// Local development connection only. The publishable key is safe to expose in a browser;
// never put a Supabase secret or service-role key in this file.
(() => {
  const url = 'http://127.0.0.1:54321';
  const publishableKey = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

  if (!window.supabase?.createClient) {
    throw new Error('Supabase JS did not load. Check your internet connection and refresh.');
  }

  window.buddiSupabase = window.supabase.createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
})();
