"""
Persistent SQLite Queue for resilient offline caching and exponential backoff retry.
Batches generated during network disconnects or backend server outages are durably
saved locally and processed FIFO once connectivity is restored.
"""
import os
import sqlite3
import json
import time
import random
import logging

logger = logging.getLogger("sync_agent.retry_queue")

class RetryQueue:
    def __init__(self, db_path="sync_queue.db"):
        self.db_path = os.path.normpath(os.path.abspath(db_path))
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self._init_db()

    def _get_conn(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._get_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS sync_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id TEXT NOT NULL,
                    sheet_name TEXT NOT NULL,
                    sync_version INTEGER NOT NULL,
                    is_full_sync INTEGER NOT NULL DEFAULT 1,
                    content_hash TEXT,
                    payload_json TEXT NOT NULL,
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    last_attempt_at REAL,
                    next_attempt_at REAL NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    last_error TEXT,
                    created_at REAL NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_sync_queue_ready ON sync_queue (status, next_attempt_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_sync_queue_sheet ON sync_queue (sheet_name, status)")
            conn.commit()

    def enqueue(self, payload):
        """
        Enqueues a sync payload. If a pending payload exists for the same sheet_name,
        replaces it with this newer version so we don't spam outdated intermediate state.
        """
        device_id = str(payload.get("device_id") or "device")
        sheet_name = str(payload.get("sheet_name") or "sheet")
        sync_version = int(payload.get("sync_version") or int(time.time() * 1000))
        is_full_sync = 1 if payload.get("is_full_sync", True) else 0
        content_hash = payload.get("content_hash") or ""
        payload_str = json.dumps(payload)
        now = time.time()

        with self._get_conn() as conn:
            # Check if there is an existing pending item for this sheet
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id FROM sync_queue WHERE sheet_name = ? AND status = 'pending'",
                (sheet_name,)
            )
            existing = cursor.fetchone()
            if existing:
                # Update existing pending entry with newer payload and reset attempts
                cursor.execute("""
                    UPDATE sync_queue
                    SET sync_version = ?, is_full_sync = ?, content_hash = ?, payload_json = ?,
                        retry_count = 0, next_attempt_at = ?, created_at = ?
                    WHERE id = ?
                """, (sync_version, is_full_sync, content_hash, payload_str, now, now, existing['id']))
                queue_id = existing['id']
                logger.info(f"Updated pending queue item #{queue_id} for sheet '{sheet_name}' (v{sync_version})")
            else:
                cursor.execute("""
                    INSERT INTO sync_queue (
                        device_id, sheet_name, sync_version, is_full_sync, content_hash,
                        payload_json, retry_count, next_attempt_at, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'pending', ?)
                """, (device_id, sheet_name, sync_version, is_full_sync, content_hash, payload_str, now, now))
                queue_id = cursor.lastrowid
                logger.info(f"Enqueued new sync batch #{queue_id} for sheet '{sheet_name}' (v{sync_version})")
            conn.commit()
            return queue_id

    def peek_ready(self, limit=5):
        """
        Returns list of items ready to be sent (status = 'pending' and next_attempt_at <= now).
        """
        now = time.time()
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, device_id, sheet_name, sync_version, payload_json, retry_count
                FROM sync_queue
                WHERE status = 'pending' AND next_attempt_at <= ?
                ORDER BY id ASC
                LIMIT ?
            """, (now, limit))
            rows = cursor.fetchall()
            items = []
            for r in rows:
                items.append({
                    "id": r["id"],
                    "device_id": r["device_id"],
                    "sheet_name": r["sheet_name"],
                    "sync_version": r["sync_version"],
                    "payload": json.loads(r["payload_json"]),
                    "retry_count": r["retry_count"]
                })
            return items

    def mark_success(self, item_id):
        """
        Deletes item upon successful ingestion.
        """
        with self._get_conn() as conn:
            conn.execute("DELETE FROM sync_queue WHERE id = ?", (item_id,))
            conn.commit()
            logger.info(f"Queue item #{item_id} successfully sent and removed from local queue.")

    def mark_failed(self, item_id, error_message=None, backoff_base=2.0, max_retries=10):
        """
        Increments retry count and sets next_attempt_at with exponential backoff + jitter.
        """
        now = time.time()
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT retry_count FROM sync_queue WHERE id = ?", (item_id,))
            row = cursor.fetchone()
            if not row:
                return

            new_retry_count = row["retry_count"] + 1
            if new_retry_count >= max_retries:
                cursor.execute("""
                    UPDATE sync_queue
                    SET status = 'failed', retry_count = ?, last_attempt_at = ?, last_error = ?
                    WHERE id = ?
                """, (new_retry_count, now, str(error_message), item_id))
                logger.error(f"Queue item #{item_id} permanently failed after {new_retry_count} attempts: {error_message}")
            else:
                # Exponential backoff with jitter: delay = base^count + jitter (max 300s / 5m)
                base_delay = backoff_base ** new_retry_count
                jitter = random.uniform(0.5, 2.0)
                delay = min(300.0, base_delay + jitter)
                next_attempt = now + delay

                cursor.execute("""
                    UPDATE sync_queue
                    SET retry_count = ?, last_attempt_at = ?, next_attempt_at = ?, last_error = ?
                    WHERE id = ?
                """, (new_retry_count, now, next_attempt, str(error_message), item_id))
                logger.warning(f"Queue item #{item_id} failed (attempt {new_retry_count}/{max_retries}). Next retry in {delay:.1f}s. Error: {error_message}")
            conn.commit()

    def get_stats(self):
        """
        Returns stats on queue items.
        """
        with self._get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT status, count(*) as count FROM sync_queue GROUP BY status")
            rows = cursor.fetchall()
            stats = {"pending": 0, "failed": 0, "total": 0}
            for r in rows:
                stats[r["status"]] = r["count"]
                stats["total"] += r["count"]
            return stats
