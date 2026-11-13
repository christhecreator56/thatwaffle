import http.server
import socketserver
import os
import sys
import re
import json
import time
import uuid
import base64
import datetime
import threading
import urllib.parse
import urllib.request
import urllib.error
import html as html_lib
import local_db

def _resolve_port(default=8080):
    for i, arg in enumerate(sys.argv[1:], start=1):
        if arg == '--port' and i + 1 < len(sys.argv) and sys.argv[i + 1].isdigit():
            return int(sys.argv[i + 1])
        if arg.startswith('--port=') and arg.split('=', 1)[1].isdigit():
            return int(arg.split('=', 1)[1])
        if arg.isdigit():
            return int(arg)
    env_port = os.environ.get('PORT', '').strip()
    return int(env_port) if env_port.isdigit() else default

PORT = _resolve_port(8080)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SITE_DIR = os.path.join(BASE_DIR, 'site')
WA_CONFIG_FILE = os.path.join(BASE_DIR, 'whatsapp.local.json')
ENV_FILE = os.path.join(BASE_DIR, '.env')

SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://hdewnmlpuznncvkyxpjn.supabase.co')
SUPABASE_KEY = os.environ.get('SUPABASE_ANON_KEY', 'sb_publishable_5X5KVusc1uaVCdilCc7MQA_xOl_Xyna')

LOCAL_TABLES = ('customers', 'broadcasts', 'broadcast_logs')

def _read_dotenv():
    vals = {}
    if os.path.exists(ENV_FILE):
        try:
            with open(ENV_FILE, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#') or '=' not in line:
                        continue
                    k, v = line.split('=', 1)
                    vals[k.strip()] = v.strip().strip('"').strip("'")
        except Exception:
            pass
    return vals

def get_wa_config():
    dotenv = _read_dotenv()
    local_cfg = {}
    if os.path.exists(WA_CONFIG_FILE):
        try:
            with open(WA_CONFIG_FILE, 'r', encoding='utf-8') as f:
                local_cfg = json.load(f) or {}
        except Exception:
            local_cfg = {}

    token = (local_cfg.get('token') or os.environ.get('WHATSAPP_TOKEN') or dotenv.get('WHATSAPP_TOKEN') or '').strip()
    phone_id = (local_cfg.get('phone_number_id') or os.environ.get('WHATSAPP_PHONE_NUMBER_ID') or dotenv.get('WHATSAPP_PHONE_NUMBER_ID') or '').strip()
    delivery_mode = (local_cfg.get('delivery_mode') or os.environ.get('WHATSAPP_DELIVERY_MODE') or dotenv.get('WHATSAPP_DELIVERY_MODE') or 'text').strip()
    if delivery_mode not in ('text', 'hello_world', 'twp_offer_broadcast'):
        delivery_mode = 'text'

    source = 'none'
    if local_cfg.get('token') and local_cfg.get('phone_number_id'):
        source = 'whatsapp.local.json'
    elif (os.environ.get('WHATSAPP_TOKEN') or dotenv.get('WHATSAPP_TOKEN')) and (os.environ.get('WHATSAPP_PHONE_NUMBER_ID') or dotenv.get('WHATSAPP_PHONE_NUMBER_ID')):
        source = 'environment'

    return {
        "token": token,
        "phone_number_id": phone_id,
        "delivery_mode": delivery_mode,
        "configured": bool(token and phone_id),
        "source": source
    }

def save_wa_config(token=None, phone_number_id=None, delivery_mode=None):
    existing = {}
    if os.path.exists(WA_CONFIG_FILE):
        try:
            with open(WA_CONFIG_FILE, 'r', encoding='utf-8') as f:
                existing = json.load(f) or {}
        except Exception:
            existing = {}

    if token is not None and token.strip():
        existing['token'] = token.strip()
    if phone_number_id is not None and phone_number_id.strip():
        existing['phone_number_id'] = phone_number_id.strip()
    if delivery_mode in ('text', 'hello_world', 'twp_offer_broadcast'):
        existing['delivery_mode'] = delivery_mode

    with open(WA_CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(existing, f, indent=2)
    return get_wa_config()

def clear_wa_config():
    if os.path.exists(WA_CONFIG_FILE):
        os.remove(WA_CONFIG_FILE)
    return get_wa_config()

def _mask_token(token):
    if not token:
        return ''
    if len(token) <= 10:
        return '****'
    return token[:6] + '...' + token[-4:]

def _format_offer_date(iso_str):
    raw = str(iso_str or '').strip()
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', raw):
        try:
            d = datetime.datetime.strptime(raw, '%Y-%m-%d')
            return f"{d.day} {d.strftime('%b %Y')}"
        except Exception:
            pass
    return raw

def _resolve_poster_bytes(poster_url, poster_data_url):
    supported = {
        'image/jpeg': 'poster.jpg',
        'image/jpg': 'poster.jpg',
        'image/png': 'poster.png',
        'image/webp': 'poster.webp',
    }
    if poster_data_url and isinstance(poster_data_url, str) and poster_data_url.startswith('data:image/'):
        try:
            header, b64 = poster_data_url.split(',', 1)
            mime = header.split(';', 1)[0].split(':', 1)[1].lower()
            if mime == 'image/jpg':
                mime = 'image/jpeg'
            if mime in supported:
                raw = base64.b64decode(b64)
                if 0 < len(raw) <= 5 * 1024 * 1024:
                    return mime, raw, supported[mime]
        except Exception:
            pass

    if poster_url and isinstance(poster_url, str) and not poster_url.startswith('blob:'):
        parsed = urllib.parse.urlparse(poster_url)
        req_path = parsed.path
        media_root = os.path.normpath(os.path.join(SITE_DIR, 'uploads', 'media'))
        subpath = None
        if '/public/media/' in req_path:
            subpath = req_path.split('/public/media/', 1)[1]
        elif '/sb/storage/v1/object/media/' in req_path:
            subpath = req_path.split('/sb/storage/v1/object/media/', 1)[1]
        if subpath:
            candidate = os.path.normpath(os.path.join(media_root, urllib.parse.unquote(subpath).lstrip('/\\')))
            try:
                if os.path.commonpath([media_root, candidate]) == media_root and os.path.isfile(candidate):
                    ext = os.path.splitext(candidate)[1].lower()
                    ext_map = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'}
                    mime = ext_map.get(ext)
                    if mime:
                        with open(candidate, 'rb') as f:
                            raw = f.read()
                        if 0 < len(raw) <= 5 * 1024 * 1024:
                            return mime, raw, os.path.basename(candidate)
            except Exception:
                pass
    return None

def _upload_meta_media(wa_token, wa_phone_id, img_bytes, mime_type, filename):
    boundary = f"----twpBoundary{uuid.uuid4().hex}"
    parts = [
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="messaging_product"\r\n\r\n'
            f"whatsapp\r\n"
        ).encode('utf-8'),
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="type"\r\n\r\n'
            f"{mime_type}\r\n"
        ).encode('utf-8'),
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: {mime_type}\r\n\r\n"
        ).encode('utf-8') + img_bytes + b"\r\n",
        f"--{boundary}--\r\n".encode('utf-8'),
    ]
    body = b"".join(parts)
    url = f"https://graph.facebook.com/v21.0/{urllib.parse.quote(wa_phone_id)}/media"
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {wa_token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        res = json.loads(resp.read().decode('utf-8'))
        return res.get('id')

def _is_public_meta_image(url):
    if not url or not isinstance(url, str):
        return False
    low = url.lower().split('?')[0]
    if not low.startswith('https://'):
        return False
    if 'localhost' in low or '127.0.0.1' in low:
        return False
    if low.endswith('.svg'):
        return False
    return True

def _parse_meta_error(he):
    raw = ''
    try:
        raw = he.read().decode('utf-8')
        data = json.loads(raw)
        err = data.get('error', {})
        code = err.get('code')
        msg = err.get('message', str(he))
        details = err.get('error_data', {}).get('details', '')
        hint = ''
        if code == 190:
            hint = ' -> Your Meta Access Token expired or is invalid. Generate a fresh token in developers.facebook.com.'
        elif code == 131030:
            hint = ' -> Add this recipient phone number to your Meta Test Number "To" allowlist and verify the OTP.'
        elif code in (131047, 131026):
            hint = ' -> 24h chat window closed for text messages: send "Hi" from your phone to Meta\'s test number once, OR switch Delivery Mode to hello_world.'
        elif code == 132001:
            hint = ' -> Template twp_offer_broadcast is not approved in your Meta WhatsApp Manager yet. Use "Live Offer Text" or "hello_world" mode for sandbox testing.'
        elif code in (131053, 131009):
            hint = ' -> Invalid media URL or parameter. Avoid localhost or .svg images.'
        full_details = f" ({details})" if details else ""
        return f"Meta Error #{code}: {msg}{full_details}{hint}"
    except Exception:
        return f"HTTP {he.code}: {raw or str(he)}"

def verify_meta_credentials(token, phone_id):
    url = f"https://graph.facebook.com/v21.0/{urllib.parse.quote(phone_id)}?fields=display_phone_number,verified_name,quality_rating"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            info = json.loads(resp.read().decode('utf-8'))
            return {"ok": True, "info": info}
    except urllib.error.HTTPError as he:
        return {"ok": False, "error": _parse_meta_error(he)}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def send_whatsapp_message(to_phone, offer_data, customer_name="Waffle Lover", is_test=False):
    cfg = get_wa_config()
    wa_token = cfg['token']
    wa_phone_id = cfg['phone_number_id']
    delivery_mode = (offer_data.get('delivery_mode') or cfg['delivery_mode'] or 'text').strip()

    cleaned_phone = re.sub(r'\D', '', str(to_phone or ''))
    if len(cleaned_phone) == 10 and cleaned_phone[0] in '6789':
        cleaned_phone = '91' + cleaned_phone

    offer_name = offer_data.get('name') or offer_data.get('offer_name') or 'Weekend Special'
    discount = offer_data.get('discount') or 'Special discount'
    starts = offer_data.get('starts_on', '')
    ends = offer_data.get('ends_on', '')
    validity = f"{_format_offer_date(starts)} to {_format_offer_date(ends)}" if (starts and ends) else (offer_data.get('dates') or "This week")
    terms = offer_data.get('terms') or 'Terms apply.'
    poster_url = offer_data.get('poster_url', '')
    poster_data_url = offer_data.get('poster_data_url', '')

    def resolve_image_param():
        if _is_public_meta_image(poster_url):
            return {"link": poster_url}
        local_media = _resolve_poster_bytes(poster_url, poster_data_url)
        if local_media and wa_token and wa_phone_id:
            mime, raw, fname = local_media
            try:
                media_id = _upload_meta_media(wa_token, wa_phone_id, raw, mime, fname)
                if media_id:
                    return {"id": media_id}
            except Exception as media_err:
                print(f"[WHATSAPP MEDIA UPLOAD WARNING] {media_err}", flush=True)
        return None

    text_body = (
        f"*That Waffle Place*\n\n"
        f"Hey {customer_name}! 🧇 Fresh offer from *That Waffle Place*:\n\n"
        f"🔥 *{offer_name}*\n"
        f"🏷️ *OFFER:* *{discount}* on your order!\n"
        f"📅 *Valid:* {validity}\n"
        f"📝 *Terms:* {terms}\n\n"
        f"Show this message at the counter or order online to claim! 🧇✨\n"
        f"_Reply STOP to unsubscribe_"
    )

    if delivery_mode == 'hello_world':
        payload = {
            "messaging_product": "whatsapp",
            "to": cleaned_phone,
            "type": "template",
            "template": {
                "name": "hello_world",
                "language": { "code": "en_US" }
            }
        }
    elif delivery_mode == 'text':
        img_param = resolve_image_param() if (wa_token and wa_phone_id) else None
        if img_param:
            payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": cleaned_phone,
                "type": "image",
                "image": {
                    **img_param,
                    "caption": text_body[:1024]
                }
            }
        else:
            payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": cleaned_phone,
                "type": "text",
                "text": {
                    "preview_url": False,
                    "body": text_body
                }
            }
    else:
        components = []
        img_param = resolve_image_param() if (wa_token and wa_phone_id) else None
        if img_param:
            components.append({
                "type": "header",
                "parameters": [
                    { "type": "image", "image": img_param }
                ]
            })
        components.append({
            "type": "body",
            "parameters": [
                { "type": "text", "text": customer_name },
                { "type": "text", "text": offer_name },
                { "type": "text", "text": discount },
                { "type": "text", "text": validity },
                { "type": "text", "text": terms }
            ]
        })
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": cleaned_phone,
            "type": "template",
            "template": {
                "name": "twp_offer_broadcast",
                "language": { "code": "en" },
                "components": components
            }
        }

    if wa_token and wa_phone_id:
        try:
            url = f"https://graph.facebook.com/v21.0/{urllib.parse.quote(wa_phone_id)}/messages"
            req_data = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(
                url,
                data=req_data,
                headers={"Authorization": f"Bearer {wa_token}", "Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                res = json.loads(resp.read().decode('utf-8'))
                msg_id = res.get('messages', [{}])[0].get('id', str(uuid.uuid4()))
                sent_kind = payload.get('type', delivery_mode)
                print(f"[WHATSAPP LIVE META] Delivered ({sent_kind}) to +{cleaned_phone} | ID: {msg_id}", flush=True)
                msg_note = (
                    f"Accepted by Meta ({sent_kind}, ID: {msg_id}). If not received within 10s, send 'Hi' once from your phone to Meta's Test # to open the 24h window, or switch mode to hello_world."
                    if delivery_mode == 'text'
                    else f"Real WhatsApp sent ({sent_kind})! Meta ID: {msg_id}"
                )
                return {
                    "success": True,
                    "message_id": msg_id,
                    "mode": "meta_live",
                    "delivery_mode": delivery_mode,
                    "message": msg_note
                }
        except urllib.error.HTTPError as he:
            err_msg = _parse_meta_error(he)
            print(f"[WHATSAPP LIVE ERROR] {err_msg}", flush=True)
            return {"success": False, "error": err_msg, "mode": "meta_live", "delivery_mode": delivery_mode}
        except Exception as e:
            print(f"[WHATSAPP LIVE ERROR] {e}", flush=True)
            return {"success": False, "error": str(e), "mode": "meta_live", "delivery_mode": delivery_mode}
    else:
        msg_id = f"wamid.sim_{uuid.uuid4().hex[:16]}"
        print(f"\n[WHATSAPP AUTOMATION {'TEST' if is_test else 'BROADCAST'} - SIMULATION]", flush=True)
        print(f"  To: +{cleaned_phone} ({customer_name})", flush=True)
        print(f"  Mode: {delivery_mode}", flush=True)
        print(f"  Offer: {offer_name} ({discount})", flush=True)
        print(f"  Validity: {validity}", flush=True)
        print(f"  Assigned Message ID: {msg_id}\n", flush=True)
        return {
            "success": True,
            "message_id": msg_id,
            "mode": "simulation",
            "delivery_mode": delivery_mode,
            "message": f"Simulated locally ({msg_id}). Add Meta credentials at /api/send-whatsapp for real phone delivery."
        }

def execute_broadcast(broadcast_id):
    try:
        # Check local_db first
        ldb = local_db.load_db()
        broadcast = next((b for b in ldb.get('broadcasts', []) if b.get('id') == broadcast_id), None)
        if not broadcast:
            return {"error": f"Broadcast {broadcast_id} not found"}

        # Prevent double execution
        local_db.handle_patch('broadcasts', {'id': f'eq.{broadcast_id}'}, {"status": "processing"})

        offer = {}
        if broadcast.get('offer_id'):
            # Fetch offer details from upstream
            try:
                o_url = f"{SUPABASE_URL}/rest/v1/offers?id=eq.{broadcast['offer_id']}&apikey={SUPABASE_KEY}"
                req = urllib.request.Request(o_url, headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    offers = json.loads(resp.read().decode('utf-8'))
                    if offers: offer = offers[0]
            except Exception: pass

        if not offer or not offer.get('name'):
            offer = {
                "name": broadcast.get('offer_name') or 'Weekend Special',
                "discount": broadcast.get('discount') or 'Special discount',
                "starts_on": broadcast.get('starts_on', ''),
                "ends_on": broadcast.get('ends_on', ''),
                "terms": broadcast.get('terms') or 'Terms apply. Dine-in only.',
                "poster_url": broadcast.get('poster_url', '')
            }

        customers = [c for c in ldb.get('customers', []) if c.get('is_subscribed')]
        sent_count = 0
        failed_count = 0

        for c in customers:
            res = send_whatsapp_message(c['phone'], offer, customer_name=c.get('name', 'Customer'))
            if res.get('success'):
                sent_count += 1
                local_db.handle_post('broadcast_logs', {
                    "broadcast_id": broadcast_id,
                    "customer_id": c.get('id'),
                    "phone": c['phone'],
                    "status": "sent",
                    "meta_message_id": res.get('message_id')
                })
            else:
                failed_count += 1
                local_db.handle_post('broadcast_logs', {
                    "broadcast_id": broadcast_id,
                    "customer_id": c.get('id'),
                    "phone": c['phone'],
                    "status": "failed",
                    "error_message": res.get('error') or 'Delivery failed'
                })

        final_status = 'completed' if (sent_count > 0 or len(customers) == 0) else 'failed'
        local_db.handle_patch('broadcasts', {'id': f'eq.{broadcast_id}'}, {
            "status": final_status,
            "total_recipients": len(customers),
            "sent_count": sent_count,
            "failed_count": failed_count,
            "completed_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        })

        return {"success": True, "status": final_status, "sent": sent_count, "failed": failed_count, "total": len(customers)}
    except Exception as e:
        local_db.handle_patch('broadcasts', {'id': f'eq.{broadcast_id}'}, {"status": "failed"})
        return {"error": str(e)}

def background_scheduler():
    while True:
        try:
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
            status, due_list = local_db.handle_get('broadcasts', {'status': 'eq.scheduled', 'scheduled_at': f'lte.{now_iso}'})
            for b in due_list:
                print(f"[SCHEDULER] Firing scheduled broadcast ID: {b['id']}...", flush=True)
                execute_broadcast(b['id'])
        except Exception as e:
            print(f"[SCHEDULER ERROR] {e}", flush=True)
        time.sleep(10)

scheduler_thread = threading.Thread(target=background_scheduler, daemon=True)
scheduler_thread.start()

class WaffleRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey, Prefer, x-upsert, cache-control')
        self.end_headers()

    def handle_storage_upload(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        prefix = '/sb/storage/v1/object/media/'
        if not path.startswith(prefix):
            prefix = '/sb/storage/v1/object/public/media/'
        subpath = path[len(prefix):]
        if not subpath:
            self.send_error(400, "Missing storage file path")
            return

        content_len = int(self.headers.get('Content-Length', 0))
        body_bytes = self.rfile.read(content_len) if content_len > 0 else b''

        # Save to local storage on disk
        local_dest = os.path.normpath(os.path.join(SITE_DIR, 'uploads', 'media', subpath))
        os.makedirs(os.path.dirname(local_dest), exist_ok=True)
        try:
            with open(local_dest, 'wb') as f:
                f.write(body_bytes)
            print(f"[STORAGE UPLOAD] Saved {len(body_bytes)} bytes locally to {local_dest}", flush=True)
        except Exception as e:
            print(f"[STORAGE ERROR] Failed writing local upload: {e}", flush=True)

        # Best-effort upstream sync to Supabase
        try:
            upstream_url = f"{SUPABASE_URL}/" + path[4:]
            if parsed.query:
                upstream_url += '?' + parsed.query
            headers = {k: v for k, v in self.headers.items() if k.lower() not in ('host', 'content-length')}
            req = urllib.request.Request(upstream_url, data=body_bytes, headers=headers, method=self.command)
            with urllib.request.urlopen(req) as resp:
                print(f"[STORAGE UPSTREAM] Successfully mirrored upload to Supabase: {resp.status}", flush=True)
        except Exception as ex:
            print(f"[STORAGE UPSTREAM NOTICE] Upstream Supabase mirror skipped ({ex}); local upload safe.", flush=True)

        file_id = str(uuid.uuid4())
        resp_data = json.dumps({
            "Key": f"media/{subpath}",
            "Id": file_id,
            "path": subpath,
            "fullPath": f"media/{subpath}",
            "message": "Uploaded successfully"
        }).encode('utf-8')

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(resp_data)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(resp_data)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path.startswith('/sb/storage/v1/object/media/') or path.startswith('/sb/storage/v1/object/public/media/'):
            self.handle_storage_upload()
            return

        if path == '/api/whatsapp-config':
            content_len = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_len).decode('utf-8')
            data = json.loads(body) if body else {}

            if data.get('action') == 'clear':
                cfg = clear_wa_config()
                res = {
                    "success": True,
                    "configured": cfg['configured'],
                    "mode": "meta_live" if cfg['configured'] else "simulation",
                    "delivery_mode": cfg['delivery_mode'],
                    "phone_number_id": cfg['phone_number_id'],
                    "token_masked": _mask_token(cfg['token']),
                    "message": "Switched back to Simulation Mode."
                }
            else:
                cur = get_wa_config()
                new_token = (data.get('token') or '').strip() or cur['token']
                new_phone_id = (data.get('phone_number_id') or '').strip() or cur['phone_number_id']
                new_mode = (data.get('delivery_mode') or cur['delivery_mode'] or 'text').strip()

                if not new_token or not new_phone_id:
                    res = {"success": False, "error": "Both Meta Access Token and Phone Number ID are required for live WhatsApp."}
                else:
                    verify = verify_meta_credentials(new_token, new_phone_id)
                    if not verify.get('ok'):
                        res = {"success": False, "error": verify.get('error', 'Meta credential check failed.')}
                    else:
                        cfg = save_wa_config(new_token, new_phone_id, new_mode)
                        info = verify.get('info', {})
                        res = {
                            "success": True,
                            "configured": cfg['configured'],
                            "mode": "meta_live",
                            "delivery_mode": cfg['delivery_mode'],
                            "phone_number_id": cfg['phone_number_id'],
                            "token_masked": _mask_token(cfg['token']),
                            "display_phone_number": info.get('display_phone_number', ''),
                            "verified_name": info.get('verified_name', ''),
                            "message": f"Connected to Meta Cloud API ({info.get('display_phone_number') or new_phone_id})!"
                        }

            resp_data = json.dumps(res).encode('utf-8')
            self.send_response(200 if res.get('success') else 400)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(resp_data)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(resp_data)
            return

        if path == '/api/webhook/whatsapp':
            content_len = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_len).decode('utf-8')
            print(f"[WHATSAPP WEBHOOK POST] {body[:400]}", flush=True)
            try:
                payload = json.loads(body) if body else {}
                for entry in payload.get('entry', []):
                    for change in entry.get('changes', []):
                        for m in change.get('value', {}).get('messages', []):
                            sender = m.get('from', '')
                            txt = m.get('text', {}).get('body', '').strip()
                            if txt.upper() in ('STOP', 'UNSUBSCRIBE'):
                                local_db.handle_rpc('opt_out_customer', {'target_phone': sender})
            except Exception:
                pass
            resp_data = json.dumps({"status": "ok"}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(resp_data)))
            self.end_headers()
            self.wfile.write(resp_data)
            return

        if path == '/api/send-whatsapp':
            content_len = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_len).decode('utf-8')
            data = json.loads(body) if body else {}

            to_phone = data.get('to', '')
            res = send_whatsapp_message(to_phone, data, customer_name=data.get('customer_name') or "Valued Customer", is_test=True)

            resp_data = json.dumps(res).encode('utf-8')
            self.send_response(200 if res.get('success') else 400)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(resp_data)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(resp_data)
            return

        if path == '/api/dispatch-broadcast':
            content_len = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_len).decode('utf-8')
            data = json.loads(body) if body else {}

            broadcast_id = data.get('broadcast_id')
            res = execute_broadcast(broadcast_id)

            resp_data = json.dumps(res).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(resp_data)))
            self.end_headers()
            self.wfile.write(resp_data)
            return

        # Intercept Supabase local tables
        if path.startswith('/sb/rest/v1/'):
            subpath = path[12:]
            table = subpath.split('?')[0].rstrip('/')
            if table in LOCAL_TABLES:
                content_len = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_len).decode('utf-8')
                data = json.loads(body) if body else {}
                status, res = local_db.handle_post(table, data)
                resp_data = json.dumps(res).encode('utf-8')
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(resp_data)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(resp_data)
                return
            elif table == 'rpc/opt_out_customer':
                content_len = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_len).decode('utf-8')
                data = json.loads(body) if body else {}
                status, res = local_db.handle_rpc('opt_out_customer', data)
                resp_data = json.dumps(res).encode('utf-8')
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(resp_data)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(resp_data)
                return

            # Forward other tables to Supabase
            self.proxy_to_supabase()
            return

        if path.startswith('/sb/'):
            self.proxy_to_supabase()
            return

        self.send_error(404, "API endpoint not found")

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith('/sb/storage/v1/object/media/') or path.startswith('/sb/storage/v1/object/public/media/'):
            self.handle_storage_upload()
            return
        if path.startswith('/sb/'):
            self.proxy_to_supabase()
            return
        self.send_error(404)

    def do_PATCH(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith('/sb/rest/v1/'):
            subpath = path[12:]
            table = subpath.split('?')[0].rstrip('/')
            if table in LOCAL_TABLES:
                content_len = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_len).decode('utf-8')
                data = json.loads(body) if body else {}
                query_params = urllib.parse.parse_qs(parsed.query)
                status, res = local_db.handle_patch(table, query_params, data)
                resp_data = json.dumps(res).encode('utf-8')
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(resp_data)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(resp_data)
                return
            self.proxy_to_supabase()
            return
        if path.startswith('/sb/'):
            self.proxy_to_supabase()
            return
        self.send_error(404)

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith('/sb/rest/v1/'):
            subpath = path[12:]
            table = subpath.split('?')[0].rstrip('/')
            if table in LOCAL_TABLES:
                query_params = urllib.parse.parse_qs(parsed.query)
                status, res = local_db.handle_delete(table, query_params)
                resp_data = json.dumps(res).encode('utf-8')
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(resp_data)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(resp_data)
                return
            self.proxy_to_supabase()
            return
        if path.startswith('/sb/'):
            self.proxy_to_supabase()
            return
        self.send_error(404)
        self.send_error(404)

    def proxy_to_supabase(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        upstream_url = f"{SUPABASE_URL}/" + path[4:]
        if parsed.query:
            upstream_url += '?' + parsed.query
        try:
            headers = {k: v for k, v in self.headers.items() if k.lower() not in ('host', 'content-length')}
            body_bytes = None
            if self.command in ('POST', 'PUT', 'PATCH'):
                content_len = int(self.headers.get('Content-Length', 0))
                body_bytes = self.rfile.read(content_len)

            req = urllib.request.Request(upstream_url, data=body_bytes, headers=headers, method=self.command)
            with urllib.request.urlopen(req) as resp:
                data = resp.read()
                self.send_response(resp.status)
                for k, v in resp.getheaders():
                    if k.lower() not in ('transfer-encoding', 'content-length'):
                        self.send_header(k, v)
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as he:
            err_data = he.read()
            self.send_response(he.code)
            for k, v in he.headers.items():
                if k.lower() not in ('transfer-encoding', 'content-length'):
                    self.send_header(k, v)
            self.send_header('Content-Length', str(len(err_data)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(err_data)
        except Exception as ex:
            self.send_error(502, f"Proxy error: {ex}")

    def render_whatsapp_test_console(self):
        cfg = get_wa_config()
        ldb = local_db.load_db()
        cust_list = [c for c in ldb.get('customers', []) if c.get('is_subscribed')]
        is_live = cfg['configured']
        mode_label = "Meta Cloud API (Live)" if is_live else "Simulation Engine (Ready)"
        token_masked = html_lib.escape(_mask_token(cfg['token'])) if cfg['token'] else ""
        phone_id_esc = html_lib.escape(cfg['phone_number_id'] or "")
        source_label = html_lib.escape(cfg['source'])
        cur_delivery_mode = cfg['delivery_mode'] or "text"
        pill_live_cls = "status-pill is-live" if is_live else "status-pill is-sim"
        token_placeholder = (
            f"Saved ({token_masked}) — paste new token to replace"
            if token_masked else "Paste EAAG... Meta access token"
        )

        mode_choices = [
            (
                "text",
                "Live Offer Text",
                "24h Window",
                "Full That Waffle Place promo copy. Reply 'Hi' once from your phone to Meta's Test # first."
            ),
            (
                "hello_world",
                "Meta Sandbox hello_world",
                "Easiest First Test",
                "Uses Meta's pre-approved hello_world (en_US) template. Works cold with zero setup."
            ),
            (
                "twp_offer_broadcast",
                "Custom Template (twp_offer_broadcast)",
                "Production",
                "Uses your branded marketing template once approved in Meta WhatsApp Manager."
            ),
        ]

        def build_mode_dropdown(dd_id, input_id, selected_val):
            chosen = next((m for m in mode_choices if m[0] == selected_val), mode_choices[0])
            opts_html = "".join([
                f'<button type="button" class="dd-opt{" is-selected" if val == selected_val else ""}" '
                f'role="option" aria-selected="{"true" if val == selected_val else "false"}" '
                f'data-value="{val}" data-title="{html_lib.escape(title)}" data-badge="{html_lib.escape(badge)}">'
                f'<div class="dd-opt-top">'
                f'<span class="dd-opt-title">{html_lib.escape(title)}</span>'
                f'<span class="dd-opt-right"><span class="dd-badge dd-badge-{val}">{html_lib.escape(badge)}</span><span class="dd-check">&#10003;</span></span>'
                f'</div>'
                f'<div class="dd-opt-desc">{html_lib.escape(desc)}</div>'
                f'</button>'
                for val, title, badge, desc in mode_choices
            ])
            menu_id = f"{dd_id}Menu"
            return (
                f'<div class="twp-dd" id="{dd_id}" data-input="{input_id}">'
                f'<input type="hidden" id="{input_id}" value="{html_lib.escape(chosen[0])}">'
                f'<button type="button" class="dd-trigger" role="combobox" aria-haspopup="listbox" '
                f'aria-expanded="false" aria-controls="{menu_id}">'
                f'<span class="dd-trigger-main">'
                f'<span class="dd-val-title">{html_lib.escape(chosen[1])}</span>'
                f'<span class="dd-badge dd-badge-{chosen[0]} dd-val-badge">{html_lib.escape(chosen[2])}</span>'
                f'</span>'
                f'<svg class="dd-chevron" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">'
                f'<path d="M5 7.5L10 12.5L15 7.5" stroke="#2e2c25" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
                f'</svg>'
                f'</button>'
                f'<div class="dd-menu" id="{menu_id}" role="listbox">{opts_html}</div>'
                f'</div>'
            )

        default_mode_dd = build_mode_dropdown("ddWaMode", "waModeSelect", cur_delivery_mode)
        test_mode_dd = build_mode_dropdown("ddTestMode", "testDeliveryMode", cur_delivery_mode)
        
        customers_chips = "".join([
            f'<button type="button" class="chip" data-phone="{html_lib.escape(str(c.get("phone", "")))}" data-name="{html_lib.escape(str(c.get("name", "Customer")))}" onclick="fillPhone(this.dataset.phone, this.dataset.name)">{html_lib.escape(str(c.get("name", "Customer")))} ({html_lib.escape(str(c.get("phone", "")))})</button>'
            for c in cust_list[:6]
        ])

        return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WhatsApp Automation Console | That Waffle Place</title>
  <link rel="stylesheet" href="/site/tokens.css">
  <link href="https://fonts.googleapis.com/css2?family=Modak&family=Zen+Maru+Gothic:wght@500;700;800&display=swap" rel="stylesheet">
  <style>
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      padding: 24px 16px;
      background: #eed4bc;
      color: #2e2c25;
      font-family: 'Zen Maru Gothic', sans-serif;
      min-height: 100vh;
    }}
    .container {{
      max-width: 980px;
      margin: 0 auto;
      display: grid;
      gap: 20px;
    }}
    .top-nav {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }}
    .top-brand {{
      display: flex;
      align-items: center;
      gap: 12px;
    }}
    .top-brand img {{
      width: 44px;
      height: 44px;
    }}
    .top-brand h1 {{
      margin: 0;
      font-family: Modak, sans-serif;
      font-size: 32px;
      color: #8a2823;
      letter-spacing: .02em;
    }}
    .top-links {{
      display: flex;
      gap: 10px;
    }}
    .btn-link {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #fbfaf5;
      color: #2e2c25;
      text-decoration: none;
      font-weight: 700;
      font-size: 14px;
      padding: 8px 16px;
      border: 2px solid #2e2c25;
      border-radius: 999px;
      box-shadow: 2px 2px 0 #2e2c25;
      transition: transform .1s ease;
    }}
    .btn-link:hover {{
      transform: translateY(-1px);
    }}
    .status-card {{
      background: #008069;
      color: #fff;
      padding: 16px 20px;
      border-radius: 18px;
      border: 3px solid #2e2c25;
      box-shadow: 4px 4px 0 #2e2c25;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }}
    .status-pill {{
      background: #25d366;
      color: #0b4619;
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .04em;
    }}
    .grid-2 {{
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
      gap: 20px;
    }}
    @media (max-width: 768px) {{
      .grid-2 {{ grid-template-columns: 1fr; }}
    }}
    .card {{
      background: #fbfaf5;
      border: 3px solid #2e2c25;
      border-radius: 20px;
      padding: 24px;
      box-shadow: 5px 5px 0 #2e2c25;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }}
    .card h2 {{
      margin: 0;
      font-family: Modak, sans-serif;
      font-size: 26px;
      color: #8a2823;
      letter-spacing: .02em;
      display: flex;
      align-items: center;
      gap: 8px;
    }}
    .field {{
      display: flex;
      flex-direction: column;
      gap: 6px;
    }}
    .field label {{
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      color: #2e2c25;
      letter-spacing: .03em;
    }}
    .input-row {{
      display: flex;
      border: 2px solid #2e2c25;
      border-radius: 12px;
      background: #fff;
      overflow: hidden;
    }}
    .input-row span {{
      padding: 10px 14px;
      background: #f7e2cf;
      font-weight: 700;
      border-right: 2px solid #2e2c25;
      color: #2e2c25;
      display: flex;
      align-items: center;
    }}
    .input-row input, .field input {{
      width: 100%;
      padding: 10px 14px;
      border: 0;
      font-family: inherit;
      font-size: 15px;
      font-weight: 700;
      outline: none;
      color: #2e2c25;
      background: transparent;
    }}
    .field input.bordered {{
      border: 2px solid #2e2c25;
      border-radius: 12px;
      background: #fff;
    }}
    .chips-label {{
      font-size: 12px;
      color: #665042;
      margin-top: 4px;
      font-weight: 700;
    }}
    .chips-row {{
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 4px;
    }}
    .chip {{
      background: #eed4bc;
      border: 1.5px solid #2e2c25;
      border-radius: 999px;
      padding: 3px 10px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      color: #2e2c25;
      transition: all .1s ease;
    }}
    .chip:hover {{
      background: #f8b500;
      transform: translateY(-1px);
    }}
    .btn-submit {{
      background: #25d366;
      color: #0b4619;
      border: 3px solid #2e2c25;
      border-radius: 999px;
      padding: 14px 24px;
      font-family: inherit;
      font-size: 16px;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 3px 3px 0 #2e2c25;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all .15s ease;
    }}
    .btn-submit:hover {{
      transform: translate(-1px, -1px);
      box-shadow: 5px 5px 0 #2e2c25;
      background: #1ebe5d;
    }}
    .btn-submit:active {{
      transform: translate(2px, 2px);
      box-shadow: 1px 1px 0 #2e2c25;
    }}
    .console-term {{
      background: #111b21;
      color: #e9edef;
      border-radius: 14px;
      padding: 16px;
      font-family: Consolas, monospace;
      font-size: 13px;
      line-height: 1.55;
      min-height: 320px;
      max-height: 480px;
      overflow-y: auto;
      border: 2px solid #2e2c25;
    }}
    .console-term .log-time {{ color: #8696a0; }}
    .console-term .log-success {{ color: #25d366; font-weight: bold; }}
    .console-term .log-info {{ color: #53bdeb; }}
    .console-term .log-warn {{ color: #f8b500; }}
  </style>
</head>
<body>
  <div class="container">
    <div class="top-nav">
      <div class="top-brand">
        <img src="/assets/badge-waffle.svg" alt="That Waffle Place">
        <h1>WhatsApp Test Engine</h1>
      </div>
      <div class="top-links">
        <a href="/admin/" class="btn-link">← Admin Dashboard</a>
        <a href="/site/" class="btn-link">🧇 Main Site</a>
      </div>
    </div>

    <style>
      .status-pill.is-live {{ background: #16a34a; color: #fff; border: 2px solid #0b4619; }}
      .status-pill.is-sim {{ background: #f8b500; color: #2e2c25; border: 2px solid #2e2c25; }}
      .setup-card {{ margin-bottom: 4px; }}
      .setup-grid {{ display: grid; grid-template-columns: 1fr 1.45fr; gap: 14px; margin-top: 4px; }}
      .setup-steps {{ background: #fff8e6; border: 2px dashed #b45309; border-radius: 14px; padding: 14px 16px; font-size: 13px; line-height: 1.55; color: #2e2c25; }}
      .setup-steps-grid {{ display: grid; grid-template-columns: 1fr 1.25fr; gap: 16px; margin-top: 8px; }}
      .setup-steps ul, .setup-steps ol {{ margin: 6px 0 0 18px; padding: 0; }}
      .setup-steps li {{ margin-bottom: 4px; }}
      .btn-row {{ display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px; align-items: center; }}
      .btn-secondary {{ background: #fbfaf5; color: #2e2c25; border: 2px solid #2e2c25; border-radius: 999px; padding: 11px 18px; font-family: inherit; font-weight: 800; cursor: pointer; font-size: 14px; box-shadow: 2px 2px 0 #2e2c25; transition: transform .1s ease, background .1s ease; }}
      .btn-secondary:hover {{ background: #f7e2cf; transform: translateY(-1px); }}
      .btn-secondary:active {{ transform: translate(1px, 1px); box-shadow: 1px 1px 0 #2e2c25; }}
      .back-admin-link {{ margin-left: auto; font-size: 13px; font-weight: 800; color: #8a2823; text-decoration: none; border-bottom: 2px solid #8a2823; padding-bottom: 1px; }}
      .back-admin-link:hover {{ color: #2e2c25; border-bottom-color: #2e2c25; }}
      .cfg-msg {{ margin-top: 4px; padding: 10px 14px; border-radius: 12px; font-size: 13px; font-weight: 700; display: none; border: 2px solid #2e2c25; }}
      .cfg-msg.ok {{ display: block; background: #dcfce7; color: #166534; border-color: #15803d; }}
      .cfg-msg.err {{ display: block; background: #fee2e2; color: #991b1b; border-color: #b91c1c; }}

      /* Custom Branded Dropdown */
      .twp-dd {{ position: relative; width: 100%; }}
      .dd-trigger {{ width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; background: #fff; color: #2e2c25; border: 2px solid #2e2c25; border-radius: 12px; padding: 10px 14px; font-family: inherit; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 2px 2px 0 #2e2c25; text-align: left; transition: background .12s ease, transform .1s ease; }}
      .dd-trigger:hover {{ background: #fffcf3; }}
      .dd-trigger[aria-expanded="true"] {{ background: #fff8e6; box-shadow: 3px 3px 0 #2e2c25; border-color: #8a2823; }}
      .dd-trigger-main {{ display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; flex-wrap: wrap; }}
      .dd-val-title {{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }}
      .dd-chevron {{ flex-shrink: 0; transition: transform .16s ease; }}
      .dd-trigger[aria-expanded="true"] .dd-chevron {{ transform: rotate(180deg); }}
      .dd-menu {{ display: none; position: absolute; top: calc(100% + 8px); left: 0; right: 0; z-index: 50; background: #fbfaf5; border: 2.5px solid #2e2c25; border-radius: 16px; padding: 8px; box-shadow: 5px 5px 0 #2e2c25; gap: 6px; flex-direction: column; }}
      .twp-dd.is-open .dd-menu {{ display: flex; }}
      .dd-opt {{ width: 100%; text-align: left; background: #fff; color: #2e2c25; border: 2px solid transparent; border-radius: 11px; padding: 10px 12px; cursor: pointer; font-family: inherit; transition: background .1s ease, border-color .1s ease; }}
      .dd-opt:hover {{ background: #fff4d6; border-color: #2e2c25; }}
      .dd-opt.is-selected {{ background: #fef0c7; border-color: #2e2c25; }}
      .dd-opt-top {{ display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }}
      .dd-opt-title {{ font-size: 14px; font-weight: 800; color: #2e2c25; }}
      .dd-opt-right {{ display: inline-flex; align-items: center; gap: 6px; }}
      .dd-opt-desc {{ font-size: 12px; font-weight: 500; color: #5a4538; margin-top: 3px; line-height: 1.4; }}
      .dd-check {{ font-size: 13px; font-weight: 900; color: #008069; opacity: 0; }}
      .dd-opt.is-selected .dd-check {{ opacity: 1; }}
      .dd-badge {{ display: inline-block; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 999px; border: 1.5px solid #2e2c25; text-transform: uppercase; letter-spacing: .03em; white-space: nowrap; }}
      .dd-badge-text {{ background: #dcfce7; color: #14532d; }}
      .dd-badge-hello_world {{ background: #fde68a; color: #451a03; }}
      .dd-badge-twp_offer_broadcast {{ background: #f3e8ff; color: #581c87; }}

      @media (max-width: 780px) {{
        .setup-grid, .setup-steps-grid {{ grid-template-columns: 1fr; }}
        .status-card {{ flex-direction: column; align-items: flex-start; gap: 10px; }}
        .back-admin-link {{ margin-left: 0; }}
        .dd-trigger-main {{ gap: 6px; }}
      }}
    </style>

    <div class="status-card">
      <div>
        <div style="font-size:18px; font-weight:800; display:flex; align-items:center; gap:8px;">
          <span>WhatsApp Marketing Automation Dispatcher</span>
        </div>
        <div style="font-size:13px; opacity:0.95; margin-top:2px;">
          Meta Cloud API v21.0 Endpoint: <code>/api/send-whatsapp</code> · Config: <code id="cfgSource">{source_label}</code>
        </div>
      </div>
      <span id="modePill" class="{pill_live_cls}">{mode_label}</span>
    </div>

    <!-- Meta Cloud API Live Setup Card -->
    <div class="card setup-card">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <h2 style="margin:0;">Real Phone Setup (Meta WhatsApp Cloud API Sandbox)</h2>
        <span style="font-size:12px; font-weight:700; color:#6b5240;">Saved locally in gitignored <code>whatsapp.local.json</code></span>
      </div>

      <div class="setup-steps">
        <div class="setup-steps-grid">
          <div>
            <strong>What You Need (100% Free Meta Sandbox):</strong>
            <ul>
              <li>A Meta Developer App (<strong>developers.facebook.com</strong>) with the <strong>WhatsApp</strong> product added.</li>
              <li><strong>Phone Number ID</strong> &amp; <strong>Access Token</strong> (from <em>WhatsApp &rarr; API Setup</em>).</li>
              <li>Your mobile number verified with 6-digit OTP under <em>To &rarr; Manage phone number list</em>.</li>
            </ul>
          </div>
          <div>
            <strong>Quick Test Steps:</strong>
            <ol>
              <li>For an instant cold test, choose <strong>Meta Sandbox hello_world</strong> below, paste ID + Token, save &amp; dispatch.</li>
              <li>To receive the <strong>full Waffle offer promo text</strong>, send <code>Hi</code> once on WhatsApp from your phone to Meta's Test Number, pick <strong>Live Offer Text</strong>, and click <strong>Dispatch Test</strong>.</li>
            </ol>
          </div>
        </div>
      </div>

      <div class="setup-grid">
        <div class="field">
          <label for="waPhoneId">Phone Number ID</label>
          <input id="waPhoneId" class="bordered" type="text" value="{phone_id_esc}" placeholder="e.g. 524891034039812">
        </div>
        <div class="field">
          <label for="waToken">Meta Access Token</label>
          <input id="waToken" class="bordered" type="password" value="" placeholder="{token_placeholder}">
        </div>
      </div>

      <div class="field">
        <label>Default Delivery Mode</label>
        {default_mode_dd}
      </div>

      <div class="btn-row">
        <button type="button" class="btn-submit" id="btnSaveWa" style="width:auto; padding:11px 20px; font-size:15px;">
          Verify &amp; Save Live Credentials
        </button>
        <button type="button" class="btn-secondary" id="btnClearWa">
          Switch to Simulation Mode
        </button>
        <a href="/admin/" class="back-admin-link">&larr; Back to Admin Studio</a>
      </div>
      <div id="cfgStatusMsg" class="cfg-msg"></div>
    </div>

    <div class="grid-2">
      <!-- Test Form -->
      <div class="card">
        <h2>Test Dispatch</h2>
        
        <div class="field">
          <label for="toPhone">Recipient Phone Number</label>
          <div class="input-row">
            <span>+91</span>
            <input id="toPhone" type="tel" value="" placeholder="10-digit mobile number">
          </div>
          <div class="chips-label">Quick Test Recipients:</div>
          <div class="chips-row">{customers_chips or '<span style="font-size:12px;color:#888;">No saved customers</span>'}</div>
        </div>

        <div class="field">
          <label for="custName">Customer Name</label>
          <input id="custName" class="bordered" type="text" value="" placeholder="e.g. Valued Customer">
        </div>

        <div class="field">
          <label>Delivery Mode (This Test)</label>
          {test_mode_dd}
        </div>

        <div class="field">
          <label for="offerName">Offer Title</label>
          <input id="offerName" class="bordered" type="text" value="" placeholder="e.g. Weekend Delight">
        </div>

        <div class="field">
          <label for="discount">Discount Tag</label>
          <input id="discount" class="bordered" type="text" value="" placeholder="e.g. 15% off signature wedge">
        </div>

        <div class="field">
          <label for="dates">Offer Validity</label>
          <input id="dates" class="bordered" type="text" value="" placeholder="e.g. Valid: 15 Nov to 20 Nov 2026">
        </div>

        <button type="button" class="btn-submit" id="btnSend">
          Dispatch Test WhatsApp Message
        </button>
      </div>

      <!-- Live Terminal Output -->
      <div class="card">
        <h2>Live Terminal Log</h2>
        <div class="console-term" id="termOutput">
<span class="log-info">[READY]</span> WhatsApp automation dispatcher initialized.<br>
<span class="log-info">[ENGINE]</span> Mode: <span id="termModeText">{mode_label}</span> | Delivery: <span id="termDeliveryText">{html_lib.escape(cur_delivery_mode)}</span><br>
<span class="log-info">[INFO]</span> Save Meta credentials above for live phone delivery, or click "Dispatch Test" for local simulation.<br>
---------------------------------------------<br>
        </div>
      </div>
    </div>
  </div>

  <script>
    function log(msg, cls) {{
      var term = document.getElementById('termOutput');
      var t = new Date().toLocaleTimeString();
      var row = document.createElement('div');
      var timeSpan = document.createElement('span');
      timeSpan.className = 'log-time';
      timeSpan.textContent = '[' + t + '] ';
      row.appendChild(timeSpan);
      var msgSpan = document.createElement('span');
      if (cls) msgSpan.className = cls;
      msgSpan.textContent = String(msg == null ? '' : msg);
      row.appendChild(msgSpan);
      term.appendChild(row);
      term.scrollTop = term.scrollHeight;
    }}

    function showCfgMsg(msg, isOk) {{
      var el = document.getElementById('cfgStatusMsg');
      el.className = 'cfg-msg ' + (isOk ? 'ok' : 'err');
      el.textContent = msg;
    }}

    function closeAllDropdowns(exceptId) {{
      document.querySelectorAll('.twp-dd.is-open').forEach(function (dd) {{
        if (dd.id !== exceptId) {{
          dd.classList.remove('is-open');
          var trig = dd.querySelector('.dd-trigger');
          if (trig) trig.setAttribute('aria-expanded', 'false');
        }}
      }});
    }}

    function setDropdownValue(ddId, val) {{
      var dd = document.getElementById(ddId);
      if (!dd) return;
      var input = document.getElementById(dd.getAttribute('data-input'));
      var opts = dd.querySelectorAll('.dd-opt');
      var matched = null;
      opts.forEach(function (opt) {{
        var isHit = opt.getAttribute('data-value') === val;
        opt.classList.toggle('is-selected', isHit);
        opt.setAttribute('aria-selected', isHit ? 'true' : 'false');
        if (isHit) matched = opt;
      }});
      if (matched) {{
        if (input) input.value = val;
        var titleEl = dd.querySelector('.dd-val-title');
        var badgeEl = dd.querySelector('.dd-val-badge');
        if (titleEl) titleEl.textContent = matched.getAttribute('data-title');
        if (badgeEl) {{
          badgeEl.textContent = matched.getAttribute('data-badge');
          badgeEl.className = 'dd-badge dd-badge-' + val + ' dd-val-badge';
        }}
      }}
    }}

    function initDropdown(ddId, onChange) {{
      var dd = document.getElementById(ddId);
      if (!dd) return;
      var trig = dd.querySelector('.dd-trigger');
      var opts = Array.prototype.slice.call(dd.querySelectorAll('.dd-opt'));

      function toggle(forceOpen) {{
        var next = typeof forceOpen === 'boolean' ? forceOpen : !dd.classList.contains('is-open');
        closeAllDropdowns(ddId);
        dd.classList.toggle('is-open', next);
        trig.setAttribute('aria-expanded', next ? 'true' : 'false');
      }}

      trig.addEventListener('click', function (ev) {{
        ev.stopPropagation();
        toggle();
      }});

      trig.addEventListener('keydown', function (ev) {{
        if (ev.key === 'ArrowDown' || ev.key === 'Enter' || ev.key === ' ') {{
          ev.preventDefault();
          toggle(true);
          var sel = dd.querySelector('.dd-opt.is-selected') || opts[0];
          if (sel) sel.focus();
        }} else if (ev.key === 'Escape') {{
          toggle(false);
        }}
      }});

      opts.forEach(function (opt, idx) {{
        opt.addEventListener('click', function (ev) {{
          ev.stopPropagation();
          var v = opt.getAttribute('data-value');
          setDropdownValue(ddId, v);
          toggle(false);
          trig.focus();
          if (onChange) onChange(v);
        }});
        opt.addEventListener('keydown', function (ev) {{
          if (ev.key === 'ArrowDown') {{
            ev.preventDefault();
            opts[(idx + 1) % opts.length].focus();
          }} else if (ev.key === 'ArrowUp') {{
            ev.preventDefault();
            opts[(idx - 1 + opts.length) % opts.length].focus();
          }} else if (ev.key === 'Escape') {{
            ev.preventDefault();
            toggle(false);
            trig.focus();
          }}
        }});
      }});
    }}

    document.addEventListener('click', function () {{ closeAllDropdowns(); }});

    initDropdown('ddWaMode', function (val) {{
      setDropdownValue('ddTestMode', val);
      document.getElementById('termDeliveryText').textContent = val;
    }});
    initDropdown('ddTestMode', function (val) {{
      document.getElementById('termDeliveryText').textContent = val;
    }});

    function syncModeUI(data) {{
      var isLive = !!data.configured;
      var pill = document.getElementById('modePill');
      pill.textContent = isLive ? 'Meta Cloud API (Live)' : 'Simulation Engine (Ready)';
      pill.className = 'status-pill ' + (isLive ? 'is-live' : 'is-sim');
      document.getElementById('termModeText').textContent = pill.textContent;
      if (data.delivery_mode) {{
        setDropdownValue('ddWaMode', data.delivery_mode);
        setDropdownValue('ddTestMode', data.delivery_mode);
        document.getElementById('termDeliveryText').textContent = data.delivery_mode;
      }}
      if (data.source) {{
        document.getElementById('cfgSource').textContent = data.source;
      }} else {{
        document.getElementById('cfgSource').textContent = isLive ? 'whatsapp.local.json' : 'none';
      }}
    }}

    function normalizePhone(rawInput) {{
      var digits = String(rawInput || '').replace(/[^0-9]/g, '');
      if (digits.length === 10 && '6789'.indexOf(digits.charAt(0)) !== -1) {{
        return '+91' + digits;
      }}
      if (digits.length >= 11) {{
        return '+' + digits;
      }}
      return '';
    }}

    function fillPhone(phone, name) {{
      var clean = String(phone || '').replace(/[^0-9]/g, '');
      if (clean.length === 12 && clean.indexOf('91') === 0) clean = clean.slice(2);
      document.getElementById('toPhone').value = clean;
      if (name) document.getElementById('custName').value = name;
      log('Target recipient selected: ' + (name || 'Customer') + ' (' + phone + ')', 'log-info');
    }}

    document.getElementById('btnSaveWa').addEventListener('click', function () {{
      var phoneId = document.getElementById('waPhoneId').value.trim();
      var token = document.getElementById('waToken').value.trim();
      var deliveryMode = document.getElementById('waModeSelect').value;

      if (!phoneId) {{
        showCfgMsg('Please enter your Meta Phone Number ID first.', false);
        return;
      }}

      var btn = this;
      btn.disabled = true;
      btn.style.opacity = '0.6';
      log('Verifying Meta Cloud API credentials for Phone ID ' + phoneId + '...', 'log-info');

      fetch('/api/whatsapp-config', {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify({{
          phone_number_id: phoneId,
          token: token,
          delivery_mode: deliveryMode
        }})
      }}).then(function (r) {{
        return r.json().then(function (d) {{ return {{ status: r.status, data: d }}; }});
      }}).then(function (res) {{
        var d = res.data || {{}};
        if (!d.success) throw new Error(d.error || ('Verification failed (HTTP ' + res.status + ')'));
        syncModeUI(d);
        if (d.token_masked) {{
          document.getElementById('waToken').value = '';
          document.getElementById('waToken').placeholder = 'Saved (' + d.token_masked + ') — paste new token to replace';
        }}
        showCfgMsg(d.message || 'Meta Cloud API verified and saved locally!', true);
        log('LIVE CONNECTED: ' + (d.display_phone_number || phoneId) + ' (' + (d.verified_name || 'Meta Sandbox') + ')', 'log-success');
      }}).catch(function (e) {{
        showCfgMsg(e.message, false);
        log('CONFIG ERROR: ' + e.message, 'log-warn');
      }}).finally(function () {{
        btn.disabled = false;
        btn.style.opacity = '1';
      }});
    }});

    document.getElementById('btnClearWa').addEventListener('click', function () {{
      var btn = this;
      btn.disabled = true;
      fetch('/api/whatsapp-config', {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify({{ action: 'clear' }})
      }}).then(function (r) {{ return r.json(); }}).then(function (d) {{
        document.getElementById('waPhoneId').value = '';
        document.getElementById('waToken').value = '';
        document.getElementById('waToken').placeholder = 'Paste EAAG... Meta access token';
        syncModeUI(d);
        showCfgMsg(d.message || 'Switched back to Simulation Mode.', true);
        log('Switched to Simulation Mode (whatsapp.local.json cleared).', 'log-info');
      }}).catch(function (e) {{
        showCfgMsg(e.message, false);
      }}).finally(function () {{
        btn.disabled = false;
      }});
    }});

    document.getElementById('btnSend').addEventListener('click', function () {{
      var rawInput = document.getElementById('toPhone').value.trim();
      var phone = normalizePhone(rawInput);
      if (!phone) {{
        log('Please enter a valid 10-digit Indian mobile number or full international number with country code (e.g. 919876543210).', 'log-warn');
        document.getElementById('toPhone').focus();
        return;
      }}
      var custName = document.getElementById('custName').value.trim() || 'Valued Customer';
      var deliveryMode = document.getElementById('testDeliveryMode').value;
      var name = document.getElementById('offerName').value.trim();
      var disc = document.getElementById('discount').value.trim();
      var dates = document.getElementById('dates').value.trim();

      var btn = this;
      btn.disabled = true;
      btn.style.opacity = '0.6';
      log('Dispatching (' + deliveryMode + ') to ' + phone + '...', 'log-info');

      fetch('/api/send-whatsapp', {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify({{
          to: phone,
          customer_name: custName,
          delivery_mode: deliveryMode,
          name: name,
          discount: disc,
          dates: dates,
          terms: 'Terms apply. Dine-in only.'
        }})
      }}).then(function (r) {{
        return r.json().then(function (d) {{ return {{ status: r.status, data: d }}; }});
      }}).then(function (res) {{
        var data = res.data || {{}};
        if (!data.success || data.error) throw new Error(data.error || ('Dispatch failed (HTTP ' + res.status + ')'));
        log('SUCCESS: ' + (data.message || 'WhatsApp message dispatched!'), 'log-success');
        log('Message ID: ' + (data.message_id || 'wamid.sim_xxxx'), 'log-success');
        log('Engine Mode: ' + (data.mode || 'simulation') + ' | Payload: ' + (data.delivery_mode || deliveryMode), 'log-warn');
        log('---------------------------------------------');
      }}).catch(function (e) {{
        log('ERROR: ' + e.message, 'log-warn');
        log('---------------------------------------------');
      }}).finally(function () {{
        btn.disabled = false;
        btn.style.opacity = '1';
      }});
    }});
  </script>
</body>
</html>'''

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == '/favicon.ico':
            self.send_response(204)
            self.end_headers()
            return

        if path == '/api/whatsapp-config':
            cfg = get_wa_config()
            status_obj = {
                "configured": cfg['configured'],
                "mode": "meta_live" if cfg['configured'] else "simulation",
                "source": cfg['source'],
                "delivery_mode": cfg['delivery_mode'],
                "phone_number_id": cfg['phone_number_id'],
                "token_masked": _mask_token(cfg['token'])
            }
            data = json.dumps(status_obj, indent=2).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)
            return

        if path == '/api/send-whatsapp':
            accept = self.headers.get('Accept', '')
            if 'text/html' in accept:
                html = self.render_whatsapp_test_console()
                data = html.encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

            cfg = get_wa_config()
            status_obj = {
                "status": "online",
                "service": "WhatsApp Marketing Automation Engine",
                "mode": "meta_live" if cfg['configured'] else "simulation",
                "delivery_mode": cfg['delivery_mode'],
                "config_source": cfg['source'],
                "endpoint": "/api/send-whatsapp",
                "config_endpoint": "/api/whatsapp-config",
                "note": "This is an API endpoint. Send POST requests from the Admin Studio or via fetch to dispatch test WhatsApp messages.",
                "example_post_payload": {
                    "to": "+919876543210",
                    "delivery_mode": "text",
                    "name": "WEEEKEND OFFER",
                    "discount": "20% off",
                    "starts_on": "2026-11-14",
                    "ends_on": "2026-11-15"
                }
            }
            resp_data = json.dumps(status_obj, indent=2).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(resp_data)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(resp_data)
            return

        if path == '/api/dispatch-broadcast':
            status_obj = {
                "status": "online",
                "service": "WhatsApp Campaign Broadcast Dispatcher",
                "endpoint": "/api/dispatch-broadcast",
                "note": "Trigger campaign dispatches by sending a POST request with {'broadcast_id': 'uuid'}."
            }
            resp_data = json.dumps(status_obj, indent=2).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(resp_data)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(resp_data)
            return

        if path == '/api/webhook/whatsapp':
            query = urllib.parse.parse_qs(parsed.query)
            hub_challenge = query.get('hub.challenge', [''])[0]
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(hub_challenge.encode('utf-8'))
            return

        if path == '/' or path == '':
            self.send_response(302)
            self.send_header('Location', '/site/')
            self.end_headers()
            return

        # Intercept Supabase Storage for local media files
        if path.startswith('/sb/storage/v1/object/public/media/') or path.startswith('/sb/storage/v1/object/media/'):
            if '/public/media/' in path:
                subpath = path.split('/public/media/')[-1]
            else:
                subpath = path.split('/media/')[-1]
            local_dest = os.path.normpath(os.path.join(SITE_DIR, 'uploads', 'media', subpath))
            if os.path.exists(local_dest) and os.path.isfile(local_dest):
                ext = os.path.splitext(local_dest)[1].lower()
                mime = 'image/jpeg'
                if ext == '.png': mime = 'image/png'
                elif ext == '.webp': mime = 'image/webp'
                elif ext == '.svg': mime = 'image/svg+xml'

                try:
                    with open(local_dest, 'rb') as f:
                        file_data = f.read()
                    self.send_response(200)
                    self.send_header('Content-Type', mime)
                    self.send_header('Content-Length', str(len(file_data)))
                    self.send_header('Cache-Control', 'public, max-age=86400')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(file_data)
                    return
                except Exception as e:
                    print(f"[STORAGE READ ERROR] {e}", flush=True)

            self.proxy_to_supabase()
            return

        # Intercept Supabase local tables
        if path.startswith('/sb/rest/v1/'):
            subpath = path[12:]
            table = subpath.split('?')[0].rstrip('/')
            if table in LOCAL_TABLES:
                query_params = urllib.parse.parse_qs(parsed.query)
                status, res = local_db.handle_get(table, query_params)
                resp_data = json.dumps(res).encode('utf-8')
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(resp_data)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(resp_data)
                return
            self.proxy_to_supabase()
            return

        if path.startswith('/sb/'):
            self.proxy_to_supabase()
            return

        if path == '/admin' or path == '/admin/':
            self.path = '/site/admin/index.html'
            return super().do_GET()

        if path == '/design-system/' or path == '/design-system':
            components_dir = os.path.join(BASE_DIR, 'design-system', 'components')
            components = []
            if os.path.exists(components_dir):
                for item in sorted(os.listdir(components_dir)):
                    item_path = os.path.join(components_dir, item)
                    if os.path.isdir(item_path) and os.path.exists(os.path.join(item_path, 'preview.html')):
                        readme_path = os.path.join(item_path, 'README.md')
                        desc = ""
                        if os.path.exists(readme_path):
                            with open(readme_path, 'r', encoding='utf-8') as f:
                                desc = f.readline().strip()
                        components.append((item, desc))

            cards_html = "".join([
                f'''<div style="background:#fbfaf5;border:3px solid #2e2c25;border-radius:20px;padding:20px;box-shadow:6px 6px 0 #2e2c25;">
                    <h3 style="margin:0 0 8px 0;font-family:Modak,sans-serif;font-size:28px;color:#8a2823;">{name}</h3>
                    <p style="margin:0 0 16px 0;font-size:15px;color:#5a4538;">{desc or "Component preview"}</p>
                    <a href="/design-system/components/{name}/preview.html" target="_blank" style="display:inline-block;padding:8px 18px;background:#f8b500;color:#2e2c25;text-decoration:none;font-weight:bold;border-radius:999px;border:2px solid #2e2c25;">View Preview &rarr;</a>
                </div>''' for name, desc in components
            ])

            html = f'''<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>That Waffle Place - Design System Catalog</title>
    <link rel="stylesheet" href="/site/tokens.css">
    <link href="https://fonts.googleapis.com/css2?family=Modak&family=Ranchers&family=Zen+Maru+Gothic:wght@500;700&display=swap" rel="stylesheet">
    <style>
        body {{ background: #eed4bc; color: #2e2c25; font-family: 'Zen Maru Gothic', sans-serif; margin: 0; padding: 40px 20px; }}
        .header {{ max-width: 1100px; margin: 0 auto 30px auto; display: flex; justify-content: space-between; align-items: center; }}
        h1 {{ font-family: Modak, sans-serif; font-size: 48px; color: #8a2823; margin: 0; text-shadow: 2px 2px 0 #2e2c25; }}
        .btn {{ display: inline-block; padding: 10px 22px; background: #8a2823; color: #eed4bc; text-decoration: none; border-radius: 999px; font-weight: bold; border: 2px solid #2e2c25; }}
        .grid {{ max-width: 1100px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 24px; }}
    </style>
</head>
<body>
    <div class="header">
        <div>
            <h1>That Waffle Place!</h1>
            <p style="margin: 6px 0 0 0; font-size: 18px; color: #5a4538;">Design System Component Showcase (16 interactive components)</p>
        </div>
        <a class="btn" href="/site/">Launch Main Website &rarr;</a>
    </div>
    <div class="grid">{cards_html}</div>
</body>
</html>'''
            data = html.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        if path.startswith('/design-system/components/') and path.endswith('/preview.html'):
            disk_path = os.path.normpath(os.path.join(BASE_DIR, path.lstrip('/')))
            if os.path.exists(disk_path):
                with open(disk_path, 'r', encoding='utf-8') as f:
                    content = f.read()

                content = re.sub(r'\{\{([^}]+)\}\}', r'/design-system/assets/\1', content)

                head_injection = '''
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="/site/tokens.css">
    <link rel="stylesheet" href="/design-system/components/bundle.css">
    <script src="/design-system/components/bundle.js"></script>
</head>
<body style="margin: 0; padding: 20px; background: var(--surface); min-height: 100vh; box-sizing: border-box;">
'''
                tail_injection = '</body></html>'
                wrapped = head_injection + content + tail_injection
                data = wrapped.encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

        rel_path = path.lstrip('/')
        disk_in_root = os.path.normpath(os.path.join(BASE_DIR, rel_path))
        abs_base = os.path.abspath(BASE_DIR)
        abs_site = os.path.abspath(SITE_DIR)

        # Defense-in-depth: Reject any path traversal escaping the project base directory
        if not os.path.abspath(disk_in_root).startswith(abs_base):
            self.send_error(403, "Access denied")
            return

        if not os.path.exists(disk_in_root):
            disk_in_site = os.path.normpath(os.path.join(SITE_DIR, rel_path))
            if os.path.abspath(disk_in_site).startswith(abs_site) and os.path.exists(disk_in_site):
                self.path = '/site/' + rel_path

        return super().do_GET()

if __name__ == '__main__':
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("", PORT), WaffleRequestHandler) as httpd:
        print(f"Serving That Waffle Place with WhatsApp Automation on http://localhost:{PORT}")
        httpd.serve_forever()
