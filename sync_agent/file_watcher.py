"""
Filesystem Watcher for Excel Workbook changes using watchdog.
Includes debounce timer, temporary lock file filtering (~$*),
and file stability polling to wait out active Windows file locks.
"""
import os
import time
import threading
import logging
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

logger = logging.getLogger("sync_agent.file_watcher")

class WorkbookEventHandler(FileSystemEventHandler):
    def __init__(self, target_filepath, on_change_callback, debounce_seconds=3.0, stability_timeout=5.0):
        super().__init__()
        self.target_filepath = os.path.normpath(os.path.abspath(target_filepath))
        self.target_filename = os.path.basename(self.target_filepath)
        self.on_change_callback = on_change_callback
        self.debounce_seconds = debounce_seconds
        self.stability_timeout = stability_timeout
        self._timer = None
        self._lock = threading.Lock()

    def _is_target_file(self, event_path):
        base = os.path.basename(event_path)
        # Strictly ignore Excel temporary lock files and autosave files
        if base.startswith("~$") or base.startswith(".~") or base.endswith(".tmp") or base.endswith(".crdownload"):
            return False
        norm = os.path.normpath(os.path.abspath(event_path))
        return norm == self.target_filepath

    def on_modified(self, event):
        if not event.is_directory and self._is_target_file(event.src_path):
            self._trigger_debounce()

    def on_created(self, event):
        if not event.is_directory and self._is_target_file(event.src_path):
            self._trigger_debounce()

    def on_moved(self, event):
        if not event.is_directory and self._is_target_file(event.dest_path):
            self._trigger_debounce()

    def _trigger_debounce(self):
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
            logger.debug(f"Detected event on workbook. Debouncing for {self.debounce_seconds}s...")
            self._timer = threading.Timer(self.debounce_seconds, self._on_debounce_complete)
            self._timer.daemon = True
            self._timer.start()

    def _wait_for_file_stability(self):
        """
        Polls until file is accessible for reading and file size is stable.
        This prevents reading while Excel is in the middle of writing or holding an exclusive lock.
        """
        deadline = time.time() + self.stability_timeout
        last_size = -1

        while time.time() < deadline:
            if not os.path.exists(self.target_filepath):
                time.sleep(0.3)
                continue

            try:
                current_size = os.path.getsize(self.target_filepath)
                # Try opening file for read to verify OS lock is released
                with open(self.target_filepath, 'rb') as f:
                    _ = f.read(1024)

                if current_size > 0 and current_size == last_size:
                    logger.debug(f"File stability confirmed: {self.target_filename} ({current_size} bytes)")
                    return True

                last_size = current_size
            except (IOError, PermissionError, OSError) as e:
                logger.debug(f"Waiting for Excel file lock release: {e}")

            time.sleep(0.4)

        # Final check
        try:
            with open(self.target_filepath, 'rb') as f:
                _ = f.read(512)
            return True
        except Exception as ex:
            logger.warning(f"File stability timeout reached; file still locked: {ex}")
            return False

    def _on_debounce_complete(self):
        with self._lock:
            self._timer = None

        logger.info(f"Debounce complete. Verifying file stability for {self.target_filename}...")
        if self._wait_for_file_stability():
            try:
                self.on_change_callback(self.target_filepath)
            except Exception as e:
                logger.error(f"Error executing on_change_callback: {e}", exc_info=True)
        else:
            logger.error(f"Could not read {self.target_filename} after stability timeout. Will retry at next reconciliation.")


class WorkbookWatcher:
    def __init__(self, target_filepath, on_change_callback, debounce_seconds=3.0, stability_timeout=5.0):
        self.target_filepath = os.path.normpath(os.path.abspath(target_filepath))
        self.watch_dir = os.path.dirname(self.target_filepath)
        self.handler = WorkbookEventHandler(
            target_filepath=self.target_filepath,
            on_change_callback=on_change_callback,
            debounce_seconds=debounce_seconds,
            stability_timeout=stability_timeout
        )
        self.observer = Observer()

    def start(self):
        if not os.path.exists(self.watch_dir):
            os.makedirs(self.watch_dir, exist_ok=True)
        self.observer.schedule(self.handler, path=self.watch_dir, recursive=False)
        self.observer.daemon = True
        self.observer.start()
        logger.info(f"Watcher started on directory: {self.watch_dir} for file: {os.path.basename(self.target_filepath)}")

    def stop(self):
        if self.observer.is_alive():
            self.observer.stop()
            self.observer.join(timeout=3)
            logger.info("Watcher stopped.")
