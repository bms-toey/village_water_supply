let _currentReport = 'income';

// ─── Switch Report Type ───
function switchReport(type) {
  _currentReport = type;
  document.querySelectorAll('#page-reports .rpt-card').forEach(c => {
    c.classList.toggle('active-rpt', c.dataset.report === type);
  });
  renderReports();
}

// ─── Render Reports Page ───
function renderReports() {
  const curPeriod      = currentPeriod();
  const thisMonthPaid  = bills.filter(b => b.status === 'paid' && b.period === curPeriod);
  const thisMonthIncome = thisMonthPaid.reduce((s, b) => s + b.total, 0);
  const totalUsage     = meterReadings.reduce((s, r) => s + r.usage, 0);
  const overdueTotal   = bills.filter(b => b.status === 'overdue').reduce((s, b) => s + b.total, 0);
  const anomalyCount   = meterReadings.filter(r => r.anomaly).length;
  const rkpis = document.querySelectorAll('#page-reports .kpi-val');
  if (rkpis[0]) rkpis[0].textContent = '฿' + thisMonthIncome.toLocaleString();
  if (rkpis[1]) rkpis[1].textContent = '฿' + overdueTotal.toLocaleString();
  if (rkpis[2]) rkpis[2].textContent = totalUsage.toLocaleString() + ' m³';
  if (rkpis[3]) rkpis[3].textContent = anomalyCount + ' เคส';

  const titles = {
    income:     'รายรับรายเดือน',
    debtors:    'ลูกหนี้ค้างชำระ',
    usage:      'การใช้น้ำรายสมาชิก',
    anomaly:    'AI ตรวจจับความผิดปกติ',
    newmembers: 'ผู้ใช้น้ำใหม่',
    history:    'ประวัติจดมิเตอร์',
    village:    'สรุปแต่ละหมู่บ้าน',
    billing:    'รายงานบิลรวม',
  };
  const cardTitle = document.querySelector('#page-reports .card .card-title');
  if (cardTitle) cardTitle.innerHTML = `<i class="ti ti-table" style="color:var(--blue-500)"></i>พรีวิวข้อมูล: ${titles[_currentReport] || ''}`;

  const tbody = document.querySelector('#page-reports .tbl-wrap table tbody');
  const thead = document.querySelector('#page-reports .tbl-wrap table thead tr');
  const rfoot = document.querySelector('#page-reports .tbl-footer span');
  if (!tbody || !thead) return;

  const fn = {
    income:     _rptIncome,
    debtors:    _rptDebtors,
    usage:      _rptUsage,
    anomaly:    _rptAnomaly,
    newmembers: _rptNewMembers,
    history:    _rptHistory,
    village:    _rptVillage,
    billing:    _rptBilling,
  };
  (fn[_currentReport] || _rptIncome)(tbody, thead, rfoot);
}

function _rptIncome(tbody, thead, rfoot) {
  thead.innerHTML = '<th>รอบบิล</th><th>บิลทั้งหมด</th><th>ชำระแล้ว</th><th>ค้างชำระ</th><th>รอยืนยัน</th><th style="text-align:right">รายรับรวม (บาท)</th>';
  const monthly = {};
  bills.forEach(b => {
    if (!monthly[b.period]) monthly[b.period] = { total: 0, paid: 0, overdue: 0, pending: 0, income: 0 };
    monthly[b.period].total++;
    if (b.status === 'paid')    { monthly[b.period].paid++;    monthly[b.period].income += b.total; }
    if (b.status === 'overdue')   monthly[b.period].overdue++;
    if (b.status === 'pending')   monthly[b.period].pending++;
  });
  const rows = Object.entries(monthly).sort((a, b) => b[0].localeCompare(a[0]));
  tbody.innerHTML = rows.map(([p, d]) => `<tr>
    <td class="text-bold">${esc(p)}</td>
    <td>${d.total}</td>
    <td style="color:var(--green-700);font-weight:600">${d.paid}</td>
    <td class="${d.overdue ? 'text-error text-bold' : 'text-muted'}">${d.overdue}</td>
    <td class="${d.pending ? 'text-bold' : 'text-muted'}" style="${d.pending ? 'color:var(--amber-700)' : ''}">${d.pending}</td>
    <td style="text-align:right" class="text-bold">฿${d.income.toLocaleString()}</td>
  </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--gray-500);padding:20px">ไม่มีข้อมูล</td></tr>';
  if (rfoot) rfoot.textContent = `แสดง ${rows.length} รอบบิล`;
}

function _rptDebtors(tbody, thead, rfoot) {
  thead.innerHTML = '<th>สมาชิก</th><th>บ้านเลขที่</th><th>เลขบิล</th><th>รอบบิล</th><th>กำหนดชำระ</th><th style="text-align:right">ยอดค้าง (บาท)</th>';
  const overdue = bills.filter(b => b.status === 'overdue').sort((a, b) => b.total - a.total);
  tbody.innerHTML = overdue.map(b => {
    const m = members.find(x => x.id === b.memberId) || {};
    return `<tr>
      <td class="text-bold">${esc((m.firstName || '') + ' ' + (m.lastName || ''))}</td>
      <td class="text-muted">${esc(m.houseNo || '—')} ${esc(m.village || '')}</td>
      <td class="mono text-muted" style="font-size:11px">${esc(b.id)}</td>
      <td>${esc(b.period)}</td>
      <td class="text-error" style="font-size:12px">${b.dueDate}</td>
      <td style="text-align:right" class="text-error text-bold">฿${b.total.toLocaleString()}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--gray-500);padding:20px">ไม่มีลูกหนี้</td></tr>';
  if (rfoot) rfoot.textContent = `แสดง ${overdue.length} รายการค้างชำระ`;
}

function _rptUsage(tbody, thead, rfoot) {
  thead.innerHTML = '<th>สมาชิก</th><th>หมู่บ้าน</th><th>มิเตอร์</th><th style="text-align:right">หน่วยรวม (m³)</th><th style="text-align:right">ค่าน้ำรวม (บาท)</th>';
  const usage = {};
  meterReadings.forEach(r => {
    if (!usage[r.memberId]) usage[r.memberId] = { u: 0, c: 0 };
    usage[r.memberId].u += r.usage;
    usage[r.memberId].c += r.waterCharge;
  });
  const rows = Object.entries(usage).sort((a, b) => b[1].u - a[1].u);
  tbody.innerHTML = rows.map(([mid, d]) => {
    const m = members.find(x => x.id === parseInt(mid)) || {};
    return `<tr>
      <td class="text-bold">${esc((m.firstName || '') + ' ' + (m.lastName || ''))}</td>
      <td class="text-muted">${esc(m.village || '—')}</td>
      <td class="mono" style="font-size:11px">${esc(m.meter || '—')}</td>
      <td style="text-align:right" class="text-bold">${d.u.toLocaleString()}</td>
      <td style="text-align:right">฿${d.c.toLocaleString()}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--gray-500);padding:20px">ไม่มีข้อมูล</td></tr>';
  if (rfoot) rfoot.textContent = `แสดง ${rows.length} สมาชิก`;
}

function _rptAnomaly(tbody, thead, rfoot) {
  thead.innerHTML = '<th>วันที่</th><th>สมาชิก</th><th>มิเตอร์</th><th>ประเภท</th><th style="text-align:right">หน่วยที่ใช้ (m³)</th><th>วิธีอ่าน</th>';
  const anomalies = meterReadings.filter(r => r.anomaly).sort((a, b) => b.readingDate.localeCompare(a.readingDate));
  tbody.innerHTML = anomalies.map(r => {
    const m = members.find(x => x.id === r.memberId) || {};
    return `<tr>
      <td class="text-muted" style="font-size:12px">${r.readingDate}</td>
      <td class="text-bold">${esc((m.firstName || '') + ' ' + (m.lastName || ''))}</td>
      <td class="mono" style="font-size:11px">${esc(r.meter || '—')}</td>
      <td><span class="pill pill-overdue" style="font-size:10px;padding:2px 7px">${esc(anomalyMap[r.anomaly] || r.anomaly)}</span></td>
      <td style="text-align:right" class="${r.anomaly === 'high_usage' ? 'text-error text-bold' : 'text-bold'}">${r.usage}</td>
      <td class="text-muted" style="font-size:11px">${methodMap[r.method] || r.method}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--gray-500);padding:20px">ไม่พบความผิดปกติ</td></tr>';
  if (rfoot) rfoot.textContent = `แสดง ${anomalies.length} เคส`;
}

function _rptNewMembers(tbody, thead, rfoot) {
  thead.innerHTML = '<th>สมาชิก</th><th>ประเภท</th><th>หมู่บ้าน</th><th>มิเตอร์</th><th>วันที่สมัคร</th><th>สถานะ</th>';
  const sorted = [...members].sort((a, b) => (b.registrationDate || '').localeCompare(a.registrationDate || '')).slice(0, 20);
  tbody.innerHTML = sorted.map(m => {
    const st = statusMap[m.status] || statusMap.normal;
    const mt = memberTypeMap[m.memberType] || memberTypeMap.residential;
    return `<tr>
      <td class="text-bold">${esc(m.firstName + ' ' + m.lastName)}</td>
      <td><span class="mtype-badge ${mt.cls}">${mt.label}</span></td>
      <td class="text-muted">${esc(m.village)}</td>
      <td class="mono" style="font-size:11px">${esc(m.meter)}</td>
      <td class="text-muted" style="font-size:12px">${m.registrationDate || '—'}</td>
      <td><span class="pill ${st.cls}">${st.label}</span></td>
    </tr>`;
  }).join('');
  if (rfoot) rfoot.textContent = `แสดง ${sorted.length} จาก ${members.length} สมาชิก (ล่าสุด)`;
}

function _rptHistory(tbody, thead, rfoot) {
  thead.innerHTML = '<th>วันที่อ่าน</th><th>สมาชิก</th><th>มิเตอร์</th><th>ก่อน → หลัง</th><th style="text-align:right">หน่วยใช้</th><th style="text-align:right">ค่าน้ำ</th><th>สถานะ</th>';
  const sorted = [...meterReadings].sort((a, b) => b.readingDate.localeCompare(a.readingDate)).slice(0, 50);
  tbody.innerHTML = sorted.map(r => {
    const m = members.find(x => x.id === r.memberId) || {};
    return `<tr>
      <td class="text-muted" style="font-size:12px">${r.readingDate}</td>
      <td class="text-bold">${esc((m.firstName || '') + ' ' + (m.lastName || ''))}</td>
      <td class="mono" style="font-size:11px">${esc(r.meter || '—')}</td>
      <td class="text-muted" style="font-family:'IBM Plex Mono',monospace;font-size:12px">${r.prevReading.toLocaleString()} → <strong style="color:var(--gray-900)">${r.currReading.toLocaleString()}</strong></td>
      <td style="text-align:right" class="text-bold">${r.usage}</td>
      <td style="text-align:right" class="text-bold">฿${r.total.toLocaleString()}</td>
      <td>${r.anomaly
        ? `<span class="pill pill-overdue" style="font-size:10px;padding:2px 7px">${esc(anomalyMap[r.anomaly] || r.anomaly)}</span>`
        : '<span class="pill pill-normal" style="font-size:10px;padding:2px 7px">ปกติ</span>'}</td>
    </tr>`;
  }).join('');
  if (rfoot) rfoot.textContent = `แสดง ${sorted.length} จาก ${meterReadings.length} รายการ`;
}

function _rptVillage(tbody, thead, rfoot) {
  thead.innerHTML = '<th>หมู่บ้าน</th><th>สมาชิก</th><th>สถานะปกติ</th><th>ค้างชำระ</th><th style="text-align:right">หน่วยน้ำรวม (m³)</th><th style="text-align:right">รายรับรวม (บาท)</th>';
  const vdata = {};
  members.forEach(m => {
    if (!vdata[m.village]) vdata[m.village] = { count: 0, normal: 0, overdue: 0, usage: 0, income: 0 };
    vdata[m.village].count++;
    if (m.status === 'normal')  vdata[m.village].normal++;
    if (m.status === 'overdue') vdata[m.village].overdue++;
  });
  meterReadings.forEach(r => {
    const m = members.find(x => x.id === r.memberId);
    if (m && vdata[m.village]) vdata[m.village].usage += r.usage;
  });
  bills.filter(b => b.status === 'paid').forEach(b => {
    const m = members.find(x => x.id === b.memberId);
    if (m && vdata[m.village]) vdata[m.village].income += b.total;
  });
  const rows = Object.entries(vdata).sort((a, b) => b[1].count - a[1].count);
  tbody.innerHTML = rows.map(([v, d]) => `<tr>
    <td class="text-bold">${esc(v)}</td>
    <td>${d.count} ราย</td>
    <td style="color:var(--green-700)">${d.normal}</td>
    <td class="${d.overdue ? 'text-error text-bold' : 'text-muted'}">${d.overdue}</td>
    <td style="text-align:right">${d.usage.toLocaleString()}</td>
    <td style="text-align:right" class="text-bold">฿${d.income.toLocaleString()}</td>
  </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--gray-500);padding:20px">ไม่มีข้อมูล</td></tr>';
  if (rfoot) rfoot.textContent = `แสดง ${rows.length} หมู่บ้าน`;
}

function _rptBilling(tbody, thead, rfoot) {
  thead.innerHTML = '<th>เลขบิล</th><th>สมาชิก</th><th>รอบบิล</th><th>วันที่ออก</th><th style="text-align:right">หน่วย</th><th style="text-align:right">ยอดสุทธิ</th><th>สถานะ</th>';
  const sorted = [...bills].sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  tbody.innerHTML = sorted.map(b => {
    const m  = members.find(x => x.id === b.memberId) || {};
    const st = billStatusMap[b.status] || billStatusMap.pending;
    return `<tr>
      <td class="mono text-muted" style="font-size:11px">${esc(b.id)}</td>
      <td class="text-bold">${esc((m.firstName || '') + ' ' + (m.lastName || ''))}</td>
      <td>${esc(b.period)}</td>
      <td class="text-muted" style="font-size:12px">${b.issueDate}</td>
      <td style="text-align:right">${b.usage} m³</td>
      <td style="text-align:right" class="text-bold${b.status === 'overdue' ? ' text-error' : ''}">฿${b.total.toLocaleString()}</td>
      <td><span class="pill ${st.cls}">${st.label}</span></td>
    </tr>`;
  }).join('');
  if (rfoot) rfoot.textContent = `แสดง 1–${sorted.length} จาก ${bills.length} บิล`;
}

// ─── Export current report as CSV ───
function exportCurrentReport() {
  const map = {
    income:     _csvIncome,
    debtors:    _csvDebtors,
    usage:      _csvUsage,
    anomaly:    _csvAnomaly,
    newmembers: exportMembersCSV,
    history:    _csvHistory,
    village:    _csvVillage,
    billing:    exportBillingCSV,
  };
  (map[_currentReport] || exportBillingCSV)();
}

function _csvIncome() {
  const monthly = {};
  bills.forEach(b => {
    if (!monthly[b.period]) monthly[b.period] = { total: 0, paid: 0, overdue: 0, income: 0 };
    monthly[b.period].total++;
    if (b.status === 'paid')    { monthly[b.period].paid++;    monthly[b.period].income += b.total; }
    if (b.status === 'overdue')   monthly[b.period].overdue++;
  });
  const rows = [['รอบบิล', 'บิลทั้งหมด', 'ชำระแล้ว', 'ค้างชำระ', 'รายรับรวม']];
  Object.entries(monthly).sort((a, b) => b[0].localeCompare(a[0])).forEach(([p, d]) =>
    rows.push([p, d.total, d.paid, d.overdue, d.income]));
  exportCSV(rows, 'income_monthly.csv');
  toast('Export รายรับรายเดือนแล้ว', 'success');
}
function _csvDebtors() {
  const rows = [['สมาชิก', 'บ้านเลขที่', 'หมู่บ้าน', 'เลขบิล', 'รอบบิล', 'กำหนดชำระ', 'ยอดค้าง']];
  bills.filter(b => b.status === 'overdue').forEach(b => {
    const m = members.find(x => x.id === b.memberId) || {};
    rows.push([(m.firstName || '') + ' ' + (m.lastName || ''), m.houseNo || '', m.village || '', b.id, b.period, b.dueDate, b.total]);
  });
  exportCSV(rows, 'debtors.csv');
  toast('Export ลูกหนี้แล้ว', 'success');
}
function _csvUsage() {
  const usage = {};
  meterReadings.forEach(r => { if (!usage[r.memberId]) usage[r.memberId] = { u: 0, c: 0 }; usage[r.memberId].u += r.usage; usage[r.memberId].c += r.waterCharge; });
  const rows = [['สมาชิก', 'หมู่บ้าน', 'มิเตอร์', 'หน่วยรวม (m³)', 'ค่าน้ำรวม']];
  Object.entries(usage).forEach(([mid, d]) => { const m = members.find(x => x.id === parseInt(mid)) || {}; rows.push([(m.firstName || '') + ' ' + (m.lastName || ''), m.village || '', m.meter || '', d.u, d.c]); });
  exportCSV(rows, 'water_usage.csv');
  toast('Export การใช้น้ำแล้ว', 'success');
}
function _csvAnomaly() {
  const rows = [['วันที่', 'สมาชิก', 'มิเตอร์', 'ประเภทผิดปกติ', 'หน่วยที่ใช้']];
  meterReadings.filter(r => r.anomaly).forEach(r => { const m = members.find(x => x.id === r.memberId) || {}; rows.push([r.readingDate, (m.firstName || '') + ' ' + (m.lastName || ''), r.meter || '', anomalyMap[r.anomaly] || r.anomaly, r.usage]); });
  exportCSV(rows, 'anomalies.csv');
  toast('Export ความผิดปกติแล้ว', 'success');
}
function _csvHistory() {
  const rows = [['วันที่', 'สมาชิก', 'มิเตอร์', 'เลขก่อน', 'เลขหลัง', 'หน่วย', 'ค่าน้ำ']];
  meterReadings.forEach(r => { const m = members.find(x => x.id === r.memberId) || {}; rows.push([r.readingDate, (m.firstName || '') + ' ' + (m.lastName || ''), r.meter || '', r.prevReading, r.currReading, r.usage, r.total]); });
  exportCSV(rows, 'meter_history.csv');
  toast('Export ประวัติมิเตอร์แล้ว', 'success');
}
function _csvVillage() {
  const vdata = {};
  members.forEach(m => { if (!vdata[m.village]) vdata[m.village] = { count: 0, normal: 0, overdue: 0, usage: 0, income: 0 }; vdata[m.village].count++; if (m.status === 'normal') vdata[m.village].normal++; if (m.status === 'overdue') vdata[m.village].overdue++; });
  meterReadings.forEach(r => { const m = members.find(x => x.id === r.memberId); if (m && vdata[m.village]) vdata[m.village].usage += r.usage; });
  bills.filter(b => b.status === 'paid').forEach(b => { const m = members.find(x => x.id === b.memberId); if (m && vdata[m.village]) vdata[m.village].income += b.total; });
  const rows = [['หมู่บ้าน', 'สมาชิก', 'ปกติ', 'ค้างชำระ', 'หน่วยน้ำรวม', 'รายรับรวม']];
  Object.entries(vdata).forEach(([v, d]) => rows.push([v, d.count, d.normal, d.overdue, d.usage, d.income]));
  exportCSV(rows, 'village_summary.csv');
  toast('Export สรุปหมู่บ้านแล้ว', 'success');
}

// ─── CSV Export ───
function exportCSV(rows, filename) {
  const csv  = rows.map(r => r.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportMembersCSV() {
  const rows = [['รหัส', 'ชื่อ', 'นามสกุล', 'ประเภท', 'หมู่บ้าน', 'บ้านเลขที่', 'มิเตอร์', 'ขนาดมิเตอร์', 'สถานะ', 'โทรศัพท์']];
  members.forEach(m => rows.push([m.id, m.firstName, m.lastName, m.memberType, m.village, m.houseNo, m.meter, meterSizeMap[m.meterSize] || m.meterSize, m.status, m.phone || '']));
  exportCSV(rows, 'members.csv');
  toast('Export สมาชิกแล้ว', 'success');
}

function exportBillingCSV() {
  const rows = [['เลขบิล', 'สมาชิก', 'รอบ', 'วันที่ออก', 'กำหนดชำระ', 'หน่วย m³', 'ค่าน้ำ', 'ค่าบริการ', 'ค่าปรับ', 'รวม', 'สถานะ']];
  bills.forEach(b => {
    const m = members.find(x => x.id === b.memberId) || {};
    rows.push([b.id, (m.firstName || '') + ' ' + (m.lastName || ''), b.period, b.issueDate, b.dueDate, b.usage, b.waterCharge, b.serviceCharge, b.lateFee, b.total, b.status]);
  });
  exportCSV(rows, 'billing.csv');
  toast('Export บิลแล้ว', 'success');
}
