// ─── Filter State ───
let _memberSearch  = '';
let _memberVillage = '';
let _memberStatus  = '';

function _memberMatchFilter(m) {
  if (_memberSearch) {
    const q    = _memberSearch.toLowerCase();
    const name = (m.firstName + ' ' + m.lastName).toLowerCase();
    if (!name.includes(q) && !m.meter.toLowerCase().includes(q) && !m.houseNo.toLowerCase().includes(q)) return false;
  }
  if (_memberVillage && m.village !== _memberVillage) return false;
  if (_memberStatus  && m.status  !== _memberStatus)  return false;
  return true;
}

// ─── Render Members Table ───
function renderMembers() {
  const tbody = document.getElementById('members-tbody');
  if (!tbody) return;
  const filtered = members.filter(m => _memberMatchFilter(m));
  tbody.innerHTML = filtered.map(m => {
    const st      = statusMap[m.status]     || statusMap.normal;
    const mt      = memberTypeMap[m.memberType] || memberTypeMap.residential;
    const full    = esc(m.firstName + ' ' + m.lastName);
    const msize   = meterSizeMap[m.meterSize] || m.meterSize || '';
    const actionBtn = m.status === 'overdue'
      ? `<button class="btn-icon" data-mid="${m.id}" data-act="debtors" title="ดูหนี้"><i class="ti ti-alert-triangle"></i></button>`
      : `<button class="btn-icon" data-mid="${m.id}" data-act="billing" title="ดูบิล"><i class="ti ti-receipt"></i></button>`;
    return `<tr data-mid="${m.id}" data-meter="${esc(m.meter)}" data-name="${full}" class="member-row">
      <td><div style="display:flex;align-items:center;gap:11px">
        <div class="mavatar" style="background:${getAvatarColor(m.id)}">${getInitials(m.firstName, m.lastName)}</div>
        <div>
          <div class="text-bold">${full}</div>
          <div class="text-muted" style="font-size:11px">ID: ${m.id} · ${esc(m.houseNo || '—')}</div>
          <span class="mtype-badge ${mt.cls}">${mt.label}</span>
        </div>
      </div></td>
      <td class="text-muted">${esc(m.village)}</td>
      <td><div class="mono">${esc(m.meter)}</div><div class="text-muted" style="font-size:11px">${esc(msize)}${m.meterBrand ? ' · ' + esc(m.meterBrand) : ''}</div></td>
      <td>${Number(m.lastRead).toLocaleString()} m³</td>
      <td><span class="pill ${st.cls}">${st.label}</span></td>
      <td><div style="display:flex;gap:5px;justify-content:flex-end">
        ${actionBtn}
        <button class="btn-icon" data-mid="${m.id}" data-act="meter"  title="จดมิเตอร์"><i class="ti ti-gauge"></i></button>
        <button class="btn-icon" data-mid="${m.id}" data-act="edit"   title="แก้ไข"><i class="ti ti-edit"></i></button>
        <button class="btn-icon" data-mid="${m.id}" data-act="delete" title="ลบ" style="color:var(--red-700);border-color:var(--red-100)"><i class="ti ti-trash"></i></button>
      </div></td>
    </tr>`;
  }).join('');
  const footer = document.getElementById('members-count-footer');
  if (footer) footer.textContent = `แสดง ${filtered.length} จาก ${members.length} รายการ`;
}

// ─── Modal Tab Helpers ───
function switchModalTab(el, panelId) {
  el.closest('.modal-tabs').querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.modal-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(panelId).classList.add('active');
}
function _resetModalTabs() {
  const tabs = document.querySelectorAll('.modal-tab');
  tabs.forEach(t => t.classList.remove('active'));
  if (tabs[0]) tabs[0].classList.add('active');
  document.querySelectorAll('.modal-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-basic').classList.add('active');
}

// ─── Add Member ───
function openAddMember() {
  document.getElementById('modal-member-id').value = '';
  document.getElementById('modal-title-text').textContent = 'เพิ่มสมาชิกใหม่';
  document.getElementById('modal-icon').className = 'ti ti-user-plus';
  ['f-firstname','f-lastname','f-nationalid','f-houseno','f-phone','f-lineid',
   'f-email','f-meter','f-meterbrand','f-gps-lat','f-gps-lng'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('f-village').value     = 'หมู่ 1 บ้านป่า';
  document.getElementById('f-membertype').value  = 'residential';
  document.getElementById('f-household').value   = '1';
  document.getElementById('f-metersize').value   = '0.5';
  document.getElementById('f-status').value      = 'normal';
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('f-regdate').value      = today;
  document.getElementById('f-meterinstall').value = today;
  const exp = new Date(); exp.setFullYear(exp.getFullYear() + 10);
  document.getElementById('f-meterexpire').value  = exp.toISOString().split('T')[0];
  _resetModalTabs();
  document.getElementById('member-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('f-firstname').focus(), 80);
}

// ─── Edit Member ───
function openEditMember(id) {
  const m = members.find(x => x.id === id); if (!m) return;
  document.getElementById('modal-member-id').value     = m.id;
  document.getElementById('modal-title-text').textContent = 'แก้ไขข้อมูลสมาชิก';
  document.getElementById('modal-icon').className      = 'ti ti-user-edit';
  document.getElementById('f-firstname').value         = m.firstName;
  document.getElementById('f-lastname').value          = m.lastName;
  document.getElementById('f-nationalid').value        = m.nationalId  || '';
  document.getElementById('f-houseno').value           = m.houseNo     || '';
  document.getElementById('f-village').value           = m.village;
  document.getElementById('f-membertype').value        = m.memberType  || 'residential';
  document.getElementById('f-household').value         = m.householdCount || 1;
  document.getElementById('f-regdate').value           = m.registrationDate || '';
  document.getElementById('f-phone').value             = m.phone       || '';
  document.getElementById('f-lineid').value            = m.lineId      || '';
  document.getElementById('f-email').value             = m.email       || '';
  document.getElementById('f-gps-lat').value           = m.gpsLat      || '';
  document.getElementById('f-gps-lng').value           = m.gpsLng      || '';
  document.getElementById('f-meter').value             = m.meter;
  document.getElementById('f-metersize').value         = m.meterSize   || '0.5';
  document.getElementById('f-meterbrand').value        = m.meterBrand  || '';
  document.getElementById('f-meterinstall').value      = m.meterInstallDate || '';
  document.getElementById('f-meterexpire').value       = m.meterExpireDate  || '';
  document.getElementById('f-status').value            = m.status;
  _resetModalTabs();
  document.getElementById('member-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('f-firstname').focus(), 80);
}

function closeMemberModal() {
  _closeGpsPicker();
  document.getElementById('member-modal').style.display = 'none';
}

// ─── Save Member (Add or Edit) ───
async function saveMember() {
  const fn    = document.getElementById('f-firstname').value.trim();
  const ln    = document.getElementById('f-lastname').value.trim();
  const meter = document.getElementById('f-meter').value.trim();
  if (!fn || !ln) {
    _resetModalTabs();
    toast('กรุณากรอกชื่อและนามสกุล', 'error');
    return;
  }
  if (!meter) {
    switchModalTab(document.querySelectorAll('.modal-tab')[1], 'tab-meter');
    toast('กรุณากรอกเลขมิเตอร์', 'error');
    return;
  }
  const data = {
    firstName:        fn,
    lastName:         ln,
    nationalId:       document.getElementById('f-nationalid').value.trim(),
    houseNo:          document.getElementById('f-houseno').value.trim(),
    village:          document.getElementById('f-village').value,
    memberType:       document.getElementById('f-membertype').value,
    householdCount:   parseInt(document.getElementById('f-household').value) || 1,
    registrationDate: document.getElementById('f-regdate').value,
    phone:            document.getElementById('f-phone').value.trim(),
    lineId:           document.getElementById('f-lineid').value.trim(),
    email:            document.getElementById('f-email').value.trim(),
    gpsLat:           parseFloat(document.getElementById('f-gps-lat').value) || null,
    gpsLng:           parseFloat(document.getElementById('f-gps-lng').value) || null,
    meter,
    meterSize:        document.getElementById('f-metersize').value,
    meterBrand:       document.getElementById('f-meterbrand').value.trim(),
    meterInstallDate: document.getElementById('f-meterinstall').value,
    meterExpireDate:  document.getElementById('f-meterexpire').value,
    status:           document.getElementById('f-status').value,
  };

  const saveBtn = document.querySelector('#member-modal .btn-primary');
  const editId  = document.getElementById('modal-member-id').value;

  if (editId) {
    const m = members.find(x => x.id === parseInt(editId));
    if (m) {
      Object.assign(m, data);
      sbUpdateMember(m);
    }
    toast(`บันทึกข้อมูล ${fn} ${ln} แล้ว`, 'success');
    closeMemberModal();
    renderMembers();
    saveToStorage();
  } else {
    // Await Supabase insert to get real id (needed for FK references)
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> บันทึก...'; }
    const tempId    = nextMemberId++;
    const newMember = { id: tempId, lastRead: 0, lastReadDate: '', ...data };
    members.push(newMember);

    const realId = await sbInsertMember(newMember);

    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="ti ti-check"></i>บันทึก'; }

    if (realId) {
      const idx = members.findIndex(m => m.id === tempId);
      if (idx >= 0) members[idx].id = realId;
      nextMemberId = realId + 1;
    }
    toast(`เพิ่มสมาชิก ${fn} ${ln} แล้ว`, 'success');
    closeMemberModal();
    renderMembers();
    saveToStorage();
  }
}

// ─── Member Quick-View Popup ───
let _mqvMemberId = null;

function openMemberQuickView(id) {
  const m = members.find(x => x.id === id); if (!m) return;
  _mqvMemberId = id;
  const st = statusMap[m.status] || statusMap.normal;
  document.getElementById('mqv-name').textContent = m.firstName + ' ' + m.lastName;
  document.getElementById('mqv-header').innerHTML = `
    <div style="display:flex;align-items:center;gap:12px">
      <div class="mavatar" style="background:${getAvatarColor(m.id)};width:44px;height:44px;font-size:15px;flex-shrink:0">${getInitials(m.firstName, m.lastName)}</div>
      <div style="flex:1">
        <div style="font-size:13px;color:var(--gray-500)">${esc(m.houseNo || '—')} ${esc(m.village)}</div>
        <div style="font-size:13px;margin-top:3px">มิเตอร์: <span class="mono">${esc(m.meter)}</span></div>
        <div style="margin-top:5px"><span class="pill ${st.cls}">${st.label}</span></div>
      </div>
    </div>`;
  _renderMemberQVBills(id);
  document.getElementById('member-qv-modal').style.display = 'flex';
}

function _renderMemberQVBills(id) {
  const memberBills = bills.filter(b => b.memberId === id)
    .sort((a, b) => b.period.localeCompare(a.period));
  const body = document.getElementById('mqv-body');
  if (!memberBills.length) {
    body.innerHTML = '<div style="text-align:center;color:var(--gray-500);padding:28px;font-size:13px"><i class="ti ti-receipt-off" style="font-size:32px;margin-bottom:8px;display:block"></i>ยังไม่มีบิล</div>';
    return;
  }
  const totalDebt = memberBills.filter(b => b.status === 'overdue').reduce((s, b) => s + b.total, 0);
  body.innerHTML = (totalDebt > 0 ? `
    <div class="warning-box" style="margin-bottom:14px">
      <i class="ti ti-alert-triangle"></i>
      <div><span class="text-bold text-error">ยอดค้างชำระรวม: ฿${totalDebt.toLocaleString()}</span></div>
    </div>` : '') +
    memberBills.map(b => {
      const st = billStatusMap[b.status] || billStatusMap.pending;
      const payBtn = (b.status === 'overdue' || b.status === 'pending')
        ? `<button class="btn btn-primary btn-xs" onclick="openCashModalForBill('${esc(b.id)}');closeMemberQV()"><i class="ti ti-cash"></i>รับชำระ</button>`
        : '';
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--gray-100)">
        <div>
          <div class="text-bold" style="font-size:13px">${esc(b.period)}</div>
          <div class="text-muted" style="font-size:11px">${esc(b.id)} · ${b.usage} m³</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          <span class="text-bold${b.status === 'overdue' ? ' text-error' : ''}">฿${b.total.toLocaleString()}</span>
          <span class="pill ${st.cls}">${st.label}</span>
          ${payBtn}
          <button class="btn-icon" title="ใบแจ้งหนี้" onclick="openBillReceipt('${esc(b.id)}')"><i class="ti ti-receipt-2"></i></button>
        </div>
      </div>`;
    }).join('');
}

function closeMemberQV() {
  document.getElementById('member-qv-modal').style.display = 'none';
  _mqvMemberId = null;
}

function openEditMemberFromQV() {
  const id = _mqvMemberId;
  closeMemberQV();
  openEditMember(id);
}

function gotoMeterFromQV() {
  const m = members.find(x => x.id === _mqvMemberId); if (!m) return;
  closeMemberQV();
  gotoMeter(m.firstName + ' ' + m.lastName, m.meter, m.id);
}

// ─── GPS Picker ───
let _gpsPickerMap    = null;
let _gpsPickerMarker = null;

function getMemberLocation() {
  const btn = document.getElementById('btn-get-location');
  if (!navigator.geolocation) { toast('เบราว์เซอร์นี้ไม่รองรับ GPS', 'error'); return; }
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> กำลังหา...';
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = parseFloat(pos.coords.latitude.toFixed(6));
      const lng = parseFloat(pos.coords.longitude.toFixed(6));
      document.getElementById('f-gps-lat').value = lat;
      document.getElementById('f-gps-lng').value = lng;
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-current-location"></i>ตำแหน่งปัจจุบัน';
      toast(`พิกัด: ${lat}, ${lng}`, 'success');
      if (_gpsPickerMap) { _gpsPickerMap.setView([lat, lng], 17); _setPickerMarker(lat, lng); }
    },
    err => {
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-current-location"></i>ตำแหน่งปัจจุบัน';
      const msg = err.code === 1 ? 'ไม่ได้รับอนุญาต GPS' : err.code === 2 ? 'ไม่พบสัญญาณ GPS' : 'หมดเวลา GPS';
      toast(msg, 'error');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function _toggleGpsPicker() {
  const wrap = document.getElementById('gps-picker-wrap');
  if (!wrap) return;
  const shown = wrap.style.display !== 'none';
  if (shown) { _closeGpsPicker(); return; }
  wrap.style.display = 'block';
  if (!_gpsPickerMap) {
    const lat = parseFloat(document.getElementById('f-gps-lat').value) || 18.79;
    const lng = parseFloat(document.getElementById('f-gps-lng').value) || 98.985;
    _gpsPickerMap = L.map('gps-picker-map').setView([lat, lng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(_gpsPickerMap);
    if (document.getElementById('f-gps-lat').value) _setPickerMarker(lat, lng);
    _gpsPickerMap.on('click', e => {
      const lt = parseFloat(e.latlng.lat.toFixed(6));
      const ln = parseFloat(e.latlng.lng.toFixed(6));
      document.getElementById('f-gps-lat').value = lt;
      document.getElementById('f-gps-lng').value = ln;
      _setPickerMarker(lt, ln);
    });
  }
  setTimeout(() => { if (_gpsPickerMap) _gpsPickerMap.invalidateSize(); }, 100);
}

function _setPickerMarker(lat, lng) {
  if (!_gpsPickerMap) return;
  if (_gpsPickerMarker) _gpsPickerMarker.setLatLng([lat, lng]);
  else _gpsPickerMarker = L.marker([lat, lng], { draggable: true })
    .addTo(_gpsPickerMap)
    .on('dragend', e => {
      const p = e.target.getLatLng();
      document.getElementById('f-gps-lat').value = parseFloat(p.lat.toFixed(6));
      document.getElementById('f-gps-lng').value = parseFloat(p.lng.toFixed(6));
    });
}

function _closeGpsPicker() {
  const wrap = document.getElementById('gps-picker-wrap');
  if (wrap) wrap.style.display = 'none';
  if (_gpsPickerMap) { _gpsPickerMap.remove(); _gpsPickerMap = null; _gpsPickerMarker = null; }
}

// ─── Delete Member ───
function confirmDeleteMember(id) {
  const m = members.find(x => x.id === id); if (!m) return;
  pendingDeleteId = id;
  document.getElementById('confirm-msg').textContent =
    `ต้องการลบ "${m.firstName} ${m.lastName}" (${m.meter}) ออกจากระบบหรือไม่?`;
  document.getElementById('confirm-modal').style.display = 'flex';
}
function closeConfirm() {
  pendingDeleteId = null;
  document.getElementById('confirm-modal').style.display = 'none';
}
function doDeleteMember() {
  if (pendingDeleteId === null) return;
  const m = members.find(x => x.id === pendingDeleteId);
  sbDeleteMember(pendingDeleteId);
  members = members.filter(x => x.id !== pendingDeleteId);
  closeConfirm();
  renderMembers();
  saveToStorage();
  if (m) toast(`ลบ ${m.firstName} ${m.lastName} แล้ว`, 'warn');
}
