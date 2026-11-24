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

function sanitizeMetaParam(text, maxLength = 1024) {
  if (!text) return '';
  return String(text)
    .replace(/[\r\n\t]+/g, ' · ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function extractMetaTemplateFields(rawMsg, baseOpts) {
  const opts = {
    offer_name: baseOpts.offer_name || 'Weekend Special',
    discount: baseOpts.discount || 'Special discount',
    validity: baseOpts.validity || 'Limited time',
    terms: baseOpts.terms || 'Terms apply.'
  };
  if (!rawMsg || typeof rawMsg !== 'string') return opts;

  const lines = rawMsg.split('\n').map(l => l.trim()).filter(Boolean);
  const customNotes = [];

  for (const line of lines) {
    if (line.includes('{offer}') || line.includes('{{2}}')) continue;
    if (line.includes('{discount}') || line.includes('{{3}}')) continue;
    if (line.includes('{validity}') || line.includes('{{4}}')) continue;
    if (line.includes('{terms}') || line.includes('{{5}}')) continue;

    const mOff = line.match(/^(?:🔥\s*\*|Offer:\s*)(.*?)(?:\*|$)/i);
    if (mOff) {
      const vOff = mOff[1].replace(/[*_~]/g, '').trim();
      if (vOff) { opts.offer_name = vOff; continue; }
    }

    const mDisc = line.match(/^(?:🏷️\s*\*OFFER:\*\s*\*|Discount:\s*)(.*?)(?:\*| on your order!|$)/i);
    if (mDisc) {
      const vDisc = mDisc[1].replace(/[*_~]/g, '').trim();
      if (vDisc) { opts.discount = vDisc; continue; }
    }

    const mVal = line.match(/^(?:📅\s*\*Valid:\*\s*|Valid:\s*)(.*?)$/i);
    if (mVal) {
      const vVal = mVal[1].replace(/[*_~]/g, '').trim();
      if (vVal) { opts.validity = vVal; continue; }
    }

    const mTerms = line.match(/^(?:📝\s*\*Terms:\*\s*|Terms:\s*)(.*?)$/i);
    if (mTerms) {
      const vTerms = mTerms[1].replace(/[*_~]/g, '').trim();
      if (vTerms) { opts.terms = vTerms; continue; }
    }

    if (/^\*?That Waffle Place\*?$/i.test(line) ||
        /^Hey\s+.*Fresh offer from.*$/i.test(line) ||
        /^Hi\s+.*special treat from.*$/i.test(line) ||
        /^Show this message at the counter.*$/i.test(line) ||
        /^Visit us in Teynampet.*$/i.test(line) ||
        /^_?Reply STOP to unsubscribe_?$/i.test(line)) {
      continue;
    }

    const clean = line.replace(/\{name\}|\{\{1\}\}/gi, '').trim();
    if (clean) {
      customNotes.push(clean);
    }
  }

  let finalTerms = opts.terms || 'Terms apply.';
  if (customNotes.length > 0) {
    const joinedNotes = customNotes.join(' · ');
    if (finalTerms && !joinedNotes.includes(finalTerms)) {
      finalTerms = `${finalTerms} · ${joinedNotes}`;
    } else {
      finalTerms = joinedNotes;
    }
  }
  opts.terms = finalTerms;
  return opts;
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

      const baseValidity = (offer.starts_on && offer.ends_on) ? `${offer.starts_on} to ${offer.ends_on}` : 'Limited time';
      const parsed = extractMetaTemplateFields(customMsg, {
        offer_name: offer.name,
        discount: offer.discount,
        validity: baseValidity,
        terms: offer.terms
      });

      const custName = sanitizeMetaParam(c.name || 'Valued Customer', 60);
      const offerName = sanitizeMetaParam(parsed.offer_name || 'Weekend Special', 80);
      const disc = sanitizeMetaParam(parsed.discount || 'Special discount', 60);
      const validity = sanitizeMetaParam(parsed.validity || 'Limited time', 60);
      const tms = sanitizeMetaParam(parsed.terms || 'Terms apply.', 1024);

      const poster = (offer && offer.poster_url) || (broadcast && broadcast.poster_url);
      const hasPoster = Boolean(poster && typeof poster === 'string' && (poster.startsWith('http://') || poster.startsWith('https://')));

      const payload = hasPoster ? {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleaned,
        type: "template",
        template: {
          name: "twp_offer_poster",
          language: { code: "en" },
          components: [
            {
              type: "header",
              parameters: [
                {
                  type: "image",
                  image: { link: poster }
                }
              ]
            },
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
      } : {
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

      try {
        let metaRes = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        if (!metaRes.ok && hasPoster) {
          const fallbackPayload = {
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
          metaRes = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(fallbackPayload)
          });
        }

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
