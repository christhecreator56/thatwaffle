/* Supabase connection. The anon key is public by design. Never put the service role key here. */
/* Traffic routes through /sb, enabling resilient offline/local fallback and proxying. */
window.TWP_SUPABASE = {
  url: location.origin + '/sb',
  anonKey: 'sb_publishable_5X5KVusc1uaVCdilCc7MQA_xOl_Xyna'
};
