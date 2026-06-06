// ─── Users Module ──────────────────────────────────────────────
import { esc, toast } from '../../utils/dom.util.js';
import { _sb } from '../../services/supabase.service.js';
import { _dbVillages } from '../../services/db-mapper.service.js';
import { currentUser, currentProfile } from '../../services/auth.service.js';

const roleMap = {
  super_admin:   { label: 'Super Admin',       cls: 'pill-paid',    icon: 'ti-crown' },
  village_admin: { label: 'Village Admin',     cls: 'pill-pending', icon: 'ti-building-community' },
  meter_reader:  { label: 'พนักงานจดมิเตอร์', cls: 'pill-normal',  icon: 'ti-gauge' },
  finance:       { label: 'การเงิน',            cls: 'pill-closed',  icon: 'ti-coin' },
};

let _allUsers   = [];
let _editUserId = null;

export async function renderUsers() {
  if (currentProfile?.role !== 'super_admin') {
    document.getElementById('page-users')?.classList.remove('active');
    return;
  }
  const tbody = document.getElementById('users-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--gray-400);padding:24px"><i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> กำลังโหลด...</td></tr>';
  const ok = await _loadAllUsers();
  if (!ok) return;
  _renderUserTable();
  _renderUserKPIs();
}

async function _loadAllUsers() {
  const { data, error } = await _sb.rpc('get_all_users');
  if (error) {
    console.error('[users] get_all_users:', error);
    const tbody = document.getElementById('users-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--red-600);padding:24px">โหลดข้อมูลไม่ได้: ${esc(error.message)}</td></tr>`;
    return false;
  }
  _allUsers = data || [];
  return true;
}

function _renderUserKPIs() {
  const kpis = document.querySelectorAll('#page-users .kpi-val');
  if (kpis[0]) kpis[0].textContent = _allUsers.length;
  if (kpis[1]) kpis[1].textContent = _allUsers.filter(u => u.role === 'super_admin').length;
  if (kpis[2]) kpis[2].textContent = _allUsers.filter(u => u.role === 'village_admin').length;
  if (kpis[3]) kpis[3].textContent = _allUsers.filter(u => u.is_active).length;
}

function _renderUserTable() {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;
  if (!_allUsers.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--gray-500);padding:24px">ไม่มีผู้ใช้งาน</td></tr>';
    return;
  }
  tbody.innerHTML = _allUsers.map(u => {
    const r       = roleMap[u.role] || roleMap.meter_reader;
    const village = _dbVillages.find(v => v.id === u.village_id);
    const isMe    = u.id === currentUser?.id;
    const statusPill = u.is_active
      ? '<span class="pill pill-paid"  style="font-size:10.5px;padding:2px 8px">ใช้งาน</span>'
      : '<span class="pill pill-closed" style="font-size:10.5px;padding:2px 8px">ปิดใช้</span>';
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:10px">
        <div class="mavatar" style="background:var(--blue-700);font-size:12px">${(u.full_name||'?').substring(0,2).toUpperCase()}</div>
        <div><div class="text-bold" style="font-size:13px">${esc(u.full_name||'')}${isMe?' <span style="font-size:10px;background:var(--blue-100);color:var(--blue-700);padding:1px 6px;border-radius:8px">คุณ</span>':''}</div>
        <div class="text-muted" style="font-size:11px">${esc(u.email||'—')}</div></div>
      </div></td>
      <td class="mono text-muted" style="font-size:12px">${esc(u.username||'—')}</td>
      <td class="text-muted" style="font-size:12px">${esc(u.phone||'—')}</td>
      <td><span class="pill ${r.cls}" style="font-size:11px;padding:3px 9px"><i class="ti ${r.icon}" style="font-size:12px;margin-right:3px"></i>${r.label}</span></td>
      <td class="text-muted" style="font-size:12px">${esc(village?.name||'ทุกหมู่บ้าน')}</td>
      <td>${statusPill}</td>
      <td><div style="display:flex;gap:5px;justify-content:flex-end">
        <button class="btn btn-secondary btn-xs" onclick="openEditUser('${u.id}')"><i class="ti ti-edit"></i>แก้ไข</button>
        ${!isMe?`<button class="btn btn-xs ${u.is_active?'btn-danger':'btn-secondary'}" onclick="toggleUserActive('${u.id}',${!u.is_active})"><i class="ti ${u.is_active?'ti-user-off':'ti-user-check'}"></i>${u.is_active?'ปิด':'เปิด'}</button>`:''}
      </div></td>
    </tr>`;
  }).join('');
  const footer = document.querySelector('#page-users .tbl-footer span');
  if (footer) footer.textContent = `ผู้ใช้งานทั้งหมด ${_allUsers.length} คน`;
}

export function openAddUser() {
  _editUserId = null;
  document.getElementById('user-modal-title').textContent = 'เพิ่มผู้ใช้งานใหม่';
  document.getElementById('user-modal-icon').className    = 'ti ti-user-plus';
  document.getElementById('uform-pass-label').innerHTML   = 'รหัสผ่าน * <span style="color:var(--gray-400);font-weight:400">(อย่างน้อย 8 ตัว มีตัวเลขด้วย)</span>';
  document.getElementById('uform-password').placeholder   = '••••••••';
  ['uform-fullname','uform-email','uform-password','uform-username','uform-phone'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('uform-role').value     = 'meter_reader';
  document.getElementById('uform-village').value  = '';
  document.getElementById('uform-active').checked = true;
  document.getElementById('user-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('uform-fullname').focus(), 80);
}

export function openEditUser(uid) {
  const u = _allUsers.find(x => x.id === uid); if (!u) return;
  _editUserId = uid;
  const isMe = uid === currentUser?.id;
  document.getElementById('user-modal-title').textContent = 'แก้ไขผู้ใช้งาน';
  document.getElementById('user-modal-icon').className    = 'ti ti-user-edit';
  document.getElementById('uform-pass-label').innerHTML   = 'รหัสผ่านใหม่ <span style="color:var(--gray-400);font-weight:400">(เว้นว่างถ้าไม่ต้องการเปลี่ยน)</span>';
  document.getElementById('uform-password').placeholder   = 'เว้นว่างถ้าไม่เปลี่ยน';
  document.getElementById('uform-password').value         = '';
  document.getElementById('uform-fullname').value = u.full_name || '';
  document.getElementById('uform-email').value    = u.email     || '';
  document.getElementById('uform-username').value = u.username  || '';
  document.getElementById('uform-phone').value    = u.phone     || '';
  document.getElementById('uform-role').value     = u.role;
  document.getElementById('uform-village').value  = u.village_id || '';
  document.getElementById('uform-active').checked = u.is_active !== false;
  // ป้องกัน admin เปลี่ยน role / ปิดใช้งาน ตัวเอง
  const roleEl   = document.getElementById('uform-role');
  const activeEl = document.getElementById('uform-active');
  if (roleEl)   { roleEl.disabled   = isMe; roleEl.title   = isMe ? 'ไม่สามารถเปลี่ยน Role ของตัวเองได้' : ''; }
  if (activeEl) { activeEl.disabled = isMe; activeEl.title = isMe ? 'ไม่สามารถปิดใช้งานบัญชีตัวเองได้' : ''; }
  document.getElementById('user-modal').style.display = 'flex';
}

export function closeUserModal() {
  document.getElementById('user-modal').style.display = 'none';
  _editUserId = null;
}

export async function saveUser() {
  const fullName  = document.getElementById('uform-fullname').value.trim();
  const email     = document.getElementById('uform-email').value.trim();
  const password  = document.getElementById('uform-password')?.value || '';
  const username  = document.getElementById('uform-username').value.trim();
  const phone     = document.getElementById('uform-phone').value.trim();
  const role      = document.getElementById('uform-role').value;
  const villageId = parseInt(document.getElementById('uform-village').value) || null;
  const isActive  = document.getElementById('uform-active').checked;
  if (!fullName) { toast('กรุณากรอกชื่อ-นามสกุล', 'error'); return; }
  const btn = document.querySelector('#user-modal .btn-primary');
  btn.disabled  = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> บันทึก...';
  const reset = () => { btn.disabled = false; btn.innerHTML = '<i class="ti ti-check"></i> บันทึก'; };
  if (_editUserId) {
    const isMe = _editUserId === currentUser?.id;
    if (isMe && role !== currentProfile?.role) {
      reset(); toast('ไม่สามารถเปลี่ยน Role ของตัวเองได้', 'error'); return;
    }
    if (isMe && !isActive) {
      reset(); toast('ไม่สามารถปิดใช้งานบัญชีตัวเองได้', 'error'); return;
    }
    const { error } = await _sb.rpc('admin_update_user', {
      p_user_id:   _editUserId,
      p_full_name: fullName,
      p_username:  username,
      p_phone:     phone,
      p_role:      role,
      p_village:   villageId,
      p_active:    isActive,
    });
    if (error) { reset(); toast('แก้ไขล้มเหลว: ' + error.message, 'error'); return; }
    if (password) {
      if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        reset(); toast('รหัสผ่านต้องมีอย่างน้อย 8 ตัว และมีทั้งตัวอักษรและตัวเลข', 'error'); return;
      }
      const { error: pwErr } = await _sb.rpc('admin_set_user_password', {
        p_user_id:  _editUserId,
        p_password: password,
      });
      if (pwErr) { reset(); toast('แก้ไขรหัสผ่านล้มเหลว: ' + pwErr.message, 'error'); return; }
    }
    reset();
    toast(`แก้ไข ${fullName} แล้ว${password ? ' (เปลี่ยนรหัสผ่านด้วย)' : ''}`, 'success');
  } else {
    if (!email) { reset(); toast('กรุณากรอกอีเมล', 'error'); return; }
    if (!password || password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      reset(); toast('รหัสผ่านต้องมีอย่างน้อย 8 ตัว และมีทั้งตัวอักษรและตัวเลข', 'error'); return;
    }
    const { error } = await _sb.rpc('admin_create_user', {
      p_email:     email,
      p_password:  password,
      p_full_name: fullName,
      p_username:  username,
      p_phone:     phone,
      p_role:      role,
      p_village:   villageId,
    });
    if (error) { reset(); toast('สร้างผู้ใช้ล้มเหลว: ' + error.message, 'error'); return; }
    reset();
    toast(`เพิ่มผู้ใช้ ${fullName} แล้ว`, 'success');
  }
  closeUserModal();
  await _loadAllUsers();
  _renderUserTable();
  _renderUserKPIs();
}

export async function toggleUserActive(uid, newActive) {
  const u = _allUsers.find(x => x.id === uid); if (!u) return;
  const { error } = await _sb.rpc('admin_update_user', { p_user_id: uid, p_full_name: u.full_name, p_username: u.username||'', p_phone: u.phone||'', p_role: u.role, p_village: u.village_id||null, p_active: newActive });
  if (error) { toast('อัปเดตสถานะล้มเหลว', 'error'); return; }
  toast(`${newActive?'เปิด':'ปิด'}ใช้งาน ${u.full_name} แล้ว`, newActive?'success':'warn');
  await _loadAllUsers();
  _renderUserTable();
  _renderUserKPIs();
}
