# That Waffle Place — Production System & WhatsApp Automation

Official web application, brand design system, and automated WhatsApp marketing engine for **That Waffle Place**, Teynampet, Chennai.

---

## 🧇 Key Capabilities

1. **Customer Web Experience (`site/`)**:
   - Brand storytelling with smooth GSAP animations and Lenis scroll physics.
   - Interactive live menu with pricing and flavor profiles.
   - Customer opt-in portal for WhatsApp drops and VIP perks.
   - Store locator, opening hours, directions, and instant distance calculator.

2. **Admin Studio (`site/admin/`)**:
   - **Offers Management**: Create, edit, and toggle promotional offers with custom poster banners.
   - **WhatsApp Campaign Drops**: Schedule date & time or dispatch immediately to all subscribed customers.
   - **Customer CRM**: Real-time subscriber list, search, manual customer creation, and bulk CSV import.
   - **CSV Template Guide & Exporter**: Instant template guide and sample CSV generator.
   - **Menu & Hours Editor**: Update menu items and operating hours in real-time.

3. **WhatsApp Marketing & Delivery Engine (`serve.py` & `local_db.py`)**:
   - Official Meta Cloud API v21.0 integration.
   - Multi-mode delivery: Marketing Template (`twp_offer_broadcast`), Live Offer Text, or Sandbox (`hello_world`).
   - Dynamic poster media upload to Meta Graph API.
   - Background automated scheduler checking every 10s for due campaigns.
   - Automatic customer opt-out handling (when customers reply `STOP` or `UNSUBSCRIBE`).
   - Resilient local database engine (`local_db.json`) with zero external dependency requirement.

---

## 🚀 Quickstart

### Prerequisites
- Python 3.9+ (No extra third-party pip packages required; uses Python standard library `http.server`, `urllib`, `sqlite/json`, `threading`).

### Start the Server
```bash
python serve.py
```
Open your browser at:
- **Customer Site**: [http://localhost:8080/](http://localhost:8080/)
- **Admin Studio**: [http://localhost:8080/admin/](http://localhost:8080/admin/)
- **WhatsApp Engine Console**: [http://localhost:8080/api/send-whatsapp](http://localhost:8080/api/send-whatsapp)

---

## 🔒 Production WhatsApp Cloud API Configuration

For live production messaging to customer phones, configure your Meta Cloud API credentials using either method below:

### Method A: Web UI Configuration (Recommended)
1. Open [http://localhost:8080/api/send-whatsapp](http://localhost:8080/api/send-whatsapp).
2. Enter your Meta **Phone Number ID** and permanent **System User Access Token**.
3. Choose your default Delivery Mode (`twp_offer_broadcast`).
4. Click **Verify & Save Live Credentials**. Credentials will be saved locally to git-ignored `whatsapp.local.json`.

### Method B: Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Populate the production values:
```env
PORT=8080
WHATSAPP_TOKEN=EAAG...your_permanent_meta_system_user_token
WHATSAPP_PHONE_NUMBER_ID=your_15_digit_phone_id
WHATSAPP_DELIVERY_MODE=twp_offer_broadcast
WHATSAPP_VERIFY_TOKEN=that_waffle_place_webhook_secret_2026
```

---

## 📁 Repository Structure

```
thatwaffle/
├── site/                     # Production static front-end assets
│   ├── index.html            # Main customer website
│   ├── main.js               # Animations, interactions, and customer opt-in
│   ├── locator.js            # Store distance and geolocation logic
│   ├── twp.css               # Core brand stylesheet
│   ├── admin/                # Admin Studio
│   │   ├── index.html        # Admin dashboard, forms, and CSV tools
│   │   ├── admin.js          # Admin logic, WhatsApp scheduler, and confirm modals
│   │   └── admin.css         # Admin styling and responsive UI
│   └── uploads/              # Uploaded media (posters, banners)
├── design-system/            # Brand design system, SVG badges, and component previews
├── local_db.py               # Resilient local database REST & query handler
├── local_db.json             # Database storage (customers, broadcasts, logs)
├── serve.py                  # High-performance Python server, scheduler & Meta API dispatcher
├── supabase/
│   └── schema.sql            # Optional cloud PostgreSQL schema with Row-Level Security
├── .env.example              # Production environment variables template
├── whatsapp.local.example.json # Local WhatsApp credentials template
└── .gitignore                # Enterprise-grade secret and artifact protection
```

---

## 🛡️ Security & Privacy Guardrails

- **Zero Hardcoded Secrets**: No API keys, tokens, or personal phone numbers are tracked in version control.
- **Strict Directory Traversal Protection**: `serve.py` rejects any path traversal attempts escaping the project root.
- **Anti-Spam & Consent Compliance**: Opt-in timestamps and sources are recorded. Inbound `STOP` webhooks automatically set `is_subscribed = false`.
- **Double Confirmation Safety**: WhatsApp broadcasts require explicit confirmation through the floating modal before calling any send or schedule APIs.
