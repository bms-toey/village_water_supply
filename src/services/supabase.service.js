// ─── Supabase Client ───────────────────────────────────────────
// Initialises and exports the two Supabase client instances.
//
// _sb       — main session client (persistent auth)
// _sbCreate — secondary client for creating users without
//             disrupting the admin session (separate storageKey)
//
// Credentials are loaded from window.APP_CONFIG (config.js)
// which is gitignored. Never hardcode keys here.
// ──────────────────────────────────────────────────────────────

const cfg = window.APP_CONFIG;
if (!cfg?.SUPABASE_URL || !cfg?.SUPABASE_ANON_KEY) {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;background:#f8fafc">
      <div style="text-align:center;padding:32px;max-width:480px">
        <div style="font-size:48px;margin-bottom:16px">⚙️</div>
        <h2 style="color:#1e3a5f;margin-bottom:8px">ยังไม่ได้ตั้งค่าระบบ</h2>
        <p style="color:#64748b;font-size:14px;line-height:1.6">
          ไม่พบไฟล์ <code>config.js</code><br>
          กรุณาคัดลอก <code>config.example.js</code> เป็น <code>config.js</code>
          แล้วใส่ค่า Supabase URL และ Anon Key ของโปรเจกต์คุณ
        </p>
      </div>
    </div>`;
  throw new Error('APP_CONFIG not found — copy config.example.js to config.js');
}

const SUPABASE_URL      = cfg.SUPABASE_URL;
const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY;

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
