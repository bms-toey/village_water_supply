// ─── Dashboard Module ──────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc } from '../../utils/dom.util.js';
import { currentPeriod } from '../../utils/date.util.js';
import { anomalyMap } from '../../config/ui.config.js';

export function renderDashboard() {
  const { members, bills, meterReadings } = appState;
  const totalMembers   = members.length;
  const normalMembers  = members.filter(m => m.status === 'normal').length;
  const overdueMembers = members.filter(m => m.status === 'overdue').length;
  const paidBills    = bills.filter(b => b.status === 'paid');
  const overdueBills = bills.filter(b => b.status === 'overdue');
  const pendingBills = bills.filter(b => b.status === 'pending');
  const totalBills   = bills.length;
  const collRate     = totalBills ? Math.round(paidBills.length / totalBills * 100) : 0;
  const totalUsage   = meterReadings.reduce((s, r) => s + r.usage, 0);

  const dkpis = document.querySelectorAll('#page-dashboard .kpi-val');
  if (dkpis[0]) dkpis[0].textContent = totalMembers.toLocaleString();
  if (dkpis[1]) dkpis[1].textContent = collRate + '%';
  if (dkpis[2]) dkpis[2].textContent = totalUsage.toLocaleString() + ' m³';
  if (dkpis[3]) dkpis[3].textContent = overdueMembers + ' ราย';

  const mkpis = document.querySelectorAll('#page-members .kpi-val');
  if (mkpis[0]) mkpis[0].textContent = totalMembers.toLocaleString();
  if (mkpis[1]) mkpis[1].textContent = normalMembers.toLocaleString();
  if (mkpis[2]) mkpis[2].textContent = overdueMembers.toLocaleString();
  // Water usage KPI (4th card)
  if (mkpis[3]) {
    const usageK = totalUsage >= 1000 ? (totalUsage / 1000).toFixed(1) + 'K' : totalUsage.toLocaleString();
    mkpis[3].innerHTML = `${usageK} <span style="font-size:14px">m³</span>`;
  }
  // Village count badge (1st card footer)
  const villageCount = new Set(members.map(m => m.village).filter(Boolean)).size;
  const kb1 = document.querySelector('#page-members .kpi-card:first-child .kpi-badge');
  if (kb1) kb1.textContent = villageCount + ' หมู่บ้าน';
  // Normal percentage badge (2nd card footer)
  const kb2 = document.querySelector('#page-members .kpi-card:nth-child(2) .kpi-badge');
  if (kb2) kb2.textContent = totalMembers ? Math.round(normalMembers / totalMembers * 100) + '%' : '0%';
  const msub = document.querySelector('#page-members .page-sub');
  if (msub) msub.textContent = `จัดการฐานข้อมูลผู้ใช้น้ำ ${totalMembers.toLocaleString()} ราย ใน ${villageCount} หมู่บ้าน`;

  const psub = document.querySelector('#page-dashboard .page-sub');
  if (psub) psub.textContent = `สรุปภาพรวมระบบประปาหมู่บ้าน • ${currentPeriod()}`;

  const billingBadge = document.getElementById('billing-badge');
  const debtorsBadge = document.getElementById('debtors-badge');
  if (billingBadge) billingBadge.textContent = (overdueBills.length + pendingBills.length) || '';
  if (debtorsBadge) debtorsBadge.textContent = overdueMembers || '';

  _updateDonutChart(paidBills.length, pendingBills.length, overdueBills.length, totalBills);
  _renderDashTopDebtors();
  _renderDashAnomalies();
  _renderDashBarChart();
  _renderDashVillages();
}

function _updateDonutChart(paid, pending, overdue, total) {
  const svg = document.querySelector('#page-dashboard svg');
  if (!svg) return;
  const C = 276.46;
  const circles = svg.querySelectorAll('circle');
  if (circles.length < 4) return;
  const texts = svg.querySelectorAll('text');
  const ls = document.querySelectorAll('#page-dashboard .donut-legend-item strong');
  if (!total) {
    circles[1].setAttribute('stroke-dasharray', `0 ${C}`);
    circles[2].setAttribute('stroke-dasharray', `0 ${C}`);
    circles[3].setAttribute('stroke-dasharray', `0 ${C}`);
    if (texts[1]) texts[1].textContent = '0';
    if (ls[0]) ls[0].textContent = '0% — 0 ราย';
    if (ls[1]) ls[1].textContent = '0% — 0 ราย';
    if (ls[2]) ls[2].textContent = '0% — 0 ราย';
    return;
  }
  const paidArc    = +(paid    / total * C).toFixed(1);
  const pendingArc = +(pending / total * C).toFixed(1);
  const overdueArc = +(overdue / total * C).toFixed(1);
  circles[1].setAttribute('stroke-dasharray', `${paidArc} ${C}`);
  circles[2].setAttribute('stroke-dasharray', `${pendingArc} ${C}`);
  circles[2].setAttribute('stroke-dashoffset', String(-paidArc));
  circles[3].setAttribute('stroke-dasharray', `${overdueArc} ${C}`);
  circles[3].setAttribute('stroke-dashoffset', String(-(paidArc + pendingArc)));
  if (texts[1]) texts[1].textContent = total.toLocaleString();
  if (ls[0]) ls[0].textContent = `${Math.round(paid / total * 100)}% — ${paid} ราย`;
  if (ls[1]) ls[1].textContent = `${Math.round(pending / total * 100)}% — ${pending} ราย`;
  if (ls[2]) ls[2].textContent = `${Math.round(overdue / total * 100)}% — ${overdue} ราย`;
}

function _renderDashTopDebtors() {
  const tbody = document.querySelector('#page-dashboard .tbl-wrap tbody');
  if (!tbody) return;
  const { bills, members } = appState;
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
    .sort((a, b) => b[1].total - a[1].total).slice(0, 3)
    .map(([mid, g]) => {
      const m  = members.find(x => x.id === parseInt(mid)) || {};
      const mo = Math.ceil((today - new Date(g.oldest)) / (86400000 * 30));
      return `<tr onclick="openMemberQuickView(${parseInt(mid)})" style="cursor:pointer">
        <td><div class="text-bold" style="font-size:12.5px">${esc((m.firstName||'')+' '+(m.lastName||''))}</div><div class="text-muted" style="font-size:11px">${esc(m.houseNo||'')} ${esc(m.village||'')}</div></td>
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
  const { meterReadings, members } = appState;
  const all = meterReadings.filter(r => r.anomaly);
  if (countEl) countEl.textContent = all.length + ' เคส';
  const recent = [...all].sort((a, b) => b.readingDate.localeCompare(a.readingDate)).slice(0, 3);
  if (!recent.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--gray-500);padding:16px;font-size:12px">ไม่มีความผิดปกติ</div>';
    return;
  }
  const icons = { high_usage: 'ti-flame', suspected_leak: 'ti-droplet-exclamation', meter_fault: 'ti-gauge-off' };
  el.innerHTML = recent.map(r => {
    const m = members.find(x => x.id === r.memberId) || {};
    return `<div class="alert-item" onclick="gotoMeter('${esc((m.firstName||'')+' '+(m.lastName||''))}','${esc(m.meter||'')}',${r.memberId})">
      <i class="ti ${icons[r.anomaly] || 'ti-alert-triangle'}"></i>
      <div><div class="text-bold" style="font-size:13px">${esc(m.houseNo||'—')} ${esc(m.village||'')}</div>
      <div style="font-size:12px;color:var(--red-700)">${esc(anomalyMap[r.anomaly]||r.anomaly)} • ${r.usage} m³ (${r.readingDate})</div></div>
    </div>`;
  }).join('');
}

let _dashChartYear = null; // null = ปีปัจจุบัน

export function setDashChartYear(yr) {
  _dashChartYear = yr || null;
  _renderDashBarChart();
}

function _renderDashBarChart() {
  const el = document.getElementById('dash-bar-chart');
  if (!el) return;

  const thisYear = new Date().getFullYear() + 543;
  const showYear = _dashChartYear || thisYear;
  const prevYear = showYear - 1;

  const getYear = (period) => { const p = period.split(' '); return p.length > 1 ? parseInt(p[1]) : 0; };

  const monthly = {}, monthlyPrev = {};
  appState.bills.filter(b => b.status === 'paid').forEach(b => {
    const yr = getYear(b.period);
    if (yr === showYear) monthly[b.period]     = (monthly[b.period]     || 0) + b.total;
    if (yr === prevYear) monthlyPrev[b.period] = (monthlyPrev[b.period] || 0) + b.total;
  });

  const months  = Object.keys(monthly).sort().slice(-12);
  const maxAmt  = months.length ? Math.max(...months.map(p => monthly[p])) : 0;
  const hasPrev = Object.keys(monthlyPrev).length > 0;

  const axisSpans = document.querySelectorAll('#page-dashboard .bar-chart-axis span');

  if (!months.length || !maxAmt) {
    el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--gray-400);font-size:12px">ยังไม่มีข้อมูลรายรับ</div>';
    if (axisSpans[0]) axisSpans[0].textContent = '';
    if (axisSpans[1]) axisSpans[1].textContent = '';
    _renderDashYearToggles(showYear, thisYear);
    return;
  }

  // Build comparison overlay value for each bar
  el.innerHTML = months.map(p => {
    const pct = Math.round(monthly[p] / maxAmt * 100);
    const lbl = p.split(' ')[0];
    // Match prev year period by replacing year
    const prevPeriod = p.replace(String(showYear), String(prevYear));
    const prevAmt    = monthlyPrev[prevPeriod] || 0;
    const prevPct    = maxAmt > 0 ? Math.round(prevAmt / maxAmt * 100) : 0;
    const trend      = prevAmt > 0 ? Math.round((monthly[p] - prevAmt) / prevAmt * 100) : null;
    const trendHtml  = trend !== null
      ? `<div style="font-size:8px;color:${trend>=0?'var(--green-600)':'var(--red-600)'};font-weight:700;margin-top:1px">${trend>=0?'▲':'▼'}${Math.abs(trend)}%</div>`
      : '';
    return `<div class="bar-grp" title="฿${monthly[p].toLocaleString()}">
      ${hasPrev && prevPct > 0 ? `<div style="position:absolute;bottom:18px;left:50%;transform:translateX(-50%);width:40%;height:${prevPct}%;background:var(--blue-100);border-radius:3px 3px 0 0;opacity:.6"></div>` : ''}
      <div class="bar-fill${pct===100?' hi':''}" style="height:${pct}%"></div>
      <div class="bar-lbl">${esc(lbl)}</div>
      ${trendHtml}
    </div>`;
  }).join('');

  const totalIncome = months.reduce((s, p) => s + monthly[p], 0);
  const avg = Math.round(totalIncome / months.length);
  if (axisSpans[0]) axisSpans[0].textContent = `ปี ${showYear} · รวม ฿${totalIncome.toLocaleString()}`;
  if (axisSpans[1]) axisSpans[1].textContent = `เฉลี่ย ฿${avg.toLocaleString()}/เดือน`;

  _renderDashYearToggles(showYear, thisYear);
}

function _renderDashYearToggles(showYear, thisYear) {
  const wrap = document.getElementById('dash-year-toggles');
  if (!wrap) return;
  const years = [...new Set(
    appState.bills.filter(b => b.status === 'paid').map(b => {
      const p = b.period.split(' '); return p.length > 1 ? parseInt(p[1]) : 0;
    }).filter(Boolean)
  )].sort().reverse().slice(0, 3);
  wrap.innerHTML = years.map(yr =>
    `<button onclick="setDashChartYear(${yr})"
      style="background:${yr===showYear?'var(--blue-600)':'var(--gray-100)'};color:${yr===showYear?'#fff':'var(--gray-600)'};
        border:none;border-radius:6px;padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer">${yr}</button>`
  ).join('');
}

function _renderDashVillages() {
  const el = document.getElementById('dash-vbar-body');
  if (!el) return;
  const { meterReadings, members } = appState;
  const villageUsage = {};
  meterReadings.forEach(r => {
    const m = members.find(x => x.id === r.memberId);
    const v = m ? (m.village || 'อื่น ๆ') : 'อื่น ๆ';
    villageUsage[v] = (villageUsage[v] || 0) + r.usage;
  });
  const entries = Object.entries(villageUsage).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (!entries.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:20px;font-size:12px">ยังไม่มีข้อมูลการใช้น้ำ</div>';
    return;
  }
  const maxU   = entries[0][1];
  const colors = ['var(--blue-500)', 'var(--blue-300)', 'var(--blue-400)', 'var(--blue-200)'];
  el.innerHTML = entries.map(([v, u], i) =>
    `<div class="vbar-item"${i===entries.length-1?' style="margin-bottom:0"':''}>
      <div class="vbar-label"><span>${esc(v)}</span><strong>${u.toLocaleString()} m³</strong></div>
      <div class="vbar-track"><div class="vbar-fill" style="width:${Math.round(u/maxU*100)}%;background:${colors[i]}"></div></div>
    </div>`
  ).join('');
}
