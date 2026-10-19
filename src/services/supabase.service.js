// ─── Supabase Client ───────────────────────────────────────────
// _sb แนบ JWT จาก session.service ไปกับทุก request (REST + Realtime)
// ยังไม่ login → ใช้ anon key ซึ่งเรียกได้แค่ RPC verify_login
//
// Credentials are loaded from window.APP_CONFIG (config.js).
// The anon key is browser-safe — access is enforced by RLS
// (sql/sql_secure_auth.sql).
// ──────────────────────────────────────────────────────────────
import { getAccessToken } from './session.service.js';

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
// หมายเหตุ: เมื่อใช้ accessToken แล้ว _sb.auth ใช้ไม่ได้ (ไม่ได้ใช้ Supabase Auth)
export const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  accessToken: async () => getAccessToken(),
});

// เรียกหลัง login / ต่ออายุ / logout ให้ช่อง Realtime ใช้ token ล่าสุด
export function syncRealtimeAuth() {
  _sb.realtime.setAuth().catch(e => console.warn('[realtime] setAuth:', e));
}
