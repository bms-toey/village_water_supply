// ─── Billing Module ────────────────────────────────────────────
import { nowLocal, toLocalDate, todayISO } from '../../utils/time.util.js';
import { appState } from '../../state/app.state.js';
import { esc, toast, jsArg } from '../../utils/dom.util.js';
import { currentPeriod, isPeriodClosed } from '../../utils/date.util.js';
import { serviceCharge } from '../../config/rate.config.js';
import { channelMap } from '../../config/ui.config.js';
import { sbInsertBills, sbCancelBill, sbGetBilledMemberIds } from '../../services/data-loader.service.js';
import { saveToStorage } from '../../services/storage.service.js';
import { currentUser } from '../../services/auth.service.js';
import { isBillLocked, canAdjustBill } from './periods.js';
import { printBillDocument, paperOptions } from '../documents/documents.js';
import { promptPaySvg } from '../../utils/promptpay.js';
import { villageOptions } from '../../services/db-mapper.service.js';

let _billSearch    = '';
let _billPeriod    = '';
let _billVillage   = '';
let _billStatusTab = null;

export function setBillFilters({ search, period, village, statusTab } = {}) {
  if (search    !== undefined) _billSearch    = search;
  if (period    !== undefined) _billPeriod    = period;
  if (village   !== undefined) _billVillage   = village;
  if (statusTab !== undefined) _billStatusTab = statusTab;
}

const billStatusMap = {
  paid:      { cls: 'pill-paid',    label: 'ชำระแล้ว' },
  overdue:   { cls: 'pill-overdue', label: 'ค้างชำระ' },
  pending:   { cls: 'pill-pending', label: 'รอยืนยัน' },
  cancelled: { cls: 'pill-closed',  label: 'ยกเลิก'   },
};

export function renderBilling(filterStatus) {
  if (filterStatus !== undefined) _billStatusTab = filterStatus;
  const { bills, members, meterReadings, payments } = appState;
  const container = document.getElementById('billing-card-list');
  if (!container) return;
  const memberOf = b => members.find(x => x.id === b.memberId) || {};
  const money = n => '฿' + (n || 0).toLocaleString();

  // ขอบเขตก่อนกรองสถานะ (รอบบิล + หมู่บ้าน + ค้นหา) — ใช้นับจำนวนในแท็บและ KPI
  let scope = bills;
  if (_billPeriod)  scope = scope.filter(b => b.period === _billPeriod);
  if (_billVillage) scope = scope.filter(b => String(memberOf(b).villageId) === _billVillage);
  if (_billSearch) {
    const q = _billSearch.toLowerCase();
    scope = scope.filter(b => {
      const m = memberOf(b);
      return [b.id, (m.firstName||'')+' '+(m.lastName||''), m.houseNo, m.meter].some(v => String(v||'').toLowerCase().includes(q));
    });
  }
  const list = _billStatusTab ? scope.filter(b => b.status === _billStatusTab) : scope;

  if (!list.length) {
    container.innerHTML = `<tr class="bill-empty"><td colspan="11"><i class="ti ti-receipt-off"></i>ไม่พบรายการ</td></tr>`;
  } else {
    // Sort: overdue first, then pending, then paid, then cancelled
    const order = { overdue:0, pending:1, paid:2, cancelled:3 };
    const sorted = [...list].sort((a, b) => (order[a.status]??9) - (order[b.status]??9) || String(b.period).localeCompare(String(a.period)));
    container.innerHTML = sorted.map(b => {
      const m    = memberOf(b);
      const mr   = meterReadings.find(r => r.billId === b.id);
      const st   = billStatusMap[b.status] || billStatusMap.pending;
      const unpaid = b.status === 'overdue' || b.status === 'pending';
      const locked = isBillLocked(b);
      const pay  = b.status === 'paid' ? payments.find(p => p.billId === b.id && p.status === 'approved') : null;
      const ch   = pay ? (channelMap[pay.channel] || { label: pay.channel, icon: 'ti-cash' }) : null;

      // ปรับ/ลด — ตามตรรกะใบแจ้งหนี้: มีใบปรับปรุงยอดใช้ยอดนั้นแทนส่วนลด
      const adj   = (appState.billAdjustments || []).filter(a => a.billId === b.id);
      const plus  = (b.lateFee || 0) + adj.filter(a => a.amount > 0).reduce((s, a) => s + a.amount, 0);
      const minus = adj.length ? -adj.filter(a => a.amount < 0).reduce((s, a) => s + a.amount, 0) : (b.discount || 0);
      const adjCell = plus || minus
        ? `${plus ? `<span class="bt-plus">+${plus.toLocaleString()}</span>` : ''}${minus ? `<span class="bt-minus">-${minus.toLocaleString()}</span>` : ''}`
        : '<span class="bt-dim">—</span>';

      const payBtn = unpaid
        ? `<button class="btn btn-primary btn-xs" aria-label="รับชำระบิล ${esc(b.id)}" onclick="openCashModalForBill(${jsArg(b.id)})"><i class="ti ti-cash"></i>รับชำระ</button>` : '';
      const alertBtn = b.status === 'overdue'
        ? `<button class="btn btn-secondary btn-xs bt-ic" aria-label="แจ้งเตือนลูกหนี้" title="แจ้งเตือน" onclick="notifyBillDebtor(${b.memberId})"><i class="ti ti-bell-exclamation" style="color:var(--red-700)"></i></button>` : '';
      const cancelBtn = unpaid && !locked
        ? `<button class="btn btn-secondary btn-xs bt-ic" aria-label="ยกเลิกบิล ${esc(b.id)}" title="ยกเลิกบิล" onclick="cancelBill(${jsArg(b.id)})"><i class="ti ti-ban" style="color:var(--red-500)"></i></button>` : '';

      return `
      <tr class="bt-row" data-st="${esc(b.status)}">
        <td class="bt-id"><span class="mono">${esc(b.id)}</span>${locked ? ' <i class="ti ti-lock" title="งวดปิดแล้ว"></i>' : ''}<small>${esc(b.period)}</small></td>
        <td class="bt-who"><b>${esc(m.firstName||'')} ${esc(m.lastName||'')}</b>
          <small>${esc(m.houseNo||'')} ${esc(m.village||'')}${m.meter ? ` · <span class="mono">${esc(m.meter)}</span>` : ''}</small></td>
        <td class="bt-mtr mono" data-use=" · ใช้ ${b.usage} m³">${mr ? `${mr.prevReading.toLocaleString()} → ${mr.currReading.toLocaleString()}` : '<span class="bt-dim">—</span>'}</td>
        <td class="r bt-use"><b>${b.usage}</b> m³</td>
        <td class="r">${(b.waterCharge||0).toLocaleString()}</td>
        <td class="r">${(b.serviceCharge||0).toLocaleString()}</td>
        <td class="r bt-adj">${adjCell}</td>
        <td class="r bt-total">${money(b.total)}</td>
        <td class="bt-due" data-lbl="${pay ? 'ชำระ' : 'กำหนด'}">${pay
          ? `<span class="bt-paid">${esc(String(pay.paidAt).substring(0,10))}</span><small><i class="ti ${ch.icon}"></i>${esc(ch.label)}</small>`
          : `<span class="${b.status==='overdue' ? 'bt-late' : ''}">${esc(b.dueDate||'—')}</span>`}</td>
        <td class="bt-st"><span class="pill ${st.cls}">${st.label}</span></td>
        <td class="r bt-act"><div>${payBtn}<button class="btn btn-secondary btn-xs bt-ic" aria-label="ดูเอกสารบิล ${esc(b.id)}" title="ดูเอกสาร" onclick="openBillReceipt(${jsArg(b.id)})"><i class="ti ti-receipt-2"></i></button>${alertBtn}${cancelBtn}</div></td>
      </tr>`;
    }).join('');
  }

  // แท็บสถานะ: ปุ่ม .on + จำนวนในขอบเขตปัจจุบัน
  const pg = document.getElementById('page-billing');
  pg.querySelectorAll('.bill-seg button').forEach(btn => btn.classList.toggle('on', (btn.dataset.v || null) === (_billStatusTab || null)));
  pg.querySelectorAll('.bill-seg-n').forEach(n => {
    const c = n.dataset.n ? scope.filter(b => b.status === n.dataset.n).length : scope.length;
    n.textContent = c || '';
  });

  const listActive = list.filter(b => b.status !== 'cancelled');
  const footer = document.getElementById('billing-card-footer');
  if (footer) footer.textContent = `แสดง ${list.length} จาก ${bills.length} รายการ`;
  const sumFoot = document.getElementById('billing-sum-footer');
  if (sumFoot) sumFoot.innerHTML = listActive.length
    ? `รวม <b>${listActive.reduce((s, b) => s + b.usage, 0).toLocaleString()}</b> m³ · <b>${money(listActive.reduce((s, b) => s + b.total, 0))}</b>` : '';

  // KPI — ตามรอบบิล/หมู่บ้านที่เลือก (ไม่ขึ้นกับแท็บสถานะ/คำค้น)
  let kpiBase = bills.filter(b => b.status !== 'cancelled');
  if (_billPeriod)  kpiBase = kpiBase.filter(b => b.period === _billPeriod);
  if (_billVillage) kpiBase = kpiBase.filter(b => String(memberOf(b).villageId) === _billVillage);
  const sum = arr => arr.reduce((s, b) => s + b.total, 0);
  const byStatus = s => kpiBase.filter(b => b.status === s);
  const totalAmount = sum(kpiBase), paid = byStatus('paid'), pending = byStatus('pending'), overdue = byStatus('overdue');
  const paidAmount  = sum(paid);
  const pct = totalAmount ? Math.round(paidAmount / totalAmount * 100) : 0;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('bk-period',    _billPeriod ? '· ' + _billPeriod : '· ทุกรอบ');
  set('bk-total',     money(totalAmount));
  set('bk-total-n',   kpiBase.length + ' บิล');
  set('bk-paid',      money(paidAmount));
  set('bk-paid-n',    `${paid.length} บิล · ${pct}%`);
  set('bk-pending',   money(sum(pending)));
  set('bk-pending-n', pending.length + ' บิล');
  set('bk-overdue',   money(sum(overdue)));
  set('bk-overdue-n', overdue.length + ' บิล');
  const bar = document.getElementById('bk-paid-bar');
  if (bar) bar.style.width = pct + '%';
  pg.querySelectorAll('.bill-kpi').forEach(k => k.classList.toggle('on', !!_billStatusTab && k.dataset.v === _billStatusTab));
}

export function populateBillingFilters() {
  const pg        = document.getElementById('page-billing');
  const selects   = pg.querySelectorAll('.fselect');
  const villageEl = selects[0];
  const periodEl  = selects[1];
  if (villageEl && villageEl.options.length <= 1) {
    villageEl.innerHTML = '<option value="">ทุกหมู่บ้าน</option>' + villageOptions();
  }
  if (periodEl) {
    const periods = [...new Set(appState.bills.map(b => b.period))].sort().reverse();
    const cur = periodEl.value;
    periodEl.innerHTML = '<option>ทุกรอบบิล</option>' + periods.map(p => `<option${p===cur?' selected':''}>${esc(p)}</option>`).join('');
  }
}

export async function autoBill() {
  const { bills, members } = appState;
  const period = currentPeriod();

  // Parse period for Supabase query (e.g. "มิ.ย. 2569" → year=2569, month=6)
  const _THAI_M = { 'ม.ค.':1,'ก.พ.':2,'มี.ค.':3,'เม.ย.':4,'พ.ค.':5,'มิ.ย.':6,'ก.ค.':7,'ส.ค.':8,'ก.ย.':9,'ต.ค.':10,'พ.ย.':11,'ธ.ค.':12 };
  const [mo, yr] = period.split(' ');
  const periodYear  = parseInt(yr);
  const periodMonth = _THAI_M[mo] || 1;

  // Query Supabase for members already billed this period (catches DB state not in memory)
  const billedInDB  = await sbGetBilledMemberIds(periodYear, periodMonth);
  const billedInMem = new Set(bills.filter(b => b.period === period && b.status !== 'cancelled').map(b => b.memberId));
  const billed      = new Set([...billedInDB, ...billedInMem]);

  if (isPeriodClosed(period)) { toast(`งวด ${period} ปิดแล้ว — ออกบิลเพิ่มไม่ได้`, 'error'); return; }

  const unbilled = members.filter(m => m.status !== 'closed' && !billed.has(m.id));
  if (!unbilled.length) { toast('ทุกสมาชิกมีบิลสำหรับรอบนี้แล้ว', 'info'); return; }

  const today   = todayISO();
  const due     = new Date(); due.setDate(due.getDate() + (parseInt(appState.systemConfig?.billing_due_days) || 15));
  const dueDate = toLocalDate(due);
  const drafts = unbilled.map(m => {
    const svc = serviceCharge(m.meterSize);
    return { memberId: m.id, period, issueDate: today, dueDate, usage: 0, waterCharge: 0, serviceCharge: svc, lateFee: 0, discount: 0, status: 'pending', sentVia: '' };
  });
  // server ออกเลขบิลให้ทุกใบ — ล้มเหลวทั้งชุดถ้ามีปัญหา (ไม่มีบิลครึ่งๆ กลางๆ)
  const saved = await sbInsertBills(drafts);
  if (!saved) return;
  bills.push(...saved);
  saveToStorage();
  renderBilling();
  toast(`สร้างบิล ${saved.length} รายการ สำหรับรอบ ${period}`, 'success');
}

// ─── Cancel Bill Modal ────────────────────────────────────────
let _cancelBillId = null;

export function cancelBill(billId) {
  const b = appState.bills.find(x => x.id === billId);
  if (!b) return;
  if (b.status === 'paid') {
    toast('ไม่สามารถยกเลิกบิลที่ชำระแล้ว กรุณายกเลิกการรับเงินก่อน', 'error');
    return;
  }
  if (b.status === 'cancelled') {
    toast('บิลนี้ถูกยกเลิกแล้ว', 'warn');
    return;
  }
  if (isBillLocked(b)) {
    toast(`งวด ${b.period} ปิดแล้ว — ยกเลิกบิลไม่ได้ ให้ใช้ "ปรับปรุงยอด" (ใบลดหนี้) แทน`, 'error');
    return;
  }
  _cancelBillId = billId;
  const label = document.getElementById('cancel-bill-id-label');
  const area  = document.getElementById('cancel-bill-reason');
  if (label) label.textContent = billId;
  if (area)  area.value = '';
  closeReceiptModal(); // ปิด receipt modal ก่อนเปิด cancel modal เสมอ
  document.getElementById('cancel-bill-modal').style.display = 'flex';
  setTimeout(() => area?.focus(), 120);
}

export function closeCancelBillModal() {
  document.getElementById('cancel-bill-modal').style.display = 'none';
  _cancelBillId     = null;
  _cancelInProgress = false;
  const btn = document.getElementById('cancel-bill-confirm-btn');
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-ban"></i>ยืนยันยกเลิกบิล'; }
}

let _cancelInProgress = false;

export async function confirmCancelBill() {
  if (_cancelInProgress) return;

  const reason = document.getElementById('cancel-bill-reason')?.value.trim();
  if (!reason) {
    const area = document.getElementById('cancel-bill-reason');
    if (area) { area.style.borderColor = 'var(--red-500)'; area.focus(); }
    toast('กรุณาระบุเหตุผลการยกเลิก', 'error');
    return;
  }
  const billId = _cancelBillId;
  if (!billId) return;

  const b = appState.bills.find(x => x.id === billId);
  if (!b) { closeCancelBillModal(); return; }

  // ตรวจสถานะอีกครั้ง ป้องกัน race condition กรณีบิลถูกชำระไประหว่างรอ
  if (b.status === 'paid') {
    toast('บิลนี้ถูกชำระแล้ว ไม่สามารถยกเลิกได้', 'error');
    closeCancelBillModal();
    return;
  }
  if (b.status === 'cancelled') {
    toast('บิลนี้ถูกยกเลิกไปแล้ว', 'warn');
    closeCancelBillModal();
    return;
  }

  _cancelInProgress = true;
  const btn = document.getElementById('cancel-bill-confirm-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> กำลังยกเลิก...'; }

  const now = nowLocal();
  const ok  = await sbCancelBill(billId, reason, now);
  if (!ok) {
    _cancelInProgress = false;
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-ban"></i>ยืนยันยกเลิกบิล'; }
    return;
  }
  b.status       = 'cancelled';
  b.cancelReason = reason;
  b.cancelledBy  = currentUser?.id || 'admin';
  b.cancelledAt  = now;
  saveToStorage();
  closeCancelBillModal();
  closeReceiptModal();
  renderBilling();
  toast(`ยกเลิกบิล ${billId} แล้ว`, 'warn');

  _cancelInProgress = false;
}

// ─── Receipt / Invoice Modal ──────────────────────────────────
let _receiptBillId = null;

export function openBillReceipt(billId) {
  _receiptBillId = billId;
  const { bills, members, meterReadings, payments } = appState;
  const b   = bills.find(x => x.id === billId);   if (!b) return;
  const m   = members.find(x => x.id === b.memberId) || {};
  const mr  = meterReadings.find(r => r.billId === billId);
  const st  = billStatusMap[b.status] || billStatusMap.pending;
  const pay = payments.find(p => p.billId === billId && p.status === 'approved');

  const isPaid      = b.status === 'paid';
  const isCancelled = b.status === 'cancelled';
  const isUnpaid    = b.status === 'pending' || b.status === 'overdue';

  // Update modal header dynamically
  const titleEl = document.getElementById('receipt-modal-title');
  const iconEl  = document.getElementById('receipt-modal-icon');
  const cancelModalBtn = document.getElementById('receipt-cancel-btn');
  const printLabel     = document.getElementById('receipt-print-label');

  if (titleEl) titleEl.textContent = isPaid ? 'ใบเสร็จรับเงิน' : isCancelled ? 'ใบแจ้งหนี้ (ยกเลิก)' : 'ใบแจ้งหนี้';
  if (iconEl)  iconEl.className    = isPaid ? 'ti ti-receipt' : 'ti ti-receipt-2';
  if (printLabel) printLabel.textContent = isPaid ? 'พิมพ์ใบเสร็จ' : 'พิมพ์';
  const locked = isBillLocked(b);
  if (cancelModalBtn) {
    cancelModalBtn.style.display = isUnpaid && !locked ? '' : 'none';
    cancelModalBtn.onclick = () => cancelBill(billId);
  }

  // ── ใบลดหนี้/เพิ่มหนี้ ของบิลนี้ ──
  const adjustments = (appState.billAdjustments || []).filter(a => a.billId === billId);
  const adjustRows = adjustments.map(a => `
      <div class="rc-line"><span>${a.amount < 0 ? 'ลดหนี้' : 'เพิ่มหนี้'} <span class="mono">${esc(a.docNo)}</span> — ${esc(a.reason)}</span>
        <b class="${a.amount < 0 ? 'rc-minus' : 'rc-plus'}">${a.amount < 0 ? '-' : '+'}฿${Math.abs(a.amount).toLocaleString()}</b></div>`).join('');
  const adjustBtn = isUnpaid && canAdjustBill()
    ? `<button class="btn btn-secondary btn-sm no-print" onclick="openAdjustBill(${jsArg(b.id)})"><i class="ti ti-adjustments-dollar"></i>ปรับปรุงยอด</button>`
    : '';
  const lockNote = locked
    ? `<span class="rc-note no-print"><i class="ti ti-lock"></i> งวด ${esc(b.period)} ปิดแล้ว — แก้ยอดได้ผ่านการปรับปรุงยอดเท่านั้น</span>`
    : '';

  // ── Channel helper ──
  const chLabel = pay ? (channelMap[pay.channel]?.label || pay.channel) : '';
  const kv = (k, v, cls = '') => `<div><span>${k}</span><b class="${cls}">${v}</b></div>`;

  // ── เลขมิเตอร์: แถบเดียว ก่อน → หลัง · หน่วยที่ใช้ ──
  const meterSection = mr ? `
    <div class="rc-meter">
      <div><span>เลขก่อน</span><b class="mono">${mr.prevReading.toLocaleString()}</b></div>
      <i class="ti ti-arrow-right" aria-hidden="true"></i>
      <div><span>เลขหลัง</span><b class="mono">${mr.currReading.toLocaleString()}</b></div>
      <div class="rc-use"><span>หน่วยที่ใช้</span><b>${b.usage} m³</b></div>
    </div>` : '';

  // ── รายการค่าใช้จ่าย + ยอดสุทธิ ──
  const chargesSection = `
    <div class="rc-lines">
      <div class="rc-line"><span>ค่าน้ำ (${b.usage} m³)</span><b>฿${(b.waterCharge||0).toLocaleString()}</b></div>
      <div class="rc-line"><span>ค่าบริการรายเดือน</span><b>฿${(b.serviceCharge||0).toLocaleString()}</b></div>
      ${b.lateFee ? `<div class="rc-line"><span>ค่าปรับล่าช้า</span><b class="rc-plus">+฿${b.lateFee.toLocaleString()}</b></div>` : ''}
      ${adjustments.length ? adjustRows
        : b.discount ? `<div class="rc-line"><span>ส่วนลด</span><b class="rc-minus">-฿${b.discount.toLocaleString()}</b></div>` : ''}
    </div>
    <div class="rc-total"><span>รวมสุทธิ</span><b>฿${b.total.toLocaleString()}</b></div>
    ${adjustBtn || lockNote ? `<div class="rc-acts">${adjustBtn}${lockNote}</div>` : ''}`;

  // ── คอลัมน์ข้าง: ชำระแล้ว → รายละเอียดรับเงิน / ยกเลิก → เหตุผล / ค้างชำระ → QR ──
  // ช่องลงชื่อ/ประทับตราอยู่ในเอกสารที่พิมพ์ (printBillDocument) ไม่ต้องกินที่บนจอ
  const receiptSection = isPaid && pay ? `
    <div class="rc-box rc-box-ok">
      <div class="rc-box-hd"><i class="ti ti-circle-check"></i>รายละเอียดการชำระเงิน</div>
      <div class="rc-kv">
        ${kv('เลขที่ใบเสร็จ', esc(pay.receiptNo || '—'), 'mono')}
        ${kv('วันที่รับเงิน', esc(pay.paidAt))}
        ${kv('ช่องทาง', esc(chLabel))}
        ${kv('ยอดรับ', `฿${pay.amount.toLocaleString()}`, 'rc-minus')}
        ${pay.txRef ? kv('เลขอ้างอิง', esc(pay.txRef), 'mono') : ''}
        ${pay.payerName ? kv('ผู้ชำระ', esc(pay.payerName)) : ''}
        ${pay.receivedByName ? kv('ผู้รับเงิน', esc(pay.receivedByName)) : ''}
      </div>
    </div>` : '';

  const cancelSection = isCancelled ? `
    <div class="rc-box rc-box-warn">
      <div class="rc-box-hd"><i class="ti ti-ban"></i>ใบแจ้งหนี้ถูกยกเลิก</div>
      <div class="rc-kv rc-kv-1">
        ${kv('เหตุผล', esc(b.cancelReason || '—'))}
        ${kv('ยกเลิกเมื่อ', esc(b.cancelledAt || '—'))}
      </div>
    </div>` : '';

  const side = (isUnpaid ? _payQrBlock(b) : '') + receiptSection + cancelSection;

  const body = document.getElementById('receipt-body');
  if (!body) return;
  body.innerHTML = `
  <div class="rc-top">
    <div class="rc-who">
      <div class="rc-name">${esc((m.firstName||'')+' '+(m.lastName||''))}</div>
      <div class="rc-sub">
        <span><i class="ti ti-home"></i>${esc(m.houseNo||'')} ${esc(m.village||'')}</span>
        <span><i class="ti ti-gauge"></i><span class="mono">${esc(m.meter||'—')}</span></span>
      </div>
    </div>
    <span class="pill ${st.cls}">${st.label}</span>
  </div>
  <div class="rc-meta">
    ${kv(isPaid ? 'เลขที่ใบเสร็จ' : 'เลขที่ใบแจ้งหนี้', isPaid && pay?.receiptNo ? esc(pay.receiptNo) : esc(b.id), 'mono rc-id')}
    ${kv('รอบบิล', esc(b.period))}
    ${kv('วันที่ออก', esc(b.issueDate))}
    ${kv(isPaid ? 'วันที่ชำระ' : 'กำหนดชำระ', esc(isPaid && pay ? pay.paidAt.substring(0,10) : b.dueDate), b.status === 'overdue' ? 'rc-plus' : '')}
  </div>
  <div class="rc-grid${side ? '' : ' rc-solo'}">
    <div class="rc-main">${meterSection}${chargesSection}</div>
    ${side ? `<aside class="rc-side">${side}</aside>` : ''}
  </div>`;

  const paperSel = document.getElementById('receipt-paper');
  if (paperSel) paperSel.innerHTML = paperOptions();
  document.getElementById('receipt-modal').style.display = 'flex';
}

// QR พร้อมเพย์บนหน้าจอ — สมาชิกสแกนจ่ายได้ทันทีตอนเจ้าหน้าที่เปิดใบแจ้งให้ดู
function _payQrBlock(b) {
  const ppId = appState.systemConfig?.promptpay_id;
  const svg  = ppId ? promptPaySvg(ppId, b.total, 132) : '';
  if (!svg) return '';
  return `
    <div class="rc-box rc-qr no-print">
      <div class="rc-qr-img">${svg}</div>
      <div class="rc-qr-txt">
        <b>สแกนจ่ายด้วยแอปธนาคาร</b>
        <span>พร้อมเพย์ ${esc(appState.systemConfig?.promptpay_name || '')}</span>
        <span>ยอด <b>฿${b.total.toLocaleString()}</b></span>
        <small>ส่งสลิปให้เจ้าหน้าที่เพื่อยืนยันการชำระ</small>
      </div>
    </div>`;
}

export function closeReceiptModal() {
  document.getElementById('receipt-modal').style.display = 'none';
  const cb = window._afterReceiptClose;
  if (cb) { window._afterReceiptClose = null; cb(); }
}

// พิมพ์เอกสารของบิลที่เปิดอยู่ (ใบแจ้ง หรือใบเสร็จถ้าชำระแล้ว) ตามกระดาษที่เลือก
export function printReceipt() {
  if (_receiptBillId) printBillDocument(_receiptBillId);
}
