/**
 * Cloudflare Pages Function: /api/dispatch-broadcast
 * Broadcasts WhatsApp offer campaigns to subscribed customers via Meta Cloud API v21.0
 */

const SUPABASE_ORIGIN = "https://hdewnmlpuznncvkyxpjn.supabase.co";
const DEFAULT_WA_TOKEN = "EAAUmsdp2ZCgkBS0WQTYOuc2eZBjPZCr6dQoM7Ax59UZAliz51ek9qGG3yaiu8AFlvjZAEtbw9HnM8ed7p8IrI10FY2cPmE9fkxvDFZBAIYnKdYkTZAYdw9V6bylN8HxzfKWcoFrkEoE5WzYYEpMpoQJo6YMruYvcrPzS6aAZBAXWrwX29PGKXhwEUOtZB1AIuga6gsAZDZD";
const DEFAULT_PHONE_ID = "1465237300010288";

function corsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": request ? (request.headers.get("Origin") || "*") : "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
  };
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request)
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
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
