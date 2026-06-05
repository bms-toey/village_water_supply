// ─── Debtors Module ────────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc, toast } from '../../utils/dom.util.js';
import { getInitials } from '../../utils/dom.util.js';
import { saveToStorage } from '../../services/storage.service.js';

let _debtorSeverity = '';

export function setDebtorSeverity(val) { _debtorSeverity = val; }

export function renderDebtors() {
  const { bills, members } = appState;
  const tbody = document.querySelector('#page-debtors .tbl-wrap table tbody');
  if (!tbody) return;
  const overdue = bills.filter(b => b.status === 'overdue');
  if (!overdue.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--gray-500);padding:24px">ไม่มีลูกหนี้</td></tr>';
    _updateDebtorKpis({});
    return;
  }
  const grouped = {};
  overdue.forEach(b => {
    if (!grouped[b.memberId]) grouped[b.memberId] = { total: 0, bills: [], oldest: b.dueDate };
    grouped[b.memberId].total += b.total;
    grouped[b.memberId].bills.push(b);
    if (b.dueDate < grouped[b.memberId].oldest) grouped[b.memberId].oldest = b.dueDate;
  });
  const today = new Date();
  let rows = Object.entries(grouped).sort((a, b) => b[1].total - a[1].total);
  if (_debtorSeverity) {
    rows = rows.filter(([, info]) => {
      const mo = Math.ceil((today - new Date(info.oldest)) / (86400000 * 30));
      if (_debtorSeverity === '1') return mo === 1;
      if (_debtorSeverity === '2') return mo === 2;
      if (_debtorSeverity === '3') return mo >= 3;
      return true;
    });
  }
  tbody.innerHTML = rows.map(([mid, info], idx) => {
    const m        = members.find(x => x.id === parseInt(mid)) || {};
    const daysPast = Math.floor((today - new Date(info.oldest)) / 86400000);
    const months   = Math.ceil(daysPast / 30);
    let severityPill, severityColor;
    if (months >= 3)      { severityPill = 'pill-overdue'; severityColor = '#dc2626'; }
    else if (months >= 2) { severityPill = 'pill-pending'; severityColor = '#d97706'; }
    else                  { severityPill = 'pill-normal';  severityColor = '#16a34a'; }
    const initials = getInitials(m.firstName || '', m.lastName || '');
    return `<tr>
      <td class="text-bold" style="color:${severityColor}">${String(idx+1).padStart(2,'0')}</td>
      <td><div style="display:flex;align-items:center;gap:10px">
        <div class="mavatar" style="width:32px;height:32px;font-size:10px;background:${severityColor}">${initials}</div>
        <span class="text-bold">${esc(m.firstName||'')} ${esc(m.lastName||'')}</span>
      </div></td>
      <td class="text-muted">${esc(m.houseNo||'—')} ${esc(m.village||'')}</td>
      <td class="${months>=3?'text-error':''} text-bold">฿${info.total.toLocaleString()}</td>
      <td><span class="pill ${severityPill}">ค้าง ${months} เดือน</span></td>
      <td><div style="display:flex;gap:5px;justify-content:flex-end">
        <button class="btn-icon" data-notify="${mid}" title="แจ้งเตือน"><i class="ti ti-bell-ringing"></i></button>
        <button class="btn-icon" title="ประวัติ" onclick="gotoMeter('${esc((m.firstName||'')+' '+(m.lastName||''))}','${esc(m.meter||'')}',${mid})"><i class="ti ti-history"></i></button>
        <button class="btn-icon" data-suspend="${mid}" title="ตัดน้ำ" style="color:var(--red-700);border-color:var(--red-100)"><i class="ti ti-droplet-off"></i></button>
      </div></td>
    </tr>`;
  }).join('');
  _updateDebtorKpis(grouped);
  document.querySelectorAll('#page-debtors [data-notify]').forEach(btn => {
    btn.addEventListener('click', () => notifyDebtor(parseInt(btn.dataset.notify)));
  });
  document.querySelectorAll('#page-debtors [data-suspend]').forEach(btn => {
    btn.addEventListener('click', () => suspendMember(parseInt(btn.dataset.suspend)));
  });
  const footer = document.querySelector('#page-debtors .tbl-footer span');
  if (footer) footer.textContent = `แสดง 1–${rows.length} จาก ${rows.length} รายการ`;
}

function _updateDebtorKpis(grouped) {
  const today = new Date();
  const all   = Object.values(grouped);
  const m1    = all.filter(g => Math.ceil((today - new Date(g.oldest)) / (86400000 * 30)) <= 1).length;
  const m2    = all.filter(g => { const mo = Math.ceil((today - new Date(g.oldest)) / (86400000 * 30)); return mo === 2; }).length;
  const m3    = all.filter(g => Math.ceil((today - new Date(g.oldest)) / (86400000 * 30)) >= 3).length;
  const total = all.reduce((s, g) => s + g.total, 0);
  const kpis = document.querySelectorAll('#page-debtors .kpi-val');
  if (kpis[0]) kpis[0].textContent = m1 + ' ราย';
  if (kpis[1]) kpis[1].textContent = m2 + ' ราย';
  if (kpis[2]) kpis[2].textContent = m3 + ' ราย';
  if (kpis[3]) kpis[3].textContent = '฿' + total.toLocaleString();
}

export function suspendMember(mid) {
  const m = appState.members.find(x => x.id === mid); if (!m) return;
  m.status = 'suspended';
  saveToStorage();
  // renderMembers and renderDebtors called via window
  window.renderMembers?.();
  renderDebtors();
  toast(`ระงับการใช้น้ำ: ${m.firstName} ${m.lastName}`, 'warn');
}

export function notifyDebtor(mid) {
  const m = appState.members.find(x => x.id === mid); if (!m) return;
  toast(`ส่งแจ้งเตือน LINE/SMS ถึง: ${m.firstName} ${m.lastName} (${m.phone || 'ไม่มีเบอร์'})`, 'info');
}

export function notifyAllDebtors() {
  const mids = [...new Set(appState.bills.filter(b => b.status === 'overdue').map(b => b.memberId))];
  if (!mids.length) { toast('ไม่มีลูกหนี้ค้างชำระ', 'info'); return; }
  mids.forEach(mid => notifyDebtor(mid));
  toast(`ส่งแจ้งเตือนถึง ${mids.length} ราย`, 'success');
}

export function suspendAllOverdue3Months() {
  const today = new Date();
  const grouped = {};
  appState.bills.filter(b => b.status === 'overdue').forEach(b => {
    if (!grouped[b.memberId] || b.dueDate < grouped[b.memberId]) grouped[b.memberId] = b.dueDate;
  });
  const toSuspend = Object.entries(grouped)
    .filter(([, oldestDue]) => Math.ceil((today - new Date(oldestDue)) / (86400000 * 30)) >= 3)
    .map(([mid]) => parseInt(mid));
  if (!toSuspend.length) { toast('ไม่มีสมาชิกที่ค้างเกิน 3 เดือน', 'info'); return; }
  toSuspend.forEach(mid => {
    const m = appState.members.find(x => x.id === mid);
    if (m && m.status !== 'suspended') m.status = 'suspended';
  });
  saveToStorage();
  window.renderMembers?.();
  renderDebtors();
  toast(`ระงับการใช้น้ำ ${toSuspend.length} ราย (ค้างเกิน 3 เดือน)`, 'warn');
}
