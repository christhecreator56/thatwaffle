/**
 * Cloudflare Worker for That Waffle Place
 * - Serves static assets from ./site via Workers Static Assets
 * - Proxies /sb/* requests to Supabase (mimicking Vercel rewrites)
 * - Supports HTTP REST, Auth, and WebSocket Realtime connections
 */

const SUPABASE_ORIGIN = "https://hdewnmlpuznncvkyxpjn.supabase.co";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Proxy /sb/* traffic to Supabase
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

      // Handle CORS preflight options
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") || "*",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Max-Age": "86400",
          },
        });
      }

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

    // 2. Serve static assets from ./site
    return env.ASSETS.fetch(request);
  },
};
