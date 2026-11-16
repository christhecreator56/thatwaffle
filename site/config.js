/* Supabase connection. The anon key is public by design. Never put the service role key here. */
/* On localhost, traffic routes through /sb for local proxying and offline fallback.
   On production (Cloudflare, etc.), it connects directly to Supabase. */
window.TWP_SUPABASE = {
  url: (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? (location.origin + '/sb')
    : 'https://hdewnmlpuznncvkyxpjn.supabase.co',
  anonKey: 'sb_publishable_5X5KVusc1uaVCdilCc7MQA_xOl_Xyna'
};
