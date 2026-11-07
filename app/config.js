/* Server settings (Supabase). The anon key is PUBLIC by design - it is safe to commit.
   Leave both empty to run in local-only mode (no login, no server sync).
   Fill them from: Supabase -> Project Settings -> API. */
window.SHELEM_CONFIG = {
    supabaseUrl: '',   // e.g. 'https://abcdxyz.supabase.co'
    anonKey: ''        // the "anon public" key
};
