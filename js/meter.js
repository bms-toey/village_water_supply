// ─── Navigate to Meter Page ───
function gotoMeter(name, meterId, memberId) {
  currentMeterMemberId = memberId || null;
  document.getElementById('meter-hd-name').textContent = 'จดมิเตอร์: ' + name;
  document.getElementById('meter-hd-id').textContent   = 'รหัสมิเตอร์: ' + meterId + ' • ' + name;
  const inp = document.getElementById('meter-new-val');
  if (inp) { inp.value = ''; calcMeter(''); }
  if (memberId) {
    const m = members.find(x => x.id === memberId);
    const prevEl = document.getElementById('m-prev');
    if (prevEl && m) prevEl.textContent = Number(m.lastRead).toLocaleString();
    renderMeterHistory(memberId);
  }
  goPage('meter');
}

// ─── Live Calculation Preview ───
function calcMeter(val) {
  const member = currentMeterMemberId ? members.find(m => m.id === currentMeterMemberId) : null;
  const prev   = member ? Number(member.lastRead) : 0;
  const curr   = parseFloat(val);
  const uEl    = document.getElementById('m-usage');
  const eEl    = document.getElementById('m-est');
  const pEl    = document.getElementById('m-pct');
  const p2El   = document.getElementById('m-pct2');
  const prEl   = document.getElementById('m-prog');
  const wEl    = document.getElementById('meter-warn');
  if (!val || isNaN(curr) || curr <= prev) {
    [uEl, eEl].forEach(e => { if (e) e.textContent = '—'; });
    if (pEl)  pEl.textContent  = 'รอกรอกข้อมูล';
    if (p2El) p2El.textContent = '—';
    if (prEl) prEl.style.width = '0%';
    if (wEl)  wEl.style.display = 'none';
    return;
  }
  const usage   = curr - prev;
  const charges = calcWaterCharge(usage, member?.meterSize || '0.5');
  if (uEl)  uEl.textContent  = usage.toFixed(1) + ' m³';
  if (eEl)  eEl.textContent  = '฿' + charges.total.toLocaleString();
  const pct = Math.round((usage / 15) * 100);
  if (pEl)  pEl.textContent  = pct + '% ของค่าเฉลี่ย';
  if (p2El) p2El.textContent = pct + '%';
  if (prEl) prEl.style.width = Math.min(pct, 200) + '%';
  if (wEl)  wEl.style.display = usage > 45 ? 'block' : 'none';
}

// ─── Save Meter Reading & Create Bill ───
function saveMeter() {
  const v = document.getElementById('meter-new-val').value;
  if (!v) { toast('กรุณากรอกเลขมิเตอร์', 'error'); return; }
  const curr = parseFloat(v);
  if (!currentMeterMemberId) { toast('ไม่พบข้อมูลสมาชิก', 'error'); return; }
  const member = members.find(m => m.id === currentMeterMemberId);
  if (!member) { toast('ไม่พบข้อมูลสมาชิก', 'error'); return; }
  if (curr <= Number(member.lastRead)) { toast('เลขมิเตอร์ต้องมากกว่าค่าเดิม', 'error'); return; }
  const prev    = Number(member.lastRead);
  const usage   = Math.round(curr - prev);
  const charges = calcWaterCharge(usage, member.meterSize || '0.5');
  const today   = new Date().toISOString().split('T')[0];
  const period  = currentPeriod();

  // Reuse existing pending bill for this period instead of creating a duplicate
  const existingBill = bills.find(b =>
    b.memberId === currentMeterMemberId && b.period === period && b.status === 'pending'
  );
  const billId = existingBill ? existingBill.id : ('BILL-' + Date.now());

  meterReadings.push({
    id: 'MR-' + Date.now(),
    memberId: currentMeterMemberId,
    meter: member.meter,
    readingDate:   today,
    prevReading:   prev,
    currReading:   curr,
    usage,
    waterCharge:   charges.waterCharge,
    serviceCharge: charges.serviceCharge,
    total:         charges.total,
    readBy:  'ผู้ดูแลระบบ',
    method:  'manual',
    anomaly: usage > 45 ? 'high_usage' : null,
    billId,
  });

  if (existingBill) {
    existingBill.usage         = usage;
    existingBill.waterCharge   = charges.waterCharge;
    existingBill.serviceCharge = charges.serviceCharge;
    existingBill.total         = charges.total;
    existingBill.issueDate     = today;
  } else {
    const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 15);
    bills.push({
      id: billId,
      memberId:      currentMeterMemberId,
      period,
      issueDate:     today,
      dueDate:       dueDate.toISOString().split('T')[0],
      usage,
      waterCharge:   charges.waterCharge,
      serviceCharge: charges.serviceCharge,
      lateFee:  0,
      discount: 0,
      total:    charges.total,
      status:   'pending',
      sentVia:  '',
      issuedBy: 'admin',
    });
  }

  member.lastRead     = curr;
  member.lastReadDate = today;

  const savedReading = meterReadings[meterReadings.length - 1];
  const savedBill    = bills.find(b => b.id === billId);
  sbUpsertReading(savedReading);
  if (savedBill) sbUpsertBill(savedBill);
  sbUpdateMember(member);

  saveToStorage();
  toast(`บันทึกแล้ว — ${member.firstName} ใช้ ${usage} m³ ค่าน้ำ ฿${charges.total.toLocaleString()}`, 'success');
  goPage('billing');
}

// ─── Meter History Table ───
function renderMeterHistory(memberId) {
  const tbody = document.getElementById('meter-history-tbody');
  if (!tbody) return;
  const history = meterReadings
    .filter(r => r.memberId === memberId)
    .sort((a, b) => b.readingDate.localeCompare(a.readingDate))
    .slice(0, 6);
  if (!history.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--gray-500);padding:20px">ไม่มีประวัติการอ่านมิเตอร์</td></tr>';
    return;
  }
  tbody.innerHTML = history.map(r => `<tr>
    <td class="text-muted" style="font-size:12px">${r.readingDate}</td>
    <td class="mono">${r.prevReading.toLocaleString()}</td>
    <td class="mono text-bold" style="color:var(--blue-900)">${r.currReading.toLocaleString()}</td>
    <td><strong>${r.usage}</strong> m³</td>
    <td class="text-bold">฿${r.total.toLocaleString()}</td>
    <td>${r.anomaly
      ? `<span class="pill pill-overdue" style="font-size:10px;padding:2px 7px">${anomalyMap[r.anomaly] || r.anomaly}</span>`
      : '<span class="pill pill-normal"  style="font-size:10px;padding:2px 7px">ปกติ</span>'}</td>
    <td class="text-muted" style="font-size:11px">${methodMap[r.method] || r.method} · ${r.readBy}</td>
  </tr>`).join('');
}
