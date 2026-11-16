/**
 * Cloudflare Pages Function for Supabase proxying (/sb/*)
 * Enables seamless proxying to Supabase when deploying via Cloudflare Pages
 */

const SUPABASE_ORIGIN = "https://hdewnmlpuznncvkyxpjn.supabase.co";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const targetPath = url.pathname.replace(/^\/sb/, "") + url.search;
  const targetUrl = new URL(targetPath, SUPABASE_ORIGIN);

  if (context.request.headers.get("Upgrade") === "websocket") {
    return fetch(targetUrl.toString(), context.request);
  }

  const headers = new Headers(context.request.headers);
  headers.set("host", "hdewnmlpuznncvkyxpjn.supabase.co");

  if (context.request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": context.request.headers.get("Origin") || "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": context.request.headers.get("Access-Control-Request-Headers") || "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const forwardInit = {
    method: context.request.method,
    headers: headers,
    redirect: "follow",
  };

  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    forwardInit.body = context.request.body;
  }

  const response = await fetch(targetUrl.toString(), forwardInit);

  const responseHeaders = new Headers(response.headers);
  if (!responseHeaders.has("Access-Control-Allow-Origin")) {
    responseHeaders.set("Access-Control-Allow-Origin", context.request.headers.get("Origin") || "*");
    responseHeaders.set("Access-Control-Allow-Credentials", "true");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
