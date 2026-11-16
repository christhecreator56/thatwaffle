"""
Configuration loader and validator for the Windows Excel Live Sync Agent.
"""
import os
import json
import logging

logger = logging.getLogger("sync_agent.config")

DEFAULT_CONFIG = {
    "device_id": "windows-pos-01",
    "device_key": "twp_sync_device_secret_key_2026",
    "ingest_url": "http://localhost:8080/api/sync/ingest",
    "status_url": "http://localhost:8080/api/sync/status",
    "workbook_path": "",
    "debounce_seconds": 3.0,
    "file_stability_timeout_seconds": 5.0,
    "reconciliation_interval_seconds": 900,
    "max_retries": 10,
    "retry_backoff_base": 2.0,
    "queue_db_path": "sync_queue.db",
    "log_file": "sync_agent.log",
    "log_level": "INFO",
    "sheets": []
}

class AgentConfig:
    def __init__(self, data, config_dir=None):
        self.config_dir = config_dir or os.getcwd()
        self._raw = dict(DEFAULT_CONFIG)
        self._raw.update(data)

        # Resolve paths relative to config_dir if relative
        wb_path = self._raw.get("workbook_path", "")
        if wb_path and not os.path.isabs(wb_path):
            self.workbook_path = os.path.normpath(os.path.join(self.config_dir, wb_path))
        else:
            self.workbook_path = os.path.normpath(wb_path) if wb_path else ""

        q_path = self._raw.get("queue_db_path", "sync_queue.db")
        if q_path and not os.path.isabs(q_path):
            self.queue_db_path = os.path.normpath(os.path.join(self.config_dir, q_path))
        else:
            self.queue_db_path = os.path.normpath(q_path)

        log_f = self._raw.get("log_file", "sync_agent.log")
        if log_f and not os.path.isabs(log_f):
            self.log_file = os.path.normpath(os.path.join(self.config_dir, log_f))
        else:
            self.log_file = os.path.normpath(log_f)

        self.device_id = str(self._raw.get("device_id", "windows-client")).strip()
        self.device_key = str(self._raw.get("device_key", "")).strip()
        self.ingest_url = str(self._raw.get("ingest_url", "")).strip()
        self.status_url = str(self._raw.get("status_url", "")).strip()
        self.debounce_seconds = float(self._raw.get("debounce_seconds", 3.0))
        self.file_stability_timeout_seconds = float(self._raw.get("file_stability_timeout_seconds", 5.0))
        self.reconciliation_interval_seconds = int(self._raw.get("reconciliation_interval_seconds", 900))
        self.max_retries = int(self._raw.get("max_retries", 10))
        self.retry_backoff_base = float(self._raw.get("retry_backoff_base", 2.0))
        self.log_level = str(self._raw.get("log_level", "INFO")).upper()
        self.sheets = self._raw.get("sheets", [])

    def validate(self):
        errors = []
        # Note: workbook_path can be empty on startup; agent runs in standby until connected via website UI
        if not self.ingest_url:
            errors.append("Missing 'ingest_url'. Must specify target HTTP/HTTPS ingestion endpoint.")
        if not self.device_key:
            errors.append("Missing 'device_key'. Must provide per-device authentication token.")
        if not self.sheets or not isinstance(self.sheets, list):
            errors.append("Missing or invalid 'sheets' configuration. Must be a non-empty list of sheet rules.")
        else:
            for i, sheet in enumerate(self.sheets):
                if not isinstance(sheet, dict) or not sheet.get("sheet_name"):
                    errors.append(f"Sheet rule index {i} is missing 'sheet_name'.")
        return errors

    @classmethod
    def load_from_file(cls, filepath):
        abs_path = os.path.abspath(filepath)
        if not os.path.exists(abs_path):
            raise FileNotFoundError(f"Configuration file not found: {abs_path}")
        with open(abs_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls(data, config_dir=os.path.dirname(abs_path))
