// ─── Luxe UX Layer ─────────────────────────────────────────────
// ตัวช่วยให้ทำงานเร็วขึ้น + ลูกเล่น 3D ที่ใช้ร่วมกันทุกหน้า
//   • Command Palette (Ctrl+K หรือ /) — ค้นหาเมนู คำสั่ง สมาชิก และเลขบิลในที่เดียว
//   • ปุ่มลัด Alt+1…0 สลับหน้า
//   • Quick Action dock (ปุ่มทองมุมขวาล่าง) — งานที่ใช้บ่อยกดครั้งเดียว
//   • 3D tilt บนการ์ด, ripple บนปุ่ม, เอฟเฟกต์ตัวเลข KPI เปลี่ยน
// สไตล์ทั้งหมดอยู่ที่ styles/luxe.css
// ──────────────────────────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc } from '../../utils/dom.util.js';

const call = (fn, ...args) => (typeof window[fn] === 'function' ? window[fn](...args) : undefined);
const go   = page => call('goPage', page);

// เรียงตามความถี่ใช้งาน — key = ปุ่มลัด Alt+key
const PAGES = [
  { id: 'dashboard',   label: 'Dashboard ภาพรวม',  icon: 'ti-layout-dashboard', c: '#1d5fd6', key: '1' },
  { id: 'meter',       label: 'จดมิเตอร์',          icon: 'ti-gauge',            c: '#0891b2', key: '2' },
  { id: 'billing',     label: 'ระบบออกบิล',         icon: 'ti-receipt-2',        c: '#7c3aed', key: '3' },
  { id: 'payments',    label: 'รับชำระเงิน',         icon: 'ti-credit-card',      c: '#15803d', key: '4' },
  { id: 'members',     label: 'สมาชิก',             icon: 'ti-users',            c: '#1d5fd6', key: '5' },
  { id: 'debtors',     label: 'ลูกหนี้ค้างชำระ',      icon: 'ti-alert-triangle',   c: '#d93036', key: '6' },
  { id: 'maintenance', label: 'ซ่อมบำรุง',           icon: 'ti-tool',             c: '#b45309', key: '7' },
  { id: 'reports',     label: 'รายงาน',             icon: 'ti-chart-bar',        c: '#0e7490', key: '8' },
  { id: 'map',         label: 'แผนที่',              icon: 'ti-map-2',            c: '#7c3aed', key: '9' },
  { id: 'settings',    label: 'ตั้งค่าระบบ',          icon: 'ti-settings-2',       c: '#5c6175', key: '0' },
  { id: 'users',       label: 'จัดการผู้ใช้',         icon: 'ti-users-group',      c: '#5c6175' },
  { id: 'portal',      label: 'ตรวจสอบบิลสมาชิก',    icon: 'ti-user-search',      c: '#0891b2' },
];

const ACTIONS = [
  { label: 'บันทึกรับเงิน',          sub: 'เงินสด / PromptPay / โอน', icon: 'ti-cash',            c: '#15803d', kw: 'ชำระ จ่าย payment cash', run: () => call('openCashModal') },
  { label: 'เพิ่มสมาชิกใหม่',        sub: 'ลงทะเบียนผู้ใช้น้ำ',        icon: 'ti-user-plus',       c: '#1d5fd6', kw: 'member add',            run: () => { go('members'); call('openAddMember'); } },
  { label: 'เพิ่มงานซ่อมบำรุง',      sub: 'แจ้งซ่อมท่อ / มิเตอร์',      icon: 'ti-tool',            c: '#b45309', kw: 'ซ่อม maintenance',      run: () => { go('maintenance'); call('openAddMaintenance'); } },
  { label: 'บันทึกเปลี่ยนมิเตอร์',    sub: 'ประวัติเปลี่ยนมิเตอร์',      icon: 'ti-replace',         c: '#b45309', kw: 'meter replace',         run: () => { go('maintenance'); call('openMeterReplaceModal'); } },
  { label: 'พิมพ์ใบแจ้งหนี้หลายใบ',   sub: 'พิมพ์เป็นชุด',             icon: 'ti-printer',         c: '#7c3aed', kw: 'print bill',            run: () => call('openBatchPrint') },
  { label: 'งวดบิล / ปิดงวด',        sub: 'ล็อกงวดบัญชี',             icon: 'ti-calendar-stats',  c: '#7c3aed', kw: 'period close',          run: () => call('openBillingPeriods') },
  { label: 'ปิดยอดประจำวัน',         sub: 'สรุปเงินสดรับวันนี้',        icon: 'ti-report-money',   c: '#15803d', kw: 'cash close daily',      run: () => call('openCashClose') },
  { label: 'พิมพ์หนังสือแจ้งลูกหนี้',  sub: 'ทวงถามค้างชำระ',           icon: 'ti-mail',            c: '#d93036', kw: 'notice debtor',         run: () => call('openNoticePrint') },
  { label: 'สำรองข้อมูล',            sub: 'ดาวน์โหลดไฟล์ backup',      icon: 'ti-database-export', c: '#0e7490', kw: 'backup',                run: () => call('downloadBackup') },
  { label: 'รีเฟรชข้อมูล',           sub: 'ดึงข้อมูลล่าสุดจากเซิร์ฟเวอร์', icon: 'ti-refresh',       c: '#0891b2', kw: 'refresh reload',        run: () => call('_manualRefresh') },
  { label: 'ย่อ / ขยายเมนูด้านข้าง',  sub: '',                         icon: 'ti-layout-sidebar',  c: '#5c6175', kw: 'sidebar menu',          run: () => document.querySelector('.btn-menu')?.click() },
  { label: 'เปลี่ยนรหัสผ่าน',        sub: '',                         icon: 'ti-key',             c: '#5c6175', kw: 'password',              run: () => call('openChangePwdModal') },
  { label: 'โหมดความเป็นส่วนตัว',     sub: 'เบลอชื่อ/เบอร์บนจอ (เปิดให้คนอื่นเห็นหน้าจอ)', icon: 'ti-eye-off', c: '#5b6b86', kw: 'privacy pdpa blur ซ่อนชื่อ', run: () => call('togglePrivacyMode') },
  { label: 'ออกจากระบบ',            sub: '',                         icon: 'ti-logout',          c: '#d93036', kw: 'logout signout',        run: () => call('doSignOut') },
];

// ─── helpers ─────────────────────────────────────────────────
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function hl(text, q) {
  const t = esc(text);
  if (!q) return t;
  const i = String(text).toLowerCase().indexOf(q);
  if (i < 0) return t;
  return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
}

function pageVisible(id) {
  if (!document.getElementById('page-' + id)) return false;
  const nav = document.querySelector(`.sidebar .nav-item[data-page="${id}"]`);
  return !nav || nav.style.display !== 'none';
}

const memberName = m => `${m.firstName || ''} ${m.lastName || ''}`.trim();

function unpaidBillOf(memberId) {
  const list = (appState.bills || []).filter(b => b.memberId === memberId && (b.status === 'overdue' || b.status === 'pending'));
  return list.sort((a, b) => String(b.period).localeCompare(String(a.period)))[0] || null;
}

function openMeterFor(m) {
  call('gotoMeter', memberName(m), m.meter, m.id);
  setTimeout(() => document.getElementById('meter-new-val')?.focus(), 120);
}

function payFor(m) {
  const b = unpaidBillOf(m.id);
  if (b) call('openCashModalForBill', b.id);
  else call('toast', `${memberName(m)} ไม่มีบิลค้างชำระ`, 'success');
}

// ═══════════════ COMMAND PALETTE ═══════════════
let _cmd = null, _items = [], _sel = 0, _lastFocus = null;

function buildPalette() {
  _cmd = document.createElement('div');
  _cmd.className = 'lx-cmd';
  _cmd.hidden = true;
  _cmd.innerHTML = `
    <div class="lx-cmd-box" role="dialog" aria-modal="true" aria-label="ค้นหาและคำสั่งด่วน">
      <div class="lx-cmd-in">
        <i class="ti ti-sparkles"></i>
        <input type="text" id="lx-cmd-q" autocomplete="off" spellcheck="false"
          placeholder="ค้นหาสมาชิก / มิเตอร์ / บิล / คำสั่ง" aria-label="ค้นหา" aria-controls="lx-cmd-list"/>
        <button class="lx-cmd-x" type="button" aria-label="ปิด"><span class="lx-kbd">Esc</span><i class="ti ti-x"></i></button>
      </div>
      <div class="lx-cmd-list" id="lx-cmd-list" role="listbox"></div>
      <div class="lx-cmd-ft">
        <span><span class="lx-kbd">↑</span><span class="lx-kbd">↓</span>เลือก</span>
        <span><span class="lx-kbd">Enter</span>ทำรายการ</span>
        <span><span class="lx-kbd">Shift+Enter</span>รับชำระ</span>
        <span><span class="lx-kbd">Alt+1…0</span>สลับหน้า</span>
      </div>
    </div>`;
  document.body.appendChild(_cmd);

  const q = _cmd.querySelector('#lx-cmd-q');
  q.addEventListener('input', () => { _sel = 0; renderPalette(q.value); });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); runItem(_items[_sel], e.shiftKey ? 'pay' : e.altKey ? 'info' : null); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeCommandPalette(); }
  });
  _cmd.addEventListener('mousedown', e => { if (e.target === _cmd) closeCommandPalette(); });
  _cmd.querySelector('.lx-cmd-x').addEventListener('click', () => closeCommandPalette());
  _cmd.querySelector('#lx-cmd-list').addEventListener('click', e => {
    const row = e.target.closest('.lx-cmd-it');
    if (!row) return;
    const act = e.target.closest('[data-act]')?.dataset.act || null;
    runItem(_items[+row.dataset.i], act);
  });
  _cmd.querySelector('#lx-cmd-list').addEventListener('mousemove', e => {
    const row = e.target.closest('.lx-cmd-it');
    if (row && +row.dataset.i !== _sel) { _sel = +row.dataset.i; paintSel(false); }
  });
}

function collect(raw) {
  const q = norm(raw);
  const out = [];
  const pages = PAGES.filter(p => pageVisible(p.id));

  if (!q) {
    out.push({ grp: 'ทำงานด่วน' }, ...ACTIONS.slice(0, 4).map(a => ({ type: 'action', ...a })));
    out.push({ grp: 'ไปที่หน้า' }, ...pages.map(p => ({ type: 'page', ...p })));
    return out;
  }

  const members = (appState.members || []).filter(m =>
    norm(memberName(m)).includes(q) || norm(m.meter).includes(q) ||
    norm(m.houseNo).includes(q) || norm(m.phone).replace(/-/g, '').includes(q.replace(/-/g, ''))
  ).slice(0, 8);
  if (members.length) out.push({ grp: `สมาชิก (${members.length})` }, ...members.map(m => ({ type: 'member', m })));

  if (q.length >= 3) {
    const bills = (appState.bills || []).filter(b => norm(b.id).includes(q)).slice(0, 5);
    if (bills.length) out.push({ grp: 'บิล' }, ...bills.map(b => ({ type: 'bill', b })));
  }

  const acts = ACTIONS.filter(a => norm(a.label + ' ' + a.sub + ' ' + a.kw).includes(q));
  if (acts.length) out.push({ grp: 'คำสั่ง' }, ...acts.map(a => ({ type: 'action', ...a })));

  const pg = pages.filter(p => norm(p.label + ' ' + p.id).includes(q));
  if (pg.length) out.push({ grp: 'ไปที่หน้า' }, ...pg.map(p => ({ type: 'page', ...p })));
  return out;
}

const statusChip = {
  overdue:   '<span class="pill pill-overdue" style="font-size:10.5px;padding:1px 8px">ค้างชำระ</span>',
  closed:    '<span class="pill pill-closed" style="font-size:10.5px;padding:1px 8px">ปิดมิเตอร์</span>',
  suspended: '<span class="pill pill-suspended" style="font-size:10.5px;padding:1px 8px">ระงับ</span>',
};

function renderPalette(raw) {
  const q = norm(raw);
  const rows = collect(raw);
  _items = rows.filter(r => !r.grp);
  if (_sel >= _items.length) _sel = 0;
  const list = _cmd.querySelector('#lx-cmd-list');

  if (!_items.length) {
    list.innerHTML = `<div class="lx-cmd-empty"><i class="ti ti-mood-search"></i>ไม่พบ “${esc(raw)}”<br><small>ลองค้นด้วยชื่อ เลขมิเตอร์ บ้านเลขที่ หรือเบอร์โทร</small></div>`;
    return;
  }

  let i = 0;
  list.innerHTML = rows.map(r => {
    if (r.grp) return `<div class="lx-cmd-grp">${esc(r.grp)}</div>`;
    const idx = i++;
    if (r.type === 'member') {
      const m = r.m;
      const hasDue = !!unpaidBillOf(m.id);
      return `<div class="lx-cmd-it" data-i="${idx}" role="option">
        <div class="lx-cmd-ic" style="--c:${m.status === 'overdue' ? '#d93036' : '#1d5fd6'}"><i class="ti ti-user"></i></div>
        <div class="lx-cmd-tx"><b>${hl(memberName(m), q)} ${statusChip[m.status] || ''}</b>
          <span>${hl(m.meter || '-', q)} · บ้านเลขที่ ${hl(m.houseNo || '-', q)} · ${esc(m.village || '')}</span></div>
        <div class="lx-cmd-acts">
          <button data-act="meter" class="pri" title="จดมิเตอร์ (Enter)"><i class="ti ti-gauge"></i><span>จดมิเตอร์</span></button>
          ${hasDue ? '<button data-act="pay" title="รับชำระ (Shift+Enter)"><i class="ti ti-cash"></i><span>รับชำระ</span></button>' : ''}
          <button data-act="info" title="ดูข้อมูล (Alt+Enter)"><i class="ti ti-id"></i></button>
        </div>
      </div>`;
    }
    if (r.type === 'bill') {
      const b = r.b, m = (appState.members || []).find(x => x.id === b.memberId) || {};
      const unpaid = b.status === 'overdue' || b.status === 'pending';
      return `<div class="lx-cmd-it" data-i="${idx}" role="option">
        <div class="lx-cmd-ic" style="--c:${unpaid ? '#d93036' : '#15803d'}"><i class="ti ti-receipt-2"></i></div>
        <div class="lx-cmd-tx"><b>${hl(b.id, q)} · ฿${Number(b.total || 0).toLocaleString()}</b>
          <span>${esc(memberName(m))} · รอบ ${esc(b.period || '')}</span></div>
        <div class="lx-cmd-acts">${unpaid ? '<button data-act="pay" class="pri"><i class="ti ti-cash"></i><span>รับชำระ</span></button>' : '<button data-act="info"><i class="ti ti-file-text"></i><span>ดูบิล</span></button>'}</div>
      </div>`;
    }
    const kbd = r.type === 'page' && r.key ? `<span class="lx-kbd">Alt+${r.key}</span>` : '';
    return `<div class="lx-cmd-it" data-i="${idx}" role="option">
      <div class="lx-cmd-ic" style="--c:${r.c}"><i class="ti ${r.icon}"></i></div>
      <div class="lx-cmd-tx"><b>${hl(r.label, q)}</b>${r.sub ? `<span>${esc(r.sub)}</span>` : ''}</div>
      ${kbd}
    </div>`;
  }).join('');
  paintSel(false);
}

function paintSel(scroll = true) {
  const rows = _cmd.querySelectorAll('.lx-cmd-it');
  rows.forEach(r => r.classList.toggle('on', +r.dataset.i === _sel));
  if (scroll) rows[_sel]?.scrollIntoView({ block: 'nearest' });
}

function move(d) {
  if (!_items.length) return;
  _sel = (_sel + d + _items.length) % _items.length;
  paintSel();
}

function runItem(it, act) {
  if (!it) return;
  closeCommandPalette(false);
  if (it.type === 'page')   return go(it.id);
  if (it.type === 'action') return it.run();
  if (it.type === 'member') {
    if (act === 'pay')  return payFor(it.m);
    if (act === 'info') return call('openMemberQuickView', it.m.id);
    return openMeterFor(it.m);
  }
  if (it.type === 'bill') {
    const unpaid = it.b.status === 'overdue' || it.b.status === 'pending';
    if (unpaid && act !== 'info') return call('openCashModalForBill', it.b.id);
    return call('openBillReceipt', it.b.id);
  }
}

export function openCommandPalette(prefill = '') {
  if (!_cmd) buildPalette();
  closeFab();
  _lastFocus = document.activeElement;
  _cmd.hidden = false;
  const q = _cmd.querySelector('#lx-cmd-q');
  q.value = prefill || '';
  _sel = 0;
  renderPalette(q.value);
  requestAnimationFrame(() => q.focus());
}

export function closeCommandPalette(restoreFocus = true) {
  if (!_cmd || _cmd.hidden) return;
  _cmd.hidden = true;
  if (restoreFocus) _lastFocus?.focus?.();
}

// ═══════════════ QUICK ACTION DOCK ═══════════════
let _fab = null, _scrim = null;

const FAB_ITEMS = [
  { label: 'ค้นหา / คำสั่ง', kbd: 'Ctrl K', icon: 'ti-search',    c: '#16307a', run: () => openCommandPalette() },
  { label: 'จดมิเตอร์',      kbd: 'Alt 2',  icon: 'ti-gauge',     c: '#0891b2', run: () => go('meter') },
  { label: 'รับชำระเงิน',     kbd: '',       icon: 'ti-cash',      c: '#15803d', run: () => call('openCashModal') },
  { label: 'เพิ่มสมาชิก',     kbd: '',       icon: 'ti-user-plus', c: '#1d5fd6', run: () => { go('members'); call('openAddMember'); } },
  { label: 'แจ้งงานซ่อม',     kbd: '',       icon: 'ti-tool',      c: '#b45309', run: () => { go('maintenance'); call('openAddMaintenance'); } },
];

function buildFab() {
  _scrim = document.createElement('div');
  _scrim.className = 'lx-fab-scrim';
  _scrim.addEventListener('click', closeFab);

  _fab = document.createElement('div');
  _fab.className = 'lx-fab';
  _fab.innerHTML = `
    <button class="lx-fab-main" aria-label="งานด่วน" aria-expanded="false" title="งานด่วน"><i class="ti ti-plus"></i></button>
    <div class="lx-fab-items">
      ${FAB_ITEMS.map((f, i) => `
        <button class="lx-fab-it" data-i="${i}" tabindex="-1">
          <span class="lx-fab-lb">${esc(f.label)}${f.kbd ? `<kbd>${f.kbd}</kbd>` : ''}</span>
          <span class="lx-fab-ic" style="--c:${f.c}"><i class="ti ${f.icon}"></i></span>
        </button>`).join('')}
    </div>`;
  _fab.querySelector('.lx-fab-main').addEventListener('click', () => (_fab.classList.contains('open') ? closeFab() : openFab()));
  _fab.querySelectorAll('.lx-fab-it').forEach(b => b.addEventListener('click', () => { closeFab(); FAB_ITEMS[+b.dataset.i].run(); }));
  document.body.append(_scrim, _fab);
  autoHideFab();
}

// เลื่อนลง = ซ่อนปุ่มลอยให้เห็นเนื้อหาท้ายหน้า, เลื่อนขึ้น/อยู่บนสุด = แสดงกลับ (ใช้ผลเฉพาะมือถือ ดู luxe.css)
function autoHideFab() {
  const ca = document.querySelector('.content-area');
  if (!ca) return;
  let last = ca.scrollTop;
  ca.addEventListener('scroll', () => {
    const y = ca.scrollTop, d = y - last;
    if (Math.abs(d) < 8) return;
    _fab.classList.toggle('lx-fab-away', d > 0 && y > 80 && !_fab.classList.contains('open'));
    last = y;
  }, { passive: true });
}

function openFab() {
  _fab.classList.add('open');
  _scrim.classList.add('on');
  _fab.querySelector('.lx-fab-main').setAttribute('aria-expanded', 'true');
  _fab.querySelectorAll('.lx-fab-it').forEach(b => (b.tabIndex = 0));
}

function closeFab() {
  if (!_fab) return;
  _fab.classList.remove('open');
  _scrim.classList.remove('on');
  _fab.querySelector('.lx-fab-main').setAttribute('aria-expanded', 'false');
  _fab.querySelectorAll('.lx-fab-it').forEach(b => (b.tabIndex = -1));
}

// ═══════════════ KEYBOARD SHORTCUTS ═══════════════
const isTyping = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const appReady = () => document.getElementById('auth-overlay')?.style.display === 'none'
  && document.getElementById('loading-overlay')?.style.display === 'none';

function onKey(e) {
  if (!appReady()) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'k') {
    e.preventDefault();
    _cmd && !_cmd.hidden ? closeCommandPalette() : openCommandPalette();
    return;
  }
  if (e.key === 'Escape') { closeFab(); return; }
  if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit\d$/.test(e.code)) {
    const p = PAGES.find(x => x.key === e.code.slice(5));
    if (p && pageVisible(p.id)) { e.preventDefault(); closeCommandPalette(false); go(p.id); }
    return;
  }
  if (e.key === '/' && !isTyping(e.target) && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    openCommandPalette();
  }
}

// ═══════════════ 3D TILT (mouse only) ═══════════════
const TILT_SEL = '.kpi-card,.rpt-card';
let _tiltEl = null;

function tiltReset(el) {
  el.classList.remove('lx-tilting');
  el.style.removeProperty('--rx');
  el.style.removeProperty('--ry');
}

function onTiltMove(e) {
  if (e.pointerType !== 'mouse') return;
  const el = e.target.closest?.(TILT_SEL);
  if (_tiltEl && _tiltEl !== el) { tiltReset(_tiltEl); _tiltEl = null; }
  if (!el) return;
  _tiltEl = el;
  const r = el.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
  el.classList.add('lx-tilting');
  el.style.setProperty('--ry', ((px - 0.5) * 9).toFixed(2) + 'deg');
  el.style.setProperty('--rx', ((0.5 - py) * 9).toFixed(2) + 'deg');
  el.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
  el.style.setProperty('--my', (py * 100).toFixed(1) + '%');
}

// ═══════════════ BUTTON RIPPLE ═══════════════
function onRipple(e) {
  const btn = e.target.closest?.('.btn,.lx-fab-main');
  if (!btn || btn.disabled) return;
  const r = btn.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2.2;
  const s = document.createElement('span');
  s.className = 'lx-ripple';
  Object.assign(s.style, { width: size + 'px', height: size + 'px', left: (e.clientX - r.left - size / 2) + 'px', top: (e.clientY - r.top - size / 2) + 'px' });
  btn.appendChild(s);
  setTimeout(() => s.remove(), 650);
}

// ═══════════════ KPI VALUE "pop" ═══════════════
function watchKpis() {
  const mo = new MutationObserver(muts => {
    const seen = new Set();
    muts.forEach(m => {
      const el = (m.target.nodeType === 3 ? m.target.parentElement : m.target)?.closest?.('.kpi-val');
      if (!el || seen.has(el)) return;
      seen.add(el);
      el.classList.remove('lx-pop');
      void el.offsetWidth;
      el.classList.add('lx-pop');
    });
  });
  document.querySelectorAll('.kpi-val').forEach(el => mo.observe(el, { childList: true, characterData: true, subtree: true }));
}

// ═══════════════ INIT ═══════════════
export function initLuxe() {
  buildFab();
  document.addEventListener('keydown', onKey);
  if (matchMedia('(hover:hover) and (pointer:fine)').matches && !matchMedia('(prefers-reduced-motion:reduce)').matches) {
    document.addEventListener('pointermove', onTiltMove, { passive: true });
    document.addEventListener('pointerleave', () => { if (_tiltEl) { tiltReset(_tiltEl); _tiltEl = null; } });
  }
  document.addEventListener('pointerdown', onRipple, { passive: true });
  watchKpis();

  // ปุ่มงานด่วนแสดงเฉพาะหน้า Dashboard (หน้าอื่นมีปุ่มของตัวเอง ปุ่มลอยไปบังเนื้อหา)
  // และซ่อนขณะยังไม่ล็อกอิน / กำลังโหลด
  const dash = document.getElementById('page-dashboard');
  const syncFab = () => {
    const ready = appReady();
    _fab.style.display = ready && dash?.classList.contains('active') ? '' : 'none';
    if (_fab.style.display === 'none') closeFab();
    if (!ready) closeCommandPalette(false);
  };
  const mo = new MutationObserver(syncFab);
  ['auth-overlay', 'loading-overlay'].forEach(id => {
    const el = document.getElementById(id);
    if (el) mo.observe(el, { attributes: true, attributeFilter: ['style'] });
  });
  if (dash) mo.observe(dash, { attributes: true, attributeFilter: ['class'] });
  syncFab();
}
