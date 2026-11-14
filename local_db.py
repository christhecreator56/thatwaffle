import json
import os
import re
import uuid
import datetime
import urllib.parse

def _normalize_phone(raw):
    digits = re.sub(r'\D', '', str(raw or ''))
    if len(digits) == 10 and digits[0] in '6789':
        return '+91' + digits
    return ('+' + digits) if digits else ''

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'local_db.json')

def load_db():
    if not os.path.exists(DB_FILE):
        initial = {
            "customers": [],
            "broadcasts": [],
            "broadcast_logs": []
        }
        save_db(initial)
        return initial
    try:
        with open(DB_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {"customers": [], "broadcasts": [], "broadcast_logs": []}

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
