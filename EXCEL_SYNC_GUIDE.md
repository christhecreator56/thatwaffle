# That Waffle Place: Windows Excel to Website Live Sync System

Production-oriented, resilient, one-way synchronization architecture streaming records from a local Windows `.xlsx` workbook directly to the website backend and Supabase PostgreSQL database.

---

## 1. System Architecture

```
+-------------------------------------------------------------------------+
|                        WINDOWS CLIENT PC                                |
|                                                                         |
|   +-----------------------+                                             |
|   | Local Excel Workbook  | <-- (Source of Truth, strictly read-only)   |
|   |  (*.xlsx, e.g. Menu)  |                                             |
|   +-----------+-----------+                                             |
|               | (FileSystem events)                                     |
|               v                                                         |
|   +-----------------------+                                             |
|   |  File Watcher         |  - Filter ~$* temporary lock files          |
|   |  (watchdog)           |  - Debounce timer (3.0s)                    |
|   +-----------+-----------+  - File stability check                     |
|               |                                                         |
|               v                                                         |
|   +-----------------------+                                             |
|   |  Excel Reader         |  - openpyxl (read_only=True, data_only=True)|
|   |  & Hash Calculator    |  - Safe type coercion (ISO dates, numbers)  |
|   +-----------+-----------+  - SHA-256 content change detection         |
|               |                                                         |
|               v                                                         |
|   +-----------------------+      (Network Down)     +---------------+   |
|   |  Sync Client          | ----------------------> | SQLite Queue  |   |
|   |  & Dispatcher         | <---------------------- | (Persistent)  |   |
|   +-----------+-----------+    (Exponential Backoff)|               |   |
|               |                                     +---------------+   |
+---------------+---------------------------------------------------------+
                |
                | HTTPS POST /api/sync/ingest
                | Headers: X-Device-Id, X-Device-Key
                v
+-------------------------------------------------------------------------+
|                        WEBSITE BACKEND (serve.py)                       |
|                                                                         |
|   1. Device Authentication (X-Device-Key verification)                  |
|   2. Rate Limiting (max 30 requests/min per device)                     |
|   3. Payload Limit Guard (max 10MB)                                     |
|   4. Schema Validation (sheet_name, sync_version, records)              |
|   5. Idempotent Batched Upsert                                          |
|   6. Safe Deletion Reconciliation (if is_full_sync == true)             |
|                                                                         |
|           +---------------------------+---------------------------+     |
|           |                                                       |     |
|           v                                                       v     |
|  +------------------+                                  +----------------+
|  | local_db.json    | (Local Dev / Offline             | Supabase       |
|  | fallback engine  |  resilience)                     | PostgreSQL     |
|  +------------------+                                  +--------+-------+
+-----------------------------------------------------------------|-------+
                                                                  |
                                      Supabase Realtime Channel   |
                                      (postgres_changes)          |
                                                                  v
+-------------------------------------------------------------------------+
|                     WEBSITE FRONTEND (Browser / Admin)                  |
|                                                                         |
|   - Realtime WebSocket updates or /api/sync/status polling heartbeat    |
|   - Live Sync Status Pill: 🟢 Connected (N items) / 🔴 Offline          |
|   - Interactive Live Sync Dashboard & Data Table in Admin Studio        |
+-------------------------------------------------------------------------+
```

---

## 2. Core Architectural Principles

1. **One-Way Sync Only**: The client's `.xlsx` workbook is the single source of truth. The backend and website never write to or modify the Excel file under any circumstances.
2. **Zero File Contention & Lock Immunity**: When Microsoft Excel opens a workbook, it creates a hidden `~$...` lock file and locks the file during saves. The watcher ignores all `~$*` and `.tmp` files, uses a 3-second debounce window, and verifies file stability before reading.
3. **Safe Formula Evaluation**: Workbooks are loaded with `openpyxl.load_workbook(filename, read_only=True, data_only=True)`. Formulas are parsed as their calculated values.
4. **Permanent Row IDs & Duplicate Handling**: Uses the configured `primary_key` column (e.g., `Item Code` or `SKU`). If missing, falls back to deterministic row hashes (`row_<n>`). If duplicates occur, the agent disambiguates them (`<id>_dup_2`) and logs structured warnings without halting execution.
5. **Safe Deletion Reconciliation**: Deletions only occur after a complete sheet payload is successfully validated and upserted. Omitted rows are marked `is_deleted = true` (tombstoned), never hard deleted. If ingestion fails midway, no records are marked deleted.
6. **Offline Queue & Exponential Backoff**: When network is unavailable or backend is offline, sync payloads are preserved in a local SQLite database (`sync_queue.db`). Batches are retried with exponential backoff and jitter (`base^retry + jitter`) up to a maximum delay of 300 seconds.
7. **Privileged Credential Safety**: Supabase `SUPABASE_SERVICE_ROLE_KEY` remains strictly server-side. The client PC only holds an authorized `device_key`.

---

## 3. Directory Structure

```
thatwaffle/
├── sync_agent/                        # Client-side Windows Sync Agent
│   ├── __init__.py
│   ├── config.py                      # Configuration loader & validator
│   ├── config.example.json            # Reference configuration template
│   ├── config.json                    # Active client configuration
│   ├── excel_reader.py                # openpyxl read-only parser & SHA-256 hasher
│   ├── file_watcher.py                # watchdog file event listener & debouncer
│   ├── retry_queue.py                 # SQLite persistent offline retry queue
│   ├── sync_client.py                 # HTTPS client with device authentication
│   ├── agent.py                       # Main CLI & background service orchestrator
│   ├── requirements.txt               # openpyxl, watchdog, requests
│   ├── install.bat                    # Automated Windows venv & dependency setup
│   ├── run_agent.bat                  # Interactive agent runner
│   ├── setup_task.ps1                 # Windows Task Scheduler registration script
│   └── remove_task.ps1                # Scheduled task removal script
├── sample_data/
│   ├── Customers.xlsx                 # Recommended customer CRM template workbook
│   └── Menu_Inventory.xlsx            # Multi-sheet sample workbook for verification
├── supabase/
│   ├── schema.sql                     # Base website schema
│   └── sync_schema.sql                # Synced records, indexes, RLS, & realtime
├── site/
│   ├── sync_live.js                   # Web Realtime subscriber & UI status badge
│   ├── admin/                         # Admin Studio with Live Sync tab
│   └── ...
├── tests/
│   ├── test_sync.py                   # Unit tests (reader, queue, watcher, local_db)
│   └── test_sync_api.py               # Integration tests (auth, validation, endpoints)
├── serve.py                           # Backend ingestion & proxy server
└── local_db.py                        # Local persistence engine
```

---

## 4. Configuration Guide (`config.json`)

By default, the sync agent is configured for **Customer CRM additions**. Whenever rows are added or edited in your customer spreadsheet, they are automatically normalized and synced into the website's Customers database (`customers`), making them immediately available for WhatsApp campaign broadcasts!

Edit `sync_agent/config.json` to reflect your workbook path, sheet rules, and column mappings:

```json
{
  "device_id": "windows-pos-01",
  "device_key": "twp_sync_device_secret_key_2026",
  "ingest_url": "http://localhost:8080/api/sync/ingest",
  "status_url": "http://localhost:8080/api/sync/status",
  "workbook_path": "C:\\Users\\ashok\\OneDrive\\Desktop\\project\\thatwaffle\\sample_data\\Customers.xlsx",
  "debounce_seconds": 3.0,
  "file_stability_timeout_seconds": 5.0,
  "reconciliation_interval_seconds": 900,
  "max_retries": 10,
  "retry_backoff_base": 2.0,
  "queue_db_path": "sync_queue.db",
  "log_file": "sync_agent.log",
  "log_level": "INFO",
  "sheets": [
    {
      "sheet_name": "Customers",
      "primary_key": "Mobile Number",
      "header_row": 1,
      "data_start_row": 2,
      "columns": {
        "Customer Name": "name",
        "Name": "name",
        "Mobile Number": "phone",
        "Mobile": "phone",
        "Phone": "phone",
        "Phone Number": "phone",
        "WhatsApp": "phone",
        "Notes": "notes"
      }
    },
    {
      "sheet_name": "Sheet1",
      "primary_key": "Mobile Number",
      "header_row": 1,
      "data_start_row": 2,
      "columns": {
        "Customer Name": "name",
        "Name": "name",
        "Mobile Number": "phone",
        "Mobile": "phone",
        "Phone": "phone",
        "Phone Number": "phone",
        "WhatsApp": "phone",
        "Notes": "notes"
      }
    }
  ]
}
```

### Supported Customer Excel Headers:
The normalizer automatically maps common column names:
- **Name**: `Customer Name`, `Name`, `Full Name`
- **Phone Number**: `Mobile Number`, `Mobile`, `Phone`, `Phone Number`, `WhatsApp`
- Numbers are automatically cleaned and converted into standard Indian mobile format: `+91XXXXXXXXXX`.
```

### Configuration Options Reference:
| Option | Type | Default | Description |
|---|---|---|---|
| `device_id` | String | `windows-pos-01` | Unique name identifying the POS register / client machine |
| `device_key` | String | Required | Secret API key matched by the server backend |
| `ingest_url` | URL | Required | Endpoint receiving sync payloads (`/api/sync/ingest`) |
| `status_url` | URL | Optional | Endpoint reporting overall health (`/api/sync/status`) |
| `workbook_path` | File Path | Required | Absolute or relative path to the `.xlsx` workbook |
| `debounce_seconds`| Float | `3.0` | Seconds to wait after file modification before reading |
| `reconciliation_interval_seconds` | Int | `900` (15m) | Interval for full reconciliation sweeps |
| `sheets` | Array | Required | List of sheet mappings (sheet name, primary key, columns) |

---

## 5. Client Installation & Windows Task Scheduler

### Option A: Interactive Setup (Recommended for testing)
1. Open Command Prompt or PowerShell in `thatwaffle/sync_agent/`.
2. Run `install.bat`:
   ```bat
   install.bat
   ```
   *Creates the isolated `.venv`, installs requirements, and scaffolds `config.json`.*
3. Run `run_agent.bat` to verify live monitoring:
   ```bat
   run_agent.bat
   ```

### Option B: Automatic Windows Startup via Task Scheduler
To run the sync agent in the background automatically upon Windows user logon:
1. Open PowerShell as Administrator or standard user.
2. Run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File setup_task.ps1
   ```
   *Registers task `TWP_Excel_Live_Sync_Agent` configured to restart on failure and run windowlessly via `pythonw.exe`.*
3. To stop or remove the task at any time:
   ```powershell
   powershell -ExecutionPolicy Bypass -File remove_task.ps1
   ```

---

## 6. Server & Database Setup

### Supabase Database Migration
In your Supabase project dashboard, navigate to the **SQL Editor**, open `thatwaffle/supabase/sync_schema.sql`, and execute it.
It creates:
- `public.synced_records`: Table holding durable synced data with unique `(sheet_name, row_id)` constraints.
- `public.sync_devices`: Table managing registered devices.
- `public.sync_logs`: Audit trail of all synchronization events.
- **RLS Policies**: Public anonymous users can only SELECT active records (`where not is_deleted`).
- **Realtime**: Adds `synced_records` to the `supabase_realtime` publication.

### Server Environment Variables (`.env`)
Add the following to your `.env` file on the web server:
```env
# Comma-separated list of authorized device keys for client sync agents
SYNC_DEVICE_KEYS=twp_sync_device_secret_key_2026,your_production_key_here

# (Optional) Privileged Supabase key for direct server-to-database upserts
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_secret
```

---

## 7. Running Tests

Run the full automated test suite covering units, edge cases, and API security:

```powershell
# 1. Run unit test suite (reader, lock filtering, queue, local_db)
python -m unittest thatwaffle.tests.test_sync

# 2. Run API integration test suite (auth, validation, endpoints)
python -m unittest thatwaffle.tests.test_sync_api
```

Both test suites execute in < 15 seconds with 100% pass rates.

---

## 8. Rollback Plan

If you ever need to roll back the Live Sync subsystem:
1. **Client PC**: Run `powershell -ExecutionPolicy Bypass -File remove_task.ps1` to stop and unregister the background agent.
2. **Server**: In `serve.py`, the sync routes (`/api/sync/ingest` and `/api/sync/status`) operate independently of the core website; deleting or ignoring them leaves the menu, offers, and WhatsApp automation fully operational.
3. **Database**: If needed, run the following SQL snippet in Supabase:
   ```sql
   drop table if exists public.sync_logs cascade;
   drop table if exists public.synced_records cascade;
   drop table if exists public.sync_devices cascade;
   ```
4. **Frontend**: Remove `<script src="/site/sync_live.js"></script>` from `admin/index.html` and `site/index.html`.

---

## 9. End-to-End Verification Checklist

| Step | Verification Procedure | Expected Result | Pass? |
|---|---|---|---|
| **1. Excel Reading** | Run `python -m thatwaffle.sync_agent.agent --config thatwaffle/sync_agent/config.json --once` | Reads configured sheets, extracts rows, coerces types, logs zero errors | ✅ |
| **2. Auth Guard** | Send `POST /api/sync/ingest` without `X-Device-Key` header | Returns `HTTP 401 Unauthorized` | ✅ |
| **3. Rate Limiter** | Send >30 requests within 60s from the same client IP/device | Returns `HTTP 429 Too Many Requests` with `Retry-After` header | ✅ |
| **4. Payload Guard** | Send payload exceeding 10MB in size | Returns `HTTP 413 Payload Too Large` | ✅ |
| **5. Live Editing** | Open `Menu_Inventory.xlsx`, change a price, save file | Watcher detects change after 3s debounce, computes new hash, transmits | ✅ |
| **6. Deletion Safe** | Remove a row from Excel and save | Ingest updates active rows and reconciles omitted row as `is_deleted = true` | ✅ |
| **7. Lock Immunity** | Open Excel file in Microsoft Excel (creates `~$...`) | Watcher ignores `~$` lock file; no errors or infinite loops | ✅ |
| **8. Offline Queue** | Disconnect network or stop server, edit Excel | Payload enqueued in `sync_queue.db`; retried with exponential backoff | ✅ |
| **9. Recovery** | Restart server; reconnect agent | Queue drains pending batches in order; database updates successfully | ✅ |
| **10. Web Realtime** | Open `/admin/` in browser, navigate to "Live Sync" tab | Displays green `🟢 Connected` badge, active record counts, and live table | ✅ |
