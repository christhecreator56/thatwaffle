"""
Windows Excel to Website Live Sync Agent - Main Service Loop
Orchestrates file watching, debounce, reading, content hashing, offline queueing,
exponential backoff, and periodic reconciliation.
"""
import os
import sys
import time
import signal
import logging
import argparse
import threading
try:
    from .config import AgentConfig
    from .excel_reader import read_all_configured_sheets
    from .file_watcher import WorkbookWatcher
    from .retry_queue import RetryQueue
    from .sync_client import SyncClient
except (ImportError, ValueError):
    _curr_dir = os.path.dirname(os.path.abspath(__file__))
    if _curr_dir not in sys.path:
        sys.path.insert(0, _curr_dir)
    from config import AgentConfig
    from excel_reader import read_all_configured_sheets
    from file_watcher import WorkbookWatcher
    from retry_queue import RetryQueue
    from sync_client import SyncClient

logger = logging.getLogger("sync_agent")

def setup_logging(log_file, log_level_str="INFO", verbose=False):
    """
    Configures structured logging to console and log file with timestamps.
    """
    level = logging.DEBUG if verbose else getattr(logging, log_level_str, logging.INFO)
    fmt = "%(asctime)s [%(levelname)s] [%(name)s] %(message)s"
    datefmt = "%Y-%m-%d %H:%M:%S"

    handlers = [logging.StreamHandler(sys.stdout)]
    if log_file:
        try:
            os.makedirs(os.path.dirname(os.path.abspath(log_file)), exist_ok=True)
            handlers.append(logging.FileHandler(log_file, encoding="utf-8"))
        except Exception as e:
            sys.stderr.write(f"Warning: could not open log file '{log_file}': {e}\n")

    logging.basicConfig(level=level, format=fmt, datefmt=datefmt, handlers=handlers)

class SyncAgent:
    def __init__(self, config: AgentConfig, dry_run=False):
        self.config = config
        self.dry_run = dry_run
        self.running = False
        self._shutdown_event = threading.Event()
        self._worker_thread = None
        self._watcher = None

        # Content hashes for change detection: sheet_name -> content_hash
        self.last_sheet_hashes = {}

        # Components
        self.queue = RetryQueue(db_path=config.queue_db_path)
        self.client = SyncClient(
            ingest_url=config.ingest_url,
            device_id=config.device_id,
            device_key=config.device_key,
            status_url=config.status_url
        )

    def scan_and_enqueue(self, is_reconciliation=False, reason="file_change"):
        """
        Reads workbook, checks for content hash changes, and enqueues changed sheets.
        Returns total number of sheets enqueued.
        """
        wb_path = self.config.workbook_path
        if not wb_path or not str(wb_path).strip():
            logger.info("No workbook connected yet. Connect your Excel file through the website UI.")
            return 0
        if not os.path.exists(wb_path):
            logger.warning(f"Target workbook not found at: {wb_path}. Waiting for file creation...")
            return 0

        logger.info(f"Scanning workbook: {os.path.basename(wb_path)} (trigger: {reason})")
        try:
            sheet_results = read_all_configured_sheets(wb_path, self.config.sheets)
        except Exception as e:
            logger.error(f"Failed reading Excel workbook: {e}", exc_info=True)
            return 0

        enqueued_count = 0
        sync_version = int(time.time() * 1000)

        for res in sheet_results:
            sheet_name = res["sheet_name"]
            records = res["records"]
            content_hash = res["content_hash"]
            warnings = res.get("warnings", [])

            for w in warnings:
                logger.warning(f"[{sheet_name}] {w}")

            # If sheet was not present in the workbook at all, skip enqueueing
            if not content_hash and not records and any("not found in workbook" in w for w in warnings):
                continue

            # Check if content has changed since last sync
            previous_hash = self.last_sheet_hashes.get(sheet_name)
            if previous_hash == content_hash and not is_reconciliation:
                logger.debug(f"Sheet '{sheet_name}' content hash unchanged ({content_hash[:8]}...). Skipping sync.")
                continue

            logger.info(
                f"Sheet '{sheet_name}': {len(records)} active rows found (hash: {content_hash[:8]}...). Enqueueing sync payload..."
            )

            payload = {
                "device_id": self.config.device_id,
                "sheet_name": sheet_name,
                "sync_version": sync_version,
                "is_full_sync": True,
                "content_hash": content_hash,
                "records": records
            }

            if self.dry_run:
                logger.info(f"[DRY RUN] Would enqueue payload for '{sheet_name}' with {len(records)} records.")
                self.last_sheet_hashes[sheet_name] = content_hash
                continue

            self.queue.enqueue(payload)
            self.last_sheet_hashes[sheet_name] = content_hash
            enqueued_count += 1

        return enqueued_count

    def drain_queue_once(self):
        """
        Processes pending items from the local SQLite queue.
        """
        if self.dry_run:
            return

        ready_items = self.queue.peek_ready(limit=5)
        for item in ready_items:
            item_id = item["id"]
            sheet_name = item["sheet_name"]
            payload = item["payload"]
            retry_count = item["retry_count"]

            logger.info(f"Dispatching sync batch #{item_id} for sheet '{sheet_name}' (retry count: {retry_count})...")
            result = self.client.send_batch(payload)

            if result["ok"]:
                data = result.get("data", {})
                upserted = data.get("upserted", 0)
                reconciled = data.get("deletions_reconciled", 0)
                logger.info(
                    f"Sync batch #{item_id} accepted: {upserted} upserted, {reconciled} deletions reconciled."
                )
                self.queue.mark_success(item_id)
            else:
                err = result.get("error")
                status = result.get("status_code")
                logger.warning(
                    f"Sync batch #{item_id} rejected (HTTP {status}): {err}"
                )
                self.queue.mark_failed(
                    item_id=item_id,
                    error_message=err,
                    backoff_base=self.config.retry_backoff_base,
                    max_retries=self.config.max_retries
                )

    def _on_file_changed(self, filepath):
        """
        Callback invoked by WorkbookWatcher when debounce and stability checks pass.
        """
        logger.info(f"File change verified for: {filepath}")
        self.scan_and_enqueue(is_reconciliation=False, reason="file_modified")
        self.drain_queue_once()

    def _background_worker(self):
        """
        Background loop draining queue, hot-reloading workbook path changes from website,
        and triggering periodic reconciliation.
        """
        last_reconcile = time.time()
        last_cfg_check = 0
        cfg_path = getattr(self.config, 'config_file_path', None)
        if not cfg_path:
            cfg_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')

        while not self._shutdown_event.is_set():
            try:
                self.drain_queue_once()
            except Exception as e:
                logger.error(f"Error in queue drain worker: {e}", exc_info=True)

            now = time.time()
            # Check for dynamic workbook connection changes from website every 3s
            if now - last_cfg_check >= 3.0:
                last_cfg_check = now
                if os.path.exists(cfg_path):
                    try:
                        with open(cfg_path, 'r', encoding='utf-8') as cf:
                            cdata = json.load(cf)
                        new_wb = cdata.get('workbook_path', '')
                        if new_wb and not os.path.isabs(new_wb):
                            new_wb = os.path.normpath(os.path.join(os.path.dirname(cfg_path), new_wb))
                        elif new_wb:
                            new_wb = os.path.normpath(new_wb)

                        current_wb = self.config.workbook_path or ''
                        if new_wb != current_wb:
                            logger.info(f"Workbook connection update detected from website: '{new_wb}'")
                            self.config.workbook_path = new_wb
                            if self._watcher:
                                self._watcher.stop()
                                self._watcher = None

                            if new_wb and os.path.exists(new_wb):
                                self._watcher = WorkbookWatcher(
                                    target_filepath=new_wb,
                                    on_change_callback=self._on_file_changed,
                                    debounce_seconds=self.config.debounce_seconds,
                                    stability_timeout=self.config.file_stability_timeout_seconds
                                )
                                self._watcher.start()
                                logger.info(f"Started live file watcher for: {new_wb}")
                                self.scan_and_enqueue(is_reconciliation=True, reason="website_connect")
                                self.drain_queue_once()
                            else:
                                logger.info("Workbook disconnected. Watcher paused.")
                    except Exception as ex:
                        logger.debug(f"Config poll notice: {ex}")

            if now - last_reconcile >= self.config.reconciliation_interval_seconds:
                logger.info("Executing periodic reconciliation scan...")
                self.scan_and_enqueue(is_reconciliation=True, reason="periodic_reconciliation")
                last_reconcile = now

            self._shutdown_event.wait(timeout=2.0)

    def start(self):
        """
        Starts the Live Sync Agent service.
        """
        self.running = True
        logger.info(f"============================================================")
        logger.info(f"That Waffle Place: Windows Excel Live Sync Agent Starting...")
        logger.info(f"Device ID:         {self.config.device_id}")
        logger.info(f"Workbook Path:     {self.config.workbook_path or '(None - Standby)'}")
        logger.info(f"Ingest URL:        {self.config.ingest_url}")
        logger.info(f"Reconciliation:    Every {self.config.reconciliation_interval_seconds}s")
        logger.info(f"Sheets Configured: {[s.get('sheet_name') for s in self.config.sheets]}")
        logger.info(f"============================================================")

        # 1. Startup check of existing queue
        stats = self.queue.get_stats()
        if stats["pending"] > 0:
            logger.info(f"Found {stats['pending']} pending batches in local offline queue from previous session.")

        # 2. Initial sync (only if workbook configured)
        if self.config.workbook_path and os.path.exists(self.config.workbook_path):
            logger.info("Performing initial startup sync pass...")
            self.scan_and_enqueue(is_reconciliation=True, reason="startup_initial_sync")
            self.drain_queue_once()
        else:
            logger.info("Agent in Standby: No workbook connected by default. Waiting for connection from website UI.")

        # 3. Start background queue worker
        self._worker_thread = threading.Thread(target=self._background_worker, name="QueueWorkerThread", daemon=True)
        self._worker_thread.start()

        # 4. Start file watcher if workbook configured
        if self.config.workbook_path and os.path.exists(self.config.workbook_path):
            self._watcher = WorkbookWatcher(
                target_filepath=self.config.workbook_path,
                on_change_callback=self._on_file_changed,
                debounce_seconds=self.config.debounce_seconds,
                stability_timeout=self.config.file_stability_timeout_seconds
            )
            self._watcher.start()
            logger.info("Sync Agent active and watching for Excel workbook changes.")
        else:
            logger.info("Live watcher idle until a workbook is connected through the website.")

    def run_forever(self):
        self.start()
        try:
            while not self._shutdown_event.is_set():
                time.sleep(1)
        except (KeyboardInterrupt, SystemExit):
            self.stop()

    def stop(self):
        if not self.running:
            return
        logger.info("Stopping Live Sync Agent...")
        self.running = False
        self._shutdown_event.set()

        if self._watcher:
            self._watcher.stop()
        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=3)

        logger.info("Live Sync Agent stopped cleanly.")

def main():
    parser = argparse.ArgumentParser(description="That Waffle Place: Windows Excel Live Sync Agent")
    parser.add_argument("--config", "-c", default="config.json", help="Path to config.json file")
    parser.add_argument("--once", action="store_true", help="Perform a single sync pass and exit")
    parser.add_argument("--dry-run", action="store_true", help="Inspect and hash workbook without sending")
    parser.add_argument("--verbose", "-v", action="store_true", help="Enable verbose debug logging")
    args = parser.parse_args()

    # Locate config file
    config_path = args.config
    if not os.path.exists(config_path):
        # Look in same directory as this script
        fallback = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
        if os.path.exists(fallback):
            config_path = fallback

    try:
        cfg = AgentConfig.load_from_file(config_path)
    except Exception as e:
        sys.stderr.write(f"Configuration error: {e}\n")
        sys.exit(1)

    errors = cfg.validate()
    if errors:
        sys.stderr.write("Configuration validation failed:\n")
        for err in errors:
            sys.stderr.write(f" - {err}\n")
        sys.exit(1)

    setup_logging(log_file=cfg.log_file, log_level_str=cfg.log_level, verbose=args.verbose)

    agent = SyncAgent(config=cfg, dry_run=args.dry_run)

    # Clean signal handling
    def _sig_handler(sig, frame):
        logger.info(f"Received signal {sig}. Exiting...")
        agent.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, _sig_handler)
    signal.signal(signal.SIGTERM, _sig_handler)

    if args.once:
        logger.info("Running in single-pass mode (--once)...")
        agent.scan_and_enqueue(is_reconciliation=True, reason="cli_once")
        agent.drain_queue_once()
        logger.info("Single pass complete.")
    else:
        agent.run_forever()

if __name__ == "__main__":
    main()
