/* Supabase connection. The anon key is public by design. Never put the service role key here. */
/* Live traffic goes through /sb on this site, because some networks and blockers stop supabase.co. */
window.TWP_SUPABASE = {
  url: /^(localhost|127\.)/.test(location.hostname) ? 'https://hdewnmlpuznncvkyxpjn.supabase.co' : location.origin + '/sb',
  anonKey: 'sb_publishable_5X5KVusc1uaVCdilCc7MQA_xOl_Xyna'
};
