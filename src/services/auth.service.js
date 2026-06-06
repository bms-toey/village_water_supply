// ─── Authentication Service ────────────────────────────────────
// Handles sign-in, sign-out, profile loading, and app initialisation
// after a successful auth event.
// ──────────────────────────────────────────────────────────────
import { _sb } from './supabase.service.js';
import { loadAllFromSupabase, sbUpdateBillFees } from './data-loader.service.js';
import { loadFromStorage, loadRateConfig, loadMaintenanceFromStorage } from './storage.service.js';
import { syncOverdueStatus, applyLateFees } from '../utils/date.util.js';
import { saveToStorage } from './storage.service.js';
import { toast } from '../utils/dom.util.js';
import { roleLabels } from '../config/ui.config.js';
import { _dbVillages } from './db-mapper.service.js';
import { esc } from '../utils/dom.util.js';

export let currentUser    = null;
export let currentProfile = null;

// ─── Sign In ─────────────────────────────────────────────────
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

  let email = identifier;

  if (!identifier.includes('@')) {
    const { data, error: rpcErr } = await _sb.rpc('get_email_by_identifier', { p_identifier: identifier });
    if (rpcErr) {
      console.error('[login] get_email_by_identifier error:', rpcErr);
      showErr('ระบบไม่สามารถค้นหาผู้ใช้ได้ กรุณาใช้อีเมลแทน');
      return;
    }
    if (!data) { showErr('ไม่พบเบอร์โทร/Username นี้ในระบบ'); return; }
    email = data;
  }

  const { data, error } = await _sb.auth.signInWithPassword({ email, password });

  btn.disabled  = false;
  btn.innerHTML = '<i class="ti ti-login"></i> เข้าสู่ระบบ';

  if (error) { showErr('รหัสผ่านไม่ถูกต้อง'); return; }

  currentUser = data.user;
  await _initApp();
}

// ─── Sign Out ────────────────────────────────────────────────
export async function doSignOut() {
  await _sb.auth.signOut();
  currentUser    = null;
  currentProfile = null;
  document.getElementById('auth-overlay').style.display = 'flex';
}

// ─── Load Profile ─────────────────────────────────────────────
export async function loadCurrentProfile() {
  if (!currentUser) return;
  let { data, error } = await _sb.from('profiles').select('*').eq('id', currentUser.id).single();
  if (error) console.warn('[profile]', error.message);

  if (!data) {
    const { data: inserted } = await _sb.from('profiles').upsert({
      id:        currentUser.id,
      full_name: currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'Admin',
      email:     currentUser.email,
      username:  currentUser.email?.split('@')[0] || 'admin',
      role:      'super_admin',
      is_active: true,
    }, { onConflict: 'id' }).select().single();
    data = inserted;
  }

  if (!data) return;
  currentProfile = data;

  const el = {
    name:   document.querySelector('.user-name'),
    role:   document.querySelector('.user-role'),
    avatar: document.querySelector('.user-avatar'),
  };
  if (el.name)   el.name.textContent   = data.full_name;
  if (el.role)   el.role.textContent   = roleLabels[data.role] || data.role;
  if (el.avatar) el.avatar.textContent = (data.full_name || '?').substring(0, 2).toUpperCase();
}

// ─── App Init (called after auth) ────────────────────────────
// Imported by app.js which passes render callbacks to avoid
// circular imports between this service and module files.
let _renderCallbacks = null;

export function registerRenderCallbacks(callbacks) {
  _renderCallbacks = callbacks;
}

export async function _initApp() {
  _showLoadingOverlay('กำลังโหลดข้อมูล...');
  let ok = false;
  try {
    await loadCurrentProfile();
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
}

// ─── Session Check ────────────────────────────────────────────
export async function checkSession() {
  // SW just updated — force sign out so user starts fresh with new code
  if (sessionStorage.getItem('_sw_force_logout')) {
    sessionStorage.removeItem('_sw_force_logout');
    await _sb.auth.signOut().catch(() => {});
    _hideLoadingOverlay();
    document.getElementById('auth-overlay').style.display = 'flex';
    return;
  }

  const { data: { session } } = await _sb.auth.getSession();
  if (session) {
    currentUser = session.user;
    await _initApp();
  } else {
    _hideLoadingOverlay();
    document.getElementById('auth-overlay').style.display = 'flex';
  }

  _sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      currentUser    = null;
      currentProfile = null;
      document.getElementById('auth-overlay').style.display = 'flex';
    }
  });
}

// ─── Change Password ──────────────────────────────────────
export function openChangePwdModal() {
  ['cpwd-new','cpwd-confirm'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
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

  const { error } = await _sb.auth.updateUser({ password: newPwd });

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

// ─── Loading Overlay ─────────────────────────────────────────
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
