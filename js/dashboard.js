function renderDashboard() {
  const totalMembers   = members.length;
  const normalMembers  = members.filter(m => m.status === 'normal').length;
  const overdueMembers = members.filter(m => m.status === 'overdue').length;

  const paidBills    = bills.filter(b => b.status === 'paid');
  const overdueBills = bills.filter(b => b.status === 'overdue');
  const pendingBills = bills.filter(b => b.status === 'pending');
  const totalBills   = bills.length;
  const collRate     = totalBills ? Math.round(paidBills.length / totalBills * 100) : 0;
  const totalUsage   = meterReadings.reduce((s, r) => s + r.usage, 0);

  // ─── Dashboard KPIs ───
  const dkpis = document.querySelectorAll('#page-dashboard .kpi-val');
  if (dkpis[0]) dkpis[0].textContent = totalMembers.toLocaleString();
  if (dkpis[1]) dkpis[1].textContent = collRate + '%';
  if (dkpis[2]) dkpis[2].textContent = totalUsage.toLocaleString() + ' m³';
  if (dkpis[3]) dkpis[3].textContent = overdueMembers + ' ราย';

  // ─── Members page KPIs ───
  const mkpis = document.querySelectorAll('#page-members .kpi-val');
  if (mkpis[0]) mkpis[0].textContent = totalMembers.toLocaleString();
  if (mkpis[1]) mkpis[1].textContent = normalMembers.toLocaleString();
  if (mkpis[2]) mkpis[2].textContent = overdueMembers.toLocaleString();
  const msub = document.querySelector('#page-members .page-sub');
  if (msub) msub.textContent = `จัดการฐานข้อมูลผู้ใช้น้ำ ${totalMembers.toLocaleString()} ราย ใน 4 หมู่บ้าน`;

  // ─── Dashboard subtitle with current period ───
  const psub = document.querySelector('#page-dashboard .page-sub');
  if (psub) psub.textContent = `สรุปภาพรวมระบบประปาหมู่บ้าน • ${currentPeriod()}`;

  // ─── Sidebar badges ───
  const badges = document.querySelectorAll('.nav-badge');
  if (badges[0]) badges[0].textContent = (overdueBills.length + pendingBills.length) || '';
  if (badges[1]) badges[1].textContent = overdueMembers || '';

  // ─── Dynamic widgets ───
  _updateDonutChart(paidBills.length, pendingBills.length, overdueBills.length, totalBills);
  _renderDashTopDebtors();
  _renderDashAnomalies();
  _renderDashBarChart();
  _renderDashVillages();
}

function _updateDonutChart(paid, pending, overdue, total) {
  const svg = document.querySelector('#page-dashboard svg');
  if (!svg || !total) return;
  const C = 276.46;
  const circles = svg.querySelectorAll('circle');
  if (circles.length < 4) return;
  const paidArc    = +(paid    / total * C).toFixed(1);
  const pendingArc = +(pending / total * C).toFixed(1);
  const overdueArc = +(overdue / total * C).toFixed(1);
  circles[1].setAttribute('stroke-dasharray', `${paidArc} ${C}`);
  circles[2].setAttribute('stroke-dasharray', `${pendingArc} ${C}`);
  circles[2].setAttribute('stroke-dashoffset', String(-paidArc));
  circles[3].setAttribute('stroke-dasharray', `${overdueArc} ${C}`);
  circles[3].setAttribute('stroke-dashoffset', String(-(paidArc + pendingArc)));
  const texts = svg.querySelectorAll('text');
  if (texts[1]) texts[1].textContent = total.toLocaleString();
  const ls = document.querySelectorAll('#page-dashboard .donut-legend-item strong');
  if (ls[0]) ls[0].textContent = `${Math.round(paid / total * 100)}% — ${paid} ราย`;
  if (ls[1]) ls[1].textContent = `${Math.round(pending / total * 100)}% — ${pending} ราย`;
  if (ls[2]) ls[2].textContent = `${Math.round(overdue / total * 100)}% — ${overdue} ราย`;
}

function _renderDashTopDebtors() {
  const tbody = document.querySelector('#page-dashboard .tbl-wrap tbody');
  if (!tbody) return;
  const overdueB = bills.filter(b => b.status === 'overdue');
  if (!overdueB.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--gray-500);padding:12px;font-size:12px">ไม่มีลูกหนี้ขณะนี้</td></tr>';
    return;
  }
  const grouped = {};
  const today = new Date();
  overdueB.forEach(b => {
    if (!grouped[b.memberId]) grouped[b.memberId] = { total: 0, oldest: b.dueDate };
    grouped[b.memberId].total += b.total;
    if (b.dueDate < grouped[b.memberId].oldest) grouped[b.memberId].oldest = b.dueDate;
  });
  tbody.innerHTML = Object.entries(grouped)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 3)
    .map(([mid, g]) => {
      const m  = members.find(x => x.id === parseInt(mid)) || {};
      const mo = Math.ceil((today - new Date(g.oldest)) / (86400000 * 30));
      return `<tr onclick="openMemberQuickView(${parseInt(mid)})" style="cursor:pointer">
        <td><div class="text-bold" style="font-size:12.5px">${esc((m.firstName || '') + ' ' + (m.lastName || ''))}</div><div class="text-muted" style="font-size:11px">${esc(m.houseNo || '')} ${esc(m.village || '')}</div></td>
        <td style="font-size:12px">${mo} เดือน</td>
        <td class="text-error text-bold" style="font-size:12.5px">฿${g.total.toLocaleString()}</td>
        <td><button class="btn btn-primary btn-xs" onclick="event.stopPropagation();notifyDebtor(${parseInt(mid)})">แจ้งเตือน</button></td>
      </tr>`;
    }).join('');
}

function _renderDashAnomalies() {
  const el      = document.getElementById('anomaly-list');
  const countEl = document.getElementById('anomaly-count');
  if (!el) return;
  const all    = meterReadings.filter(r => r.anomaly);
  if (countEl) countEl.textContent = all.length + ' เคส';
  const recent = [...all].sort((a, b) => b.readingDate.localeCompare(a.readingDate)).slice(0, 3);
  if (!recent.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--gray-500);padding:16px;font-size:12px">ไม่มีความผิดปกติ</div>';
    return;
  }
  const icons = { high_usage: 'ti-flame', suspected_leak: 'ti-droplet-exclamation', meter_fault: 'ti-gauge-off' };
  el.innerHTML = recent.map(r => {
    const m = members.find(x => x.id === r.memberId) || {};
    return `<div class="alert-item" style="cursor:pointer" onclick="gotoMeter('${esc((m.firstName || '') + ' ' + (m.lastName || ''))}','${esc(m.meter || '')}',${r.memberId})">
      <i class="ti ${icons[r.anomaly] || 'ti-alert-triangle'}"></i>
      <div>
        <div class="text-bold" style="font-size:13px">${esc(m.houseNo || 'บ้านเลขที่ —')} ${esc(m.village || '')}</div>
        <div style="font-size:12px;color:var(--red-700)">${esc(anomalyMap[r.anomaly] || r.anomaly)} • ${r.usage} m³ (${r.readingDate})</div>
      </div>
    </div>`;
  }).join('');
}

function _renderDashBarChart() {
  const el = document.getElementById('dash-bar-chart');
  if (!el) return;
  const monthly = {};
  bills.filter(b => b.status === 'paid').forEach(b => {
    monthly[b.period] = (monthly[b.period] || 0) + b.total;
  });
  const last8 = Object.keys(monthly).sort().slice(-8);
  if (!last8.length) return;
  const maxAmt = Math.max(...last8.map(p => monthly[p]));
  if (!maxAmt) return;
  el.innerHTML = last8.map(p => {
    const pct = Math.round(monthly[p] / maxAmt * 100);
    const lbl = p.split(' ')[0];
    return `<div class="bar-grp"><div class="bar-fill${pct === 100 ? ' hi' : ''}" style="height:${pct}%"></div><div class="bar-lbl">${esc(lbl)}</div></div>`;
  }).join('');
  const axisSpans = document.querySelectorAll('#page-dashboard .bar-chart-axis span');
  const maxPeriod = last8.find(p => monthly[p] === maxAmt);
  if (axisSpans[0]) axisSpans[0].textContent = `ยอดสูงสุด: ฿${maxAmt.toLocaleString()} (${maxPeriod || ''})`;
  if (axisSpans[1]) {
    const avg = Math.round(last8.reduce((s, p) => s + monthly[p], 0) / last8.length);
    axisSpans[1].textContent = `เฉลี่ย ฿${avg.toLocaleString()}/เดือน`;
  }
}

function _renderDashVillages() {
  const el = document.getElementById('dash-vbar-body');
  if (!el) return;
  const villageUsage = {};
  meterReadings.forEach(r => {
    const m = members.find(x => x.id === r.memberId);
    const v = m ? (m.village || 'อื่น ๆ') : 'อื่น ๆ';
    villageUsage[v] = (villageUsage[v] || 0) + r.usage;
  });
  const entries = Object.entries(villageUsage).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (!entries.length) return;
  const maxU   = entries[0][1];
  const colors = ['var(--blue-500)', 'var(--blue-300)', 'var(--blue-400)', 'var(--blue-200)'];
  el.innerHTML = entries.map(([v, u], i) =>
    `<div class="vbar-item"${i === entries.length - 1 ? ' style="margin-bottom:0"' : ''}>
      <div class="vbar-label"><span>${esc(v)}</span><strong>${u.toLocaleString()} m³</strong></div>
      <div class="vbar-track"><div class="vbar-fill" style="width:${Math.round(u / maxU * 100)}%;background:${colors[i]}"></div></div>
    </div>`
  ).join('');
}
