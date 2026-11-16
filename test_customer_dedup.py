import unittest
import os
import json
import tempfile
import sys
from bs4 import BeautifulSoup

# Ensure thatwaffle is in python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import local_db

class TestCustomerDeduplication(unittest.TestCase):
    def setUp(self):
        # Use a temporary db file to isolate tests
        self.tmp_fd, self.tmp_path = tempfile.mkstemp(suffix='.json')
        os.close(self.tmp_fd)
        with open(self.tmp_path, 'w', encoding='utf-8') as f:
            json.dump({'customers': [], 'offers': [], 'menu': [], 'synced_records': []}, f)
        self.orig_db_file = local_db.DB_FILE
        local_db.DB_FILE = self.tmp_path

    def tearDown(self):
        local_db.DB_FILE = self.orig_db_file
        if os.path.exists(self.tmp_path):
            os.remove(self.tmp_path)

    def test_single_customer_add_and_duplicate_rejection(self):
        # 1. Add first customer
        status, res = local_db.handle_post('customers', {
            'name': 'Rahul Sharma',
            'phone': '+919876543210',
            'source': 'counter'
        })
        self.assertEqual(status, 201)
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]['name'], 'Rahul Sharma')

        # 2. Try to add duplicate phone with same name -> must return 409
        status, res = local_db.handle_post('customers', {
            'name': 'Rahul Sharma',
            'phone': '+919876543210',
            'source': 'counter'
        })
        self.assertEqual(status, 409)
        self.assertIn('already exists', res['message'])

        # 3. Try to add duplicate phone with DIFFERENT name -> must return 409 (phone is PK)
        status, res = local_db.handle_post('customers', {
            'name': 'Another Person',
            'phone': '9876543210', # un-prefixed
            'source': 'counter'
        })
        self.assertEqual(status, 409)
        self.assertIn('already exists', res['message'])

    def test_same_name_different_phone_is_allowed(self):
        # 1. Add Rahul with Phone 1
        status1, res1 = local_db.handle_post('customers', {
            'name': 'Rahul Sharma',
            'phone': '+919876543210',
            'source': 'counter'
        })
        self.assertEqual(status1, 201)

        # 2. Add Rahul with Phone 2 (Names CAN be the same)
        status2, res2 = local_db.handle_post('customers', {
            'name': 'Rahul Sharma',
            'phone': '+919876543211',
            'source': 'counter'
        })
        self.assertEqual(status2, 201)

        db = local_db.load_db()
        self.assertEqual(len(db['customers']), 2)
        self.assertEqual(db['customers'][0]['name'], 'Rahul Sharma')
        self.assertEqual(db['customers'][1]['name'], 'Rahul Sharma')
        self.assertNotEqual(db['customers'][0]['phone'], db['customers'][1]['phone'])

    def test_batch_import_deduplication(self):
        # Seed DB with one customer
        local_db.handle_post('customers', {
            'name': 'Existing Customer',
            'phone': '+919876543210'
        })

        # Batch import:
        # Row 1: Existing phone -> should be skipped
        # Row 2: New customer A -> should be added
        # Row 3: Same name as Row 2, but new phone -> should be added
        # Row 4: Duplicate of Row 2 within batch -> should be skipped
        batch = [
            {'name': 'Duplicate Guy', 'phone': '9876543210'},
            {'name': 'Priya Patel', 'phone': '9123456780'},
            {'name': 'Priya Patel', 'phone': '9123456781'},
            {'name': 'Priya Copy', 'phone': '+919123456780'},
        ]

        status, created = local_db.handle_post('customers', batch)
        self.assertEqual(status, 201)
        self.assertEqual(len(created), 2)
        phones_created = [c['phone'] for c in created]
        self.assertIn('+919123456780', [local_db._normalize_phone(p) for p in phones_created])
        self.assertIn('+919123456781', [local_db._normalize_phone(p) for p in phones_created])

        db = local_db.load_db()
        # Total in DB should be 3 (1 initial + 2 new)
        self.assertEqual(len(db['customers']), 3)

    def test_html_label_accessibility_compliance(self):
        admin_html = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'site', 'admin', 'index.html')
        with open(admin_html, 'r', encoding='utf-8') as f:
            soup = BeautifulSoup(f.read(), 'html.parser')

        all_ids = set(tag.get('id') for tag in soup.find_all(id=True))
        labelable_tags = {'input', 'textarea', 'select', 'progress', 'meter', 'output'}

        for label in soup.find_all('label'):
            target_id = label.get('for')
            if target_id:
                self.assertIn(target_id, all_ids, f"<label for='{target_id}'> target does not exist in DOM!")
                target_elem = soup.find(id=target_id)
                self.assertIn(target_elem.name, labelable_tags,
                    f"<label for='{target_id}'> targets non-labelable tag <{target_elem.name}>! Must be input, textarea, or select.")

if __name__ == '__main__':
    unittest.main()
