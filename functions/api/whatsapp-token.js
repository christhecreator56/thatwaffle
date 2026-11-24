/**
 * Cloudflare Pages Function: /api/whatsapp-token
 * Returns the configured WhatsApp Cloud API credentials
 */

const DEFAULT_WA_TOKEN = "EAAUmsdp2ZCgkBS0WQTYOuc2eZBjPZCr6dQoM7Ax59UZAliz51ek9qGG3yaiu8AFlvjZAEtbw9HnM8ed7p8IrI10FY2cPmE9fkxvDFZBAIYnKdYkTZAYdw9V6bylN8HxzfKWcoFrkEoE5WzYYEpMpoQJo6YMruYvcrPzS6aAZBAXWrwX29PGKXhwEUOtZB1AIuga6gsAZDZD";
const DEFAULT_PHONE_ID = "1465237300010288";

function corsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": request ? (request.headers.get("Origin") || "*") : "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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

export async function onRequestGet(context) {
  const { request, env } = context;
  const token = (env && (env.WHATSAPP_TOKEN || env.META_WA_TOKEN)) || DEFAULT_WA_TOKEN;
  const phoneId = (env && (env.WHATSAPP_PHONE_NUMBER_ID || env.META_PHONE_ID)) || DEFAULT_PHONE_ID;

  return new Response(JSON.stringify({
    token: token,
    phone_id: phoneId,
    delivery_mode: "twp_offer_broadcast"
  }), {
    status: 200,
    headers: corsHeaders(request)
  });
}
