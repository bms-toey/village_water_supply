// ─── Maintenance Module ────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc, toast } from '../../utils/dom.util.js';
import { sbUpsertMaintenance, sbInsertMeterReplacement } from '../../services/data-loader.service.js';
import { getMaintenanceTypeDisplay } from '../../config/ui.config.js';
import { buildSelectOptions } from '../settings/settings.js';
import { currentUser } from '../../services/auth.service.js';

let _mntTab = 'jobs'; // 'jobs' | 'replacements'
const maintenanceStatusMap = {
  pending:     { label: 'รอดำเนินการ',     cls: 'pill-pending' },
  in_progress: { label: 'กำลังดำเนินการ',  cls: 'pill-overdue' },
  completed:   { label: 'เสร็จแล้ว',       cls: 'pill-paid'    },
  cancelled:   { label: 'ยกเลิก',          cls: 'pill-closed'  },
};

export function setMntTab(tab) {
  _mntTab = tab;
  document.querySelectorAll('#page-maintenance .tab').forEach((t, i) => {
    t.classList.toggle('active', (i === 0 && tab === 'jobs') || (i === 1 && tab === 'replacements'));
  });
  document.getElementById('mnt-jobs-section').style.display        = tab === 'jobs'         ? '' : 'none';
  document.getElementById('mnt-replacements-section').style.display = tab === 'replacements' ? '' : 'none';
  document.getElementById('mnt-add-job-btn').style.display          = tab === 'jobs'         ? '' : 'none';
  document.getElementById('mnt-add-replace-btn').style.display      = tab === 'replacements' ? '' : 'none';
  if (tab === 'replacements') _renderReplacements();
}

export function renderMaintenance() {
  const { maintenance, members } = appState;
  const el = document.getElementById('mnt-jobs-card-list');
  if (!el) return;
  const totalCost = maintenance.reduce((s, x) => s + (x.cost || 0), 0);
  const pending   = maintenance.filter(x => x.status === 'pending').length;
  const inProg    = maintenance.filter(x => x.status === 'in_progress').length;
  const kpis = document.querySelectorAll('#page-maintenance .kpi-val');
  if (kpis[0]) kpis[0].textContent = maintenance.length + ' รายการ';
  if (kpis[1]) kpis[1].textContent = pending + ' รายการ';
  if (kpis[2]) kpis[2].textContent = inProg  + ' รายการ';
  if (kpis[3]) kpis[3].textContent = '฿' + totalCost.toLocaleString();
  const badge = document.getElementById('mnt-badge');
  if (badge) badge.textContent = (pending + inProg) || '';
  if (!maintenance.length) {
    el.innerHTML = `<div style="text-align:center;padding:48px 24px;color:var(--gray-400);font-size:14px"><i class="ti ti-tool" style="font-size:36px;margin-bottom:8px;display:block"></i>ไม่มีรายการซ่อมบำรุง</div>`;
    const footer = document.getElementById('mnt-jobs-footer')?.querySelector('span');
    if (footer) footer.textContent = 'ไม่มีรายการ';
    return;
  }
  const sorted = [...maintenance].sort((a, b) => {
    const order = { in_progress: 0, pending: 1, completed: 2, cancelled: 3 };
    return (order[a.status]??9) - (order[b.status]??9) || b.reportedDate.localeCompare(a.reportedDate);
  });
  el.innerHTML = sorted.map(item => {
    const type     = getMaintenanceTypeDisplay(item.type);
    const status   = maintenanceStatusMap[item.status] || maintenanceStatusMap.pending;
    const reporter = item.reportedMemberId ? (members.find(m => m.id === item.reportedMemberId) || {}) : null;
    const isDone   = item.status === 'completed' || item.status === 'cancelled';
    const doneBtn  = !isDone
      ? `<button class="btn btn-primary btn-xs" onclick="completeMaintenance('${esc(item.id)}')"><i class="ti ti-check"></i>เสร็จแล้ว</button>`
      : '';
    return `<div class="h-card" style="opacity:${isDone?.65:1}">
      <div class="mnch-type">
        <span class="pill ${type.cls}" style="padding:2px 7px;white-space:nowrap"><i class="ti ${type.icon}" style="font-size:11px;margin-right:3px"></i>${type.label}</span>
        <div class="mono text-muted" style="font-size:10px;margin-top:3px">${esc(item.id)}</div>
      </div>
      <div class="mnch-info">
        <div class="text-bold" style="font-size:13px">${esc(item.description)}</div>
        <div class="text-muted" style="font-size:11px">${esc(item.location||'—')}${item.reportedDate?' · '+item.reportedDate:''}${reporter?' · โดย '+esc((reporter.firstName||'')+' '+(reporter.lastName||''))  :''}</div>
      </div>
      <div class="mnch-assigned">${esc(item.assignedTo||'ยังไม่มอบหมาย')}</div>
      <div class="mnch-status"><span class="pill ${status.cls}" style="font-size:11px">${status.label}</span></div>
      <div class="mnch-cost">${item.cost?'฿'+item.cost.toLocaleString():'—'}</div>
      <div class="mnch-actions">
        ${doneBtn}
        <button class="btn-icon" title="แก้ไข" onclick="openEditMaintenance('${esc(item.id)}')"><i class="ti ti-edit"></i></button>
      </div>
    </div>`;
  }).join('');
  const footer = document.getElementById('mnt-jobs-footer')?.querySelector('span');
  if (footer) footer.textContent = `แสดง 1–${sorted.length} จาก ${maintenance.length} รายการ`;
}

export function completeMaintenance(id) {
  const item = appState.maintenance.find(x => x.id === id); if (!item) return;
  item.status        = 'completed';
  item.completedDate = new Date().toISOString().split('T')[0];
  sbUpsertMaintenance(item);
  _saveMaintenanceToStorage();
  renderMaintenance();
  toast('บันทึกเสร็จงานแล้ว: ' + item.description, 'success');
}

export function openAddMaintenance() {
  document.getElementById('mnt-modal-id').value          = '';
  document.getElementById('mnt-desc').value              = '';
  document.getElementById('mnt-location').value          = '';
  document.getElementById('mnt-assigned').value          = '';
  const mntTypeSel = document.getElementById('mnt-type');
  if (mntTypeSel) mntTypeSel.innerHTML = buildSelectOptions('maintenance_type', 'pipe_repair');
  document.getElementById('mnt-type').value              = 'pipe_repair';
  document.getElementById('mnt-cost').value              = '';
  document.getElementById('mnt-status').value            = 'pending';
  document.getElementById('mnt-modal-title').textContent = 'เพิ่มงานซ่อมบำรุง';
  document.getElementById('mnt-modal').style.display     = 'flex';
}

export function openEditMaintenance(id) {
  const item = appState.maintenance.find(x => x.id === id); if (!item) return;
  document.getElementById('mnt-modal-id').value          = item.id;
  document.getElementById('mnt-desc').value              = item.description;
  document.getElementById('mnt-location').value          = item.location   || '';
  document.getElementById('mnt-assigned').value          = item.assignedTo || '';
  document.getElementById('mnt-type').value              = item.type;
  document.getElementById('mnt-cost').value              = item.cost || '';
  document.getElementById('mnt-status').value            = item.status;
  document.getElementById('mnt-modal-title').textContent = 'แก้ไขงานซ่อมบำรุง';
  document.getElementById('mnt-modal').style.display     = 'flex';
}

export function closeMntModal() { document.getElementById('mnt-modal').style.display = 'none'; }

export function saveMaintenance() {
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
    const item = appState.maintenance.find(x => x.id === id);
    if (item) { Object.assign(item, data); sbUpsertMaintenance(item); }
    toast('แก้ไขรายการแล้ว', 'success');
  } else {
    const newItem = { id: 'MNT-'+Date.now(), reportedBy: 'staff', reportedMemberId: null, reportedDate: new Date().toISOString().split('T')[0], startDate: null, completedDate: null, materials: '', approvedBy: null, ...data };
    appState.maintenance.push(newItem);
    sbUpsertMaintenance(newItem);
    toast('เพิ่มงานซ่อมบำรุงแล้ว', 'success');
  }
  closeMntModal();
  _saveMaintenanceToStorage();
  renderMaintenance();
}

function _saveMaintenanceToStorage() {
  try { localStorage.setItem('aq_maintenance', JSON.stringify(appState.maintenance)); } catch (_) {}
}

// ─── Meter Replacement Log ────────────────────────────────────
function _renderReplacements() {
  const el = document.getElementById('mnt-replace-card-list');
  if (!el) return;
  const { meterReplacements, members } = appState;
  const sorted = [...meterReplacements].sort((a, b) => b.replacedAt.localeCompare(a.replacedAt));
  if (!sorted.length) {
    el.innerHTML = `<div style="text-align:center;padding:48px 24px;color:var(--gray-400);font-size:14px"><i class="ti ti-replace" style="font-size:36px;margin-bottom:8px;display:block"></i>ยังไม่มีประวัติการเปลี่ยนมิเตอร์</div>`;
    const foot = document.getElementById('mnt-replace-footer')?.querySelector('span');
    if (foot) foot.textContent = 'ไม่มีรายการ';
    const kpi = document.getElementById('mnt-replace-count');
    if (kpi) kpi.textContent = '0 ครั้ง';
    return;
  }
  const reasonLabel = { broken: 'ชำรุด', expired: 'ครบอายุการใช้งาน', stolen: 'ถูกขโมย', other: 'อื่น ๆ' };
  el.innerHTML = sorted.map(r => {
    const m = members.find(x => x.id === r.memberId) || {};
    return `<div class="h-card">
      <div class="mrch-date">${esc(r.replacedAt)}</div>
      <div class="mrch-info">
        <div class="text-bold" style="font-size:13px">${esc(m.firstName||'')} ${esc(m.lastName||'')}</div>
        <div class="text-muted" style="font-size:11px">${esc(m.houseNo||'')} ${esc(m.village||'')}</div>
      </div>
      <div class="mrch-meters">
        <div class="mono" style="font-size:12px">${esc(r.oldMeterNo)} <i class="ti ti-arrow-right" style="font-size:10px"></i> ${esc(r.newMeterNo)}</div>
        <div class="text-muted" style="font-size:10.5px">${r.oldReading.toLocaleString()} → ${r.newReading.toLocaleString()} m³</div>
      </div>
      <div class="mrch-reason">${esc(reasonLabel[r.reason] || r.reason || '—')}</div>
      <div class="mrch-by">${esc(r.replacedBy || '—')}</div>
      <div class="mrch-note">${esc(r.note || '—')}</div>
    </div>`;
  }).join('');
  const foot = document.getElementById('mnt-replace-footer')?.querySelector('span');
  if (foot) foot.textContent = `แสดง 1–${sorted.length} จาก ${sorted.length} รายการ`;
  const kpi = document.getElementById('mnt-replace-count');
  if (kpi) kpi.textContent = meterReplacements.length + ' ครั้ง';
}

export function openMeterReplaceModal() {
  const { members } = appState;
  const sel = document.getElementById('mr-member');
  if (sel) {
    sel.innerHTML = '<option value="">-- เลือกสมาชิก --</option>' +
      [...members].sort((a, b) => a.id - b.id).map(m =>
        `<option value="${m.id}">${esc(m.firstName)} ${esc(m.lastName)} (${esc(m.meter)})</option>`
      ).join('');
  }
  document.getElementById('mr-old-meter').value  = '';
  document.getElementById('mr-new-meter').value  = '';
  document.getElementById('mr-old-read').value   = '';
  document.getElementById('mr-new-read').value   = '0';
  document.getElementById('mr-reason').value     = 'broken';
  document.getElementById('mr-note').value       = '';
  document.getElementById('mr-date').value       = new Date().toISOString().split('T')[0];
  document.getElementById('mr-modal').style.display = 'flex';
}

// Auto-fill old meter no and last reading when member is selected
export function onMrMemberChange() {
  const id  = parseInt(document.getElementById('mr-member').value);
  const m   = appState.members.find(x => x.id === id);
  if (!m) return;
  document.getElementById('mr-old-meter').value = m.meter || '';
  document.getElementById('mr-old-read').value  = m.lastRead || 0;
}

export function closeMeterReplaceModal() {
  document.getElementById('mr-modal').style.display = 'none';
}

export function genNewMeterNo() {
  const inp     = document.getElementById('mr-new-meter');
  if (!inp) return;
  const members = appState.members;
  const pool    = members.map(m => m.meter).filter(Boolean);

  if (pool.length > 0) {
    const sorted = [...pool].sort((a, b) => {
      const na = parseInt(a.match(/\d+$/)?.[0] || '0');
      const nb = parseInt(b.match(/\d+$/)?.[0] || '0');
      return nb - na;
    });
    for (const last of sorted) {
      const m = last.match(/^(.*?)(\d+)$/);
      if (!m) continue;
      const prefix = m[1];
      const digits = m[2].length;
      let nextNum  = parseInt(m[2]) + 1;
      while (true) {
        const candidate = prefix + String(nextNum).padStart(digits, '0');
        if (!members.some(x => x.meter === candidate)) {
          inp.value = candidate;
          toast(`สร้างเลขมิเตอร์: ${candidate}`, 'info');
          return;
        }
        nextNum++;
      }
    }
  }

  let seq = members.length + 1;
  while (true) {
    const candidate = 'WM-' + String(seq).padStart(4, '0');
    if (!members.some(x => x.meter === candidate)) {
      inp.value = candidate;
      toast(`สร้างเลขมิเตอร์: ${candidate}`, 'info');
      return;
    }
    seq++;
  }
}

export async function saveMeterReplacement() {
  const memberId   = parseInt(document.getElementById('mr-member').value);
  const oldMeterNo = document.getElementById('mr-old-meter').value.trim();
  const newMeterNo = document.getElementById('mr-new-meter').value.trim();
  const oldReading = parseFloat(document.getElementById('mr-old-read').value) || 0;
  const newReading = parseFloat(document.getElementById('mr-new-read').value) || 0;
  const reason     = document.getElementById('mr-reason').value;
  const note       = document.getElementById('mr-note').value.trim();
  const replacedAt = document.getElementById('mr-date').value;

  if (!memberId)   { toast('กรุณาเลือกสมาชิก', 'error'); return; }
  if (!newMeterNo) { toast('กรุณากรอกเลขมิเตอร์ใหม่', 'error'); return; }
  if (!replacedAt) { toast('กรุณาระบุวันที่เปลี่ยน', 'error'); return; }

  const rec = {
    memberId, oldMeterNo, newMeterNo,
    oldReading, newReading, reason, note, replacedAt,
    replacedBy: currentUser?.fullName || currentUser?.username || '',
  };

  const btn = document.getElementById('mr-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }

  const newId = await sbInsertMeterReplacement(rec);

  if (btn) { btn.disabled = false; btn.textContent = 'บันทึก'; }

  if (!newId) return; // error shown by sbErr

  rec.id = newId;
  appState.meterReplacements.unshift(rec);

  // Update member's meter number in state + Supabase
  const member = appState.members.find(x => x.id === memberId);
  if (member) {
    member.meter    = newMeterNo;
    member.lastRead = newReading;
    const { sbUpdateMember } = await import('../../services/data-loader.service.js'); // lazy to avoid circular
    sbUpdateMember(member);
  }

  closeMeterReplaceModal();
  _renderReplacements();
  window.renderMembers?.();
  toast(`บันทึกการเปลี่ยนมิเตอร์ ${oldMeterNo} → ${newMeterNo} แล้ว`, 'success');
}
