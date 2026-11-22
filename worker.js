/**
 * Cloudflare Worker for That Waffle Place
 * - Serves static assets from ./site via Workers Static Assets
 * - Proxies /sb/* requests to Supabase (mimicking Vercel rewrites)
 * - Dispatches WhatsApp Cloud API messages (/api/send-whatsapp)
 * - Supports HTTP REST, Auth, and WebSocket Realtime connections
 */

const SUPABASE_ORIGIN = "https://hdewnmlpuznncvkyxpjn.supabase.co";
const DEFAULT_WA_TOKEN = "";
const DEFAULT_PHONE_ID = "1465237300010288";

function corsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": request ? (request.headers.get("Origin") || "*") : "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, Prefer, x-upsert, cache-control",
    "Access-Control-Allow-Credentials": "true",
    "Content-Type": "application/json"
  };
}

async function handleSendWhatsApp(request, env) {
  try {
    const data = await request.json();
    const token = (env && env.WHATSAPP_TOKEN) || DEFAULT_WA_TOKEN;
    const phoneId = (env && env.WHATSAPP_PHONE_NUMBER_ID) || DEFAULT_PHONE_ID;

    let cleaned = (data.to || '').replace(/\D/g, '');
    if (cleaned.startsWith('0091') && cleaned.length === 14) cleaned = cleaned.slice(4);
    else if (cleaned.startsWith('91') && cleaned.length === 12) cleaned = cleaned.slice(2);
    else if (cleaned.startsWith('0') && cleaned.length === 11) cleaned = cleaned.slice(1);
    if (cleaned.length === 10) cleaned = '91' + cleaned;

    if (!cleaned || cleaned.length < 10) {
      return new Response(JSON.stringify({ success: false, error: "Invalid recipient mobile number." }), {
        status: 400,
        headers: corsHeaders(request)
      });
    }

    const custName = (data.customer_name || '').trim() || 'Valued Customer';
    const offerName = (data.offer_name || '').trim() || 'Weekend Special';
    const disc = (data.discount || '').trim() || 'Special discount';
    const validity = (data.starts_on && data.ends_on) ? `${data.starts_on} to ${data.ends_on}` : ((data.validity || '').trim() || 'Limited time');
    const tms = (data.terms || '').trim() || 'Terms apply.';

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: cleaned,
      type: "template",
      template: {
        name: "twp_offer_broadcast",
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: custName },
              { type: "text", text: offerName },
              { type: "text", text: disc },
              { type: "text", text: validity },
              { type: "text", text: tms }
            ]
          }
        ]
      }
    };

    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const metaData = await metaRes.json();
    if (!metaRes.ok) {
      const err = (metaData && metaData.error && metaData.error.message) || `Meta API error (${metaRes.status})`;
      return new Response(JSON.stringify({ success: false, error: err }), {
        status: 400,
        headers: corsHeaders(request)
      });
    }

    const msgId = (metaData.messages && metaData.messages[0] && metaData.messages[0].id) || 'wamid.sent';
    return new Response(JSON.stringify({
      success: true,
      message_id: msgId,
      mode: "meta_live",
      message: `Delivered via Meta Cloud API! ID: ${msgId}`
    }), {
      status: 200,
      headers: corsHeaders(request)
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message || 'Server error' }), {
      status: 500,
      headers: corsHeaders(request)
    });
  }
}

async function handleDispatchBroadcast(request, env) {
  try {
    const data = await request.json();
    const broadcastId = data.broadcast_id;
    const directCustomers = data.customers;
    const token = (env && env.WHATSAPP_TOKEN) || DEFAULT_WA_TOKEN;
    const phoneId = (env && env.WHATSAPP_PHONE_NUMBER_ID) || DEFAULT_PHONE_ID;
    const anonKey = (env && env.SUPABASE_ANON_KEY) || "sb_publishable_5X5KVusc1uaVCdilCc7MQA_xOl_Xyna";
    const authHeader = request.headers.get("Authorization") || `Bearer ${anonKey}`;

    let broadcast = null;
    if (broadcastId) {
      try {
        const bRes = await fetch(`${SUPABASE_ORIGIN}/rest/v1/broadcasts?id=eq.${broadcastId}`, {
          headers: { "apikey": anonKey, "Authorization": authHeader }
        });
        const bList = await bRes.json();
        if (bList && bList.length) broadcast = bList[0];
      } catch (_) {}
    }

    let offer = {};
    if (broadcast && broadcast.offer_id) {
      try {
        const oRes = await fetch(`${SUPABASE_ORIGIN}/rest/v1/offers?id=eq.${broadcast.offer_id}`, {
          headers: { "apikey": anonKey, "Authorization": authHeader }
        });
        const oList = await oRes.json();
        if (oList && oList.length) offer = oList[0];
      } catch (_) {}
    }

    let customerList = [];
    if (directCustomers && Array.isArray(directCustomers) && directCustomers.length) {
      customerList = directCustomers;
    } else {
      try {
        const cRes = await fetch(`${SUPABASE_ORIGIN}/rest/v1/customers?is_subscribed=eq.true`, {
          headers: { "apikey": anonKey, "Authorization": authHeader }
        });
        const cList = await cRes.json();
        if (cList && Array.isArray(cList)) customerList = cList;
      } catch (_) {}
    }

    let sentCount = 0;
    let failedCount = 0;
    const customMsg = (broadcast && broadcast.custom_message) || (offer && offer.custom_message) || '';

    for (const c of customerList) {
      let cleaned = (c.phone || '').replace(/\D/g, '');
      if (cleaned.startsWith('0091') && cleaned.length === 14) cleaned = cleaned.slice(4);
      else if (cleaned.startsWith('91') && cleaned.length === 12) cleaned = cleaned.slice(2);
      else if (cleaned.startsWith('0') && cleaned.length === 11) cleaned = cleaned.slice(1);
      if (cleaned.length === 10) cleaned = '91' + cleaned;

      if (!cleaned || cleaned.length < 10) {
        failedCount++;
        continue;
      }

      const custName = (c.name || '').trim() || 'Valued Customer';
      const offerName = (offer.name || '').trim() || 'Weekend Special';
      const disc = (offer.discount || '').trim() || 'Special discount';
      const validity = (offer.starts_on && offer.ends_on) ? `${offer.starts_on} to ${offer.ends_on}` : 'Limited time';
      const tms = (offer.terms || '').trim() || 'Terms apply.';

      try {
        const metaRes = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: cleaned,
            type: "template",
            template: {
              name: "twp_offer_broadcast",
              language: { code: "en" },
              components: [
                {
                  type: "body",
                  parameters: [
                    { type: "text", text: custName },
                    { type: "text", text: offerName },
                    { type: "text", text: disc },
                    { type: "text", text: validity },
                    { type: "text", text: tms }
                  ]
                }
              ]
            }
          })
        });
        if (metaRes.ok) {
          sentCount++;
        } else {
          failedCount++;
        }
      } catch (_) {
        failedCount++;
      }
    }

    if (broadcastId) {
      try {
        await fetch(`${SUPABASE_ORIGIN}/rest/v1/broadcasts?id=eq.${broadcastId}`, {
          method: "PATCH",
          headers: {
            "apikey": anonKey,
            "Authorization": authHeader,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            status: sentCount > 0 ? "completed" : "failed",
            total_recipients: customerList.length,
            sent_count: sentCount,
            failed_count: failedCount,
            completed_at: new Date().toISOString()
          })
        });
      } catch (_) {}
    }

    return new Response(JSON.stringify({
      success: true,
      sent: sentCount,
      failed: failedCount,
      total: customerList.length,
      mode: "meta_live"
    }), {
      status: 200,
      headers: corsHeaders(request)
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message || 'Server error' }), {
      status: 500,
      headers: corsHeaders(request)
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight options
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request)
      });
    }

    // 1. WhatsApp API Endpoints
    if (url.pathname === "/api/send-whatsapp") {
      return handleSendWhatsApp(request, env);
    }
    if (url.pathname === "/api/dispatch-broadcast") {
      return handleDispatchBroadcast(request, env);
    }

    // 2. Proxy /sb/* traffic to Supabase
    if (url.pathname.startsWith("/sb/")) {
      const targetPath = url.pathname.replace(/^\/sb/, "") + url.search;
      const targetUrl = new URL(targetPath, SUPABASE_ORIGIN);

      // Pass WebSocket upgrade requests (Supabase Realtime) directly
      if (request.headers.get("Upgrade") === "websocket") {
        return fetch(targetUrl.toString(), request);
      }

      // Clone and adjust headers for Supabase upstream
      const headers = new Headers(request.headers);
      headers.set("host", "hdewnmlpuznncvkyxpjn.supabase.co");

      // Forward request to Supabase
      const forwardInit = {
        method: request.method,
        headers: headers,
        redirect: "follow",
      };

      if (request.method !== "GET" && request.method !== "HEAD") {
        forwardInit.body = request.body;
      }

      const response = await fetch(targetUrl.toString(), forwardInit);

      // Ensure CORS headers are present on the response
      const responseHeaders = new Headers(response.headers);
      if (!responseHeaders.has("Access-Control-Allow-Origin")) {
        responseHeaders.set("Access-Control-Allow-Origin", request.headers.get("Origin") || "*");
        responseHeaders.set("Access-Control-Allow-Credentials", "true");
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }

    // 3. Serve static assets from ./site
    return env.ASSETS.fetch(request);
  },
};
