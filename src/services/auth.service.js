// ─── Authentication Service ────────────────────────────────────
// Login ด้วย email / username / เบอร์โทร ผ่าน RPC verify_login
// ซึ่งคืน JWT ที่ฐานข้อมูลเซ็นเอง → RLS บังคับสิทธิ์ทุก request
// Session อายุ 12 ชม. ต่ออายุอัตโนมัติเมื่อเหลือ < 2 ชม.
// (ดู sql/sql_secure_auth.sql)
// ──────────────────────────────────────────────────────────────
import { _sb, syncRealtimeAuth } from './supabase.service.js';
import { getSession, setSession, clearSession, secondsLeft } from './session.service.js';
import { loadAllFromSupabase, sbUpdateBillFees } from './data-loader.service.js';
import { loadFromStorage, loadRateConfig, loadMaintenanceFromStorage } from './storage.service.js';
import { syncOverdueStatus, applyLateFees } from '../utils/date.util.js';
import { saveToStorage } from './storage.service.js';
import { toast } from '../utils/dom.util.js';
import { roleLabels } from '../config/ui.config.js';

const REFRESH_BEFORE_SEC = 2 * 3600;
const RETRY_SEC          = 5 * 60;

export let currentUser    = null;
export let currentProfile = null;

let _refreshTimer = null;

// ─── Session lifecycle ────────────────────────────────────────
// ใช้ session ใหม่ (หลัง login / ต่ออายุ / เปลี่ยนรหัสผ่าน)
export function adoptSession(session, remember) {
  setSession(session, remember);
  currentProfile = session.profile;
  currentUser    = session.profile;
  syncRealtimeAuth();
  _scheduleRefresh();
}

function _scheduleRefresh() {
  clearTimeout(_refreshTimer);
  const left = secondsLeft();
  if (left <= 0) { _expireSession(); return; }
  const wait = Math.max(0, left - REFRESH_BEFORE_SEC);
  _refreshTimer = setTimeout(_refreshNow, wait * 1000);
}

async function _refreshNow() {
  const { data, error } = await _sb.rpc('refresh_session');
  if (data?.token) {
    adoptSession(data);
    loadCurrentProfile();
    return;
  }
  if (_isNetworkError(error) && secondsLeft() > 0) {
    clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(_refreshNow, Math.min(RETRY_SEC, secondsLeft()) * 1000);
    return;
  }
  _expireSession();
}

function _expireSession() {
  _endSession();
  _showLogin('เซสชันหมดอายุหรือถูกยกเลิก กรุณาเข้าสู่ระบบใหม่');
}

function _endSession() {
  clearTimeout(_refreshTimer);
  clearSession();
  currentUser    = null;
  currentProfile = null;
  syncRealtimeAuth();
}

// timer ในแท็บที่ถูกพักอาจไม่ทำงาน — เช็กใหม่ทุกครั้งที่กลับมาเปิดแอป
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && getSession()) _scheduleRefresh();
});

// fetch ล้มเหลว (ออฟไลน์) จะไม่มี error.code — ต่างจาก error จาก server
function _isNetworkError(error) {
  if (!error) return false;
  return !navigator.onLine || !error.code || /fetch|network|load failed/i.test(error.message || '');
}

function _showLogin(message) {
  _hideLoadingOverlay();
  const errEl = document.getElementById('login-error');
  if (errEl) {
    errEl.textContent   = message || '';
    errEl.style.display = message ? 'block' : 'none';
  }
  document.getElementById('auth-overlay').style.display = 'flex';
}

// ─── Sign In ──────────────────────────────────────────────────
export async function doSignIn() {
  const idEl   = document.getElementById('login-identifier');
  const passEl = document.getElementById('login-password');
  const errEl  = document.getElementById('login-error');
  const btn    = document.getElementById('login-btn');

  const identifier = idEl.value.trim();
  const password   = passEl.value;
  errEl.style.display = 'none';

  if (!identifier || !password) {
    errEl.textContent   = 'กรุณากรอกข้อมูลและรหัสผ่าน';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled  = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> กำลังเข้าสู่ระบบ...';

  const { data, error } = await _sb.rpc('verify_login', {
    p_identifier: identifier,
    p_password:   password,
  });

  btn.disabled  = false;
  btn.innerHTML = '<i class="ti ti-login"></i> เข้าสู่ระบบ';

  if (error || !data?.token) {
    errEl.textContent = data?.error
      || (_isNetworkError(error) ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' : 'เข้าสู่ระบบไม่ได้ กรุณาลองใหม่');
    errEl.style.display = 'block';
    return;
  }

  passEl.value = '';
  const remember = !!document.getElementById('login-remember')?.checked;
  adoptSession(data, remember);
  await _initApp();
}

// ─── Sign Out ─────────────────────────────────────────────────
export async function doSignOut() {
  _endSession();
  _showLogin();
}

// ─── Load Profile — อัปเดต UI จาก session ที่เก็บไว้ ────────
export async function loadCurrentProfile() {
  if (!currentProfile) return;
  const data = currentProfile;

  const initials = (data.full_name || '?').substring(0, 2).toUpperCase();
  const el = {
    name:   document.querySelector('.user-name'),
    role:   document.querySelector('.user-role'),
    avatar: document.querySelector('.user-avatar'),
  };
  if (el.name)   el.name.textContent   = data.full_name;
  if (el.role)   el.role.textContent   = roleLabels[data.role] || data.role;
  if (el.avatar) el.avatar.textContent = initials;

  const bnavName   = document.getElementById('bnav-name');
  const bnavRole   = document.getElementById('bnav-role');
  const bnavAvatar = document.getElementById('bnav-avatar');
  if (bnavName)   bnavName.textContent   = data.full_name;
  if (bnavRole)   bnavRole.textContent   = roleLabels[data.role] || data.role;
  if (bnavAvatar) bnavAvatar.textContent = initials;

  const topbarAvatar = document.getElementById('topbar-user-avatar');
  if (topbarAvatar) topbarAvatar.textContent = initials;
}

// ─── App Init (เรียกหลัง login สำเร็จ) ───────────────────────
let _renderCallbacks = null;

export function registerRenderCallbacks(callbacks) {
  _renderCallbacks = callbacks;
}

export async function _initApp() {
  _showLoadingOverlay('กำลังโหลดข้อมูล...');
  let ok = false;
  try {
    loadCurrentProfile();
    ok = await loadAllFromSupabase();
  } catch (e) {
    console.error('[initApp] unexpected error:', e);
  } finally {
    _hideLoadingOverlay();
  }

  if (!ok) {
    loadFromStorage();
    loadRateConfig();
    loadMaintenanceFromStorage();
    toast('ใช้ข้อมูล local (offline mode)', 'warn');
  }

  document.getElementById('auth-overlay').style.display = 'none';

  const usersNav = document.getElementById('nav-users');
  if (usersNav) usersNav.style.display = currentProfile?.role === 'super_admin' ? '' : 'none';

  const overdueChanged = syncOverdueStatus();
  const feeChanges     = applyLateFees();
  if (overdueChanged || feeChanges.length) {
    saveToStorage();
    feeChanges.forEach(b => sbUpdateBillFees(b.id, b.lateFee));
  }

  if (_renderCallbacks) {
    const r = _renderCallbacks;
    r.populateVillageDropdowns?.();
    r.renderDashboard();
    r.renderMembers();
    r.populateBillingFilters();
    r.renderBilling();
    r.renderDebtors();
    r.renderPayments();
    r.renderReports();
    r.renderMaintenance();
  }

  window.dispatchEvent(new Event('aquaflow:data-ready'));

  const startPage = new URLSearchParams(window.location.search).get('page');
  if (startPage && window.goPage) window.goPage(startPage);
}

// ─── Check Session — ตอนเปิดแอป ตรวจ token กับ server ─────────
export async function checkSession() {
  const saved = getSession();
  if (!saved) { _showLogin(); return; }
  if (secondsLeft() <= 0) { _expireSession(); return; }

  const { data, error } = await _sb.rpc('refresh_session');
  if (data?.token) {
    adoptSession(data);
  } else if (_isNetworkError(error)) {
    // ออฟไลน์ — ใช้ session เดิมไปก่อน แล้ว _initApp จะ fallback เป็นข้อมูล local
    adoptSession(saved);
  } else {
    _expireSession();
    return;
  }
  await _initApp();
}

// ─── Change Password ──────────────────────────────────────────
export function openChangePwdModal() {
  ['cpwd-current', 'cpwd-new', 'cpwd-confirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const errEl = document.getElementById('cpwd-error');
  if (errEl) errEl.style.display = 'none';
  document.getElementById('change-pwd-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('cpwd-current')?.focus(), 80);
}

export function closeChangePwdModal() {
  document.getElementById('change-pwd-modal').style.display = 'none';
}

export async function doChangePassword() {
  const currentPwd = document.getElementById('cpwd-current').value;
  const newPwd     = document.getElementById('cpwd-new').value;
  const confirmPwd = document.getElementById('cpwd-confirm').value;
  const errEl      = document.getElementById('cpwd-error');
  const btn        = document.getElementById('cpwd-btn');

  errEl.style.display = 'none';
  const showErr = (msg) => { errEl.textContent = msg; errEl.style.display = 'block'; };

  if (!currentPwd) { showErr('กรุณากรอกรหัสผ่านปัจจุบัน'); return; }
  if (!newPwd || newPwd.length < 8) { showErr('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'); return; }
  if (!/[a-zA-Z]/.test(newPwd) || !/[0-9]/.test(newPwd)) {
    showErr('รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลขอย่างน้อย 1 ตัว');
    return;
  }
  if (newPwd !== confirmPwd) { showErr('รหัสผ่านทั้งสองช่องไม่ตรงกัน'); return; }

  btn.disabled  = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> กำลังบันทึก...';

  const { data, error } = await _sb.rpc('change_my_password', {
    p_current: currentPwd,
    p_new:     newPwd,
  });

  btn.disabled  = false;
  btn.innerHTML = '<i class="ti ti-check"></i> บันทึก';

  if (error || !data?.token) {
    showErr(error?.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ');
    return;
  }

  // session เดิมทุกเครื่องถูกยกเลิกแล้ว — เครื่องนี้ใช้ session ใหม่ต่อ
  adoptSession(data);
  closeChangePwdModal();
  toast('เปลี่ยนรหัสผ่านสำเร็จ — อุปกรณ์อื่นที่ login อยู่จะต้องเข้าสู่ระบบใหม่', 'success');
}

// ─── Loading Overlay ──────────────────────────────────────────
export function _showLoadingOverlay(msg) {
  const el  = document.getElementById('loading-overlay');
  const txt = document.getElementById('loading-text');
  if (txt) txt.textContent = msg || 'กำลังโหลด...';
  if (el)  el.style.display = 'flex';
}
export function _hideLoadingOverlay() {
  const el = document.getElementById('loading-overlay');
  if (el)  el.style.display = 'none';
}
