const payStatusMap = {
  approved: { cls: 'pill-paid',    label: 'อนุมัติแล้ว' },
  pending:  { cls: 'pill-pending', label: 'รอตรวจสอบ' },
  rejected: { cls: 'pill-overdue', label: 'ปฏิเสธ' },
};

// ─── Render Payments Table ───
function renderPayments() {
  const tbody = document.querySelector('#page-payments .tbl-wrap table tbody');
  if (!tbody) return;
  const sorted = [...payments].sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  if (!sorted.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--gray-500);padding:24px">ไม่มีรายการ</td></tr>';
  } else {
    tbody.innerHTML = sorted.map(p => {
      const m  = members.find(x => x.id === p.memberId) || {};
      const ch = channelMap[p.channel] || { label: p.channel, icon: 'ti-cash' };
      const st = payStatusMap[p.status] || payStatusMap.pending;
      const actionBtns = p.status === 'pending'
        ? `<button class="btn btn-primary btn-xs" onclick="approvePayment('${p.id}')"><i class="ti ti-check"></i>อนุมัติ</button>
           <button class="btn btn-danger  btn-xs" onclick="rejectPayment('${p.id}')">ปฏิเสธ</button>`
        : `<button class="btn-icon" title="ดู"><i class="ti ti-eye"></i></button>`;
      return `<tr>
        <td class="text-muted" style="font-size:12px">${p.paidAt}</td>
        <td class="text-bold">${esc(m.firstName || '')} ${esc(m.lastName || '')}</td>
        <td class="text-bold">฿${Number(p.amount).toLocaleString()}</td>
        <td><span style="display:flex;align-items:center;gap:4px;font-size:12.5px"><i class="ti ${ch.icon}" style="color:var(--blue-500)"></i>${ch.label}</span></td>
        <td><span class="pill ${st.cls}">${st.label}</span></td>
        <td><div style="display:flex;gap:5px">${actionBtns}</div></td>
      </tr>`;
    }).join('');
  }
  // KPI updates
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

// ─── Approve Payment ───
function approvePayment(pid) {
  const p = payments.find(x => x.id === pid); if (!p) return;
  const now    = new Date().toISOString().replace('T', ' ').substring(0, 16);
  p.status     = 'approved';
  p.approvedBy = currentUser?.id || 'admin';
  p.approvedAt = now;
  const b = bills.find(x => x.id === p.billId);
  if (b) b.status = 'paid';
  sbUpdatePayment(pid, { status: 'approved', approved_at: now });
  if (b) sbUpdateBillStatus(b.id, 'paid');
  saveToStorage();
  renderPayments();
  renderBilling();
  renderDebtors();
  toast('อนุมัติการชำระเงินแล้ว', 'success');
}

// ─── Reject Payment ───
function rejectPayment(pid) {
  const p = payments.find(x => x.id === pid); if (!p) return;
  p.status = 'rejected';
  sbUpdatePayment(pid, { status: 'rejected' });
  saveToStorage();
  renderPayments();
  toast('ปฏิเสธรายการชำระเงิน', 'warn');
}

// ─── Payment Modal (all channels) ───
const _channelMeta = {
  cash:      { title: 'บันทึกรับเงินสด',       icon: 'ti-cash',          showRef: false, refPlaceholder: '' },
  promptpay: { title: 'บันทึกชำระ PromptPay',  icon: 'ti-qrcode',        showRef: true,  refPlaceholder: 'เลขอ้างอิง PromptPay' },
  bank:      { title: 'บันทึกโอนธนาคาร',       icon: 'ti-building-bank', showRef: true,  refPlaceholder: 'เลขที่อ้างอิงการโอน' },
  mobile:    { title: 'บันทึกชำระ Mobile App', icon: 'ti-device-mobile', showRef: true,  refPlaceholder: 'Transaction ID' },
};

function openCashModal(channel) {
  channel = channel || 'cash';
  const meta    = _channelMeta[channel] || _channelMeta.cash;
  const iconEl  = document.getElementById('cp-modal-icon');
  const titleEl = document.getElementById('cp-modal-title');
  if (iconEl)  iconEl.className    = 'ti ' + meta.icon;
  if (titleEl) titleEl.textContent = meta.title;

  document.getElementById('cp-channel').value = channel;

  const unpaid = bills.filter(b => b.status === 'overdue' || b.status === 'pending');
  const select = document.getElementById('cp-bill');
  select.innerHTML = '<option value="">-- เลือกบิล --</option>' +
    unpaid.map(b => {
      const m = members.find(x => x.id === b.memberId) || {};
      return `<option value="${b.id}">${b.id} — ${m.firstName || ''} ${m.lastName || ''} (฿${b.total})</option>`;
    }).join('');

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
function closeCashModal() { document.getElementById('cash-modal').style.display = 'none'; }

// ─── Open modal pre-filled from Billing Table ───
function openCashModalForBill(billId) {
  openCashModal('cash');
  const b = bills.find(x => x.id === billId);
  if (!b) return;
  const select = document.getElementById('cp-bill');
  if (select) select.value = billId;
  document.getElementById('cp-amount').value = b.total;
  const m = members.find(x => x.id === b.memberId);
  if (m) document.getElementById('cp-name').value = m.firstName + ' ' + m.lastName;
}

// ─── Quick notify from billing table ───
function notifyBillDebtor(memberId) {
  const m = members.find(x => x.id === memberId);
  if (!m) return;
  toast(`ส่งแจ้งเตือนถึง: ${m.firstName} ${m.lastName} (${m.phone || 'ไม่มีเบอร์'})`, 'info');
}

function saveCashPayment() {
  const billId  = document.getElementById('cp-bill').value;
  const amount  = parseFloat(document.getElementById('cp-amount').value);
  const channel = document.getElementById('cp-channel').value || 'cash';
  const refEl   = document.getElementById('cp-ref');
  const txRef   = refEl ? refEl.value.trim() : '';

  if (!billId)              { toast('กรุณาเลือกบิล', 'error'); return; }
  if (!amount || amount <= 0) { toast('กรุณากรอกจำนวนเงิน', 'error'); return; }

  const b = bills.find(x => x.id === billId);
  if (!b) { toast('ไม่พบบิล', 'error'); return; }

  const now    = new Date().toISOString().replace('T', ' ').substring(0, 16);
  const isCash = channel === 'cash';

  payments.push({
    id:           'PAY-' + Date.now(),
    billId,
    memberId:     b.memberId,
    paidAt:       now,
    amount,
    channel,
    txRef,
    payerName:    document.getElementById('cp-name').value.trim(),
    slipPath:     null,
    status:       isCash ? 'approved' : 'pending',
    approvedBy:   isCash ? 'admin' : null,
    approvedAt:   isCash ? now : null,
    rejectReason: null,
  });

  if (isCash) b.status = 'paid';

  const newPay = payments[payments.length - 1];
  sbUpsertPayment(newPay);
  if (isCash) sbUpdateBillStatus(billId, 'paid');

  closeCashModal();
  saveToStorage();
  renderPayments();
  renderBilling();
  renderDebtors();

  const meta = _channelMeta[channel] || _channelMeta.cash;
  if (isCash) {
    toast(`รับเงินสด ฿${amount.toLocaleString()} — ${b.id}`, 'success');
  } else {
    toast(`บันทึก ${meta.title} ฿${amount.toLocaleString()} — รอยืนยันสลิป`, 'info');
  }
}
