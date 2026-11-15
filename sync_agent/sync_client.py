"""
HTTP Client for sending sync payloads to the website ingestion endpoint.
Attaches device authentication headers, enforces timeouts, and parses structured server responses.
"""
import json
import logging
import requests

logger = logging.getLogger("sync_agent.sync_client")

class SyncClient:
    def __init__(self, ingest_url, device_id, device_key, status_url=None, timeout_seconds=15):
        self.ingest_url = ingest_url
        self.status_url = status_url
        self.device_id = device_id
        self.device_key = device_key
        self.timeout_seconds = timeout_seconds

        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": f"TWP-Excel-Sync-Agent/1.0 ({device_id})",
            "Content-Type": "application/json",
            "X-Device-Id": self.device_id,
            "X-Device-Key": self.device_key
        })

    def send_batch(self, payload):
        """
        Sends a single sheet sync batch to the backend ingest endpoint.
        Returns:
            dict: {"ok": bool, "status_code": int, "data": dict, "error": str, "retry_after": int}
        """
        try:
            resp = self.session.post(
                self.ingest_url,
                json=payload,
                timeout=self.timeout_seconds
            )

            try:
                data = resp.json()
            except Exception:
                data = {"raw": resp.text}

            retry_after = 0
            if resp.status_code == 429:
                retry_header = resp.headers.get("Retry-After")
                if retry_header and retry_header.isdigit():
                    retry_after = int(retry_header)
                else:
                    retry_after = data.get("retry_after", 60)

            if resp.status_code == 200:
                return {
                    "ok": True,
                    "status_code": resp.status_code,
                    "data": data,
                    "error": None,
                    "retry_after": 0
                }
            else:
                err_msg = data.get("error") or data.get("message") or f"HTTP {resp.status_code}"
                return {
                    "ok": False,
                    "status_code": resp.status_code,
                    "data": data,
                    "error": err_msg,
                    "retry_after": retry_after
                }

        except requests.exceptions.Timeout as ex:
            return {
                "ok": False,
                "status_code": 0,
                "data": None,
                "error": f"Connection timed out after {self.timeout_seconds}s: {ex}",
                "retry_after": 5
            }
        except requests.exceptions.ConnectionError as ex:
            return {
                "ok": False,
                "status_code": 0,
                "data": None,
                "error": f"Failed to connect to ingestion server: {ex}",
                "retry_after": 5
            }
        except Exception as ex:
            return {
                "ok": False,
                "status_code": 0,
                "data": None,
                "error": f"Unexpected error during sync request: {ex}",
                "retry_after": 10
            }

    def fetch_status(self):
        """
        Queries backend sync status endpoint.
        """
        if not self.status_url:
            return None
        try:
            resp = self.session.get(self.status_url, timeout=5)
            if resp.status_code == 200:
                return resp.json()
            return None
        except Exception:
            return None
