// ─── Select Picker ─────────────────────────────────────────────
// แทนรายการตัวเลือกแบบ native ของ <select> ทุกตัวในระบบ — รายการ native วาดโดยเบราว์เซอร์/OS
// คุมขนาดด้วย CSS ไม่ได้ (บนมือถือ/จอที่ย่อขยายจะใหญ่กว่าส่วนอื่นมาก) จึงเปิด popover ของเราเอง
// ที่ใช้ขนาดตัวอักษรเท่ากับช่องเลือกนั้นแทน
//   • <select> เดิมยังเก็บค่าเหมือนเดิม — เลือกแล้วยิง input + change (onchange เดิมทำงานต่อได้)
//   • ไม่ยุ่งกับ select ที่เป็น multiple / size>1 / disabled หรือใส่ data-native
//   • คีย์บอร์ด: Space / F4 / Alt+↓ เปิด, ↑↓ Home End PgUp PgDn เลื่อน, Enter เลือก, Esc ปิด, พิมพ์อักษรเพื่อค้น
// สไตล์อยู่ที่ styles/select-picker.css
// ──────────────────────────────────────────────────────────────
import { esc } from '../../utils/dom.util.js';

let _pop = null, _sel = null, _via = '', _active = -1;
let _touch = null, _typed = '', _typedAt = 0;

const eligible = el => el instanceof HTMLSelectElement && !el.multiple && el.size <= 1 && !el.disabled && !('native' in el.dataset);
const selectOf = t => { const s = t?.closest?.('select'); return eligible(s) ? s : null; };
const isDisabled = o => o.disabled || (o.parentElement?.tagName === 'OPTGROUP' && o.parentElement.disabled);
const items = () => _pop ? [..._pop.querySelectorAll('.sp-opt')] : [];

// ─── open / close ────────────────────────────────────────────
function open(s, via) {
  close(false);
  _sel = s; _via = via;

  const cs  = getComputedStyle(s);
  const rgb = (cs.color.match(/\d+/g) || [0, 0, 0]).map(Number);
  const dark = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 160; // ตัวอักษรสว่าง = ช่องพื้นเข้ม

  const optHtml = (o, inGrp) => {
    if (o.hidden) return '';
    const cls = ['sp-opt', inGrp && 'in-grp', o.selected && 'sel', isDisabled(o) && 'dis'].filter(Boolean).join(' ');
    return `<div class="${cls}" role="option" data-i="${o.index}" aria-selected="${o.selected}"${isDisabled(o) ? ' aria-disabled="true"' : ''}>`
         + `<span>${esc(o.label || o.text || ' ')}</span><i class="ti ti-check"></i></div>`;
  };
  let html = '';
  for (const el of s.children) {
    if (el.tagName === 'OPTGROUP') {
      html += `<div class="sp-grp">${esc(el.label)}</div>` + [...el.children].map(o => optHtml(o, true)).join('');
    } else if (el.tagName === 'OPTION') {
      html += optHtml(el, false);
    }
  }

  _pop = document.createElement('div');
  _pop.className = 'sp-pop' + (dark ? ' dark' : '');
  _pop.setAttribute('role', 'listbox');
  _pop.tabIndex = -1;
  _pop.style.fontSize   = cs.fontSize;
  _pop.style.fontFamily = cs.fontFamily;
  _pop.innerHTML = html || '<div class="sp-grp">ไม่มีตัวเลือก</div>';
  _pop.addEventListener('click', onPopClick);
  _pop.addEventListener('pointermove', onPopHover);
  _pop.addEventListener('keydown', onPopKey);
  document.body.appendChild(_pop);

  place();
  setActive(s.selectedIndex, true);
  s.setAttribute('aria-expanded', 'true');
  if (via === 'touch') document.activeElement?.blur?.(); // หุบคีย์บอร์ดเหมือน picker ของ OS
  else _pop.focus({ preventScroll: true });
}

function close(restoreFocus) {
  if (!_pop) return;
  _pop.remove();
  _pop = null;
  const s = _sel;
  _sel = null; _active = -1;
  s.setAttribute('aria-expanded', 'false');
  if (restoreFocus && _via !== 'touch' && s.isConnected) s.focus({ preventScroll: true });
}

function place() {
  const r  = _sel.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.visualViewport?.height ?? innerHeight;
  const gap = 4, margin = 8;

  _pop.style.minWidth = Math.min(Math.max(r.width, 140), vw - margin * 2) + 'px';
  _pop.style.maxWidth = (vw - margin * 2) + 'px';

  const below = vh - r.bottom - gap - margin;
  const above = r.top - gap - margin;
  const up = _pop.scrollHeight > below && above > below;
  _pop.style.maxHeight = Math.max(120, Math.min(320, up ? above : below)) + 'px';
  _pop.classList.toggle('up', up);

  _pop.style.left = Math.max(margin, Math.min(r.left, vw - margin - _pop.offsetWidth)) + 'px';
  if (up) { _pop.style.top = ''; _pop.style.bottom = (innerHeight - r.top + gap) + 'px'; }
  else    { _pop.style.bottom = ''; _pop.style.top = (r.bottom + gap) + 'px'; }
}

function setActive(index, center) {
  _active = index;
  for (const it of items()) {
    const on = +it.dataset.i === index;
    it.classList.toggle('act', on);
    if (on) it.scrollIntoView({ block: center ? 'center' : 'nearest' });
  }
}

function choose(index) {
  const s = _sel, o = s?.options[index];
  if (!o || isDisabled(o)) return;
  const changed = s.selectedIndex !== index;
  close(true);
  if (!changed) return;
  s.selectedIndex = index;
  s.dispatchEvent(new Event('input',  { bubbles: true }));
  s.dispatchEvent(new Event('change', { bubbles: true }));
}

// ─── popover events ──────────────────────────────────────────
function onPopClick(e) {
  const it = e.target.closest('.sp-opt');
  if (it) choose(+it.dataset.i);
}

function onPopHover(e) {
  if (e.pointerType !== 'mouse') return;
  const it = e.target.closest('.sp-opt:not(.dis)');
  if (it && +it.dataset.i !== _active) setActive(+it.dataset.i, false);
}

function onPopKey(e) {
  const list = items().filter(it => !it.classList.contains('dis'));
  const pos  = list.findIndex(it => +it.dataset.i === _active);
  const go   = p => { const it = list[Math.max(0, Math.min(list.length - 1, p))]; if (it) setActive(+it.dataset.i, false); };

  switch (e.key) {
    case 'ArrowDown': go(pos < 0 ? 0 : pos + 1); break;
    case 'ArrowUp':   go(pos < 0 ? 0 : pos - 1); break;
    case 'PageDown':  go(pos + 8); break;
    case 'PageUp':    go(pos - 8); break;
    case 'Home':      go(0); break;
    case 'End':       go(list.length - 1); break;
    case 'Enter':
    case ' ':         choose(_active); break;
    case 'Escape':
    case 'Tab':       close(true); break;
    default:
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      _typed = (Date.now() - _typedAt > 700 ? '' : _typed) + e.key.toLowerCase();
      _typedAt = Date.now();
      { const hit = list.find(it => it.textContent.trim().toLowerCase().startsWith(_typed)); if (hit) setActive(+hit.dataset.i, false); }
  }
  e.preventDefault();
  e.stopPropagation(); // Esc ไม่ให้ไปปิด modal ที่อยู่ข้างหลัง
}

// ─── document events (เปิดแทนรายการ native) ────────────────────
function onMouseDown(e) {
  if (e.button !== 0) return;
  const s = selectOf(e.target);
  if (!s) return;
  e.preventDefault();
  if (_sel === s) close(true); else open(s, 'mouse');
}

function onTouchStart(e) {
  const s = selectOf(e.target);
  _touch = s && e.touches.length === 1 ? { s, x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
}

function onTouchEnd(e) {
  const t = _touch;
  _touch = null;
  if (!t || !e.cancelable) return;
  const p = e.changedTouches[0];
  if (Math.abs(p.clientX - t.x) > 10 || Math.abs(p.clientY - t.y) > 10) return; // ปัดเลื่อนจอ ไม่ใช่แตะ
  e.preventDefault(); // กันทั้ง picker ของ OS และ mousedown/click ที่ตามมา
  if (_sel === t.s) close(false); else open(t.s, 'touch');
}

function onKeyDown(e) {
  const s = selectOf(e.target);
  if (!s || e.target !== s) return;
  if (e.key === ' ' || e.key === 'F4' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) {
    e.preventDefault();
    open(s, 'key');
  }
}

function onOutside(e) {
  if (!_pop || _pop.contains(e.target) || _sel.contains(e.target)) return;
  close(false);
}

// เลื่อนจอ / คีย์บอร์ดมือถือหุบ-กาง → ย้ายตามช่องเลือก, ช่องหลุดจอแล้วจึงปิด
let _raf = 0;
function follow(e) {
  if (!_pop || (e?.target instanceof Node && _pop.contains(e.target)) || _raf) return;
  _raf = requestAnimationFrame(() => {
    _raf = 0;
    if (!_pop) return;
    const r = _sel.getBoundingClientRect();
    if (!_sel.isConnected || r.bottom < 0 || r.top > innerHeight || (!r.width && !r.height)) close(false);
    else place();
  });
}

export function initSelectPicker() {
  document.addEventListener('mousedown',   onMouseDown,  true);
  document.addEventListener('touchstart',  onTouchStart, { capture: true, passive: true });
  document.addEventListener('touchend',    onTouchEnd,   { capture: true, passive: false });
  document.addEventListener('keydown',     onKeyDown,    true);
  document.addEventListener('pointerdown', onOutside,    true);
  document.addEventListener('scroll',      follow,       true);
  window.addEventListener('resize', follow);
  window.visualViewport?.addEventListener('resize', follow);
  window.addEventListener('blur', () => close(false));
}
