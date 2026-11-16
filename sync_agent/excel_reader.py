"""
Excel Workbook Reader using openpyxl (strictly read-only and data-only).
Reads formulas as calculated values, safely coerces cell types, handles empty cells,
extracts permanent row IDs, and generates content hashes for change detection.
"""
import os
import hashlib
import json
import logging
import datetime
from decimal import Decimal
import openpyxl

logger = logging.getLogger("sync_agent.excel_reader")

def _is_phone_header(header_name):
    h = str(header_name or '').lower().replace(' ', '').replace('_', '').replace('-', '')
    return any(k in h for k in ('phone', 'mobile', 'whatsapp', 'contact', 'cell', 'tel', 'phno', 'mobno', 'phonenumber', 'mobilenumber'))

def _is_name_header(header_name):
    h = str(header_name or '').lower().replace(' ', '').replace('_', '').replace('-', '')
    return any(k in h for k in ('name', 'customer', 'client', 'fullname', 'person', 'customername', 'clientname'))

def _normalize_phone_str(raw):
    """
    Normalizes mobile numbers into standard +91XXXXXXXXXX format.
    """
    if raw is None:
        return None
    import re
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
    return ('+' + digits) if digits else str(raw).strip()

def _normalize_cell_value(val):
    """
    Safely converts openpyxl cell value to JSON-serializable Python type.
    """
    if val is None:
        return None
    if isinstance(val, (datetime.datetime, datetime.date)):
        return val.isoformat()
    if isinstance(val, Decimal):
        f = float(val)
        return int(f) if f.is_integer() else f
    if isinstance(val, float):
        return int(val) if val.is_integer() else val
    if isinstance(val, bool):
        return val
    if isinstance(val, int):
        return val
    if isinstance(val, str):
        trimmed = val.strip()
        return trimmed if trimmed != "" else None
    return str(val).strip()

def _compute_row_hash(data_dict):
    """
    Computes a deterministic SHA-256 hash of a dictionary.
    """
    serialized = json.dumps(data_dict, sort_keys=True, separators=(',', ':'), default=str)
    return hashlib.sha256(serialized.encode('utf-8')).hexdigest()

def read_sheet(workbook_path, sheet_config):
    """
    Reads an individual sheet from the workbook according to the sheet_config.
    Returns:
        dict: {
            "sheet_name": str,
            "records": list of dicts,
            "content_hash": str,
            "total_rows_read": int,
            "warnings": list of str
        }
    """
    sheet_name = sheet_config.get("sheet_name")
    primary_key_col = sheet_config.get("primary_key")
    header_row_num = sheet_config.get("header_row", 1)
    data_start_row_num = sheet_config.get("data_start_row", header_row_num + 1)
    col_mapping = sheet_config.get("columns", {}) # excel_col_name -> target_field_name

    warnings = []

    # Strict read-only and data-only to ensure zero writes and formula evaluation
    wb = openpyxl.load_workbook(workbook_path, read_only=True, data_only=True)
    try:
        # Auto-resolve sheet if not found directly (case-insensitive)
        if sheet_name not in wb.sheetnames:
            matched = next((s for s in wb.sheetnames if s.lower() == (sheet_name or '').lower()), None)
            if matched:
                sheet_name = matched
            else:
                msg = f"Sheet '{sheet_name}' not found in workbook. Available sheets: {wb.sheetnames}"
                logger.warning(msg)
                warnings.append(msg)
                return {
                    "sheet_name": sheet_name,
                    "records": [],
                    "content_hash": "",
                    "total_rows_read": 0,
                    "warnings": warnings
                }

        ws = wb[sheet_name]

        # Read headers
        headers = {} # col_index (0-based) -> excel_header_name
        current_row_idx = 0
        records = []
        seen_row_ids = {} # row_id -> count
        phone_col_idx = None
        name_col_idx = None

        for row in ws.iter_rows(values_only=True):
            current_row_idx += 1

            if current_row_idx == header_row_num:
                for idx, cell_val in enumerate(row):
                    if cell_val is not None and str(cell_val).strip():
                        h_clean = str(cell_val).strip()
                        headers[idx] = h_clean
                        if phone_col_idx is None and _is_phone_header(h_clean):
                            phone_col_idx = idx
                        elif name_col_idx is None and _is_name_header(h_clean):
                            name_col_idx = idx
                continue

            if current_row_idx < data_start_row_num:
                continue

            # Check if entire row is empty
            if not any(v is not None and str(v).strip() != "" for v in row):
                continue

            row_data = {}
            raw_primary_val = None
            detected_phone = None
            detected_name = None

            for col_idx, cell_val in enumerate(row):
                header_name = headers.get(col_idx)
                if not header_name:
                    continue

                norm_val = _normalize_cell_value(cell_val)
                target_field = col_mapping.get(header_name)
                clean_field = header_name.lower().replace(' ', '_').replace('-', '_')

                is_phone_col = (col_idx == phone_col_idx) or (target_field == 'phone') or _is_phone_header(header_name)
                is_name_col = (col_idx == name_col_idx) or (target_field == 'name') or _is_name_header(header_name)

                if is_phone_col and norm_val is not None:
                    norm_val = _normalize_phone_str(norm_val)
                    detected_phone = norm_val
                    row_data['phone'] = norm_val
                    row_data[clean_field] = norm_val
                elif is_name_col and norm_val is not None:
                    detected_name = str(norm_val).strip()
                    row_data['name'] = detected_name
                    row_data[clean_field] = detected_name
                else:
                    # Capture ANY and ALL custom columns dynamically
                    field_key = target_field if target_field else clean_field
                    row_data[field_key] = norm_val

                # Check if this column is the explicitly requested primary key
                if primary_key_col and header_name.lower() == str(primary_key_col).lower():
                    raw_primary_val = norm_val

            # Determine permanent row ID: prioritize phone number, then explicit primary key, then fallback
            if detected_phone:
                row_id = str(detected_phone).strip()
            elif raw_primary_val is not None:
                row_id = str(raw_primary_val).strip()
            else:
                row_id = f"row_{current_row_idx}"
                warnings.append(f"Row {current_row_idx} in sheet '{sheet_name}' has missing primary key '{primary_key_col}'; generated fallback ID '{row_id}'.")

            # Duplicate row ID detection
            if row_id in seen_row_ids:
                seen_row_ids[row_id] += 1
                disambiguated_id = f"{row_id}_dup_{seen_row_ids[row_id]}"
                warnings.append(f"Duplicate row ID '{row_id}' detected at row {current_row_idx}; assigned '{disambiguated_id}'.")
                row_id = disambiguated_id
            else:
                seen_row_ids[row_id] = 1

            row_hash = _compute_row_hash(row_data)

            records.append({
                "row_id": row_id,
                "row_number": current_row_idx,
                "data": row_data,
                "content_hash": row_hash
            })

        # Compute sheet-level content hash
        all_row_hashes = sorted([r["content_hash"] for r in records])
        sheet_content_hash = hashlib.sha256("".join(all_row_hashes).encode('utf-8')).hexdigest()

        return {
            "sheet_name": sheet_name,
            "records": records,
            "content_hash": sheet_content_hash,
            "total_rows_read": len(records),
            "warnings": warnings
        }
    finally:
        wb.close()

def read_all_configured_sheets(workbook_path, sheets_config):
    """
    Reads all sheets specified in configuration from the workbook.
    Returns list of sheet result dictionaries.
    """
    results = []
    for sheet_cfg in sheets_config:
        res = read_sheet(workbook_path, sheet_cfg)
        results.append(res)
    return results
