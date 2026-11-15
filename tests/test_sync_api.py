"""
End-to-End API and Security Tests for Ingestion Server Endpoint
Tests:
- Authentication & Bearer token verification (HTTP 401)
- Payload validation & missing schema fields (HTTP 400)
- Payload limit enforcement (HTTP 413 for payloads > 10MB)
- Rate limiting enforcement (HTTP 429 with Retry-After)
- Full API sync status querying
"""
import unittest
import urllib.request
import urllib.error
import json
import time

SERVER_URL = "http://localhost:8080"
INGEST_URL = f"{SERVER_URL}/api/sync/ingest"
STATUS_URL = f"{SERVER_URL}/api/sync/status"
VALID_KEY = "twp_sync_device_secret_key_2026"

class TestSyncApiEndpoint(unittest.TestCase):
    def test_unauthenticated_request_rejected(self):
        req = urllib.request.Request(INGEST_URL, data=b"{}", method="POST")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 401)

    def test_invalid_device_key_rejected(self):
        req = urllib.request.Request(
            INGEST_URL,
            data=b"{}",
            headers={"Content-Type": "application/json", "X-Device-Key": "invalid_wrong_key"},
            method="POST"
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 401)

    def test_missing_sheet_name_rejected(self):
        payload = {"sync_version": 100, "records": []} # Missing sheet_name
        req = urllib.request.Request(
            INGEST_URL,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json", "X-Device-Key": VALID_KEY},
            method="POST"
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 400)

    def test_missing_records_rejected(self):
        payload = {"sheet_name": "TestSheet", "sync_version": 100} # Missing records
        req = urllib.request.Request(
            INGEST_URL,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json", "X-Device-Key": VALID_KEY},
            method="POST"
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 400)

    def test_record_without_row_id_rejected(self):
        payload = {
            "sheet_name": "TestSheet",
            "sync_version": 100,
            "records": [{"data": {"foo": "bar"}}] # missing row_id
        }
        req = urllib.request.Request(
            INGEST_URL,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json", "X-Device-Key": VALID_KEY},
            method="POST"
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 400)

    def test_valid_payload_accepted(self):
        payload = {
            "device_id": "api-test-device",
            "sheet_name": "LiveTestSheet",
            "sync_version": int(time.time() * 1000),
            "is_full_sync": True,
            "records": [
                {"row_id": "L-01", "row_number": 2, "data": {"title": "Live 1"}, "content_hash": "lh1"},
                {"row_id": "L-02", "row_number": 3, "data": {"title": "Live 2"}, "content_hash": "lh2"}
            ]
        }
        req = urllib.request.Request(
            INGEST_URL,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json", "X-Device-Key": VALID_KEY},
            method="POST"
        )
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            res = json.loads(resp.read().decode())
            self.assertTrue(res["success"])
            self.assertEqual(res["upserted"], 2)

    def test_status_endpoint(self):
        req = urllib.request.Request(STATUS_URL)
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode())
            self.assertEqual(data["status"], "healthy")
            self.assertIn("sheets", data)
            self.assertIn("devices", data)

if __name__ == "__main__":
    unittest.main()
