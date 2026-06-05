// ─── Auth State ─────────────────────────────────────────────────
let currentUser    = null;
let currentProfile = null;

// ─── Sign In — รองรับ email / เบอร์โทร / username ───────────────
async function doSignIn() {
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

  // ถ้าไม่ใช่ email (ไม่มี @) → lookup จาก phone หรือ username
  if (!identifier.includes('@')) {
    const { data, error: rpcErr } = await _sb.rpc('get_email_by_identifier', { p_identifier: identifier });
    if (rpcErr || !data) {
      showErr('ไม่พบผู้ใช้นี้ในระบบ');
      return;
    }
    email = data;
  }

  const { data, error } = await _sb.auth.signInWithPassword({ email, password });

  btn.disabled  = false;
  btn.innerHTML = '<i class="ti ti-login"></i> เข้าสู่ระบบ';

  if (error) {
    showErr('รหัสผ่านไม่ถูกต้อง');
    return;
  }

  currentUser = data.user;
  await _initApp();
}

// ─── Sign Out ────────────────────────────────────────────────────
async function doSignOut() {
  await _sb.auth.signOut();
  currentUser    = null;
  currentProfile = null;
  document.getElementById('auth-overlay').style.display = 'flex';
}

// ─── Load current user's profile ────────────────────────────────
async function loadCurrentProfile() {
  if (!currentUser) return;
  let { data, error } = await _sb.from('profiles').select('*').eq('id', currentUser.id).single();
  if (error) console.warn('[profile]', error.message);
  if (!data) {
    // Profile ไม่มี — สร้างอัตโนมัติจาก auth.users
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

  const roleLabels = {
    super_admin:   'Super Admin',
    village_admin: 'Village Admin',
    meter_reader:  'พนักงานจดมิเตอร์',
    finance:       'การเงิน',
  };
  const el = {
    name:   document.querySelector('.user-name'),
    role:   document.querySelector('.user-role'),
    avatar: document.querySelector('.user-avatar'),
  };
  if (el.name)   el.name.textContent   = data.full_name;
  if (el.role)   el.role.textContent   = roleLabels[data.role] || data.role;
  if (el.avatar) el.avatar.textContent = (data.full_name || '?').substring(0, 2).toUpperCase();
}

// ─── Init app after successful auth ─────────────────────────────
async function _initApp() {
  _showLoadingOverlay('กำลังโหลดข้อมูล...');
  await loadCurrentProfile();
  const ok = await loadAllFromSupabase();
  _hideLoadingOverlay();

  if (!ok) {
    // fallback to localStorage
    loadFromStorage();
    loadRateConfig();
    loadMaintenanceFromStorage();
    toast('ใช้ข้อมูล local (offline mode)', 'warn');
  }

  document.getElementById('auth-overlay').style.display = 'none';

  // แสดง/ซ่อน nav users ตาม role
  const usersNav = document.getElementById('nav-users');
  if (usersNav) usersNav.style.display = currentProfile?.role === 'super_admin' ? '' : 'none';

  // Populate village select ใน user modal
  const uVillage = document.getElementById('uform-village');
  if (uVillage && _dbVillages.length) {
    uVillage.innerHTML = '<option value="">ทุกหมู่บ้าน</option>' +
      _dbVillages.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('');
  }

  if (syncOverdueStatus()) saveToStorage();
  renderDashboard();
  renderMembers();
  _populateBillingFilters();
  renderBilling();
  renderDebtors();
  renderPayments();
  renderReports();
  renderMaintenance();
  renderSettingsRates();
  renderSettingsVillages();
}

// ─── Check existing session on page load ────────────────────────
async function checkSession() {
  const { data: { session } } = await _sb.auth.getSession();
  if (session) {
    currentUser = session.user;
    await _initApp();
  } else {
    _hideLoadingOverlay();
    document.getElementById('auth-overlay').style.display = 'flex';
  }

  // Auto-refresh session
  _sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      currentUser    = null;
      currentProfile = null;
      document.getElementById('auth-overlay').style.display = 'flex';
    }
  });
}

// ─── Loading overlay ─────────────────────────────────────────────
function _showLoadingOverlay(msg) {
  const el  = document.getElementById('loading-overlay');
  const txt = document.getElementById('loading-text');
  if (txt) txt.textContent = msg || 'กำลังโหลด...';
  if (el)  el.style.display = 'flex';
}
function _hideLoadingOverlay() {
  const el = document.getElementById('loading-overlay');
  if (el)  el.style.display = 'none';
}
