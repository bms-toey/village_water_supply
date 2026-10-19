// ─── Session Service ───────────────────────────────────────────
// เก็บ session ที่ได้จาก RPC verify_login / refresh_session
//   { token, expires_at (epoch วินาที), profile }
// supabase.service แนบ token นี้ไปกับทุก request → RLS รู้ว่าใครเรียก
//
// "จดจำการเข้าสู่ระบบ" → localStorage (อยู่จนหมดอายุ)
// ไม่ติ๊ก              → sessionStorage (หายเมื่อปิดแท็บ/แอป)
// ไม่ import service อื่น เพื่อกัน circular dependency
// ──────────────────────────────────────────────────────────────

const SESSION_KEY = 'aquaflow_session';

let _session = _read(localStorage) || _read(sessionStorage);
let _store   = _session && _read(localStorage) ? localStorage : sessionStorage;

function _read(store) {
  try {
    const s = JSON.parse(store.getItem(SESSION_KEY) || 'null');
    // session รูปแบบเก่า (มีแต่ profile ไม่มี token) ถือว่าไม่มี → login ใหม่
    return s?.token && s?.expires_at && s?.profile ? s : null;
  } catch {
    return null;
  }
}

function _remove(store) {
  try { store.removeItem(SESSION_KEY); } catch { /* storage blocked */ }
}

export function getSession() {
  return _session;
}

// remember: true/false = เลือกที่เก็บใหม่, undefined = ใช้ที่เก็บเดิม (ตอน refresh)
export function setSession(session, remember) {
  if (remember !== undefined) {
    _remove(_store);
    _store = remember ? localStorage : sessionStorage;
  }
  _session = session;
  try { _store.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* storage blocked */ }
}

export function clearSession() {
  _session = null;
  _remove(localStorage);
  _remove(sessionStorage);
}

export function secondsLeft() {
  return _session ? _session.expires_at - Date.now() / 1000 : 0;
}

// token ที่หมดอายุแล้วไม่ส่ง — supabase-js จะใช้ anon key แทน (เรียกได้แค่ verify_login)
export function getAccessToken() {
  return secondsLeft() > 0 ? _session.token : null;
}
