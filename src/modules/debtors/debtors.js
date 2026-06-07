// ─── Debtors Module ────────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc, toast } from '../../utils/dom.util.js';
import { getInitials } from '../../utils/dom.util.js';
import { saveToStorage } from '../../services/storage.service.js';

let _debtorSeverity = '';

export function setDebtorSeverity(val) { _debtorSeverity = val; }

export function renderDebtors() {
  const { bills, members } = appState;
  const el = document.getElementById('debtors-card-list');
  if (!el) return;
  const overdue = bills.filter(b => b.status === 'overdue');
  if (!overdue.length) {
    el.innerHTML = `<div style="text-align:center;padding:48px 24px;color:var(--gray-400);font-size:14px"><i class="ti ti-circle-check" style="font-size:36px;margin-bottom:8px;display:block;color:var(--green-500)"></i>ไม่มีลูกหนี้ค้างชำระ</div>`;
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
  el.innerHTML = rows.map(([mid, info], idx) => {
    const m        = members.find(x => x.id === parseInt(mid)) || {};
    const daysPast = Math.floor((today - new Date(info.oldest)) / 86400000);
    const months   = Math.ceil(daysPast / 30);
    let severityPill, severityColor;
    if (months >= 3)      { severityPill = 'pill-overdue'; severityColor = '#dc2626'; }
    else if (months >= 2) { severityPill = 'pill-pending'; severityColor = '#d97706'; }
    else                  { severityPill = 'pill-normal';  severityColor = '#16a34a'; }
    const initials = getInitials(m.firstName || '', m.lastName || '');
    return `<div class="h-card">
      <div class="dch-rank" style="color:${severityColor}">${String(idx+1).padStart(2,'0')}</div>
      <div class="mavatar" style="width:36px;height:36px;font-size:11px;background:${severityColor}">${initials}</div>
      <div class="dch-info">
        <div class="text-bold" style="font-size:13px">${esc(m.firstName||'')} ${esc(m.lastName||'')}</div>
        <div class="text-muted" style="font-size:11.5px">${esc(m.houseNo||'—')} ${esc(m.village||'')}</div>
      </div>
      <div class="dch-debt">
        <div class="${months>=3?'text-error':''} text-bold" style="font-size:16px">฿${info.total.toLocaleString()}</div>
        <div class="text-muted" style="font-size:10.5px">${info.bills.length} บิล</div>
      </div>
      <div class="dch-severity"><span class="pill ${severityPill}" style="font-size:11px">ค้าง ${months} เดือน</span></div>
      <div class="dch-actions">
        <button class="btn-icon" data-notify="${mid}" title="แจ้งเตือน"><i class="ti ti-bell-ringing"></i></button>
        <button class="btn-icon" title="ประวัติ" onclick="gotoMeter('${esc((m.firstName||'')+' '+(m.lastName||''))}','${esc(m.meter||'')}',${mid})"><i class="ti ti-history"></i></button>
        <button class="btn-icon" data-suspend="${mid}" title="ตัดน้ำ" style="color:var(--red-700);border-color:var(--red-100)"><i class="ti ti-droplet-off"></i></button>
      </div>
    </div>`;
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
