// ─── Payments Module ───────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc, toast, showConfirm } from '../../utils/dom.util.js';
import { channelMap } from '../../config/ui.config.js';
import { sbUpsertPayment, sbUpdatePayment, sbUpdateBillStatus } from '../../services/data-loader.service.js';
import { nextReceiptNo } from '../../utils/date.util.js';
import { saveToStorage } from '../../services/storage.service.js';
import { currentUser } from '../../services/auth.service.js';

const payStatusMap = {
  approved: { cls: 'pill-paid',    label: 'อนุมัติแล้ว' },
  pending:  { cls: 'pill-pending', label: 'รอตรวจสอบ' },
  rejected: { cls: 'pill-overdue', label: 'ปฏิเสธ' },
};

const _channelMeta = {
  cash:      { title: 'บันทึกรับเงินสด',       icon: 'ti-cash',          showRef: false, refPlaceholder: '' },
  promptpay: { title: 'บันทึกชำระ PromptPay',  icon: 'ti-qrcode',        showRef: true,  refPlaceholder: 'เลขอ้างอิง PromptPay' },
  bank:      { title: 'บันทึกโอนธนาคาร',       icon: 'ti-building-bank', showRef: true,  refPlaceholder: 'เลขที่อ้างอิงการโอน' },
  mobile:    { title: 'บันทึกชำระ Mobile App', icon: 'ti-device-mobile', showRef: true,  refPlaceholder: 'Transaction ID' },
};

export function renderPayments() {
  const { payments, members, bills } = appState;
  const el = document.getElementById('payments-card-list');
  if (!el) return;
  const sorted = [...payments].sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  if (!sorted.length) {
    el.innerHTML = `<div style="text-align:center;padding:48px 24px;color:var(--gray-400);font-size:14px"><i class="ti ti-receipt-off" style="font-size:36px;margin-bottom:8px;display:block"></i>ไม่มีรายการ</div>`;
  } else {
    el.innerHTML = sorted.map(p => {
      const m  = members.find(x => x.id === p.memberId) || {};
      const ch = channelMap[p.channel] || { label: p.channel, icon: 'ti-cash' };
      const st = payStatusMap[p.status] || payStatusMap.pending;
      const [dateStr, timeStr] = p.paidAt.split(' ');
      let actionBtns;
      if (p.status === 'pending') {
        actionBtns = `<button class="btn btn-primary btn-xs" onclick="approvePayment('${p.id}')"><i class="ti ti-check"></i>อนุมัติ</button>
           <button class="btn btn-danger btn-xs" onclick="rejectPayment('${p.id}')">ปฏิเสธ</button>`;
      } else if (p.status === 'approved') {
        actionBtns = `<button class="btn btn-secondary btn-xs" onclick="printReceiptByPayment('${p.id}')" title="พิมพ์ใบเสร็จ"><i class="ti ti-printer"></i></button>
           <button class="btn btn-xs" style="color:var(--red-600);border:1px solid var(--red-200);border-radius:var(--radius-sm);padding:3px 8px;background:#fff;cursor:pointer" onclick="cancelPayment('${p.id}')" title="ยกเลิก"><i class="ti ti-ban"></i></button>`;
      } else {
        actionBtns = `<span style="font-size:11px;color:var(--gray-400)">${p.status === 'cancelled' ? 'ยกเลิกแล้ว' : '—'}</span>`;
      }
      return `<div class="h-card" style="opacity:${p.status==='cancelled'?.55:1}">
        <div class="pch-time">
          <div style="font-size:12px;font-weight:600;color:var(--gray-700)">${esc(dateStr||'—')}</div>
          <div class="mono" style="font-size:10.5px;color:var(--gray-400)">${esc(timeStr||'')}</div>
        </div>
        <div class="pch-channel">
          <i class="ti ${ch.icon}" style="font-size:20px;color:var(--blue-500)"></i>
          <span>${esc(ch.label)}</span>
        </div>
        <div class="pch-info">
          <div class="text-bold" style="font-size:13px">${esc(m.firstName||'')} ${esc(m.lastName||'')}</div>
          <div class="text-muted" style="font-size:11px">${esc(p.billId||'—')}${p.receiptNo?' · <span class="mono">'+esc(p.receiptNo)+'</span>':''}</div>
        </div>
        <div class="pch-amount">
          <div style="font-size:17px;font-weight:800;color:var(--blue-900)">฿${Number(p.amount).toLocaleString()}</div>
        </div>
        <div class="pch-status"><span class="pill ${st.cls}" style="font-size:11px">${st.label}</span></div>
        <div class="pch-actions">${actionBtns}</div>
      </div>`;
    }).join('');
  }
  const todayStr   = new Date().toISOString().split('T')[0];
  const todayAmt   = payments.filter(p => p.paidAt.startsWith(todayStr) && p.status === 'approved').reduce((s, p) => s + p.amount, 0);
  const pendingPay = payments.filter(p => p.status === 'pending');
  const overdueB   = bills.filter(b => b.status === 'overdue');
  const overdueAmt = overdueB.reduce((s, b) => s + b.total, 0);
  const pkpis = document.querySelectorAll('#page-payments .kpi-val');
  if (pkpis[0]) pkpis[0].textContent = '฿' + overdueAmt.toLocaleString();
  if (pkpis[1]) pkpis[1].textContent = '฿' + todayAmt.toLocaleString();
  if (pkpis[2]) pkpis[2].textContent = pendingPay.length + ' รายการ';
  if (pkpis[3]) pkpis[3].textContent = overdueB.length + ' ราย';
  const foot = document.querySelector('#page-payments .tbl-footer span');
  if (foot) foot.textContent = `แสดง 1–${sorted.length} จาก ${payments.length} รายการ`;
}

export function approvePayment(pid) {
  const { payments, bills } = appState;
  const p = payments.find(x => x.id === pid); if (!p) return;
  const now       = new Date().toISOString().replace('T',' ').substring(0,16);
  const receiptNo = p.receiptNo || nextReceiptNo();
  p.status     = 'approved';
  p.approvedBy = currentUser?.id || 'admin';
  p.approvedAt = now;
  p.receiptNo  = receiptNo;
  const b = bills.find(x => x.id === p.billId);
  if (b) b.status = 'paid';
  sbUpdatePayment(pid, { status: 'approved', approved_at: now, receipt_no: receiptNo });
  if (b) sbUpdateBillStatus(b.id, 'paid');
  saveToStorage();
  renderPayments();
  window.renderBilling?.();
  window.renderDebtors?.();
  toast(`อนุมัติการชำระเงิน — ใบเสร็จ ${receiptNo}`, 'success');
}

export function rejectPayment(pid) {
  const p = appState.payments.find(x => x.id === pid); if (!p) return;
  p.status = 'rejected';
  sbUpdatePayment(pid, { status: 'rejected' });
  saveToStorage();
  renderPayments();
  toast('ปฏิเสธรายการชำระเงิน', 'warn');
}

export function openCashModal(channel) {
  channel = channel || 'cash';
  const meta    = _channelMeta[channel] || _channelMeta.cash;
  const iconEl  = document.getElementById('cp-modal-icon');
  const titleEl = document.getElementById('cp-modal-title');
  if (iconEl)  iconEl.className    = 'ti ' + meta.icon;
  if (titleEl) titleEl.textContent = meta.title;
  document.getElementById('cp-channel').value = channel;
  const { bills, members } = appState;
  const unpaid = bills.filter(b => b.status === 'overdue' || b.status === 'pending');
  const select = document.getElementById('cp-bill');
  select.innerHTML = '<option value="">-- เลือกบิล --</option>' +
    unpaid.map(b => { const m = members.find(x => x.id === b.memberId) || {}; return `<option value="${b.id}">${b.id} — ${m.firstName||''} ${m.lastName||''} (฿${b.total})</option>`; }).join('');
  const refRow  = document.getElementById('cp-ref-row');
  const slipRow = document.getElementById('cp-slip-row');
  const refInp  = document.getElementById('cp-ref');
  if (refRow)  refRow.style.display  = meta.showRef ? '' : 'none';
  if (slipRow) slipRow.style.display = meta.showRef ? '' : 'none';
  if (refInp)  { refInp.placeholder = meta.refPlaceholder; refInp.value = ''; }
  document.getElementById('cp-name').value   = '';
  document.getElementById('cp-amount').value = '';
  document.getElementById('cp-note').value   = '';
  document.getElementById('cash-modal').style.display = 'flex';
}

export function closeCashModal() { document.getElementById('cash-modal').style.display = 'none'; }

let _pendingPayBillId = null;

export function openCashModalForBill(billId) {
  _pendingPayBillId = billId;
  const b = appState.bills.find(x => x.id === billId);
  const m = b ? appState.members.find(x => x.id === b.memberId) : null;
  const infoEl = document.getElementById('pay-type-bill-info');
  if (infoEl) {
    infoEl.innerHTML = b && m
      ? `<div style="font-weight:700;font-size:13px;color:var(--blue-900)">${esc(m.firstName)} ${esc(m.lastName)}</div>
         <div style="font-size:12px;color:var(--gray-500);margin-top:2px">${esc(b.id)} · รอบ ${esc(b.period)}</div>
         <div style="font-size:18px;font-weight:800;color:var(--blue-700);margin-top:6px">฿${b.total.toLocaleString()}</div>`
      : '—';
  }
  document.getElementById('pay-type-modal').style.display = 'flex';
}

export function closePayTypeModal() {
  document.getElementById('pay-type-modal').style.display = 'none';
}

window._selectPayType = function(channel) {
  closePayTypeModal();
  const billId = _pendingPayBillId;
  _pendingPayBillId = null;
  openCashModal(channel);
  if (!billId) return;
  const b = appState.bills.find(x => x.id === billId);
  if (!b) return;
  const select = document.getElementById('cp-bill');
  if (select) select.value = billId;
  document.getElementById('cp-amount').value = b.total;
  const m = appState.members.find(x => x.id === b.memberId);
  if (m) document.getElementById('cp-name').value = m.firstName + ' ' + m.lastName;
};

export function notifyBillDebtor(memberId) {
  const m = appState.members.find(x => x.id === memberId);
  if (!m) return;
  toast(`ส่งแจ้งเตือนถึง: ${m.firstName} ${m.lastName} (${m.phone||'ไม่มีเบอร์'})`, 'info');
}

export function cancelPayment(pid) {
  const { payments, bills } = appState;
  const p = payments.find(x => x.id === pid);
  if (!p) return;
  if (p.status !== 'approved') { toast('ยกเลิกได้เฉพาะรายการที่อนุมัติแล้ว', 'error'); return; }
  showConfirm({
    title:   `ยกเลิกใบเสร็จ ${p.receiptNo || pid}`,
    message: `ยอดเงิน: ฿${p.amount.toLocaleString()}\n\nบิลจะถูกเปลี่ยนกลับเป็นสถานะรอชำระ`,
    okText:  'ยืนยันยกเลิก',
    icon:    'ti-ban',
    onOk() {
      const now = new Date().toISOString().replace('T', ' ').substring(0, 16);
      p.status      = 'cancelled';
      p.cancelledAt = now;
      const b = bills.find(x => x.id === p.billId);
      if (b && b.status === 'paid') {
        const today = new Date().toISOString().split('T')[0];
        b.status = b.dueDate < today ? 'overdue' : 'pending';
        sbUpdateBillStatus(b.id, b.status);
      }
      sbUpdatePayment(pid, { status: 'cancelled', cancelled_at: now });
      saveToStorage();
      renderPayments();
      window.renderBilling?.();
      window.renderDebtors?.();
      toast(`ยกเลิกใบเสร็จ ${p.receiptNo || pid} แล้ว`, 'warn');
    },
  });
}

export function printReceiptByPayment(pid) {
  const p = appState.payments.find(x => x.id === pid);
  if (!p) return;
  const b = appState.bills.find(x => x.id === p.billId);
  if (!b) return;
  window.openBillReceipt?.(b.id);
  setTimeout(() => window.printReceipt?.(), 350);
}

export function saveCashPayment() {
  const { bills, payments } = appState;
  const billId  = document.getElementById('cp-bill').value;
  const amount  = parseFloat(document.getElementById('cp-amount').value);
  const channel = document.getElementById('cp-channel').value || 'cash';
  const txRef   = document.getElementById('cp-ref')?.value.trim() || '';
  if (!billId)           { toast('กรุณาเลือกบิล', 'error'); return; }
  if (!amount || amount <= 0) { toast('กรุณากรอกจำนวนเงิน', 'error'); return; }
  const b = bills.find(x => x.id === billId);
  if (!b) { toast('ไม่พบบิล', 'error'); return; }
  const now       = new Date().toISOString().replace('T',' ').substring(0,16);
  const isCash    = channel === 'cash';
  const receiptNo = isCash ? nextReceiptNo() : null;
  const newPay = {
    id: 'PAY-'+Date.now(), billId, memberId: b.memberId, paidAt: now, amount, channel, txRef,
    payerName: document.getElementById('cp-name').value.trim(),
    slipPath: null, receiptNo,
    status: isCash ? 'approved' : 'pending',
    approvedBy: isCash ? (currentUser?.id || 'admin') : null,
    approvedAt: isCash ? now : null,
    rejectReason: null,
  };
  payments.push(newPay);
  if (isCash) b.status = 'paid';
  sbUpsertPayment(newPay);
  if (isCash) sbUpdateBillStatus(billId, 'paid');
  closeCashModal();
  saveToStorage();
  renderPayments();
  window.renderBilling?.();
  window.renderDebtors?.();
  const meta = _channelMeta[channel] || _channelMeta.cash;
  toast(
    isCash
      ? `รับเงินสด ฿${amount.toLocaleString()} — ใบเสร็จ ${receiptNo}`
      : `บันทึก ${meta.title} ฿${amount.toLocaleString()} — รอยืนยันสลิป`,
    isCash ? 'success' : 'info'
  );
}
