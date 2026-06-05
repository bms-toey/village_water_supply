// ─── Supabase Client ───────────────────────────────────────────
// Initialises and exports the two Supabase client instances.
//
// _sb       — main session client (persistent auth)
// _sbCreate — secondary client for creating users without
//             disrupting the admin session (separate storageKey)
// ──────────────────────────────────────────────────────────────

const SUPABASE_URL      = 'https://gtflwdzatwowhufxddxs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0Zmx3ZHphdHdvd2h1ZnhkZHhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMjc5MTIsImV4cCI6MjA5NTkwMzkxMn0.n9DccSYx0knRzqdILk91aV-is-pIcgXhQpCUkMU7gK4';

// supabase is loaded as a global via CDN script in index.html
export const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const _sbCreate = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession:    false,
    autoRefreshToken:  false,
    detectSessionInUrl: false,
    storageKey:        'sb-admin-create',
  },
});
