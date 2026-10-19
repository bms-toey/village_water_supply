// ─── Dashboard Module (Executive Command Center) ───────────────
// ภาพรวมทุกมิติ: การใช้น้ำ · รายได้/การจัดเก็บ · สมดุลน้ำ (NRW) ·
// หมู่บ้าน · พฤติกรรมการใช้ · ลูกหนี้ · ระดับบริการ · คุณภาพน้ำ ·
// งานซ่อม · ความผิดปกติ — คำนวณจาก appState ทั้งหมด (ไม่ query เพิ่ม)
// ──────────────────────────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc, getAvatarColor, getInitials } from '../../utils/dom.util.js';
import { periodLabel } from '../../utils/date.util.js';
import { todayISO, addDaysISO } from '../../utils/time.util.js';
import { _periodYM } from '../../services/db-mapper.service.js';
import { getAnomalyLabel, getChannelDisplay, getMemberTypeDisplay, getMaintenanceTypeDisplay } from '../../config/ui.config.js';

const C = {
  aqua: '#38e1ff', blue: '#3b82f6', gold: '#e9c47a', green: '#34d399',
  amber: '#fbbf24', orange: '#fb923c', red: '#fb7185', violet: '#a78bfa',
};
const CUBE = {
  aqua:   ['#38e1ff', '#0369a1', '#a5f3fc', '#075985'],
  blue:   ['#60a5fa', '#1d4ed8', '#bfdbfe', '#1e3a8a'],
  violet: ['#c4b5fd', '#6d28d9', '#ede9fe', '#4c1d95'],
  gold:   ['#f6dea6', '#a8853f', '#fff3d6', '#7a5f28'],
  green:  ['#6ee7b7', '#047857', '#d1fae5', '#064e3b'],
  red:    ['#fda4af', '#be123c', '#ffe4e6', '#881337'],
  amber:  ['#fcd34d', '#b45309', '#fef3c7', '#78350f'],
};
const CUBE_SEQ = ['aqua', 'violet', 'blue', 'gold', 'green', 'amber'];
const TYPE_COLORS = [C.aqua, C.gold, C.green, C.violet, C.orange, C.blue];

let _selKey = null;          // งวดที่เลือก (year*100+month) — null = ล่าสุด
let _dashChartYear = null;   // null = 12 งวดล่าสุด
let _uiReady = false;

// ─── Formatters ───────────────────────────────────────────────
const n0  = v => Math.round(v || 0).toLocaleString('th-TH');
const n1  = v => (Math.round((v || 0) * 10) / 10).toLocaleString('th-TH');
const thb = v => '฿' + n0(v);
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const compact = v => {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (a >= 1e4) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return n0(v);
};
const keyOf   = (y, m) => y * 100 + m;
const keyY    = k => Math.floor(k / 100);
const keyM    = k => k % 100;
const keyLbl  = k => periodLabel(keyY(k), keyM(k));
const prevKey = k => (keyM(k) === 1 ? keyOf(keyY(k) - 1, 12) : k - 1);
const billKey = b => {
  if (b.periodYear && b.periodMonth) return keyOf(+b.periodYear, +b.periodMonth);
  const { year, month } = _periodYM(b.period);
  return keyOf(year, month);
};
const nowKey = () => { const d = new Date(); return keyOf(d.getFullYear() + 543, d.getMonth() + 1); };
const memberName = m => ((m.firstName || '') + ' ' + (m.lastName || '')).trim() || '—';
const empty = (icon, msg) => `<div class="dx-empty"><i class="ti ${icon}"></i>${msg}</div>`;

function trendHtml(cur, prev, invert = false) {
  if (!prev) return '<span class="dx-trend dx-flat">— ไม่มีข้อมูลเทียบ</span>';
  const d = ((cur - prev) / prev) * 100;
  if (Math.abs(d) < 0.05) return '<span class="dx-trend dx-flat">● คงที่</span>';
  const good = invert ? d < 0 : d > 0;
  return `<span class="dx-trend ${good ? 'dx-up' : 'dx-down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}%</span>`;
}

// set innerHTML only when content changed — ป้องกัน animation เล่นซ้ำตอน realtime refresh
function setHTML(el, html) {
  if (!el || el._dxh === html) return;
  el._dxh = html;
  el.innerHTML = html;
  const cubes = el.querySelectorAll('[data-w]');
  if (cubes.length) requestAnimationFrame(() => requestAnimationFrame(() =>
    cubes.forEach(c => { c.style.width = c.dataset.w + '%'; })));
}

function countUp(el, to, fmt) {
  if (!el) return;
  const from = el._dxv ?? 0;
  el._dxv = to;
  if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 900;
  const step = t => {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1 && el._dxv === to) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ─── Aggregation ──────────────────────────────────────────────
function _aggregate() {
  const { members, bills, payments } = appState;
  const live = bills.filter(b => b.status !== 'cancelled');
  const byKey = new Map();
  live.forEach(b => {
    const k = billKey(b);
    let a = byKey.get(k);
    if (!a) byKey.set(k, a = { usage: 0, billed: 0, paidAmt: 0, overdueAmt: 0, pendingAmt: 0, n: 0, paid: 0, pending: 0, overdue: 0, bills: [] });
    a.usage += b.usage; a.billed += b.total; a.n++; a.bills.push(b);
    if (b.status === 'paid')         { a.paid++;    a.paidAmt    += b.total; }
    else if (b.status === 'overdue') { a.overdue++; a.overdueAmt += b.total; }
    else                             { a.pending++; a.pendingAmt += b.total; }
  });
  const keys = [...byKey.keys()].sort((a, b) => b - a);
  const memberMap = new Map(members.map(m => [m.id, m]));
  return { live, byKey, keys, memberMap, payments };
}
const EMPTY_AGG = { usage: 0, billed: 0, paidAmt: 0, overdueAmt: 0, pendingAmt: 0, n: 0, paid: 0, pending: 0, overdue: 0, bills: [] };

// ─── Public API ───────────────────────────────────────────────
export function setDashPeriod(v) {
  _selKey = parseInt(v) || null;
  renderDashboard();
}

export function setDashChartYear(yr) {
  _dashChartYear = parseInt(yr) || null;
  renderDashboard();
}

/** ไปหน้าจดมิเตอร์ของสมาชิก (ใช้ id แทนการฝังชื่อใน onclick) */
export function dashGotoMeter(mid) {
  const m = appState.members.find(x => x.id === mid);
  if (m) window.gotoMeter?.(memberName(m), m.meter, m.id);
}

export function renderDashboard() {
  _syncSidePanels();
  if (!document.getElementById('dx-root')) return;
  _initUI();

  const A = _aggregate();
  const sel = (_selKey && A.byKey.has(_selKey)) ? _selKey : (A.keys[0] || nowKey());
  const cur  = A.byKey.get(sel) || EMPTY_AGG;
  const prev = A.byKey.get(prevKey(sel)) || null;
  const ctx = { A, sel, cur, prev, label: keyLbl(sel) };

  _renderHeader(ctx);
  _renderTank(ctx);
  _renderKpis(ctx);
  _renderTrend(ctx);
  _renderDonut(ctx);
  _renderBalance(ctx);
  _renderVillages(ctx);
  _renderProfile(ctx);
  _renderFinance(ctx);
  _renderDebtors(ctx);
  _renderConsumers(ctx);
  _renderService(ctx);
  _renderQuality();
  _renderMaintenance();
  _renderAnomalies();
}

// ─── Other pages' KPIs & nav badges (เดิมอยู่ใน renderDashboard) ─
function _syncSidePanels() {
  const { members, bills, meterReadings } = appState;
  const totalMembers   = members.length;
  const normalMembers  = members.filter(m => m.status === 'normal').length;
  const overdueMembers = members.filter(m => m.status === 'overdue').length;
  const totalUsage     = meterReadings.reduce((s, r) => s + r.usage, 0);

  const mkpis = document.querySelectorAll('#page-members .kpi-val');
  if (mkpis[0]) mkpis[0].textContent = totalMembers.toLocaleString();
  if (mkpis[1]) mkpis[1].textContent = normalMembers.toLocaleString();
  if (mkpis[2]) mkpis[2].textContent = overdueMembers.toLocaleString();
  if (mkpis[3]) {
    const usageK = totalUsage >= 1000 ? (totalUsage / 1000).toFixed(1) + 'K' : totalUsage.toLocaleString();
    mkpis[3].innerHTML = `${usageK} <span style="font-size:14px">m³</span>`;
  }
  const villageCount = new Set(members.map(m => m.village).filter(Boolean)).size;
  const kb1 = document.querySelector('#page-members .kpi-card:first-child .kpi-badge');
  if (kb1) kb1.textContent = villageCount + ' หมู่บ้าน';
  const kb2 = document.querySelector('#page-members .kpi-card:nth-child(2) .kpi-badge');
  if (kb2) kb2.textContent = totalMembers ? Math.round(normalMembers / totalMembers * 100) + '%' : '0%';
  const msub = document.querySelector('#page-members .page-sub');
  if (msub) msub.textContent = `จัดการฐานข้อมูลผู้ใช้น้ำ ${totalMembers.toLocaleString()} ราย ใน ${villageCount} หมู่บ้าน`;

  const open = bills.filter(b => b.status === 'overdue' || b.status === 'pending').length;
  const billingBadge = document.getElementById('billing-badge');
  const debtorsBadge = document.getElementById('debtors-badge');
  if (billingBadge) billingBadge.textContent = open || '';
  if (debtorsBadge) debtorsBadge.textContent = overdueMembers || '';
}

// ─── One-time UI wiring: clock, bubbles, 3D tilt ──────────────
function _initUI() {
  if (_uiReady) return;
  _uiReady = true;
  const root = document.getElementById('dx-root');

  const clock = document.getElementById('dx-clock');
  const tick = () => {
    if (clock) clock.textContent = new Date().toLocaleString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  tick(); setInterval(tick, 30000);

  const bub = document.getElementById('dx-bubbles');
  if (bub) bub.innerHTML = Array.from({ length: 8 }, (_, i) => {
    const s = 3 + (i * 37 % 6);
    return `<span class="dx-bubble" style="left:${12 + (i * 53 % 76)}%;width:${s}px;height:${s}px;animation-delay:${(i * 0.7).toFixed(1)}s;animation-duration:${4 + (i % 3)}s"></span>`;
  }).join('');

  // 3D tilt ตามตำแหน่งเมาส์ (เฉพาะ mouse — ไม่ทำบนจอสัมผัส)
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let active = null;
  const reset = card => { card.classList.remove('is-tilting'); card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); };
  root.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const card = e.target.closest('.dx-tilt');
    if (active && active !== card) { reset(active); active = null; }
    if (!card) return;
    active = card;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const k = r.width > 500 ? 0.45 : 1;   // การ์ดใหญ่เอียงน้อยลง
    card.classList.add('is-tilting');
    card.style.setProperty('--rx', ((0.5 - y) * 8 * k).toFixed(2) + 'deg');
    card.style.setProperty('--ry', ((x - 0.5) * 10 * k).toFixed(2) + 'deg');
    card.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
    card.style.setProperty('--my', (y * 100).toFixed(1) + '%');
  });
  root.addEventListener('pointerleave', () => { if (active) { reset(active); active = null; } });
}

// ─── Header + period selector ─────────────────────────────────
function _renderHeader({ A, sel, label }) {
  const { members } = appState;
  const villages = new Set(members.map(m => m.village).filter(Boolean)).size;
  const sub = document.getElementById('dx-sub');
  if (sub) sub.innerHTML = `งวด <b>${esc(label)}</b> · ผู้ใช้น้ำ <b>${n0(members.length)}</b> ราย · <b>${villages}</b> หมู่บ้าน · อัปเดต ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;

  const selEl = document.getElementById('dx-period');
  if (selEl) {
    const keys = A.keys.length ? A.keys : [sel];
    setHTML(selEl, keys.map(k => `<option value="${k}">งวด ${esc(keyLbl(k))}</option>`).join(''));
    selEl.value = String(sel);
  }
}

// ─── Hero: 3D water tank (อัตราการจัดเก็บตามยอดเงิน) ──────────
function _renderTank({ cur, label }) {
  const rate = pct(cur.paidAmt, cur.billed);
  const tank = document.getElementById('dx-tank');
  if (tank) requestAnimationFrame(() => tank.style.setProperty('--lvl', (Math.min(rate, 100) / 100).toFixed(3)));
  countUp(document.getElementById('dx-tank-pct'), rate, v => Math.round(v) + '%');

  const outstanding = cur.billed - cur.paidAmt;
  setHTML(document.getElementById('dx-tank-info'), `
    <h3>อัตราการจัดเก็บรายได้</h3>
    <p>งวด ${esc(label)} · คิดตามยอดเงิน</p>
    <div class="dx-tank-rows">
      <div class="dx-tank-row"><span>เรียกเก็บทั้งงวด</span><b>${thb(cur.billed)}</b></div>
      <div class="dx-tank-row"><span>เก็บได้แล้ว</span><b style="color:${C.aqua}">${thb(cur.paidAmt)}</b></div>
      <div class="dx-tank-row"><span>คงค้างงวดนี้</span><b style="color:${outstanding > 0 ? C.red : C.green}">${thb(outstanding)}</b></div>
      <div class="dx-tank-row"><span>บิลที่ชำระแล้ว</span><b>${n0(cur.paid)} / ${n0(cur.n)} ราย</b></div>
    </div>`);
}

// ─── KPI 3D cards ─────────────────────────────────────────────
const KPI_DEF = [
  { id: 'acc',   label: 'ผู้ใช้น้ำที่ออกบิล',   icon: 'ti-users',          c: C.aqua,   page: 'members',  unit: 'ราย' },
  { id: 'use',   label: 'ปริมาณน้ำใช้งวดนี้',  icon: 'ti-droplet',        c: C.blue,   page: 'meter',    unit: 'm³' },
  { id: 'rev',   label: 'รายได้เรียกเก็บ',     icon: 'ti-receipt-2',      c: C.gold,   page: 'billing',  unit: '' },
  { id: 'debt',  label: 'ยอดค้างชำระสะสม',     icon: 'ti-alert-octagon',  c: C.red,    page: 'debtors',  unit: '' },
  { id: 'nrw',   label: 'น้ำสูญเสีย (NRW)',     icon: 'ti-droplet-off',    c: C.violet, page: 'reports',  unit: '%' },
  { id: 'avg',   label: 'ใช้น้ำเฉลี่ยต่อราย',   icon: 'ti-home-stats',     c: C.green,  page: 'reports',  unit: 'm³' },
];

function _spark(values, color) {
  if (values.length < 2 || !values.some(v => v)) return '<svg class="dx-spark" viewBox="0 0 92 32"></svg>';
  const max = Math.max(...values), min = Math.min(...values), rng = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 90 + 1, 28 - ((v - min) / rng) * 24]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const gid = 'dxsp' + color.slice(1);
  const last = pts[pts.length - 1];
  return `<svg class="dx-spark" viewBox="0 0 92 32" preserveAspectRatio="none">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".45"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${line} L91,32 L1,32 Z" fill="url(#${gid})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.6" fill="#fff" stroke="${color}" stroke-width="1.5"/>
  </svg>`;
}

function _wpFor(key) {
  const rows = appState.waterProduction || [];
  if (!rows.length) return { row: null, exact: false };
  const exact = rows.find(r => keyOf(+r.period_year, +r.period_month) === key);
  if (exact) return { row: exact, exact: true };
  const sorted = [...rows].sort((a, b) => keyOf(+b.period_year, +b.period_month) - keyOf(+a.period_year, +a.period_month));
  return { row: sorted[0], exact: false };
}
const nrwPctOf = r => {
  if (!r) return null;
  if (r.nrw_pct !== null && r.nrw_pct !== undefined) return parseFloat(r.nrw_pct);
  const d = parseFloat(r.water_distributed) || 0, u = parseFloat(r.total_meter_usage) || 0;
  return d > 0 ? ((d - u) / d) * 100 : null;
};

function _renderKpis({ A, sel, cur, prev }) {
  const wrap = document.getElementById('dx-kpis');
  if (!wrap) return;
  if (!wrap.dataset.built) {
    wrap.dataset.built = '1';
    wrap.innerHTML = KPI_DEF.map((k, i) => `
      <div class="dx-glass dx-tilt dx-kpi dx-in" style="--c:${k.c};animation-delay:${80 + i * 70}ms" onclick="goPage('${k.page}')">
        <div class="dx-kpi-top"><span class="dx-kpi-lbl">${k.label}</span><span class="dx-ico" style="--c:${k.c}"><i class="ti ${k.icon}"></i></span></div>
        <div class="dx-kpi-val"><span id="dx-k-${k.id}">0</span><small>${k.unit}</small></div>
        <div class="dx-kpi-ft"><div class="dx-kpi-note" id="dx-k-${k.id}-n"></div><div id="dx-k-${k.id}-s"></div></div>
      </div>`).join('');
  }

  // 8 งวดย้อนหลังสำหรับ sparkline
  const hist = [];
  for (let k = sel, i = 0; i < 8; i++, k = prevKey(k)) hist.unshift(A.byKey.get(k) || EMPTY_AGG);

  const overdueAll = A.live.filter(b => b.status === 'overdue');
  const debtAmt = overdueAll.reduce((s, b) => s + b.total, 0);
  const debtMembers = new Set(overdueAll.map(b => b.memberId)).size;

  const { row: wp, exact } = _wpFor(sel);
  const nrw = nrwPctOf(wp);
  const nrwHist = (appState.waterProduction || [])
    .slice().sort((a, b) => keyOf(+a.period_year, +a.period_month) - keyOf(+b.period_year, +b.period_month))
    .slice(-8).map(r => nrwPctOf(r) || 0);
  const prevWp = wp ? (appState.waterProduction || []).find(r => keyOf(+r.period_year, +r.period_month) === prevKey(keyOf(+wp.period_year, +wp.period_month))) : null;

  const avg  = cur.n ? cur.usage / cur.n : 0;
  const avgP = prev && prev.n ? prev.usage / prev.n : 0;
  const active = appState.members.filter(m => m.status !== 'closed' && m.status !== 'suspended').length;

  const set = (id, val, fmt, note, spark) => {
    countUp(document.getElementById(`dx-k-${id}`), val, fmt);
    setHTML(document.getElementById(`dx-k-${id}-n`), note);
    setHTML(document.getElementById(`dx-k-${id}-s`), spark);
  };

  set('acc', cur.n, n0,
    `${trendHtml(cur.n, prev?.n)}<br>จากผู้ใช้ที่ใช้งาน ${n0(active)} ราย`,
    _spark(hist.map(h => h.n), C.aqua));
  set('use', cur.usage, n0,
    `${trendHtml(cur.usage, prev?.usage)}<br>เทียบงวดก่อน ${prev ? n0(prev.usage) + ' m³' : '—'}`,
    _spark(hist.map(h => h.usage), C.blue));
  set('rev', cur.billed, v => thb(v),
    `${trendHtml(cur.billed, prev?.billed)}<br>เฉลี่ย ${thb(cur.n ? cur.billed / cur.n : 0)}/ราย`,
    _spark(hist.map(h => h.billed), C.gold));
  set('debt', debtAmt, v => thb(v),
    `<span class="dx-trend" style="color:${C.red}">${n0(debtMembers)} ราย · ${n0(overdueAll.length)} บิล</span><br>สถานะ ณ ปัจจุบัน`,
    _spark(hist.map(h => h.overdueAmt), C.red));
  set('nrw', nrw ?? 0, v => (nrw === null ? '—' : v.toFixed(1)),
    nrw === null
      ? '<span class="dx-trend dx-flat">ยังไม่มีข้อมูลการผลิต</span><br>บันทึกน้ำผลิต/จ่ายเพื่อคำนวณ'
      : `${trendHtml(nrw, nrwPctOf(prevWp), true)}<br>${nrw <= 20 ? 'อยู่ในเกณฑ์ดี (≤20%)' : nrw <= 30 ? 'ควรเฝ้าระวัง' : 'สูงเกินเกณฑ์ ตรวจหาจุดรั่ว'}${exact ? '' : ' · ' + esc(wp.period_label || '')}`,
    _spark(nrwHist, C.violet));
  set('avg', avg, n1,
    `${trendHtml(avg, avgP)}<br>≈ ${n1(avg / 30 * 1000)} ลิตร/วัน/ราย`,
    _spark(hist.map(h => (h.n ? h.usage / h.n : 0)), C.green));
}

// ─── Trend: isometric 3D bars + revenue lines ─────────────────
const niceMax = v => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil((v / p) * 2) / 2 * p; };

function _isoDefs(id, [c1, c2, ct, cs]) {
  return `<linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
    <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${cs}"/><stop offset="1" stop-color="${cs}" stop-opacity=".7"/></linearGradient>
    <linearGradient id="${id}t" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ct}"/><stop offset="1" stop-color="${c1}"/></linearGradient>`;
}
function _isoBar(x, base, w, h, id, title) {
  const dx = w * 0.42, dy = w * 0.26, y = base - h, f = v => v.toFixed(1);
  return `<g class="bar"><title>${esc(title)}</title>
    <rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="url(#${id}f)"/>
    <polygon points="${f(x + w)},${f(y)} ${f(x + w + dx)},${f(y - dy)} ${f(x + w + dx)},${f(base - dy)} ${f(x + w)},${f(base)}" fill="url(#${id}s)"/>
    <polygon points="${f(x)},${f(y)} ${f(x + dx)},${f(y - dy)} ${f(x + w + dx)},${f(y - dy)} ${f(x + w)},${f(y)}" fill="url(#${id}t)"/>
  </g>`;
}
function _smooth(pts, top, bottom) {
  if (!pts.length) return '';
  const clamp = v => Math.max(top, Math.min(bottom, v));
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, clamp(p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, clamp(p2[1] - (p3[1] - p1[1]) / 6)];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function _renderTrend({ A, sel }) {
  // toggles
  const years = [...new Set(A.keys.map(keyY))].sort((a, b) => b - a).slice(0, 3);
  if (_dashChartYear && !years.includes(_dashChartYear)) _dashChartYear = null;
  setHTML(document.getElementById('dash-year-toggles'),
    `<button class="${!_dashChartYear ? 'on' : ''}" onclick="setDashChartYear(0)">12 งวด</button>` +
    years.map(y => `<button class="${_dashChartYear === y ? 'on' : ''}" onclick="setDashChartYear(${y})">${y}</button>`).join(''));

  const keys = (_dashChartYear
    ? A.keys.filter(k => keyY(k) === _dashChartYear)
    : A.keys.filter(k => k <= sel).slice(0, 12)
  ).slice().sort((a, b) => a - b);
  const el = document.getElementById('dx-trend');
  const sumEl = document.getElementById('dx-trend-sum');
  if (!keys.length) {
    setHTML(el, empty('ti-chart-bar-off', 'ยังไม่มีข้อมูลบิล — เริ่มจดมิเตอร์และออกบิลเพื่อดูแนวโน้ม'));
    setHTML(sumEl, '');
    return;
  }
  const S = keys.map(k => ({ k, ...(A.byKey.get(k)) }));

  const W = 720, H = 262, pl = 44, pr = 54, pt = 24, pb = 34;
  const pw = W - pl - pr, ph = H - pt - pb, base = pt + ph;
  const n = S.length, slot = pw / n, bw = Math.min(34, slot * 0.5), dx = bw * 0.42;
  const maxU = niceMax(Math.max(...S.map(s => s.usage)));
  const maxB = niceMax(Math.max(...S.map(s => s.billed)));

  let g = '';
  for (let i = 0; i <= 4; i++) {
    const y = (base - (ph * i) / 4).toFixed(1);
    g += `<line x1="${pl}" x2="${W - pr + 10}" y1="${y}" y2="${y}" stroke="rgba(148,190,255,${i ? 0.09 : 0.25})" stroke-dasharray="${i ? '3 5' : ''}"/>
      <text x="${pl - 8}" y="${+y + 4}" text-anchor="end" font-size="10" fill="#7d8db5">${compact((maxU * i) / 4)}</text>
      <text x="${W - pr + 16}" y="${+y + 4}" font-size="10" fill="#a8853f">${compact((maxB * i) / 4)}</text>`;
  }
  g += `<text x="${pl - 8}" y="${pt - 10}" text-anchor="end" font-size="9.5" fill="#7d8db5">m³</text>
        <text x="${W - pr + 16}" y="${pt - 10}" font-size="9.5" fill="#a8853f">฿</text>`;

  let bars = '';
  const ptsB = [], ptsP = [];
  S.forEach((s, i) => {
    const x = pl + slot * i + (slot - bw - dx) / 2;
    const h = Math.max(1, (s.usage / maxU) * ph);
    const isSel = s.k === sel;
    bars += _isoBar(x, base, bw, h, isSel ? 'dxgS' : 'dxgB',
      `${keyLbl(s.k)} · น้ำ ${n0(s.usage)} m³ · เรียกเก็บ ${thb(s.billed)} · เก็บได้ ${thb(s.paidAmt)}`);
    const cx = x + (bw + dx) / 2;
    ptsB.push([cx, base - (s.billed / maxB) * ph]);
    ptsP.push([cx, base - (s.paidAmt / maxB) * ph]);
    const mo = keyLbl(s.k).split(' ')[0];
    bars += `<text x="${cx.toFixed(1)}" y="${base + 17}" text-anchor="middle" font-size="10.5" font-weight="${isSel ? 700 : 500}" fill="${isSel ? C.gold : '#9fb0d6'}">${esc(mo)}</text>`;
    if (keyM(s.k) === 1 || i === 0) bars += `<text x="${cx.toFixed(1)}" y="${base + 29}" text-anchor="middle" font-size="8.5" fill="#5f6f96">${keyY(s.k)}</text>`;
    if (isSel) bars += `<text x="${cx.toFixed(1)}" y="${(base - h - bw * 0.26 - 7).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#fff">${compact(s.usage)}</text>`;
  });

  const lineB = _smooth(ptsB, pt - 6, base), lineP = _smooth(ptsP, pt - 6, base);
  const area = n > 1 ? `${lineB} L${ptsB[n - 1][0].toFixed(1)},${base} L${ptsB[0][0].toFixed(1)},${base} Z` : '';
  const dots = (pts, c) => pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.2" fill="#0a1838" stroke="${c}" stroke-width="2"/>`).join('');

  setHTML(el, `<svg class="dx-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟแนวโน้มการใช้น้ำและรายได้">
    <defs>
      ${_isoDefs('dxgB', ['#38e1ff', '#1d4ed8', '#c8f6ff', '#123a8a'])}
      ${_isoDefs('dxgS', ['#f6dea6', '#a8853f', '#fff6dd', '#6e5524'])}
      <linearGradient id="dxgArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9c47a" stop-opacity=".22"/><stop offset="1" stop-color="#e9c47a" stop-opacity="0"/></linearGradient>
      <filter id="dxgGlow"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    ${g}${bars}
    ${area ? `<path d="${area}" fill="url(#dxgArea)"/>` : ''}
    <path d="${lineP}" fill="none" stroke="${C.green}" stroke-width="2" stroke-dasharray="5 4" opacity=".9"/>
    <path d="${lineB}" fill="none" stroke="${C.gold}" stroke-width="2.4" filter="url(#dxgGlow)"/>
    ${dots(ptsP, C.green)}${dots(ptsB, C.gold)}
  </svg>`);
  // มือถือ: กราฟเลื่อนแนวนอนได้ — เปิดมาให้เห็นงวดล่าสุดทางขวาก่อน
  if (el && el.scrollWidth > el.clientWidth) el.scrollLeft = el.scrollWidth;

  // summary minis + YoY
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const tU = sum(S, s => s.usage), tB = sum(S, s => s.billed), tP = sum(S, s => s.paidAmt);
  // เทียบเฉพาะงวดที่มีข้อมูลทั้งปีนี้และปีก่อน
  const pairs = keys.filter(k => A.byKey.has(k - 100));
  const lastYearU = sum(pairs, k => A.byKey.get(k - 100).usage);
  const thisYearU = sum(pairs, k => A.byKey.get(k).usage);
  const yoy = lastYearU ? ((thisYearU - lastYearU) / lastYearU) * 100 : null;
  setHTML(sumEl, `
    <div class="dx-mini"><span>น้ำใช้รวม ${n} งวด</span><b>${n0(tU)} m³</b></div>
    <div class="dx-mini"><span>รายได้เรียกเก็บ</span><b style="color:${C.gold}">${thb(tB)}</b></div>
    <div class="dx-mini"><span>เก็บได้จริง</span><b style="color:${C.green}">${thb(tP)} <small style="font-size:11px;color:#7d8db5">${pct(tP, tB).toFixed(0)}%</small></b></div>
    <div class="dx-mini"><span>เทียบงวดเดียวกันปีก่อน${pairs.length ? ` (${pairs.length} งวด)` : ''}</span><b class="${yoy === null ? 'dx-flat' : yoy >= 0 ? 'dx-up' : 'dx-down'}">${yoy === null ? '—' : (yoy >= 0 ? '▲ ' : '▼ ') + Math.abs(yoy).toFixed(1) + '%'}</b></div>`);
}

// ─── 3D extruded donut ────────────────────────────────────────
function _renderDonut({ cur, label }) {
  const cap = document.getElementById('dx-donut-cap');
  if (cap) cap.textContent = `บิลงวด ${label}`;
  countUp(document.getElementById('dx-donut-total'), cur.n, n0);

  const R = 76, CIRC = 2 * Math.PI * R, GAP = cur.n ? 4 : 0;
  const segs = [
    { v: cur.paid,    amt: cur.paidAmt,    c: C.aqua, lbl: 'ชำระแล้ว' },
    { v: cur.pending, amt: cur.pendingAmt, c: C.gold, lbl: 'รอชำระ / รอยืนยัน' },
    { v: cur.overdue, amt: cur.overdueAmt, c: C.red,  lbl: 'ค้างชำระ' },
  ];
  let off = 0;
  const arcs = segs.map(s => {
    const len = cur.n ? (s.v / cur.n) * CIRC : 0;
    const a = len > GAP ? `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${s.c}" stroke-width="28" stroke-dasharray="${(len - GAP).toFixed(2)} ${CIRC.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 100 100)"/>` : '';
    off += len;
    return a;
  }).join('');
  const LAYERS = 9;
  const layers = Array.from({ length: LAYERS }, (_, i) => {
    const top = i === LAYERS - 1;
    const b = (0.32 + (0.6 * i) / (LAYERS - 1)).toFixed(2);
    return `<svg viewBox="0 0 200 200" style="transform:translateZ(${(i * 2.2).toFixed(1)}px);filter:brightness(${top ? 1.05 : b})">
      <circle cx="100" cy="100" r="${R}" fill="none" stroke="rgba(148,190,255,${top ? 0.12 : 0.08})" stroke-width="28"/>
      ${arcs}
      ${top ? `<circle cx="100" cy="100" r="${R + 14}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1"/><circle cx="100" cy="100" r="${R - 14}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="1"/>` : ''}
    </svg>`;
  }).join('');
  setHTML(document.getElementById('dx-donut'), layers);

  setHTML(document.getElementById('dx-donut-list'), segs.map(s => `
    <div class="dx-drow" style="--c:${s.c}"><i></i><span>${s.lbl}</span><b>${n0(s.v)} ราย</b><em>${pct(s.v, cur.n).toFixed(0)}% · ${thb(s.amt)}</em></div>`).join(''));
}

// ─── Cuboid bar helper ────────────────────────────────────────
function _cube(pctW, scheme) {
  const [c1, c2, ct, cs] = CUBE[scheme] || CUBE.aqua;
  return `<div class="dx-cube-track"><div class="dx-cube" data-w="${Math.max(0, Math.min(100, pctW)).toFixed(1)}" style="--c1:${c1};--c2:${c2};--ct:${ct};--cs:${cs}"></div></div>`;
}

// ─── Water balance (สมดุลน้ำ) ─────────────────────────────────
function _renderBalance({ sel, A }) {
  const el = document.getElementById('dx-balance');
  const cap = document.getElementById('dx-bal-cap');
  const { row: wp, exact } = _wpFor(sel);
  if (!wp) {
    if (cap) cap.textContent = 'ผลิต → จ่าย → จำหน่าย';
    setHTML(el, empty('ti-building-factory-2', 'ยังไม่มีบันทึกข้อมูลการผลิตน้ำ<br>เมื่อบันทึกน้ำดิบ/น้ำผลิต/น้ำจ่าย ระบบจะคำนวณน้ำสูญเสียให้อัตโนมัติ'));
    return;
  }
  const wpKey = keyOf(+wp.period_year, +wp.period_month);
  if (cap) cap.textContent = `งวด ${wp.period_label || keyLbl(wpKey)}${exact ? '' : ' (ข้อมูลล่าสุด)'}`;
  const f = k => parseFloat(wp[k]) || 0;
  const raw = f('raw_water_in'), prod = f('water_produced'), dist = f('water_distributed'), sold = f('total_meter_usage');
  const max = Math.max(raw, prod, dist, sold, 1);
  const steps = [
    { lbl: 'น้ำดิบเข้าระบบ',      v: raw,  icon: 'ti-ripple',          c: C.blue,   s: 'blue' },
    { lbl: 'น้ำผลิตได้ (ผ่านกรอง)', v: prod, icon: 'ti-filter',          c: C.aqua,   s: 'aqua' },
    { lbl: 'น้ำจ่ายเข้าเส้นท่อ',    v: dist, icon: 'ti-arrows-split-2',  c: C.violet, s: 'violet' },
    { lbl: 'น้ำจำหน่าย (มิเตอร์)',  v: sold, icon: 'ti-gauge',           c: C.green,  s: 'green' },
  ];
  const nrw = nrwPctOf(wp) ?? 0;
  const nrwC = nrw <= 20 ? C.green : nrw <= 30 ? C.amber : C.red;
  const cost = f('total_cost') || (f('electricity_cost') + f('chemical_cost'));
  const costPer = prod ? cost / prod : 0;
  const rev = A.byKey.get(wpKey);
  const revPer = rev && rev.usage ? rev.billed / rev.usage : 0;

  setHTML(el, `
    <div class="dx-flow">${steps.map(s => `
      <div class="dx-flow-step">
        <span class="dx-flow-n" style="--c:${s.c}"><i class="ti ${s.icon}"></i></span>
        <div class="dx-cube-row" style="margin:0">
          <div class="dx-cube-lbl"><span>${s.lbl}</span><b>${n0(s.v)} m³</b></div>
          ${_cube((s.v / max) * 100, s.s)}
        </div>
      </div>`).join('')}
    </div>
    <div class="dx-nrw" style="--c:${nrwC}">
      <span>น้ำสูญเสีย (NRW)<br><b style="font-size:13px;color:var(--dx-sub)">${n0(dist - sold)} m³</b></span>
      <b>${nrw.toFixed(1)}%</b>
    </div>
    <div class="dx-stats">
      <div class="dx-stat" style="--c:${C.amber}"><i class="ti ti-bolt"></i><div><b>${costPer ? '฿' + costPer.toFixed(2) : '—'}</b><span>ต้นทุนผลิต/m³ (${thb(cost)})</span></div></div>
      <div class="dx-stat" style="--c:${C.gold}"><i class="ti ti-cash"></i><div><b>${revPer ? '฿' + revPer.toFixed(2) : '—'}</b><span>รายได้เฉลี่ย/m³</span></div></div>
    </div>`);
}

// ─── Villages (cuboid bars) ───────────────────────────────────
function _renderVillages({ cur, A }) {
  const el = document.getElementById('dash-vbar-body');
  const V = {};
  cur.bills.forEach(b => {
    const m = A.memberMap.get(b.memberId);
    const v = (m && m.village) || 'ไม่ระบุหมู่บ้าน';
    const o = V[v] || (V[v] = { usage: 0, n: 0, overdue: 0, billed: 0 });
    o.usage += b.usage; o.n++; o.billed += b.total;
    if (b.status === 'overdue') o.overdue++;
  });
  const rows = Object.entries(V).sort((a, b) => b[1].usage - a[1].usage).slice(0, 6);
  if (!rows.length) { setHTML(el, empty('ti-map-off', 'ยังไม่มีข้อมูลการใช้น้ำในงวดนี้')); return; }
  const max = rows[0][1].usage || 1;
  setHTML(el, rows.map(([v, o], i) => `
    <div class="dx-cube-row">
      <div class="dx-cube-lbl"><span>${esc(v)} <em>· ${n0(o.n)} ราย · เฉลี่ย ${n1(o.usage / o.n)} m³${o.overdue ? ` · <span style="color:${C.red}">ค้าง ${o.overdue}</span>` : ''}</em></span><b>${n0(o.usage)} m³</b></div>
      ${_cube((o.usage / max) * 100, CUBE_SEQ[i % CUBE_SEQ.length])}
    </div>`).join(''));
}

// ─── Consumption profile: histogram + member-type split ───────
function _renderProfile({ cur, A }) {
  const el = document.getElementById('dx-profile');
  if (!cur.n) { setHTML(el, empty('ti-chart-histogram', 'ยังไม่มีข้อมูลการใช้น้ำในงวดนี้')); return; }
  const B = [
    { lbl: '0', t: u => u <= 0 }, { lbl: '1–5', t: u => u > 0 && u <= 5 }, { lbl: '6–10', t: u => u > 5 && u <= 10 },
    { lbl: '11–20', t: u => u > 10 && u <= 20 }, { lbl: '21–30', t: u => u > 20 && u <= 30 },
    { lbl: '31–50', t: u => u > 30 && u <= 50 }, { lbl: '50+', t: u => u > 50 },
  ].map(b => ({ ...b, v: cur.bills.filter(x => b.t(x.usage)).length }));
  const max = Math.max(...B.map(b => b.v), 1);
  const W = 320, H = 132, base = 104, slot = W / B.length, bw = slot * 0.46;
  const bars = B.map((b, i) => {
    const x = slot * i + (slot - bw * 1.42) / 2, h = Math.max(1, (b.v / max) * 76);
    const id = i === 0 || i === B.length - 1 ? 'dxhW' : 'dxhN';
    return _isoBar(x, base, bw, h, id, `${b.lbl} m³ : ${b.v} ราย`) +
      `<text x="${(x + bw * 0.71).toFixed(1)}" y="${base + 15}" text-anchor="middle" font-size="9.5" fill="#9fb0d6">${b.lbl}</text>` +
      (b.v ? `<text x="${(x + bw * 0.71).toFixed(1)}" y="${(base - h - bw * 0.26 - 5).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">${b.v}</text>` : '');
  }).join('');

  // member type split by usage
  const T = {};
  cur.bills.forEach(b => {
    const code = A.memberMap.get(b.memberId)?.memberType || 'residential';
    T[code] = (T[code] || 0) + b.usage;
  });
  const types = Object.entries(T).sort((a, b) => b[1] - a[1]);
  const tot = cur.usage || 1;

  setHTML(el, `
    <svg class="dx-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="การกระจายปริมาณการใช้น้ำ">
      <defs>${_isoDefs('dxhN', CUBE.green)}${_isoDefs('dxhW', CUBE.amber)}</defs>
      <line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="rgba(148,190,255,.2)"/>
      ${bars}
    </svg>
    <div class="dx-chips" style="margin:6px 0 0">
      <span class="dx-chip" style="--c:${C.amber}"><i class="ti ti-zzz"></i>ไม่ใช้น้ำ ${B[0].v} ราย</span>
      <span class="dx-chip" style="--c:${C.orange}"><i class="ti ti-flame"></i>เกิน 50 m³ ${B[6].v} ราย</span>
    </div>
    <div class="dx-sec-lbl">สัดส่วนตามประเภทผู้ใช้</div>
    <div class="dx-split">${types.map(([c, u], i) => `<span style="width:${pct(u, tot).toFixed(2)}%;--c:${TYPE_COLORS[i % TYPE_COLORS.length]}" title="${esc(getMemberTypeDisplay(c).label)}"></span>`).join('')}</div>
    <div class="dx-split-lg">${types.map(([c, u], i) => `<div style="--c:${TYPE_COLORS[i % TYPE_COLORS.length]}"><i></i><span>${esc(getMemberTypeDisplay(c).label)}</span><b>${pct(u, tot).toFixed(0)}%</b></div>`).join('')}</div>`);
}

// ─── Finance: channels + debt aging ───────────────────────────
function _renderFinance({ sel, A }) {
  const el = document.getElementById('dx-finance');
  const y = keyY(sel) - 543, m = String(keyM(sel)).padStart(2, '0');
  const prefix = `${y}-${m}`;
  const cap = document.getElementById('dx-fin-cap');
  if (cap) cap.textContent = `เงินเข้าเดือน ${keyLbl(sel)}`;

  const valid = A.payments.filter(p => !p.cancelledAt);
  const inMonth = valid.filter(p => p.status === 'approved' && (p.paidAt || '').startsWith(prefix));
  const pending = valid.filter(p => p.status === 'pending');
  const ch = {};
  inMonth.forEach(p => { ch[p.channel] = (ch[p.channel] || 0) + p.amount; });
  const chRows = Object.entries(ch).sort((a, b) => b[1] - a[1]);
  const totalIn = inMonth.reduce((s, p) => s + p.amount, 0);
  const maxCh = chRows.length ? chRows[0][1] : 1;
  const chScheme = { cash: 'gold', promptpay: 'aqua', bank: 'blue', mobile: 'violet', line_pay: 'green' };

  // aging: จำนวนงวดที่ค้างต่อราย
  const G = {};
  A.live.filter(b => b.status === 'overdue').forEach(b => {
    const g = G[b.memberId] || (G[b.memberId] = { n: 0, amt: 0 });
    g.n++; g.amt += b.total;
  });
  const age = [
    { lbl: 'ค้าง 1 งวด',  t: n => n === 1, c: C.amber },
    { lbl: 'ค้าง 2 งวด',  t: n => n === 2, c: C.orange },
    { lbl: 'ค้าง 3+ งวด', t: n => n >= 3,  c: C.red },
  ].map(a => {
    const list = Object.values(G).filter(g => a.t(g.n));
    return { ...a, m: list.length, amt: list.reduce((s, g) => s + g.amt, 0) };
  });
  const debtTotal = age.reduce((s, a) => s + a.amt, 0);

  setHTML(el, `
    <div class="dx-tank-row" style="border:none;padding:0 0 12px"><span>รับชำระแล้ว ${n0(inMonth.length)} รายการ</span><b style="font-size:20px;color:${C.gold}">${thb(totalIn)}</b></div>
    ${chRows.length ? chRows.map(([c, v]) => {
      const d = getChannelDisplay(c);
      return `<div class="dx-cube-row"><div class="dx-cube-lbl"><span><i class="ti ${esc(d.icon)}"></i> ${esc(d.label)} <em>· ${pct(v, totalIn).toFixed(0)}%</em></span><b>${thb(v)}</b></div>${_cube((v / maxCh) * 100, chScheme[c] || 'aqua')}</div>`;
    }).join('') : empty('ti-cash-off', 'ยังไม่มีรายการรับชำระในเดือนนี้')}
    ${pending.length ? `<div class="dx-alert" style="--c:${C.gold};margin:12px 0 0" onclick="goPage('payments')"><i class="ti ti-file-search"></i><div><b>สลิปรอตรวจสอบ ${n0(pending.length)} รายการ</b><span>ยอดรวม ${thb(pending.reduce((s, p) => s + p.amount, 0))} · แตะเพื่ออนุมัติ</span></div></div>` : ''}
    <div class="dx-sec-lbl">อายุหนี้ค้างชำระ</div>
    <div class="dx-aging">${age.map(a => `<div class="dx-age" style="--c:${a.c}"><span>${a.lbl}</span><b>${thb(a.amt)}</b><em>${n0(a.m)} ราย</em></div>`).join('')}</div>
    <div class="dx-total"><span>หนี้ค้างรวมทั้งระบบ</span><b>${thb(debtTotal)}</b></div>`);
}

// ─── Top debtors ──────────────────────────────────────────────
function _renderDebtors({ A }) {
  const el = document.getElementById('dx-debtors');
  const G = {};
  A.live.filter(b => b.status === 'overdue').forEach(b => {
    const g = G[b.memberId] || (G[b.memberId] = { total: 0, n: 0, oldest: b.dueDate });
    g.total += b.total; g.n++;
    if (b.dueDate && b.dueDate < g.oldest) g.oldest = b.dueDate;
  });
  const rows = Object.entries(G).sort((a, b) => b[1].total - a[1].total).slice(0, 5);
  const cap = document.getElementById('dx-debt-cap');
  if (cap) cap.textContent = `ค้างชำระทั้งหมด ${n0(Object.keys(G).length)} ราย`;
  if (!rows.length) { setHTML(el, empty('ti-mood-happy', 'ยอดเยี่ยม! ไม่มีลูกหนี้ค้างชำระ')); return; }
  const today = new Date(todayISO());
  setHTML(el, `<div class="dx-rank">${rows.map(([mid, g], i) => {
    const id = parseInt(mid);
    const m = A.memberMap.get(id) || {};
    const days = g.oldest ? Math.max(0, Math.round((today - new Date(g.oldest)) / 86400000)) : 0;
    return `<div class="dx-ri" onclick="openMemberQuickView(${id})">
      <span class="dx-rn">${i + 1}</span>
      <span class="dx-av" style="--c:${getAvatarColor(id)}">${esc(getInitials(m.firstName, m.lastName) || '?')}</span>
      <div class="dx-rname"><b>${esc(memberName(m))}</b><span>${esc(m.houseNo || '')} ${esc(m.village || '')} · ${g.n} งวด · ${days} วัน</span></div>
      <div class="dx-rv"><b style="color:${C.red}">${thb(g.total)}</b><button onclick="event.stopPropagation();notifyDebtor(${id})"><i class="ti ti-bell"></i> แจ้งเตือน</button></div>
    </div>`;
  }).join('')}</div>`);
}

// ─── Top consumers ────────────────────────────────────────────
function _renderConsumers({ cur, A, label }) {
  const el = document.getElementById('dx-consumers');
  const cap = document.getElementById('dx-top-cap');
  if (cap) cap.textContent = `งวด ${label}`;
  const rows = [...cur.bills].sort((a, b) => b.usage - a.usage).slice(0, 5);
  if (!rows.length || !rows[0].usage) { setHTML(el, empty('ti-droplet-off', 'ยังไม่มีข้อมูลการใช้น้ำในงวดนี้')); return; }
  const anomalous = new Set(appState.meterReadings.filter(r => r.anomaly && r.period === label).map(r => r.memberId));
  const max = rows[0].usage || 1;
  const avg = cur.n ? cur.usage / cur.n : 0;
  setHTML(el, `<div class="dx-rank">${rows.map((b, i) => {
    const m = A.memberMap.get(b.memberId) || {};
    const x = avg ? b.usage / avg : 0;
    return `<div class="dx-ri" onclick="openMemberQuickView(${parseInt(b.memberId)})">
      <span class="dx-rn">${i + 1}</span>
      <span class="dx-av" style="--c:${getAvatarColor(b.memberId)}">${esc(getInitials(m.firstName, m.lastName) || '?')}</span>
      <div class="dx-rname"><b>${esc(memberName(m))}${anomalous.has(b.memberId) ? ` <i class="ti ti-alert-triangle" style="color:${C.red}" title="พบความผิดปกติ"></i>` : ''}</b><span>${esc(getMemberTypeDisplay(m.memberType).label)} · ${x ? x.toFixed(1) + '× ค่าเฉลี่ย' : ''}</span></div>
      <div class="dx-rv"><b style="color:${C.aqua}">${n0(b.usage)} m³</b><span style="font-size:11px;color:#7d8db5">${thb(b.total)}</span></div>
      <div class="dx-rbar"><span style="width:${((b.usage / max) * 100).toFixed(1)}%"></span></div>
    </div>`;
  }).join('')}</div>`);
}

// ─── Service level rings ──────────────────────────────────────
function _ring(p, color, label, sub) {
  const r = 34, c = 2 * Math.PI * r, len = (Math.min(100, Math.max(0, p)) / 100) * c;
  return `<div><div class="dx-ring">
      <svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="${r}" fill="none" stroke="rgba(148,190,255,.12)" stroke-width="8"/>
      <circle cx="42" cy="42" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${len.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 42 42)" style="filter:drop-shadow(0 0 4px ${color})"/>
      <circle cx="42" cy="42" r="25" fill="rgba(0,0,0,.25)"/></svg>
      <b>${Math.round(p)}%</b></div>
    <div class="dx-ring-l">${label}</div><div class="dx-ring-s">${sub}</div></div>`;
}

function _renderService({ cur, label }) {
  const el = document.getElementById('dx-service');
  const { members, meterReadings, payments, meterReplacements } = appState;
  const active = members.filter(m => m.status !== 'closed' && m.status !== 'suspended');
  const read = new Set([...cur.bills.map(b => b.memberId), ...meterReadings.filter(r => r.period === label).map(r => r.memberId)]);
  const readN = active.filter(m => read.has(m.id)).length;
  const sent = cur.bills.filter(b => b.sentVia && b.sentVia !== 'none').length;

  const paidOn = new Map();
  payments.forEach(p => {
    if (p.status !== 'approved' || p.cancelledAt || !p.billId) return;
    const d = (p.paidAt || '').slice(0, 10);
    if (!paidOn.has(p.billId) || d < paidOn.get(p.billId)) paidOn.set(p.billId, d);
  });
  const onTime = cur.bills.filter(b => b.status === 'paid' && (!paidOn.has(b.id) || !b.dueDate || paidOn.get(b.id) <= b.dueDate)).length;

  const yearAD = String(new Date().getFullYear());
  const limit = addDaysISO(180);
  const expiring = members.filter(m => m.meterExpireDate && m.meterExpireDate <= limit && m.status !== 'closed').length;
  const newMembers = members.filter(m => (m.registrationDate || '').startsWith(yearAD)).length;
  const suspended = members.filter(m => m.status === 'suspended' || m.status === 'closed').length;
  const slips = payments.filter(p => p.status === 'pending' && !p.cancelledAt).length;

  setHTML(el, `
    <div class="dx-rings">
      ${_ring(pct(readN, active.length), C.aqua, 'จดมิเตอร์แล้ว', `${n0(readN)}/${n0(active.length)} ราย`)}
      ${_ring(pct(sent, cur.n), C.violet, 'ส่งบิลถึงผู้ใช้', `${n0(sent)}/${n0(cur.n)} บิล`)}
      ${_ring(pct(onTime, cur.n), C.green, 'ชำระทันกำหนด', `${n0(onTime)}/${n0(cur.n)} บิล`)}
    </div>
    <div class="dx-stats">
      <div class="dx-stat" style="--c:${C.gold}" onclick="goPage('payments')"><i class="ti ti-file-search"></i><div><b>${n0(slips)}</b><span>สลิปรอตรวจ</span></div></div>
      <div class="dx-stat" style="--c:${C.orange}" onclick="goPage('maintenance')"><i class="ti ti-gauge-off"></i><div><b>${n0(expiring)}</b><span>มิเตอร์หมดอายุ ≤180 วัน</span></div></div>
      <div class="dx-stat" style="--c:${C.green}" onclick="goPage('members')"><i class="ti ti-user-plus"></i><div><b>${n0(newMembers)}</b><span>สมาชิกใหม่ปีนี้</span></div></div>
      <div class="dx-stat" style="--c:${C.red}" onclick="goPage('members')"><i class="ti ti-plug-connected-x"></i><div><b>${n0(suspended)}</b><span>ระงับ/ปิดมิเตอร์</span></div></div>
    </div>
    <div style="font-size:11px;color:#7d8db5;margin-top:10px;text-align:center">เปลี่ยนมิเตอร์แล้ว ${n0((meterReplacements || []).length)} ครั้ง</div>`);
}

// ─── Water quality gauges ─────────────────────────────────────
function _gauge(val, min, max, okLo, okHi, label, unit, dec = 1) {
  const pt = f => { const a = Math.PI * (1 - f); return [50 + 38 * Math.cos(a), 50 - 38 * Math.sin(a)]; };
  const fr = v => Math.max(0, Math.min(1, (v - min) / (max - min)));
  const arc = (a, b) => { const p = pt(a), q = pt(b); return `M${p[0].toFixed(1)},${p[1].toFixed(1)} A38,38 0 0 1 ${q[0].toFixed(1)},${q[1].toFixed(1)}`; };
  const has = val !== null && !isNaN(val);
  const ok = has && val >= okLo && val <= okHi;
  const col = !has ? '#7d8db5' : ok ? C.green : C.red;
  const v = has ? fr(val) : 0, nd = pt(v);
  return `<div class="dx-gauge">
    <svg viewBox="0 0 100 58">
      <path d="${arc(0, 1)}" fill="none" stroke="rgba(148,190,255,.12)" stroke-width="8" stroke-linecap="round"/>
      <path d="${arc(fr(okLo), fr(okHi))}" fill="none" stroke="rgba(52,211,153,.28)" stroke-width="8"/>
      ${has ? `<path d="${arc(0, Math.max(v, 0.001))}" fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round" style="filter:drop-shadow(0 0 3px ${col})"/>
      <line x1="50" y1="50" x2="${nd[0].toFixed(1)}" y2="${nd[1].toFixed(1)}" stroke="#fff" stroke-width="2" stroke-linecap="round"/>` : ''}
      <circle cx="50" cy="50" r="4" fill="#0a1838" stroke="${col}" stroke-width="2"/>
    </svg>
    <div class="dx-gauge-v" style="color:${col}">${has ? val.toFixed(dec) : '—'}</div>
    <div class="dx-gauge-l">${label}</div>
    <div class="dx-gauge-r">เกณฑ์ ${okLo}–${okHi}${unit ? ' ' + unit : ''}</div>
  </div>`;
}

function _renderQuality() {
  const el = document.getElementById('dx-quality');
  const rows = [...(appState.waterQuality || [])].sort((a, b) => (b.test_date || '').localeCompare(a.test_date || ''));
  if (!rows.length) { setHTML(el, empty('ti-flask-off', 'ยังไม่มีผลตรวจคุณภาพน้ำ')); return; }
  const last = rows[0].test_date;
  const latest = rows.filter(r => r.test_date === last);
  const avg = k => { const v = latest.map(r => parseFloat(r[k])).filter(x => !isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const since = addDaysISO(-365);
  const yr = rows.filter(r => (r.test_date || '') >= since);
  const pass = yr.filter(r => r.result === 'pass').length;
  const failLatest = latest.filter(r => r.result === 'fail').length;
  const cap = document.getElementById('dx-q-cap');
  if (cap) cap.textContent = `ตรวจล่าสุด ${new Date(last).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })} · ${latest.length} จุด`;

  setHTML(el, `
    <div class="dx-gauges">
      ${_gauge(avg('ph'), 0, 14, 6.5, 8.5, 'ค่า pH', '', 1)}
      ${_gauge(avg('turbidity'), 0, 10, 0, 5, 'ความขุ่น', 'NTU', 2)}
      ${_gauge(avg('chlorine'), 0, 1.5, 0.2, 0.5, 'คลอรีนอิสระ', 'mg/L', 2)}
    </div>
    <div class="dx-nrw" style="--c:${pct(pass, yr.length) >= 95 ? C.green : C.amber};margin-top:14px">
      <span>ผ่านเกณฑ์ย้อนหลัง 12 เดือน<br><b style="font-size:12px;color:var(--dx-sub)">${n0(pass)} / ${n0(yr.length)} ตัวอย่าง</b></span>
      <b>${yr.length ? pct(pass, yr.length).toFixed(0) + '%' : '—'}</b>
    </div>
    ${failLatest ? `<div class="dx-alert" style="--c:${C.red};margin:10px 0 0"><i class="ti ti-alert-circle"></i><div><b>ไม่ผ่านเกณฑ์ ${failLatest} จุด</b><span>${latest.filter(r => r.result === 'fail').map(r => esc(r.sample_point || '')).join(', ')}</span></div></div>` : ''}`);
}

// ─── Maintenance ──────────────────────────────────────────────
function _renderMaintenance() {
  const el = document.getElementById('dx-maint');
  const jobs = appState.maintenance || [];
  const yearAD = String(new Date().getFullYear());
  const cap = document.getElementById('dx-m-cap');
  if (cap) cap.textContent = `ปี ${new Date().getFullYear() + 543}`;
  if (!jobs.length) { setHTML(el, empty('ti-tool', 'ยังไม่มีงานซ่อมบำรุง')); return; }
  const pend = jobs.filter(j => j.status === 'pending');
  const prog = jobs.filter(j => j.status === 'in_progress');
  const done = jobs.filter(j => j.status === 'completed' && (j.completedDate || j.reportedDate || '').startsWith(yearAD));
  const cost = jobs.filter(j => j.status !== 'cancelled' && (j.reportedDate || '').startsWith(yearAD)).reduce((s, j) => s + (j.cost || 0), 0);
  const open = [...pend, ...prog].sort((a, b) => (a.reportedDate || '').localeCompare(b.reportedDate || '')).slice(0, 3);
  const today = new Date(todayISO());
  setHTML(el, `
    <div class="dx-pipe">
      <div style="--c:${C.amber}" onclick="goPage('maintenance')"><b>${pend.length}</b><span>รอดำเนินการ</span></div>
      <div style="--c:${C.blue}" onclick="goPage('maintenance')"><b>${prog.length}</b><span>กำลังซ่อม</span></div>
      <div style="--c:${C.green}" onclick="goPage('maintenance')"><b>${done.length}</b><span>เสร็จปีนี้</span></div>
    </div>
    <div class="dx-tank-row" style="border:none;padding:0 0 4px"><span>ค่าใช้จ่ายซ่อมบำรุงปีนี้</span><b style="color:${C.gold}">${thb(cost)}</b></div>
    ${open.length ? open.map(j => {
      const t = getMaintenanceTypeDisplay(j.type);
      const age = j.reportedDate ? Math.max(0, Math.round((today - new Date(j.reportedDate)) / 86400000)) : 0;
      return `<div class="dx-job" style="--c:${j.status === 'in_progress' ? C.blue : C.amber}" onclick="goPage('maintenance')"><i class="ti ${esc(t.icon)}"></i><div><b>${esc(j.description || t.label)}</b>${esc(j.location || t.label)} · ${age} วันที่แล้ว</div></div>`;
    }).join('') : `<div class="dx-job" style="--c:${C.green}"><i class="ti ti-circle-check"></i><div><b>ไม่มีงานค้าง</b>ทุกงานดำเนินการเรียบร้อย</div></div>`}`);
}

// ─── Anomalies ────────────────────────────────────────────────
function _renderAnomalies() {
  const el = document.getElementById('anomaly-list');
  const countEl = document.getElementById('anomaly-count');
  const { meterReadings, members } = appState;
  const all = meterReadings.filter(r => r.anomaly);
  if (countEl) countEl.textContent = all.length + ' เคส';
  if (!el) return;
  if (!all.length) { setHTML(el, empty('ti-shield-check', 'ไม่พบการใช้น้ำผิดปกติ')); return; }
  const meta = {
    high_usage:     { icon: 'ti-flame',               c: C.orange },
    suspected_leak: { icon: 'ti-droplet-exclamation', c: C.aqua },
    meter_fault:    { icon: 'ti-gauge-off',           c: C.violet },
  };
  const byType = {};
  all.forEach(r => { byType[r.anomaly] = (byType[r.anomaly] || 0) + 1; });
  const recent = [...all].sort((a, b) => (b.readingDate || '').localeCompare(a.readingDate || '')).slice(0, 4);
  setHTML(el, `
    <div class="dx-chips">${Object.entries(byType).map(([t, n]) => {
      const mt = meta[t] || { icon: 'ti-alert-triangle', c: C.red };
      return `<span class="dx-chip" style="--c:${mt.c}"><i class="ti ${mt.icon}"></i>${esc(getAnomalyLabel(t))} ${n}</span>`;
    }).join('')}</div>
    ${recent.map(r => {
      const m = members.find(x => x.id === r.memberId) || {};
      const mt = meta[r.anomaly] || { icon: 'ti-alert-triangle', c: C.red };
      return `<div class="dx-alert" style="--c:${mt.c}" onclick="dashGotoMeter(${parseInt(r.memberId)})"><i class="ti ${mt.icon}"></i><div>
        <b>${esc(m.houseNo || '—')} ${esc(m.village || '')} · ${esc(memberName(m))}</b>
        <span>${esc(getAnomalyLabel(r.anomaly))} · ${n0(r.usage)} m³ · ${esc(r.readingDate || '')}</span></div></div>`;
    }).join('')}`);
}
