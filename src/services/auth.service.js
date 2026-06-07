// ─── Authentication Service (Simple Mode) ──────────────────────
// Login ตรวจจาก profiles.password_hash ไม่ผ่าน Supabase Auth
// Session เก็บใน localStorage key 'aquaflow_session'
// ──────────────────────────────────────────────────────────────
import { _sb } from './supabase.service.js';
import { loadAllFromSupabase, sbUpdateBillFees } from './data-loader.service.js';
import { loadFromStorage, loadRateConfig, loadMaintenanceFromStorage } from './storage.service.js';
import { syncOverdueStatus, applyLateFees } from '../utils/date.util.js';
import { saveToStorage } from './storage.service.js';
import { toast } from '../utils/dom.util.js';
import { roleLabels } from '../config/ui.config.js';

const SESSION_KEY = 'aquaflow_session';

export let currentUser    = null;
export let currentProfile = null;

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

  const showErr = (msg) => {
    btn.disabled  = false;
    btn.innerHTML = '<i class="ti ti-login"></i> เข้าสู่ระบบ';
    errEl.textContent   = msg;
    errEl.style.display = 'block';
  };

  const { data, error } = await _sb.rpc('verify_login', {
    p_identifier: identifier,
    p_password:   password,
  });

  btn.disabled  = false;
  btn.innerHTML = '<i class="ti ti-login"></i> เข้าสู่ระบบ';

  if (error) {
    showErr(error.message || 'เข้าสู่ระบบไม่ได้ กรุณาลองใหม่');
    return;
  }

  if (!data || data.length === 0) {
    showErr('ไม่พบข้อมูลผู้ใช้');
    return;
  }

  const profile = data[0];
  currentProfile = profile;
  currentUser    = profile;
  localStorage.setItem(SESSION_KEY, JSON.stringify(profile));

  await _initApp();
}

// ─── Sign Out ─────────────────────────────────────────────────
export async function doSignOut() {
  localStorage.removeItem(SESSION_KEY);
  currentUser    = null;
  currentProfile = null;
  document.getElementById('auth-overlay').style.display = 'flex';
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
    feeChanges.forEach(b => sbUpdateBillFees(b.id, b.lateFee, b.total));
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

// ─── Check Session — อ่าน localStorage แล้ว re-verify ───────
export async function checkSession() {
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) {
    _hideLoadingOverlay();
    document.getElementById('auth-overlay').style.display = 'flex';
    return;
  }

  try {
    const saved = JSON.parse(stored);
    // Re-verify ว่า account ยังใช้งานอยู่
    const { data, error } = await _sb
      .from('profiles')
      .select('id, full_name, email, username, phone, role, village_id, is_active')
      .eq('id', saved.id)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !data) {
      localStorage.removeItem(SESSION_KEY);
      _hideLoadingOverlay();
      document.getElementById('auth-overlay').style.display = 'flex';
      return;
    }

    currentProfile = data;
    currentUser    = data;
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    await _initApp();
  } catch (e) {
    console.error('[checkSession] error:', e);
    localStorage.removeItem(SESSION_KEY);
    _hideLoadingOverlay();
    document.getElementById('auth-overlay').style.display = 'flex';
  }
}

// ─── Change Password ──────────────────────────────────────────
export function openChangePwdModal() {
  ['cpwd-new', 'cpwd-confirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const errEl = document.getElementById('cpwd-error');
  if (errEl) errEl.style.display = 'none';
  document.getElementById('change-pwd-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('cpwd-new')?.focus(), 80);
}

export function closeChangePwdModal() {
  document.getElementById('change-pwd-modal').style.display = 'none';
}

export async function doChangePassword() {
  const newPwd     = document.getElementById('cpwd-new').value;
  const confirmPwd = document.getElementById('cpwd-confirm').value;
  const errEl      = document.getElementById('cpwd-error');
  const btn        = document.getElementById('cpwd-btn');

  errEl.style.display = 'none';

  if (!newPwd || newPwd.length < 8) {
    errEl.textContent   = 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร';
    errEl.style.display = 'block';
    return;
  }
  if (!/[a-zA-Z]/.test(newPwd) || !/[0-9]/.test(newPwd)) {
    errEl.textContent   = 'รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลขอย่างน้อย 1 ตัว';
    errEl.style.display = 'block';
    return;
  }
  if (newPwd !== confirmPwd) {
    errEl.textContent   = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled  = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> กำลังบันทึก...';

  const { error } = await _sb.rpc('set_profile_password', {
    p_user_id: currentProfile.id,
    p_password: newPwd,
  });

  btn.disabled  = false;
  btn.innerHTML = '<i class="ti ti-check"></i> บันทึก';

  if (error) {
    errEl.textContent   = 'เกิดข้อผิดพลาด: ' + error.message;
    errEl.style.display = 'block';
    return;
  }

  closeChangePwdModal();
  toast('เปลี่ยนรหัสผ่านสำเร็จ', 'success');
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
