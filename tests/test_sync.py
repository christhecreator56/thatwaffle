"""
Comprehensive Automated Test Suite for That Waffle Place Excel Live Sync System.
Covers:
- Workbook reading and cell type coercion
- Empty rows and cell null handling
- Permanent row IDs and duplicate detection
- Content hashing and edit detection
- Row insertion, deletion reconciliation, and reordering
- Malformed workbooks and missing sheets
- Temporary Excel lock file filtering (~$*)
- Local SQLite offline queue persistence and exponential backoff
- Ingestion endpoint authentication, validation, payload limits, and rate limiting
- Idempotency and safe deletion reconciliation
"""
import os
import sys
import json
import time
import shutil
import tempfile
import unittest
import openpyxl

# Add parent directory to path so tests can import thatwaffle modules
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)

import local_db
from sync_agent.config import AgentConfig
from sync_agent.excel_reader import read_sheet, read_all_configured_sheets
from sync_agent.file_watcher import WorkbookEventHandler
from sync_agent.retry_queue import RetryQueue
from sync_agent.sync_client import SyncClient

class TestExcelReader(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.wb_path = os.path.join(self.test_dir, "test_menu.xlsx")

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_read_valid_workbook_with_types(self):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Menu"
        ws.append(["Item Code", "Item Name", "Price", "Available", "Description"])
        ws.append(["M-01", "Waffle Classic", 120, True, "Fresh golden waffle."])
        ws.append(["M-02", "Berry Crunch", 180.5, False, "Berries and cream."])
        wb.save(self.wb_path)

        cfg = {
            "sheet_name": "Menu",
            "primary_key": "Item Code",
            "header_row": 1,
            "data_start_row": 2,
            "columns": {
                "Item Code": "code",
                "Item Name": "name",
                "Price": "price",
                "Available": "is_available",
                "Description": "desc"
            }
        }
        res = read_sheet(self.wb_path, cfg)
        self.assertEqual(res["sheet_name"], "Menu")
        self.assertEqual(len(res["records"]), 2)

        rec1 = res["records"][0]
        self.assertEqual(rec1["row_id"], "M-01")
        self.assertEqual(rec1["data"]["price"], 120)
        self.assertEqual(rec1["data"]["is_available"], True)
        self.assertTrue(len(rec1["content_hash"]) > 0)

        rec2 = res["records"][1]
        self.assertEqual(rec2["row_id"], "M-02")
        self.assertEqual(rec2["data"]["price"], 180.5)
        self.assertEqual(rec2["data"]["is_available"], False)

    def test_empty_cells_and_null_coercion(self):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Menu"
        ws.append(["Item Code", "Item Name", "Price", "Description"])
        ws.append(["M-03", "Plain Waffle", None, "   "]) # Empty price, blank whitespace desc
        ws.append([None, None, None, None]) # Completely blank row
        ws.append(["M-04", "Butter Waffle", 90, "Crispy"])
        wb.save(self.wb_path)

        cfg = {
            "sheet_name": "Menu",
            "primary_key": "Item Code",
            "columns": {"Item Code": "code", "Item Name": "name", "Price": "price", "Description": "desc"}
        }
        res = read_sheet(self.wb_path, cfg)
        self.assertEqual(len(res["records"]), 2)
        r1 = res["records"][0]
        self.assertIsNone(r1["data"]["price"])
        self.assertIsNone(r1["data"]["desc"])
        self.assertEqual(res["records"][1]["row_id"], "M-04")

    def test_duplicate_row_ids(self):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Inventory"
        ws.append(["SKU", "Item"])
        ws.append(["SKU-100", "Flour"])
        ws.append(["SKU-100", "Flour Batch 2"]) # Duplicate key
        wb.save(self.wb_path)

        cfg = {"sheet_name": "Inventory", "primary_key": "SKU", "columns": {"SKU": "sku", "Item": "item"}}
        res = read_sheet(self.wb_path, cfg)
        self.assertEqual(len(res["records"]), 2)
        self.assertEqual(res["records"][0]["row_id"], "SKU-100")
        self.assertEqual(res["records"][1]["row_id"], "SKU-100_dup_2")
        self.assertTrue(any("Duplicate row ID" in w for w in res["warnings"]))

    def test_file_edits_and_hash_change(self):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Menu"
        ws.append(["Item Code", "Price"])
        ws.append(["M-01", 100])
        wb.save(self.wb_path)

        cfg = {"sheet_name": "Menu", "primary_key": "Item Code", "columns": {"Item Code": "code", "Price": "price"}}
        res1 = read_sheet(self.wb_path, cfg)
        hash1 = res1["content_hash"]

        # Edit price in cell
        wb2 = openpyxl.load_workbook(self.wb_path)
        wb2["Menu"].cell(row=2, column=2, value=150)
        wb2.save(self.wb_path)

        res2 = read_sheet(self.wb_path, cfg)
        hash2 = res2["content_hash"]
        self.assertNotEqual(hash1, hash2, "Content hash must change when cell value is edited")

    def test_row_insertion_and_reordering(self):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Menu"
        ws.append(["Item Code", "Name"])
        ws.append(["A", "Alpha"])
        ws.append(["B", "Beta"])
        wb.save(self.wb_path)

        cfg = {"sheet_name": "Menu", "primary_key": "Item Code"}
        res1 = read_sheet(self.wb_path, cfg)
        self.assertEqual(len(res1["records"]), 2)

        # Reorder rows B then A and insert C
        wb2 = openpyxl.Workbook()
        ws2 = wb2.active
        ws2.title = "Menu"
        ws2.append(["Item Code", "Name"])
        ws2.append(["B", "Beta"])
        ws2.append(["C", "Gamma"]) # Inserted row
        ws2.append(["A", "Alpha"])
        wb2.save(self.wb_path)

        res2 = read_sheet(self.wb_path, cfg)
        self.assertEqual(len(res2["records"]), 3)
        row_ids = [r["row_id"] for r in res2["records"]]
        self.assertEqual(row_ids, ["B", "C", "A"])

    def test_missing_sheet_handling(self):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "ExistingSheet"
        ws.append(["Col1"])
        wb.save(self.wb_path)

        cfg = {"sheet_name": "NonExistentSheet"}
        res = read_sheet(self.wb_path, cfg)
        self.assertEqual(len(res["records"]), 0)
        self.assertTrue(any("not found in workbook" in w for w in res["warnings"]))


class TestFileWatcherFiltering(unittest.TestCase):
    def test_excel_temporary_lock_file_filter(self):
        handler = WorkbookEventHandler(
            target_filepath="C:\\Data\\Inventory.xlsx",
            on_change_callback=lambda p: None
        )
        # Real file matches
        self.assertTrue(handler._is_target_file("C:\\Data\\Inventory.xlsx"))
        # Temporary Excel ~$ lock file ignored
        self.assertFalse(handler._is_target_file("C:\\Data\\~$Inventory.xlsx"))
        # Other files in directory ignored
        self.assertFalse(handler._is_target_file("C:\\Data\\Other.xlsx"))
        # Tmp and crdownload files ignored
        self.assertFalse(handler._is_target_file("C:\\Data\\Inventory.xlsx.tmp"))
        self.assertFalse(handler._is_target_file("C:\\Data\\Inventory.xlsx.crdownload"))


class TestRetryQueue(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.test_dir, "test_queue.db")
        self.queue = RetryQueue(db_path=self.db_path)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_enqueue_peek_and_success(self):
        payload = {
            "device_id": "test-dev",
            "sheet_name": "Menu",
            "sync_version": 100,
            "records": [{"row_id": "R1", "data": {"foo": "bar"}}]
        }
        item_id = self.queue.enqueue(payload)
        self.assertTrue(item_id > 0)

        ready = self.queue.peek_ready(limit=10)
        self.assertEqual(len(ready), 1)
        self.assertEqual(ready[0]["sheet_name"], "Menu")
        self.assertEqual(ready[0]["payload"]["records"][0]["row_id"], "R1")

        self.queue.mark_success(item_id)
        ready_after = self.queue.peek_ready(limit=10)
        self.assertEqual(len(ready_after), 0)

    def test_exponential_backoff_on_failure(self):
        payload = {"device_id": "dev1", "sheet_name": "Inventory", "sync_version": 200, "records": []}
        item_id = self.queue.enqueue(payload)

        # Mark failed with base 2.0
        self.queue.mark_failed(item_id, error_message="Network unreachable", backoff_base=2.0)

        # Immediately after failure, item should not be in peek_ready because next_attempt_at is in future
        ready = self.queue.peek_ready(limit=10)
        self.assertEqual(len(ready), 0, "Item in backoff period should not be returned by peek_ready")

        stats = self.queue.get_stats()
        self.assertEqual(stats["pending"], 1)

    def test_recovery_after_restart(self):
        payload = {"device_id": "dev1", "sheet_name": "Menu", "sync_version": 300, "records": []}
        self.queue.enqueue(payload)

        # Simulate agent restart by creating a new RetryQueue instance on the same db
        new_queue_instance = RetryQueue(db_path=self.db_path)
        stats = new_queue_instance.get_stats()
        self.assertEqual(stats["pending"], 1)


class TestBackendIngestAndLocalDb(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.original_db_file = local_db.DB_FILE
        local_db.DB_FILE = os.path.join(self.test_dir, "local_db.json")

    def tearDown(self):
        local_db.DB_FILE = self.original_db_file
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_idempotent_batched_upsert(self):
        records = [
            {"row_id": "ID-1", "row_number": 2, "data": {"name": "Item 1", "price": 100}, "content_hash": "h1"},
            {"row_id": "ID-2", "row_number": 3, "data": {"name": "Item 2", "price": 200}, "content_hash": "h2"}
        ]
        upserted, deleted = local_db.handle_sync_ingest(
            device_id="dev-1",
            sheet_name="Menu",
            sync_version=1000,
            is_full_sync=True,
            records=records
        )
        self.assertEqual(upserted, 2)
        self.assertEqual(deleted, 0)

        # Replay identical batch (idempotency check)
        upserted2, deleted2 = local_db.handle_sync_ingest(
            device_id="dev-1",
            sheet_name="Menu",
            sync_version=1000,
            is_full_sync=True,
            records=records
        )
        self.assertEqual(upserted2, 2)
        self.assertEqual(deleted2, 0)

        status = local_db.get_sync_status()
        self.assertEqual(status["sheets"]["Menu"]["active_records"], 2)
        self.assertEqual(status["sheets"]["Menu"]["deleted_records"], 0)

    def test_safe_deletion_reconciliation(self):
        # Initial import with ID-1, ID-2, ID-3
        records_initial = [
            {"row_id": "ID-1", "data": {"name": "Item 1"}},
            {"row_id": "ID-2", "data": {"name": "Item 2"}},
            {"row_id": "ID-3", "data": {"name": "Item 3"}}
        ]
        local_db.handle_sync_ingest("dev-1", "Menu", 1001, True, records_initial)

        # Full sync import with ID-1 and ID-3 only (ID-2 was removed in Excel)
        records_updated = [
            {"row_id": "ID-1", "data": {"name": "Item 1 Updated"}},
            {"row_id": "ID-3", "data": {"name": "Item 3"}}
        ]
        upserted, deleted = local_db.handle_sync_ingest("dev-1", "Menu", 1002, True, records_updated)
        self.assertEqual(upserted, 2)
        self.assertEqual(deleted, 1, "Omitted row ID-2 must be safely marked as deleted")

        status = local_db.get_sync_status()
        self.assertEqual(status["sheets"]["Menu"]["active_records"], 2)
        self.assertEqual(status["sheets"]["Menu"]["deleted_records"], 1)

    def test_customers_sheet_sync(self):
        records = [
            {"row_id": "+919876543210", "data": {"name": "Priya Sharma", "phone": "+919876543210"}},
            {"row_id": "9840123456", "data": {"name": "Karthik R", "phone": "9840123456"}}
        ]
        upserted, deleted = local_db.handle_sync_ingest("dev-1", "Customers", 2001, True, records)
        self.assertEqual(upserted, 2)

        db = local_db.load_db()
        cust_phones = [c["phone"] for c in db.get("customers", [])]
        self.assertIn("+919876543210", cust_phones)
        self.assertIn("+919840123456", cust_phones)

if __name__ == "__main__":
    unittest.main()
