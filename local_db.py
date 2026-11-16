import json
import os
import re
import uuid
import datetime
import urllib.parse

def _normalize_phone(raw):
    digits = re.sub(r'\D', '', str(raw or ''))
    if digits.startswith('0091') and len(digits) == 14:
        digits = digits[4:]
    elif digits.startswith('91') and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith('0') and len(digits) == 11:
        digits = digits[1:]
    if len(digits) == 10:
        return '+91' + digits
    if len(digits) >= 10:
        return '+' + digits
    return ('+' + digits) if digits else ''

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'local_db.json')

def load_db():
    if not os.path.exists(DB_FILE):
        initial = {
            "customers": [],
            "broadcasts": [],
            "broadcast_logs": [],
            "synced_records": [],
            "sync_devices": [],
            "sync_logs": []
        }
        save_db(initial)
        return initial
    try:
        with open(DB_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            for k in ("synced_records", "sync_devices", "sync_logs"):
                if k not in data:
                    data[k] = []
            return data
    except Exception:
        return {"customers": [], "broadcasts": [], "broadcast_logs": [], "synced_records": [], "sync_devices": [], "sync_logs": []}

def save_db(data):
    with open(DB_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

def _parse_iso(s):
    if not s:
        return None
    raw = str(s).strip()
    try:
        if raw.endswith('Z') or raw.endswith('z'):
            raw = raw[:-1] + '+00:00'
        return datetime.datetime.fromisoformat(raw)
    except Exception:
        return None

def filter_records(records, query_params):
    res = records[:]
    for key, values in query_params.items():
        val = values[0] if isinstance(values, list) else values
        if key.startswith('order'):
            # e.g. order=opted_in_at.desc
            parts = val.split('.')
            col = parts[0]
            descending = len(parts) > 1 and parts[1].lower() == 'desc'
            res.sort(key=lambda x: str(x.get(col, '')), reverse=descending)
        elif key.startswith('select'):
            continue
        elif '=' in val or key in ('id', 'phone', 'is_subscribed', 'status', 'scheduled_at'):
            # Handle operator e.g. id=eq.123 or is_subscribed=eq.true
            if val.startswith('eq.'):
                target = val[3:]
                if target.lower() == 'true': target = True
                elif target.lower() == 'false': target = False
                res = [r for r in res if r.get(key) == target]
            elif val.startswith('lte.'):
                target = val[4:]
                t_dt = _parse_iso(target)
                if t_dt:
                    def _is_lte(rec):
                        r_dt = _parse_iso(rec.get(key))
                        if r_dt:
                            if r_dt.tzinfo is None:
                                r_dt = r_dt.replace(tzinfo=datetime.timezone.utc)
                            t_utc = t_dt if t_dt.tzinfo is not None else t_dt.replace(tzinfo=datetime.timezone.utc)
                            return r_dt <= t_utc
                        return str(rec.get(key, '')) <= target
                    res = [r for r in res if _is_lte(r)]
                else:
                    res = [r for r in res if str(r.get(key, '')) <= target]
    return res

def handle_get(table, query_params):
    db = load_db()
    records = db.get(table, [])
    filtered = filter_records(records, query_params)
    return 200, filtered

def handle_post(table, data):
    db = load_db()
    if table not in db:
        db[table] = []

    items = data if isinstance(data, list) else [data]
    created = []
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    for item in items:
        record = dict(item)
        if table == 'offers':
            s, e = str(record.get('starts_on') or ''), str(record.get('ends_on') or '')
            if s and e and e < s:
                return 400, {'message': 'End date cannot be before start date.'}
        if 'id' not in record or not record['id']:
            record['id'] = str(uuid.uuid4())
        if 'opted_in_at' not in record and table == 'customers':
            record['opted_in_at'] = now_iso
        if 'created_at' not in record:
            record['created_at'] = now_iso

        # Upsert if phone already exists in customers
        if table == 'customers' and 'phone' in record:
            existing_idx = next((i for i, r in enumerate(db[table]) if r.get('phone') == record['phone']), None)
            if existing_idx is not None:
                db[table][existing_idx].update(record)
                created.append(db[table][existing_idx])
                continue

        db[table].append(record)
        created.append(record)

    save_db(db)
    return 201, created

def handle_patch(table, query_params, patch_data):
    db = load_db()
    records = db.get(table, [])
    updated = []

    target_id = None
    for k, v in query_params.items():
        val = v[0] if isinstance(v, list) else v
        if k == 'id' and val.startswith('eq.'):
            target_id = val[3:]

    for r in records:
        if target_id is None or r.get('id') == target_id:
            if table == 'offers':
                merged = dict(r)
                merged.update(patch_data)
                s, e = str(merged.get('starts_on') or ''), str(merged.get('ends_on') or '')
                if s and e and e < s:
                    return 400, {'message': 'End date cannot be before start date.'}
            r.update(patch_data)
            updated.append(r)

    save_db(db)
    return 200, updated

def handle_delete(table, query_params):
    db = load_db()
    records = db.get(table, [])

    eq_filters = {}
    for k, v in query_params.items():
        val = v[0] if isinstance(v, list) else v
        if isinstance(val, str) and val.startswith('eq.'):
            eq_filters[k] = val[3:]

    if eq_filters:
        db[table] = [
            r for r in records
            if not all(str(r.get(k, '')) == fv for k, fv in eq_filters.items())
        ]
        save_db(db)
    return 200, []

def handle_rpc(func_name, data):
    db = load_db()
    if func_name == 'opt_out_customer':
        phone = _normalize_phone(data.get('target_phone', ''))
        if not phone:
            return 200, False
        found = False
        for c in db.get('customers', []):
            if _normalize_phone(c.get('phone', '')) == phone:
                c['is_subscribed'] = False
                c['unsubscribed_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                found = True
        save_db(db)
        return 200, found
    return 200, True

def handle_sync_ingest(device_id, sheet_name, sync_version, is_full_sync, records, content_hash=None):
    """
    Idempotent batched upsert and safe deletion reconciliation for synced records.
    """
    db = load_db()
    if 'synced_records' not in db:
        db['synced_records'] = []
    if 'sync_logs' not in db:
        db['sync_logs'] = []
    if 'sync_devices' not in db:
        db['sync_devices'] = []

    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    # Track / update device
    device_entry = next((d for d in db['sync_devices'] if d.get('device_id') == device_id), None)
    if device_entry:
        device_entry['last_seen_at'] = now_iso
    else:
        db['sync_devices'].append({
            'device_id': device_id or 'unknown-device',
            'device_name': f"Device {device_id or 'unknown'}",
            'is_active': True,
            'last_seen_at': now_iso,
            'created_at': now_iso
        })

    upserted_count = 0
    incoming_row_ids = set()

    for item in records:
        row_id = str(item.get('row_id') or '').strip()
        if not row_id:
            continue
        incoming_row_ids.add(row_id)
        row_num = item.get('row_number')
        row_data = item.get('data') or {}
        row_hash = item.get('content_hash') or ''

        # Search existing record for (sheet_name, row_id)
        existing = next(
            (r for r in db['synced_records'] if r.get('sheet_name') == sheet_name and r.get('row_id') == row_id),
            None
        )

        if existing:
            existing['data'] = row_data
            existing['row_number'] = row_num
            existing['content_hash'] = row_hash
            existing['sync_version'] = sync_version
            existing['is_deleted'] = False
            existing['device_id'] = device_id
            existing['synced_at'] = now_iso
            upserted_count += 1
        else:
            db['synced_records'].append({
                'id': str(uuid.uuid4()),
                'sheet_name': sheet_name,
                'row_id': row_id,
                'row_number': row_num,
                'data': row_data,
                'content_hash': row_hash,
                'sync_version': sync_version,
                'is_deleted': False,
                'device_id': device_id,
                'created_at': now_iso,
                'synced_at': now_iso
            })
            upserted_count += 1

    # Safe deletion reconciliation: Only if full sync is declared
    deleted_count = 0
    if is_full_sync:
        for r in db['synced_records']:
            if r.get('sheet_name') == sheet_name and not r.get('is_deleted', False):
                if r.get('row_id') not in incoming_row_ids:
                    r['is_deleted'] = True
                    r['synced_at'] = now_iso
                    r['sync_version'] = sync_version
                    deleted_count += 1

    # When syncing Customers sheet (or any sheet since workbook is used only for customers)
    is_customer_sheet = sheet_name.lower() in ('customers', 'customer', 'customer_list', 'clients', 'sheet1', 'sheet_1') or True
    if is_customer_sheet:
        if 'customers' not in db:
            db['customers'] = []

        valid_excel_phones = set()
        for item in records:
            row_data = item.get('data') or {}
            raw_phone = (
                row_data.get('phone') or
                row_data.get('mobile') or
                row_data.get('mobile_number') or
                row_data.get('contact') or
                row_data.get('whatsapp') or
                item.get('row_id')
            )
            phone = _normalize_phone(raw_phone)
            if re.match(r'^\+91[0-9]{10}$', phone) or re.match(r'^\+[0-9]{10,15}$', phone):
                valid_excel_phones.add(phone)
                name = str(row_data.get('name') or row_data.get('customer_name') or '').strip()
                if not name or name.lower() == 'none':
                    name = 'Customer'

                custom_fields = {
                    k: v for k, v in row_data.items()
                    if k not in ('phone', 'mobile', 'mobile_number', 'contact', 'whatsapp', 'name', 'customer_name', 'notes') and v is not None and str(v).strip() != ''
                }

                existing_c = next((c for c in db['customers'] if _normalize_phone(c.get('phone')) == phone), None)
                if existing_c:
                    if name != 'Customer':
                        existing_c['name'] = name
                    existing_c['is_subscribed'] = True
                    existing_c['unsubscribed_at'] = None
                    existing_c['source'] = 'import'
                    if row_data.get('notes'):
                        existing_c['notes'] = row_data.get('notes')
                    existing_c['custom_fields'] = custom_fields
                    existing_c['updated_at'] = now_iso
                else:
                    db['customers'].append({
                        'id': str(uuid.uuid4()),
                        'name': name,
                        'phone': phone,
                        'notes': row_data.get('notes') or '',
                        'custom_fields': custom_fields,
                        'is_subscribed': True,
                        'opted_in_at': now_iso,
                        'source': 'import'
                    })

        # If full sync, reconcile customers previously imported via Excel that were removed
        if is_full_sync and valid_excel_phones:
            for c in db['customers']:
                if c.get('source') == 'import' and _normalize_phone(c.get('phone')) not in valid_excel_phones:
                    c['is_subscribed'] = False
                    c['unsubscribed_at'] = now_iso

    # Log sync event
    db['sync_logs'].append({
        'id': str(uuid.uuid4()),
        'device_id': device_id,
        'sheet_name': sheet_name,
        'sync_version': sync_version,
        'is_full_sync': is_full_sync,
        'records_count': len(records),
        'upserted_count': upserted_count,
        'deleted_count': deleted_count,
        'content_hash': content_hash,
        'status': 'success',
        'created_at': now_iso
    })

    save_db(db)
    return upserted_count, deleted_count

def get_sync_status():
    """
    Returns high-level status of synchronized sheets and devices.
    """
    db = load_db()
    records = db.get('synced_records', [])
    devices = db.get('sync_devices', [])
    logs = db.get('sync_logs', [])

    sheets_summary = {}
    for r in records:
        sheet = r.get('sheet_name', 'default')
        if sheet not in sheets_summary:
            sheets_summary[sheet] = {
                'active_records': 0,
                'deleted_records': 0,
                'total_records': 0,
                'last_synced_at': None,
                'latest_version': 0
            }
        sheets_summary[sheet]['total_records'] += 1
        if r.get('is_deleted', False):
            sheets_summary[sheet]['deleted_records'] += 1
        else:
            sheets_summary[sheet]['active_records'] += 1

        v = r.get('sync_version') or 0
        if v > sheets_summary[sheet]['latest_version']:
            sheets_summary[sheet]['latest_version'] = v
        sync_at = r.get('synced_at')
        if sync_at and (not sheets_summary[sheet]['last_synced_at'] or sync_at > sheets_summary[sheet]['last_synced_at']):
            sheets_summary[sheet]['last_synced_at'] = sync_at

    last_log = logs[-1] if logs else None

    # Retrieve connected workbook details from sync_agent/config.json
    wb_info = {
        'path': None,
        'filename': None,
        'exists': False,
        'last_modified': None,
        'size_bytes': 0
    }
    cfg_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sync_agent', 'config.json')
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, 'r', encoding='utf-8') as cf:
                cfg_data = json.load(cf)
            raw_wb = cfg_data.get('workbook_path')
            if raw_wb:
                if not os.path.isabs(raw_wb):
                    wb_abs = os.path.normpath(os.path.join(os.path.dirname(cfg_path), raw_wb))
                else:
                    wb_abs = os.path.normpath(raw_wb)
                wb_info['path'] = wb_abs
                wb_info['filename'] = os.path.basename(wb_abs)
                if os.path.exists(wb_abs):
                    wb_info['exists'] = True
                    wb_info['last_modified'] = datetime.datetime.fromtimestamp(os.path.getmtime(wb_abs)).isoformat()
                    wb_info['size_bytes'] = os.path.getsize(wb_abs)
        except Exception:
            pass

    return {
        'status': 'healthy',
        'sheets': sheets_summary,
        'total_active_records': sum(s['active_records'] for s in sheets_summary.values()),
        'devices': devices,
        'last_sync': last_log,
        'connected_workbook': wb_info
    }

def reset_sync_data(keep_counter_customers=True):
    """
    Clears all synced records and sync logs to allow connecting Excel live fresh.
    Also clears SQLite queue and resets workbook rows.
    """
    db = load_db()
    db['synced_records'] = []
    db['sync_logs'] = []
    if not keep_counter_customers:
        db['customers'] = []
    else:
        # Keep non-imported customers (counter opt-ins)
        db['customers'] = [c for c in db.get('customers', []) if c.get('source') != 'import']
    save_db(db)

    # Clean local queue db
    queue_db = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sync_agent', 'sync_queue.db')
    if os.path.exists(queue_db):
        try:
            import sqlite3
            conn = sqlite3.connect(queue_db)
            conn.execute('DELETE FROM sync_queue')
            conn.commit()
            conn.close()
        except Exception:
            pass

    return {"success": True, "message": "Synced records and logs have been reset fresh."}


