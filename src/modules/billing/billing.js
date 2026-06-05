// ─── Billing Module ────────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc, toast } from '../../utils/dom.util.js';
import { currentPeriod, nextBillNo } from '../../utils/date.util.js';
import { rateConfig } from '../../config/rate.config.js';
import { channelMap } from '../../config/ui.config.js';
import { sbUpsertBills, sbCancelBill, sbGetBilledMemberIds } from '../../services/data-loader.service.js';
import { saveToStorage } from '../../services/storage.service.js';
import { currentUser } from '../../services/auth.service.js';

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
  const { bills, members, meterReadings } = appState;
  const container = document.getElementById('billing-card-list');
  if (!container) return;
  let list = _billStatusTab ? bills.filter(b => b.status === _billStatusTab) : bills;
  if (_billSearch) {
    const q = _billSearch.toLowerCase();
    list = list.filter(b => {
      const m = members.find(x => x.id === b.memberId) || {};
      return b.id.toLowerCase().includes(q) || (m.firstName+' '+m.lastName).toLowerCase().includes(q);
    });
  }
  if (_billPeriod)  list = list.filter(b => b.period === _billPeriod);
  if (_billVillage) list = list.filter(b => { const m = members.find(x => x.id === b.memberId); return m && m.village === _billVillage; });

  if (!list.length) {
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px 24px;color:var(--gray-400);font-size:14px">
      <i class="ti ti-receipt-off" style="font-size:36px;margin-bottom:8px;display:block"></i>ไม่พบรายการ</div>`;
  } else {
    // Sort: overdue first, then pending, then paid, then cancelled
    const order = { overdue:0, pending:1, paid:2, cancelled:3 };
    const sorted = [...list].sort((a, b) => (order[a.status]??9) - (order[b.status]??9));
    container.innerHTML = sorted.map(b => {
      const m    = members.find(x => x.id === b.memberId) || {};
      const mr   = meterReadings.find(r => r.billId === b.id);
      const st   = billStatusMap[b.status] || billStatusMap.pending;
      const unpaid = b.status === 'overdue' || b.status === 'pending';
      const isOverdue = b.status === 'overdue';
      const prevNum = mr ? mr.prevReading.toLocaleString() : '—';
      const currNum = mr ? mr.currReading.toLocaleString() : '—';

      const payBtn = unpaid
        ? `<button class="btn btn-primary btn-sm" style="flex:1;justify-content:center" onclick="openCashModalForBill('${esc(b.id)}')">
             <i class="ti ti-cash"></i>รับชำระ
           </button>` : '';
      const alertBtn = isOverdue
        ? `<button class="btn btn-secondary btn-sm" onclick="notifyBillDebtor(${b.memberId})" title="แจ้งเตือน">
             <i class="ti ti-bell-exclamation" style="color:var(--red-700)"></i>
           </button>` : '';
      const cancelBtn = unpaid
        ? `<button class="btn btn-secondary btn-sm" onclick="cancelBill('${esc(b.id)}')" title="ยกเลิกบิล">
             <i class="ti ti-ban" style="color:var(--red-500)"></i>
           </button>` : '';

      return `
      <div style="background:var(--white);border:1px solid var(--gray-200);border-radius:var(--radius-lg);
        overflow:hidden;box-shadow:var(--shadow-sm);display:flex;flex-direction:column;
        opacity:${b.status==='cancelled'?.55:1};
        border-left:4px solid ${isOverdue?'var(--red-500)':b.status==='paid'?'var(--green-600)':b.status==='cancelled'?'var(--gray-300)':'var(--blue-400)'}">

        <!-- Top: bill ID + status -->
        <div style="display:flex;justify-content:space-between;align-items:center;
          padding:10px 14px;background:var(--gray-50);border-bottom:1px solid var(--gray-100)">
          <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--gray-500)">${esc(b.id)}</span>
          <span class="pill ${st.cls}" style="font-size:11px;padding:2px 10px">${st.label}</span>
        </div>

        <!-- Member info -->
        <div style="padding:12px 14px 8px;display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="min-width:0">
            <div style="font-weight:700;font-size:14px;color:var(--blue-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${esc(m.firstName||'')} ${esc(m.lastName||'')}
            </div>
            <div style="font-size:11.5px;color:var(--gray-500);margin-top:2px">
              ${esc(m.houseNo||'')} ${esc(m.village||'')}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:22px;font-weight:800;line-height:1;color:${isOverdue?'var(--red-700)':'var(--blue-900)'}">฿${b.total.toLocaleString()}</div>
            <div style="font-size:11px;color:var(--gray-400);margin-top:3px">${esc(b.period)}</div>
          </div>
        </div>

        <!-- Meter reading -->
        <div style="padding:6px 14px 12px;font-size:12px;color:var(--gray-500)">
          <span style="font-family:'IBM Plex Mono',monospace">${prevNum} → ${currNum}</span>
          <span style="margin:0 6px;color:var(--gray-300)">•</span>
          <strong style="color:var(--gray-700)">${b.usage} m³</strong>
          <span style="margin:0 6px;color:var(--gray-300)">•</span>
          กำหนด ${b.dueDate}
        </div>

        <!-- Actions -->
        <div style="padding:10px 14px 12px;display:flex;gap:8px;border-top:1px solid var(--gray-100);flex-wrap:wrap">
          ${payBtn}
          <button class="btn btn-secondary btn-sm" onclick="openBillReceipt('${esc(b.id)}')" style="flex:1;justify-content:center;min-width:90px">
            <i class="ti ti-receipt-2"></i>ดูเอกสาร
          </button>
          ${alertBtn}${cancelBtn}
        </div>
      </div>`;
    }).join('');
  }

  const footer = document.getElementById('billing-card-footer');
  if (footer) footer.textContent = `แสดง ${list.length} จาก ${bills.length} รายการ`;

  const activeBills   = bills.filter(b => b.status !== 'cancelled');
  const totalAmount   = activeBills.reduce((s, b) => s + b.total, 0);
  const paidAmount    = activeBills.filter(b => b.status === 'paid').reduce((s, b) => s + b.total, 0);
  const overdueAmount = activeBills.filter(b => b.status === 'overdue').reduce((s, b) => s + b.total, 0);
  const overdueCount  = activeBills.filter(b => b.status === 'overdue').length;
  const kpis = document.querySelectorAll('#page-billing .kpi-val');
  if (kpis[0]) kpis[0].textContent = '฿' + totalAmount.toLocaleString();
  if (kpis[1]) kpis[1].textContent = '฿' + paidAmount.toLocaleString();
  if (kpis[2]) kpis[2].textContent = '฿' + overdueAmount.toLocaleString();
  const overdueKpiBadge = document.querySelector('#page-billing .kpi-card:nth-child(3) .kpi-badge');
  if (overdueKpiBadge) overdueKpiBadge.textContent = overdueCount + ' รายการ →';
}

export function populateBillingFilters() {
  const pg        = document.getElementById('page-billing');
  const selects   = pg.querySelectorAll('.fselect');
  const villageEl = selects[0];
  const periodEl  = selects[1];
  if (villageEl && villageEl.options.length <= 1) {
    const villages = [...new Set(appState.members.map(m => m.village))].sort();
    villageEl.innerHTML = '<option>ทุกหมู่บ้าน</option>' + villages.map(v => `<option>${esc(v)}</option>`).join('');
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

  const unbilled = members.filter(m => m.status !== 'closed' && !billed.has(m.id));
  if (!unbilled.length) { toast('ทุกสมาชิกมีบิลสำหรับรอบนี้แล้ว', 'info'); return; }

  const today   = new Date().toISOString().split('T')[0];
  const due     = new Date(); due.setDate(due.getDate() + 15);
  const dueDate = due.toISOString().split('T')[0];
  const newBills = [];
  unbilled.forEach(m => {
    const svc = (m.meterSize === '1' || m.meterSize === '1.5') ? rateConfig.svcLarge : rateConfig.svcSmall;
    const b = { id: nextBillNo(), memberId: m.id, period, issueDate: today, dueDate, usage: 0, waterCharge: 0, serviceCharge: svc, lateFee: 0, discount: 0, total: svc, status: 'pending', sentVia: '', issuedBy: 'admin', cancelReason: null, cancelledBy: null, cancelledAt: null };
    bills.push(b);
    newBills.push(b);
  });
  sbUpsertBills(newBills);
  saveToStorage();
  renderBilling();
  toast(`สร้างบิล ${unbilled.length} รายการ สำหรับรอบ ${period}`, 'success');
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
  _cancelBillId = null;
}

export function confirmCancelBill() {
  const reason = document.getElementById('cancel-bill-reason')?.value.trim();
  if (!reason) {
    const area = document.getElementById('cancel-bill-reason');
    if (area) { area.style.borderColor = 'var(--red-500)'; area.focus(); }
    toast('กรุณาระบุเหตุผลการยกเลิก', 'error');
    return;
  }
  const billId = _cancelBillId;
  const b = appState.bills.find(x => x.id === billId);
  if (!b) { closeCancelBillModal(); return; }

  const now = new Date().toISOString().replace('T', ' ').substring(0, 16);
  b.status       = 'cancelled';
  b.cancelReason = reason;
  b.cancelledBy  = currentUser?.id || 'admin';
  b.cancelledAt  = now;
  sbCancelBill(billId, reason, now);
  saveToStorage();
  closeCancelBillModal();
  closeReceiptModal();
  renderBilling();
  toast(`ยกเลิกบิล ${billId} แล้ว`, 'warn');
}

// ─── Receipt / Invoice Modal ──────────────────────────────────
export function openBillReceipt(billId) {
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
  if (cancelModalBtn) {
    cancelModalBtn.style.display = isUnpaid ? '' : 'none';
    cancelModalBtn.onclick = () => cancelBill(billId);
  }

  // ── Channel helper ──
  const chLabel = pay ? (channelMap[pay.channel]?.label || pay.channel) : '';

  // ── Meter reading section ──
  const meterSection = mr ? `
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;text-align:center">
    <div style="background:var(--gray-50);padding:10px 8px;border-radius:var(--radius-md)">
      <div class="text-muted" style="font-size:10px;margin-bottom:3px">เลขก่อน</div>
      <div class="text-bold mono">${mr.prevReading.toLocaleString()}</div>
    </div>
    <div style="background:var(--blue-50);padding:10px 8px;border-radius:var(--radius-md)">
      <div class="text-muted" style="font-size:10px;margin-bottom:3px">เลขหลัง</div>
      <div class="text-bold mono" style="color:var(--blue-900)">${mr.currReading.toLocaleString()}</div>
    </div>
    <div style="background:var(--cyan-50);padding:10px 8px;border-radius:var(--radius-md)">
      <div class="text-muted" style="font-size:10px;margin-bottom:3px">หน่วยที่ใช้</div>
      <div class="text-bold" style="color:var(--cyan-800)">${b.usage} m³</div>
    </div>
  </div>` : '';

  // ── Charges section ──
  const chargesSection = `
  <div style="border-top:1px solid var(--gray-100);padding-top:12px;font-size:13px">
    <div style="display:flex;justify-content:space-between;padding:5px 0;color:var(--gray-700)"><span>ค่าน้ำ (${b.usage} m³)</span><span>฿${(b.waterCharge||0).toLocaleString()}</span></div>
    <div style="display:flex;justify-content:space-between;padding:5px 0;color:var(--gray-700)"><span>ค่าบริการรายเดือน</span><span>฿${(b.serviceCharge||0).toLocaleString()}</span></div>
    ${b.lateFee  ? `<div style="display:flex;justify-content:space-between;padding:5px 0"><span class="text-muted">ค่าปรับล่าช้า</span><span class="text-error">+฿${b.lateFee.toLocaleString()}</span></div>` : ''}
    ${b.discount ? `<div style="display:flex;justify-content:space-between;padding:5px 0"><span class="text-muted">ส่วนลด</span><span style="color:var(--green-700)">-฿${b.discount.toLocaleString()}</span></div>` : ''}
    <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:2px solid var(--gray-200);margin-top:5px">
      <span class="text-bold" style="font-size:15px">รวมสุทธิ</span>
      <span class="text-bold" style="font-size:20px;color:var(--blue-900)">฿${b.total.toLocaleString()}</span>
    </div>
  </div>`;

  // ── Receipt-specific section (shown only when paid) ──
  const receiptSection = isPaid && pay ? `
  <div style="background:var(--green-50);border:1px solid var(--green-200);border-radius:var(--radius-md);padding:12px 14px;margin-top:12px">
    <div style="font-size:11px;font-weight:700;color:var(--green-800);text-transform:uppercase;margin-bottom:8px;letter-spacing:.5px">รายละเอียดการชำระเงิน</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12.5px">
      <div><span class="text-muted">เลขที่ใบเสร็จ</span><div class="text-bold mono" style="color:var(--green-900)">${esc(pay.receiptNo||'—')}</div></div>
      <div><span class="text-muted">วันที่รับเงิน</span><div class="text-bold">${esc(pay.paidAt)}</div></div>
      <div><span class="text-muted">ช่องทาง</span><div class="text-bold">${esc(chLabel)}</div></div>
      <div><span class="text-muted">ยอดรับ</span><div class="text-bold" style="color:var(--green-700)">฿${pay.amount.toLocaleString()}</div></div>
      ${pay.txRef ? `<div><span class="text-muted">เลขอ้างอิง</span><div class="mono" style="font-size:11px">${esc(pay.txRef)}</div></div>` : ''}
      ${pay.payerName ? `<div><span class="text-muted">ผู้ชำระ</span><div>${esc(pay.payerName)}</div></div>` : ''}
    </div>
  </div>
  <div style="margin-top:16px;padding-top:14px;border-top:1px dashed var(--gray-200);display:flex;justify-content:space-between;align-items:flex-end;font-size:12px;color:var(--gray-500)">
    <div>ลงชื่อผู้รับเงิน .....................................<br><span style="margin-top:4px;display:block;padding-left:8px">(${esc(m.firstName||'')} ${esc(m.lastName||'')})</span></div>
    <div style="text-align:right">ประทับตรา<br><div style="width:60px;height:60px;border:1px dashed var(--gray-300);border-radius:50%;margin-top:4px;margin-left:auto"></div></div>
  </div>` : '';

  // ── Cancelled section ──
  const cancelSection = isCancelled ? `
  <div style="background:#fff8f0;border:1px solid #f97316;border-radius:var(--radius-md);padding:12px 14px;margin-top:12px">
    <div style="font-size:11px;font-weight:700;color:#c2410c;margin-bottom:6px;text-transform:uppercase">ใบแจ้งหนี้ถูกยกเลิก</div>
    <div style="font-size:12.5px;color:var(--gray-700)">เหตุผล: <strong>${esc(b.cancelReason||'—')}</strong></div>
    <div style="font-size:11.5px;color:var(--gray-500);margin-top:4px">ยกเลิกเมื่อ ${esc(b.cancelledAt||'—')}</div>
  </div>` : '';

  const body = document.getElementById('receipt-body');
  if (!body) return;
  body.innerHTML = `
  <div style="text-align:center;padding:0 0 16px;border-bottom:2px solid var(--gray-100);margin-bottom:16px">
    <div style="font-size:20px;font-weight:800;color:var(--blue-900)"><i class="ti ti-droplet-filled" style="color:var(--blue-500)"></i> AquaFlow Pro</div>
    <div style="font-size:12px;color:var(--gray-500);margin-top:2px">${isPaid ? 'ใบเสร็จรับเงิน' : 'ใบแจ้งหนี้ค่าน้ำประปาหมู่บ้าน'}</div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;font-size:12.5px">
    <div>
      <div class="text-muted" style="font-size:10.5px;font-weight:700;text-transform:uppercase">${isPaid ? 'เลขที่ใบเสร็จ' : 'เลขที่ใบแจ้งหนี้'}</div>
      <div class="text-bold mono" style="font-size:12px;margin-top:3px;color:var(--blue-900)">${isPaid && pay?.receiptNo ? esc(pay.receiptNo) : esc(b.id)}</div>
    </div>
    <div><div class="text-muted" style="font-size:10.5px;font-weight:700;text-transform:uppercase">รอบบิล</div><div class="text-bold" style="margin-top:3px">${esc(b.period)}</div></div>
    <div><div class="text-muted" style="font-size:10.5px;font-weight:700;text-transform:uppercase">วันที่ออก</div><div style="margin-top:3px">${b.issueDate}</div></div>
    <div><div class="text-muted" style="font-size:10.5px;font-weight:700;text-transform:uppercase">${isPaid ? 'วันที่ชำระ' : 'กำหนดชำระ'}</div><div style="margin-top:3px" class="${b.status==='overdue'?'text-error text-bold':''}">${isPaid && pay ? pay.paidAt.substring(0,10) : b.dueDate}</div></div>
  </div>
  <div style="background:var(--gray-50);border-radius:var(--radius-md);padding:12px 14px;margin-bottom:16px">
    <div class="text-bold" style="font-size:14px;margin-bottom:5px">${esc((m.firstName||'')+' '+(m.lastName||''))}</div>
    <div class="text-muted" style="font-size:12px">${esc(m.houseNo||'')} ${esc(m.village||'')}</div>
    <div class="text-muted" style="font-size:12px">มิเตอร์: <span class="mono">${esc(m.meter||'—')}</span></div>
  </div>
  ${meterSection}
  ${chargesSection}
  <div style="text-align:center;margin-top:14px">
    <span class="pill ${st.cls}" style="font-size:13px;padding:5px 18px">${st.label}</span>
  </div>
  ${receiptSection}
  ${cancelSection}`;

  document.getElementById('receipt-modal').style.display = 'flex';
}

export function closeReceiptModal() {
  document.getElementById('receipt-modal').style.display = 'none';
  const cb = window._afterReceiptClose;
  if (cb) { window._afterReceiptClose = null; cb(); }
}

export function printReceipt() {
  const body = document.getElementById('receipt-body');
  if (!body) return;
  const titleText = document.getElementById('receipt-modal-title')?.textContent || 'เอกสาร';
  const w = window.open('', '_blank', 'width=520,height=820');
  w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"/><title>${titleText}</title>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet"/>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Sarabun',sans-serif;font-size:14px;color:#111;padding:28px;max-width:440px;margin:0 auto}
  .text-bold{font-weight:700}.text-muted{color:#666}.text-error{color:#ba1a1a}.text-primary{color:#00236f}.op-50{opacity:.5}
  .mono{font-family:'IBM Plex Mono',monospace;font-size:12px}.pill{display:inline-block;padding:4px 16px;border-radius:20px;font-weight:700;font-size:12px}
  .pill-paid{background:#dcfce7;color:#15803d}.pill-overdue{background:#ffdad6;color:#ba1a1a}.pill-pending{background:#fef3c7;color:#b45309}.pill-closed{background:#f1f5f9;color:#475569}
  i[class*="ti"]{display:none}</style></head><body>${body.innerHTML}</body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 400);
}
