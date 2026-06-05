let _billSearch   = '';
let _billPeriod   = '';
let _billVillage  = '';
let _billStatusTab = null;

const billStatusMap = {
  paid:      { cls: 'pill-paid',    label: 'ชำระแล้ว' },
  overdue:   { cls: 'pill-overdue', label: 'ค้างชำระ' },
  pending:   { cls: 'pill-pending', label: 'รอยืนยัน' },
  cancelled: { cls: 'pill-closed',  label: 'ยกเลิก' },
};

// ─── Render Billing Table ───
function renderBilling(filterStatus) {
  if (filterStatus !== undefined) _billStatusTab = filterStatus;
  const tbody = document.querySelector('#page-billing .tbl-wrap table tbody');
  if (!tbody) return;
  let list = _billStatusTab ? bills.filter(b => b.status === _billStatusTab) : bills;
  if (_billSearch) {
    const q = _billSearch.toLowerCase();
    list = list.filter(b => {
      const m = members.find(x => x.id === b.memberId) || {};
      return b.id.toLowerCase().includes(q) || (m.firstName + ' ' + m.lastName).toLowerCase().includes(q);
    });
  }
  if (_billPeriod)  list = list.filter(b => b.period === _billPeriod);
  if (_billVillage) list = list.filter(b => { const m = members.find(x => x.id === b.memberId); return m && m.village === _billVillage; });
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--gray-500);padding:24px">ไม่มีข้อมูล</td></tr>';
  } else {
    tbody.innerHTML = list.map(b => {
      const m      = members.find(x => x.id === b.memberId) || {};
      const prev   = meterReadings.find(r => r.billId === b.id);
      const st     = billStatusMap[b.status] || billStatusMap.pending;
      const prevNum = prev ? prev.prevReading.toLocaleString() : '—';
      const currNum = prev ? prev.currReading.toLocaleString() : '—';
      const unpaid = b.status === 'overdue' || b.status === 'pending';
      const payBtn = unpaid
        ? `<button class="btn btn-primary btn-xs" onclick="openCashModalForBill('${esc(b.id)}')"><i class="ti ti-cash"></i>รับชำระ</button>`
        : '';
      const alertBtn = b.status === 'overdue'
        ? `<button class="btn-icon" style="color:var(--red-700);border-color:var(--red-100)" title="แจ้งเตือน" onclick="notifyBillDebtor(${b.memberId})"><i class="ti ti-bell-exclamation"></i></button>`
        : '';
      return `<tr>
        <td class="mono text-primary">${esc(b.id)}</td>
        <td><div class="text-bold">${esc(m.firstName || '')} ${esc(m.lastName || '')}</div><div class="text-muted" style="font-size:11px">${esc(m.houseNo || '')} ${esc(m.village || '')}</div></td>
        <td class="text-muted" style="font-family:'IBM Plex Mono',monospace;font-size:12px">${prevNum} → <strong style="color:var(--gray-900)">${currNum}</strong></td>
        <td><strong>${b.usage}</strong> m³</td>
        <td class="text-bold${b.status === 'overdue' ? ' text-error' : ''}">฿${b.total.toLocaleString()}</td>
        <td><span class="pill ${st.cls}">${st.label}</span></td>
        <td><div style="display:flex;gap:5px;justify-content:flex-end;align-items:center">
          ${payBtn}
          <button class="btn-icon" title="ดูใบแจ้งหนี้" onclick="openBillReceipt('${esc(b.id)}')"><i class="ti ti-receipt-2"></i></button>
          ${alertBtn}
        </div></td>
      </tr>`;
    }).join('');
  }
  // Footer count
  const footer = document.querySelector('#page-billing .tbl-footer span');
  if (footer) footer.textContent = `แสดง 1–${list.length} จาก ${bills.length} รายการ`;
  // KPI updates
  const totalAmount   = bills.reduce((s, b) => s + b.total, 0);
  const paidAmount    = bills.filter(b => b.status === 'paid').reduce((s, b) => s + b.total, 0);
  const overdueAmount = bills.filter(b => b.status === 'overdue').reduce((s, b) => s + b.total, 0);
  const overdueCount  = bills.filter(b => b.status === 'overdue').length;
  const kpis = document.querySelectorAll('#page-billing .kpi-val');
  if (kpis[0]) kpis[0].textContent = '฿' + totalAmount.toLocaleString();
  if (kpis[1]) kpis[1].textContent = '฿' + paidAmount.toLocaleString();
  if (kpis[2]) kpis[2].textContent = '฿' + overdueAmount.toLocaleString();
  const overdueKpiBadge = document.querySelector('#page-billing .kpi-card:nth-child(3) .kpi-badge');
  if (overdueKpiBadge) overdueKpiBadge.textContent = overdueCount + ' รายการ →';
}

// ─── Auto-create Bills for Current Period ───
function autoBill() {
  const period  = currentPeriod();
  const billed  = new Set(bills.filter(b => b.period === period).map(b => b.memberId));
  const unbilled = members.filter(m => m.status !== 'closed' && !billed.has(m.id));
  if (!unbilled.length) { toast('ทุกสมาชิกมีบิลสำหรับรอบนี้แล้ว', 'info'); return; }
  const today   = new Date().toISOString().split('T')[0];
  const due     = new Date(); due.setDate(due.getDate() + 15);
  const dueDate = due.toISOString().split('T')[0];
  unbilled.forEach(m => {
    const svc = (m.meterSize === '1' || m.meterSize === '1.5') ? rateConfig.svcLarge : rateConfig.svcSmall;
    bills.push({
      id: 'BILL-' + Date.now() + '-' + m.id,
      memberId: m.id, period,
      issueDate: today, dueDate,
      usage: 0, waterCharge: 0,
      serviceCharge: svc,
      lateFee: 0, discount: 0,
      total: svc,
      status: 'pending', sentVia: '', issuedBy: 'admin',
    });
  });
  const newBills = bills.filter(b => b.period === period && unbilled.some(m => m.id === b.memberId));
  sbUpsertBills(newBills);
  saveToStorage();
  renderBilling();
  toast(`สร้างบิล ${unbilled.length} รายการ สำหรับรอบ ${period}`, 'success');
}

// ─── Bill Receipt Modal ───
function openBillReceipt(billId) {
  const b  = bills.find(x => x.id === billId); if (!b) return;
  const m  = members.find(x => x.id === b.memberId) || {};
  const mr = meterReadings.find(r => r.billId === billId);
  const st = billStatusMap[b.status] || billStatusMap.pending;
  const pay = payments.find(p => p.billId === billId && p.status === 'approved');
  const body = document.getElementById('receipt-body');
  if (!body) return;
  body.innerHTML = `
  <div style="text-align:center;padding:0 0 16px;border-bottom:2px solid var(--gray-100);margin-bottom:16px">
    <div style="font-size:20px;font-weight:800;color:var(--blue-900)"><i class="ti ti-droplet-filled" style="color:var(--blue-500)"></i> AquaFlow Pro</div>
    <div style="font-size:12px;color:var(--gray-500);margin-top:2px">ใบแจ้งหนี้ค่าน้ำประปาหมู่บ้าน</div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;font-size:12.5px">
    <div><div class="text-muted" style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">เลขที่บิล</div><div class="text-bold mono" style="font-size:12px;margin-top:3px">${esc(b.id)}</div></div>
    <div><div class="text-muted" style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">รอบบิล</div><div class="text-bold" style="margin-top:3px">${esc(b.period)}</div></div>
    <div><div class="text-muted" style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">วันที่ออก</div><div style="margin-top:3px">${b.issueDate}</div></div>
    <div><div class="text-muted" style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">กำหนดชำระ</div><div style="margin-top:3px" class="${b.status === 'overdue' ? 'text-error text-bold' : ''}">${b.dueDate}</div></div>
  </div>
  <div style="background:var(--gray-50);border-radius:var(--radius-md);padding:12px 14px;margin-bottom:16px">
    <div class="text-bold" style="font-size:14px;margin-bottom:5px">${esc((m.firstName || '') + ' ' + (m.lastName || ''))}</div>
    <div class="text-muted" style="font-size:12px">${esc(m.houseNo || '')} ${esc(m.village || '')}</div>
    <div class="text-muted" style="font-size:12px">มิเตอร์: <span class="mono">${esc(m.meter || '—')}</span></div>
  </div>
  ${mr ? `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;text-align:center">
    <div style="background:var(--gray-50);padding:10px 8px;border-radius:var(--radius-md)"><div class="text-muted" style="font-size:10px;margin-bottom:3px">เลขก่อน</div><div class="text-bold mono">${mr.prevReading.toLocaleString()}</div></div>
    <div style="background:var(--blue-50);padding:10px 8px;border-radius:var(--radius-md)"><div class="text-muted" style="font-size:10px;margin-bottom:3px">เลขหลัง</div><div class="text-bold mono" style="color:var(--blue-900)">${mr.currReading.toLocaleString()}</div></div>
    <div style="background:var(--cyan-50);padding:10px 8px;border-radius:var(--radius-md)"><div class="text-muted" style="font-size:10px;margin-bottom:3px">หน่วยที่ใช้</div><div class="text-bold" style="color:var(--cyan-800)">${b.usage} m³</div></div>
  </div>` : ''}
  <div style="border-top:1px solid var(--gray-100);padding-top:12px;font-size:13px">
    <div style="display:flex;justify-content:space-between;padding:5px 0;color:var(--gray-700)"><span>ค่าน้ำ (${b.usage} m³)</span><span>฿${(b.waterCharge || 0).toLocaleString()}</span></div>
    <div style="display:flex;justify-content:space-between;padding:5px 0;color:var(--gray-700)"><span>ค่าบริการรายเดือน</span><span>฿${(b.serviceCharge || 0).toLocaleString()}</span></div>
    ${b.lateFee  ? `<div style="display:flex;justify-content:space-between;padding:5px 0"><span class="text-muted">ค่าปรับล่าช้า</span><span class="text-error">+฿${b.lateFee.toLocaleString()}</span></div>` : ''}
    ${b.discount ? `<div style="display:flex;justify-content:space-between;padding:5px 0"><span class="text-muted">ส่วนลด</span><span style="color:var(--green-700)">-฿${b.discount.toLocaleString()}</span></div>` : ''}
    <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:2px solid var(--gray-200);margin-top:5px">
      <span class="text-bold" style="font-size:15px">รวมสุทธิ</span>
      <span class="text-bold" style="font-size:20px;color:var(--blue-900)">฿${b.total.toLocaleString()}</span>
    </div>
  </div>
  <div style="text-align:center;margin-top:14px">
    <span class="pill ${st.cls}" style="font-size:13px;padding:5px 18px">${st.label}</span>
    ${pay ? `<div class="text-muted" style="font-size:11px;margin-top:6px">ชำระเมื่อ ${pay.paidAt} · ${channelMap[pay.channel]?.label || pay.channel}</div>` : ''}
  </div>`;
  document.getElementById('receipt-modal').style.display = 'flex';
}

function closeReceiptModal() { document.getElementById('receipt-modal').style.display = 'none'; }

function printReceipt() {
  const body = document.getElementById('receipt-body');
  if (!body) return;
  const w = window.open('', '_blank', 'width=520,height=780');
  w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"/><title>ใบแจ้งหนี้</title>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet"/>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Sarabun',sans-serif;font-size:14px;color:#111;padding:28px;max-width:440px;margin:0 auto}
  .text-bold{font-weight:700}.text-muted{color:#666}.text-error{color:#ba1a1a}.text-primary{color:#00236f}
  .mono{font-family:'IBM Plex Mono',monospace;font-size:12px}.pill{display:inline-block;padding:4px 16px;border-radius:20px;font-weight:700;font-size:12px}
  .pill-paid{background:#dcfce7;color:#15803d}.pill-overdue{background:#ffdad6;color:#ba1a1a}.pill-pending{background:#fef3c7;color:#b45309}
  i[class*="ti"]{display:none}</style></head><body>${body.innerHTML}</body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 400);
}
