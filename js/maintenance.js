const maintenanceTypeMap = {
  pipe_repair:   { label: 'ซ่อมท่อ',           icon: 'ti-tool',                 cls: 'pill-overdue' },
  meter_replace: { label: 'เปลี่ยนมิเตอร์',     icon: 'ti-gauge',                cls: 'pill-pending' },
  tank_clean:    { label: 'ล้างถังพัก',          icon: 'ti-droplet',              cls: 'pill-pending' },
  pump_service:  { label: 'บำรุงปั๊มน้ำ',        icon: 'ti-engine',               cls: 'pill-pending' },
  leak_fix:      { label: 'แก้ไขรั่วซึม',        icon: 'ti-droplet-exclamation',  cls: 'pill-overdue' },
  other:         { label: 'อื่น ๆ',              icon: 'ti-settings',             cls: 'pill-normal'  },
};
const maintenanceStatusMap = {
  pending:     { label: 'รอดำเนินการ',     cls: 'pill-pending' },
  in_progress: { label: 'กำลังดำเนินการ',  cls: 'pill-overdue' },
  completed:   { label: 'เสร็จแล้ว',       cls: 'pill-paid'    },
  cancelled:   { label: 'ยกเลิก',          cls: 'pill-closed'  },
};

// ─── Render Maintenance Page ───
function renderMaintenance() {
  const tbody = document.querySelector('#page-maintenance .tbl-wrap table tbody');
  if (!tbody) return;

  const totalCost    = maintenance.reduce((s, x) => s + (x.cost || 0), 0);
  const pending      = maintenance.filter(x => x.status === 'pending').length;
  const inProg       = maintenance.filter(x => x.status === 'in_progress').length;
  const completed    = maintenance.filter(x => x.status === 'completed').length;
  const kpis = document.querySelectorAll('#page-maintenance .kpi-val');
  if (kpis[0]) kpis[0].textContent = maintenance.length + ' รายการ';
  if (kpis[1]) kpis[1].textContent = pending + ' รายการ';
  if (kpis[2]) kpis[2].textContent = inProg  + ' รายการ';
  if (kpis[3]) kpis[3].textContent = '฿' + totalCost.toLocaleString();

  // Update sidebar badge
  const badge = document.getElementById('mnt-badge');
  if (badge) badge.textContent = (pending + inProg) || '';

  if (!maintenance.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--gray-500);padding:24px">ไม่มีรายการซ่อมบำรุง</td></tr>';
    return;
  }
  const sorted = [...maintenance].sort((a, b) => {
    const order = { in_progress: 0, pending: 1, completed: 2, cancelled: 3 };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.reportedDate.localeCompare(a.reportedDate);
  });
  tbody.innerHTML = sorted.map(item => {
    const type   = maintenanceTypeMap[item.type]     || maintenanceTypeMap.other;
    const status = maintenanceStatusMap[item.status] || maintenanceStatusMap.pending;
    const reporter = item.reportedMemberId ? (members.find(m => m.id === item.reportedMemberId) || {}) : null;
    const actionBtns = item.status !== 'completed' && item.status !== 'cancelled'
      ? `<button class="btn btn-primary btn-xs" onclick="completeMaintenance('${esc(item.id)}')"><i class="ti ti-check"></i>เสร็จแล้ว</button>`
      : '';
    return `<tr>
      <td class="mono text-muted" style="font-size:10.5px">${esc(item.id)}</td>
      <td><span class="pill ${type.cls}" style="font-size:10.5px;padding:2px 8px"><i class="ti ${type.icon}" style="font-size:11px;margin-right:3px"></i>${type.label}</span></td>
      <td>
        <div class="text-bold" style="font-size:13px">${esc(item.description)}</div>
        <div class="text-muted" style="font-size:11px">${esc(item.location || '—')}${reporter ? ' · รายงานโดย ' + esc((reporter.firstName || '') + ' ' + (reporter.lastName || '')) : ''}</div>
      </td>
      <td class="text-muted" style="font-size:12px">${esc(item.assignedTo || 'ยังไม่มอบหมาย')}</td>
      <td><span class="pill ${status.cls}">${status.label}</span></td>
      <td class="text-bold" style="font-size:13px">${item.cost ? '฿' + item.cost.toLocaleString() : '—'}</td>
      <td>
        <div style="display:flex;gap:5px;justify-content:flex-end">
          ${actionBtns}
          <button class="btn-icon" title="แก้ไข" onclick="openEditMaintenance('${esc(item.id)}')"><i class="ti ti-edit"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');
  const footer = document.querySelector('#page-maintenance .tbl-footer span');
  if (footer) footer.textContent = `แสดง 1–${sorted.length} จาก ${maintenance.length} รายการ`;
}

// ─── Complete a maintenance item ───
function completeMaintenance(id) {
  const item = maintenance.find(x => x.id === id); if (!item) return;
  item.status        = 'completed';
  item.completedDate = new Date().toISOString().split('T')[0];
  sbUpsertMaintenance(item);
  saveMaintenanceToStorage();
  renderMaintenance();
  toast('บันทึกเสร็จงานแล้ว: ' + item.description, 'success');
}

// ─── Open Add/Edit modal ───
function openAddMaintenance() {
  document.getElementById('mnt-modal-id').value      = '';
  document.getElementById('mnt-desc').value          = '';
  document.getElementById('mnt-location').value      = '';
  document.getElementById('mnt-assigned').value      = '';
  document.getElementById('mnt-type').value          = 'pipe_repair';
  document.getElementById('mnt-cost').value          = '';
  document.getElementById('mnt-status').value        = 'pending';
  document.getElementById('mnt-modal-title').textContent = 'เพิ่มงานซ่อมบำรุง';
  document.getElementById('mnt-modal').style.display = 'flex';
}
function openEditMaintenance(id) {
  const item = maintenance.find(x => x.id === id); if (!item) return;
  document.getElementById('mnt-modal-id').value      = item.id;
  document.getElementById('mnt-desc').value          = item.description;
  document.getElementById('mnt-location').value      = item.location  || '';
  document.getElementById('mnt-assigned').value      = item.assignedTo || '';
  document.getElementById('mnt-type').value          = item.type;
  document.getElementById('mnt-cost').value          = item.cost || '';
  document.getElementById('mnt-status').value        = item.status;
  document.getElementById('mnt-modal-title').textContent = 'แก้ไขงานซ่อมบำรุง';
  document.getElementById('mnt-modal').style.display = 'flex';
}
function closeMntModal() { document.getElementById('mnt-modal').style.display = 'none'; }

// ─── Save maintenance (add or edit) ───
function saveMaintenance() {
  const id   = document.getElementById('mnt-modal-id').value;
  const desc = document.getElementById('mnt-desc').value.trim();
  if (!desc) { toast('กรุณากรอกรายละเอียดงาน', 'error'); return; }
  const data = {
    description: desc,
    location:    document.getElementById('mnt-location').value.trim(),
    assignedTo:  document.getElementById('mnt-assigned').value.trim(),
    type:        document.getElementById('mnt-type').value,
    cost:        parseFloat(document.getElementById('mnt-cost').value) || 0,
    status:      document.getElementById('mnt-status').value,
  };
  if (id) {
    const item = maintenance.find(x => x.id === id);
    if (item) {
      Object.assign(item, data);
      sbUpsertMaintenance(item);
    }
    toast('แก้ไขรายการแล้ว', 'success');
  } else {
    const newItem = {
      id: 'MNT-' + Date.now(),
      reportedBy: 'staff', reportedMemberId: null,
      reportedDate: new Date().toISOString().split('T')[0],
      startDate: null, completedDate: null, materials: '',
      approvedBy: null,
      ...data,
    };
    maintenance.push(newItem);
    sbUpsertMaintenance(newItem);
    toast('เพิ่มงานซ่อมบำรุงแล้ว', 'success');
  }
  closeMntModal();
  saveMaintenanceToStorage();
  renderMaintenance();
}

// ─── Storage ───
function saveMaintenanceToStorage() {
  try { localStorage.setItem('aq_maintenance', JSON.stringify(maintenance)); } catch (e) {}
}
function loadMaintenanceFromStorage() {
  try { const d = localStorage.getItem('aq_maintenance'); if (d) maintenance = JSON.parse(d); } catch (e) {}
}
