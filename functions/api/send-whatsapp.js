/**
 * Cloudflare Pages Function: /api/send-whatsapp
 * Dispatches live WhatsApp test/offer messages via Meta Cloud API v21.0
 */

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

    const hasPoster = Boolean(data.poster_url && typeof data.poster_url === 'string' && (data.poster_url.startsWith('http://') || data.poster_url.startsWith('https://')));

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
                image: { link: data.poster_url }
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

    let metaRes = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    let metaData = await metaRes.json();
    if (!metaRes.ok && hasPoster) {
      // Fallback to text template if poster link fails
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
      metaData = await metaRes.json();
    }

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
