// ─── Documents (UI) ───────────────────────────────────────────
// พิมพ์ใบแจ้งค่าน้ำ / ใบเสร็จ (ต้นฉบับ-สำเนา-ยกเลิก) / พิมพ์ทีละหลายใบ /
// หนังสือแจ้งเตือน-งดจ่ายน้ำ / ใบนำส่งเงินประจำวัน
// ──────────────────────────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc, toast } from '../../utils/dom.util.js';
import { todayISO } from '../../utils/time.util.js';
import { sbMarkReceiptPrinted, sbLogAudit } from '../../services/data-loader.service.js';
import { openModal, closeModal } from '../../components/modal/modal.js';
import { invoiceHtml, receiptHtml, noticeHtml, remittanceHtml, orgInfo } from './templates.js';
import { beginPrint, getPaper, setPaper, PAPERS } from './print.js';

const UNPAID = ['pending', 'overdue'];

function _billContext(bill) {
  const { members, meterReadings, billAdjustments, bills } = appState;
  return {
    bill,
    member:      members.find(m => m.id === bill.memberId) || {},
    reading:     meterReadings.find(r => r.billId === bill.id) || null,
    adjustments: (billAdjustments || []).filter(a => a.billId === bill.id),
    otherUnpaid: bills.filter(b => b.memberId === bill.memberId && b.id !== bill.id && UNPAID.includes(b.status)),
    org:         orgInfo(appState.systemConfig),
  };
}

export const paperOptions = (selected = getPaper()) =>
  Object.entries(PAPERS).map(([k, v]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');

export function onPaperChange(value) {
  setPaper(value);
}

// ─── บิลเดียว: ใบแจ้ง (ยังไม่ชำระ) หรือใบเสร็จ (ชำระแล้ว) ──────
export async function printBillDocument(billId) {
  const bill = appState.bills.find(b => b.id === billId);
  if (!bill) return;
  const pay = appState.payments.find(p => p.billId === billId && p.status === 'approved');
  if (bill.status === 'paid' && pay) return printPaymentReceipt(pay.id);
  const job = beginPrint(`ใบแจ้งค่าน้ำ ${bill.id}`);
  await job.print([invoiceHtml(_billContext(bill))], getPaper());
}

// ─── ใบเสร็จ — ครั้งแรก "ต้นฉบับ" ครั้งต่อไป "สำเนา" ───────────
export async function printPaymentReceipt(paymentId) {
  const pay  = appState.payments.find(p => p.id === paymentId);
  const bill = pay && appState.bills.find(b => b.id === pay.billId);
  if (!pay || !bill) { toast('ไม่พบข้อมูลใบเสร็จ', 'error'); return; }
  const job = beginPrint(`ใบเสร็จ ${pay.receiptNo || pay.id}`);   // ต้องเรียกก่อน await (iOS)
  let printNo = pay.printCount + 1;
  if (pay.status === 'approved') {
    const n = await sbMarkReceiptPrinted(pay.id);
    if (n === null) { job.cancel(); return; }
    printNo = n;
    pay.printCount = n;
  }
  await job.print([receiptHtml({ ..._billContext(bill), payment: pay, printNo })], getPaper());
}

// ─── พิมพ์ใบแจ้งทีละหลายใบ ──────────────────────────────────
export function openBatchPrint() {
  const periods  = [...new Set(appState.bills.map(b => b.period))].filter(Boolean);
  const villages = [...new Set(appState.members.map(m => m.village))].filter(Boolean).sort();
  openModal({
    id: 'batch-print-modal', title: 'พิมพ์ใบแจ้งค่าน้ำทีละหลายใบ', icon: 'ti-printer', width: 460,
    body: `
      <div class="form-group" style="margin-bottom:12px">
        <label class="form-label" for="bp-period">รอบบิล</label>
        <select class="form-input" id="bp-period">${periods.map(p => `<option>${esc(p)}</option>`).join('')}</select>
      </div>
      <div class="form-group" style="margin-bottom:12px">
        <label class="form-label" for="bp-village">หมู่บ้าน</label>
        <select class="form-input" id="bp-village"><option value="">ทุกหมู่บ้าน</option>${villages.map(v => `<option>${esc(v)}</option>`).join('')}</select>
      </div>
      <div class="form-group" style="margin-bottom:12px">
        <label class="form-label" for="bp-status">บิล</label>
        <select class="form-input" id="bp-status">
          <option value="unpaid">เฉพาะที่ยังไม่ชำระ</option>
          <option value="all">ทั้งหมด (ยกเว้นที่ยกเลิก)</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom:12px">
        <label class="form-label" for="bp-paper">กระดาษ</label>
        <select class="form-input" id="bp-paper">${paperOptions()}</select>
      </div>
      <div id="bp-count" style="font-size:13px;color:var(--gray-600)"></div>`,
    footer: `
      <button class="btn btn-secondary" data-close>ยกเลิก</button>
      <button class="btn btn-primary" id="bp-ok"><i class="ti ti-printer"></i>พิมพ์</button>`,
  });
  const el = document.getElementById('batch-print-modal');
  const pick = () => {
    const period  = el.querySelector('#bp-period').value;
    const village = el.querySelector('#bp-village').value;
    const status  = el.querySelector('#bp-status').value;
    return appState.bills
      .filter(b => b.period === period && b.status !== 'cancelled' && (status === 'all' || UNPAID.includes(b.status)))
      .filter(b => !village || appState.members.find(m => m.id === b.memberId)?.village === village)
      .sort((a, b) => {
        const ma = appState.members.find(m => m.id === a.memberId) || {};
        const mb = appState.members.find(m => m.id === b.memberId) || {};
        return (ma.village || '').localeCompare(mb.village || '', 'th')
          || String(ma.houseNo || '').localeCompare(String(mb.houseNo || ''), 'th', { numeric: true });
      });
  };
  const refresh = () => { el.querySelector('#bp-count').textContent = `จะพิมพ์ ${pick().length} ใบ (เรียงตามหมู่บ้านและบ้านเลขที่)`; };
  el.querySelectorAll('select').forEach(s => s.addEventListener('change', refresh));
  refresh();
  el.querySelector('#bp-ok').onclick = async () => {
    const list  = pick();
    const paper = el.querySelector('#bp-paper').value;
    if (!list.length) { toast('ไม่มีบิลตามเงื่อนไข', 'warn'); return; }
    setPaper(paper);
    const job = beginPrint(`ใบแจ้งค่าน้ำ ${list[0].period}`);
    closeModal('batch-print-modal');
    await job.print(list.map(b => invoiceHtml(_billContext(b))), paper);
  };
}

// ─── หนังสือแจ้งเตือน / งดจ่ายน้ำ ───────────────────────────
const NOTICE_KINDS = {
  reminder1:  { label: 'แจ้งเตือนครั้งที่ 1',  minMonths: 1, days: 7 },
  reminder2:  { label: 'แจ้งเตือนครั้งที่ 2',  minMonths: 2, days: 7 },
  disconnect: { label: 'แจ้งงดจ่ายน้ำ',       minMonths: 3, days: 3 },
};

function _monthsOverdue(dueDate) {
  return Math.max(1, Math.ceil((Date.now() - new Date(dueDate).getTime()) / (86400000 * 30)));
}

/** ลูกหนี้ที่เข้าเงื่อนไข: [{ member, bills }] */
function _debtors(minMonths, village, memberIds) {
  const byMember = new Map();
  appState.bills.filter(b => b.status === 'overdue').forEach(b => {
    if (!byMember.has(b.memberId)) byMember.set(b.memberId, []);
    byMember.get(b.memberId).push(b);
  });
  return [...byMember.entries()]
    .map(([mid, bills]) => ({ member: appState.members.find(m => m.id === mid), bills: bills.sort((a, b) => a.dueDate.localeCompare(b.dueDate)) }))
    .filter(d => d.member)
    .filter(d => memberIds ? memberIds.includes(d.member.id) : _monthsOverdue(d.bills[0].dueDate) >= minMonths)
    .filter(d => !village || d.member.village === village)
    .sort((a, b) => (a.member.village || '').localeCompare(b.member.village || '', 'th')
      || String(a.member.houseNo || '').localeCompare(String(b.member.houseNo || ''), 'th', { numeric: true }));
}

export function openNoticePrint(memberId) {
  const villages = [...new Set(appState.members.map(m => m.village))].filter(Boolean).sort();
  const single   = memberId ? appState.members.find(m => m.id === memberId) : null;
  openModal({
    id: 'notice-modal', title: single ? `พิมพ์หนังสือแจ้ง — ${single.firstName} ${single.lastName}` : 'พิมพ์หนังสือแจ้งลูกหนี้', icon: 'ti-mail', width: 460,
    body: `
      <div class="form-group" style="margin-bottom:12px">
        <label class="form-label" for="nt-kind">ประเภทหนังสือ</label>
        <select class="form-input" id="nt-kind">${Object.entries(NOTICE_KINDS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
      </div>
      ${single ? '' : `
      <div class="form-group" style="margin-bottom:12px">
        <label class="form-label" for="nt-months">ค้างชำระตั้งแต่</label>
        <select class="form-input" id="nt-months"><option value="1">1 เดือนขึ้นไป</option><option value="2">2 เดือนขึ้นไป</option><option value="3">3 เดือนขึ้นไป</option></select>
      </div>
      <div class="form-group" style="margin-bottom:12px">
        <label class="form-label" for="nt-village">หมู่บ้าน</label>
        <select class="form-input" id="nt-village"><option value="">ทุกหมู่บ้าน</option>${villages.map(v => `<option>${esc(v)}</option>`).join('')}</select>
      </div>`}
      <div class="form-group" style="margin-bottom:12px">
        <label class="form-label" for="nt-days">ให้ชำระภายใน (วัน)</label>
        <input class="form-input" id="nt-days" type="number" min="1" max="60" value="7"/>
      </div>
      <div id="nt-count" style="font-size:13px;color:var(--gray-600)"></div>
      <div style="font-size:11.5px;color:var(--gray-500);margin-top:8px">พิมพ์บนกระดาษ A4 · ระบบบันทึกประวัติการออกหนังสือไว้ในบันทึกกิจกรรม</div>`,
    footer: `
      <button class="btn btn-secondary" data-close>ยกเลิก</button>
      <button class="btn btn-primary" id="nt-ok"><i class="ti ti-printer"></i>พิมพ์</button>`,
  });
  const el   = document.getElementById('notice-modal');
  const kind = el.querySelector('#nt-kind');
  const pick = () => _debtors(
    parseInt(el.querySelector('#nt-months')?.value || '1'),
    el.querySelector('#nt-village')?.value || '',
    single ? [single.id] : null);
  const refresh = () => {
    const n = pick();
    el.querySelector('#nt-count').textContent = `จะพิมพ์ ${n.length} ฉบับ · ยอดค้างรวม ฿${n.reduce((s, d) => s + d.bills.reduce((t, b) => t + b.total, 0), 0).toLocaleString()}`;
  };
  kind.addEventListener('change', () => {
    const k = NOTICE_KINDS[kind.value];
    el.querySelector('#nt-days').value = k.days;
    const months = el.querySelector('#nt-months');
    if (months) months.value = String(k.minMonths);
    refresh();
  });
  el.querySelectorAll('select').forEach(s => s !== kind && s.addEventListener('change', refresh));
  refresh();

  el.querySelector('#nt-ok').onclick = async () => {
    const list = pick();
    if (!list.length) { toast('ไม่มีลูกหนี้ตามเงื่อนไข', 'warn'); return; }
    const k    = kind.value;
    const days = Math.max(1, parseInt(el.querySelector('#nt-days').value) || NOTICE_KINDS[k].days);
    const org  = orgInfo(appState.systemConfig);
    const date = todayISO();
    const job  = beginPrint(NOTICE_KINDS[k].label);
    closeModal('notice-modal');
    await job.print(list.map(d => noticeHtml({ kind: k, member: d.member, bills: d.bills, org, date, days })), 'letter');
    list.forEach(d => sbLogAudit('notices', String(d.member.id), k, null, {
      kind: k, label: NOTICE_KINDS[k].label, member: `${d.member.firstName} ${d.member.lastName}`,
      bills: d.bills.map(b => b.id), total: d.bills.reduce((s, b) => s + b.total, 0), due_days: days,
    }));
    toast(`พิมพ์${NOTICE_KINDS[k].label} ${list.length} ฉบับ`, 'success');
  };
}

// ─── ใบนำส่งเงินประจำวัน ─────────────────────────────────────
export async function printRemittance(summary, closing) {
  const job = beginPrint(`ใบนำส่งเงิน ${summary.date}`);
  await job.print([remittanceHtml({ summary, closing, org: orgInfo(appState.systemConfig) })], 'letter');
}
