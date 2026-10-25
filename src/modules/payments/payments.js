// ─── Payments Module ───────────────────────────────────────────
import { nowLocal, todayISO, addDaysISO } from '../../utils/time.util.js';
import { appState } from '../../state/app.state.js';
import { esc, jsArg, toast } from '../../utils/dom.util.js';
import { channelMap, getChannelDisplay } from '../../config/ui.config.js';
import { sbInsertPayment, sbApprovePayment, sbCancelPayment, sbUpdatePayment } from '../../services/data-loader.service.js';
import { saveToStorage } from '../../services/storage.service.js';
import { currentUser } from '../../services/auth.service.js';
import { uploadImage, signedImageUrl } from '../../services/files.service.js';
import { promptPaySvg } from '../../utils/promptpay.js';
import { openModal, closeModal, busyButton } from '../../components/modal/modal.js';
import { printPaymentReceipt } from '../documents/documents.js';
import { sendOverdueReminders } from '../notify/notify.js';

const payStatusMap = {
  approved:  { cls: 'pill-paid',    label: 'อนุมัติแล้ว' },
  pending:   { cls: 'pill-pending', label: 'รอตรวจสอบ' },
  rejected:  { cls: 'pill-overdue', label: 'ปฏิเสธ' },
  cancelled: { cls: 'pill-closed',  label: 'ยกเลิก' },
};

let _slipFile = null;   // สลิปที่เลือกในหน้าบันทึกการชำระ (อัปโหลดตอนบันทึก)

const _channelMeta = {
  cash:      { title: 'บันทึกรับเงินสด',       icon: 'ti-cash',          showRef: false, refPlaceholder: '' },
  promptpay: { title: 'บันทึกชำระ PromptPay',  icon: 'ti-qrcode',        showRef: true,  refPlaceholder: 'เลขอ้างอิง PromptPay' },
  bank:      { title: 'บันทึกโอนธนาคาร',       icon: 'ti-building-bank', showRef: true,  refPlaceholder: 'เลขที่อ้างอิงการโอน' },
  mobile:    { title: 'บันทึกชำระ Mobile App', icon: 'ti-device-mobile', showRef: true,  refPlaceholder: 'Transaction ID' },
};

// ช่องทางที่เปิดใช้งานใน ตั้งค่า › ช่องทางชำระ (เรียงตาม sortOrder) — ยังไม่โหลด Master Data ใช้ครบทุกช่องทาง
function _activeChannels() {
  const md = appState.masterData?.payment_channel;
  if (!md?.length) return Object.keys(_channelMeta);
  return md.filter(x => x.isActive && _channelMeta[x.code]).map(x => x.code);
}

function _renderNewButtons() {
  const grid = document.getElementById('pay-new-grid');
  if (!grid) return;
  const codes = _activeChannels();
  // เงินสดเป็นปุ่มหลักเต็มแถวเสมอ (ถ้าเปิดใช้งาน)
  const ordered = codes.includes('cash') ? ['cash', ...codes.filter(c => c !== 'cash')] : codes;
  grid.innerHTML = ordered.length
    ? ordered.map(code => {
        const ch = getChannelDisplay(code);
        return `<button type="button" class="pay-ch${code === 'cash' ? ' pay-ch-main' : ''}" onclick="openCashModal(${jsArg(code)})"><i class="ti ${esc(ch.icon)}"></i><span>${esc(ch.label)}</span></button>`;
      }).join('')
    : `<div class="text-muted" style="grid-column:1/-1;font-size:12px">ยังไม่ได้เปิดใช้งานช่องทางชำระ — ตั้งค่า › ช่องทางชำระ</div>`;
}

// ── หน้ารายการ: กรองสถานะ/ช่วงวัน/ค้นหา · จัดกลุ่มตามวัน · แสดงทีละ _PAGE ──
const _PAGE = 50;
const _pf = { status: 'all', range: 'all', q: '', limit: _PAGE };
const _TH_MON = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const _money = n => '฿' + Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

function _thDate(d) {
  const [y, m, dd] = String(d).split('-').map(Number);
  return y && m && dd ? `${dd} ${_TH_MON[m - 1]} ${y + 543}` : (d || '—');
}
function _dayLabel(d) {
  if (d === todayISO()) return 'วันนี้';
  if (d === addDaysISO(-1)) return 'เมื่อวาน';
  return _thDate(d);
}

function _matchPay(p, members) {
  const f = _pf;
  if (f.status === 'pending'  && p.status !== 'pending')  return false;
  if (f.status === 'approved' && p.status !== 'approved') return false;
  if (f.status === 'void'     && p.status !== 'cancelled' && p.status !== 'rejected') return false;
  if (f.range !== 'all') {
    const from = f.range === 'today' ? todayISO() : addDaysISO(1 - Number(f.range));
    if (String(p.paidAt).slice(0, 10) < from) return false;
  }
  if (f.q) {
    const m = members.get(p.memberId) || {};
    const q = f.q.toLowerCase();
    return [p.billId, p.receiptNo, p.txRef, m.id, `${m.firstName || ''} ${m.lastName || ''}`, m.houseNo, m.meter]
      .some(v => String(v || '').toLowerCase().includes(q));
  }
  return true;
}

function _payRow(p, m) {
  const ch = channelMap[p.channel] || { label: p.channel, icon: 'ti-cash' };
  const st = payStatusMap[p.status] || payStatusMap.pending;
  const timeStr = String(p.paidAt).split(' ')[1] || '';
  const slipBtn = p.slipPath
    ? `<button class="btn btn-secondary btn-xs" onclick="viewPaymentSlip(${jsArg(p.id)})" title="ดูสลิป"><i class="ti ti-photo"></i></button>` : '';
  let actionBtns;
  if (p.status === 'pending') {
    actionBtns = `${slipBtn}<button class="btn btn-primary btn-xs" onclick="approvePayment(${jsArg(p.id)})"><i class="ti ti-check"></i>อนุมัติ</button>
       <button class="btn btn-danger btn-xs" onclick="rejectPayment(${jsArg(p.id)})" title="ปฏิเสธ"><i class="ti ti-x"></i></button>`;
  } else if (p.status === 'approved') {
    actionBtns = `${slipBtn}<button class="btn btn-secondary btn-xs" onclick="printReceiptByPayment(${jsArg(p.id)})" title="พิมพ์ใบเสร็จ${p.printCount ? ' (พิมพ์แล้ว ' + p.printCount + ' ครั้ง)' : ''}"><i class="ti ti-printer"></i></button>
       <button class="btn btn-xs pay-btn-void" onclick="cancelPayment(${jsArg(p.id)})" title="ยกเลิกใบเสร็จ"><i class="ti ti-ban"></i></button>`;
  } else if (p.status === 'cancelled' && p.receiptNo) {
    actionBtns = `${slipBtn}<button class="btn btn-secondary btn-xs" onclick="printReceiptByPayment(${jsArg(p.id)})" title="พิมพ์ใบเสร็จที่ยกเลิก"><i class="ti ti-printer"></i></button>`;
  } else {
    actionBtns = slipBtn;
  }
  const sub = [m.houseNo ? 'บ้าน ' + esc(m.houseNo) : '', esc(p.billId || '—'),
    p.receiptNo ? '<span class="mono">' + esc(p.receiptNo) + '</span>' : '',
    p.receivedByName ? 'รับโดย ' + esc(p.receivedByName) : ''].filter(Boolean).join(' · ');
  return `<div class="pay-row" data-st="${esc(p.status)}">
    <div class="pay-row-time mono">${esc(timeStr)}</div>
    <div class="pay-row-ch" data-ch="${esc(p.channel)}" title="${esc(ch.label)}"><i class="ti ${ch.icon}"></i><span>${esc(ch.label)}</span></div>
    <div class="pay-row-info">
      <div class="pay-row-name">${esc(m.firstName || '')} ${esc(m.lastName || '')}</div>
      <div class="pay-row-sub">${sub}</div>
    </div>
    <div class="pay-row-amt">${_money(p.amount)}</div>
    <div class="pay-row-st"><span class="pill ${st.cls}">${st.label}</span></div>
    <div class="pay-row-act">${actionBtns}</div>
  </div>`;
}

const _sum = (arr, k) => arr.reduce((s, x) => s + Number(x[k] || 0), 0);

function _renderToday(todayOk) {
  const body = document.getElementById('pay-today-body');
  if (!body) return;
  // ช่องทางที่ปิดแล้วแต่มีรับเงินวันนี้ ยังต้องแสดงเพื่อให้ยอดรวมตรง
  const active = _activeChannels();
  const codes  = Object.keys(_channelMeta).filter(c => active.includes(c) || todayOk.some(p => p.channel === c));
  const rows = codes.map(code => {
    const ch   = getChannelDisplay(code);
    const list = todayOk.filter(p => p.channel === code);
    return `<div class="pay-tch${list.length ? '' : ' zero'}" data-ch="${code}">
      <i class="ti ${ch.icon}"></i><span class="pay-tch-lbl">${esc(ch.label)}</span>
      <span class="pay-tch-n">${list.length}</span>
      <span class="pay-tch-amt">${_money(_sum(list, 'amount'))}</span>
    </div>`;
  }).join('');
  const dateEl = document.getElementById('pay-today-date');
  if (dateEl) dateEl.textContent = _thDate(todayISO());
  body.innerHTML = `<div class="pay-today-total"><span>รวมรับเงิน</span><b>${_money(_sum(todayOk, 'amount'))}</b><small>${todayOk.length} รายการ</small></div>
    <div class="pay-tch-list">${rows}</div>`;
}

function _syncToolbar(pendingN) {
  document.querySelectorAll('#page-payments .pay-seg').forEach(seg => {
    const key = seg.dataset.payKey;
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(_pf[key])));
  });
  const n = document.getElementById('pay-seg-pending');
  if (n) n.textContent = pendingN || '';
  const q = document.getElementById('pay-q');
  if (q && q.value.trim() !== _pf.q) q.value = _pf.q;
}

window._payFilter = function(key, val) {
  _pf[key] = key === 'q' ? String(val || '').trim() : val;
  _pf.limit = _PAGE;
  renderPayments();
};
window._payMore  = function() { _pf.limit += _PAGE; renderPayments(); };
window._payReset = function() {
  Object.assign(_pf, { status: 'all', range: 'all', q: '', limit: _PAGE });
  renderPayments();
};

let _segBound = false;
function _bindSeg() {
  const page = document.getElementById('page-payments');
  if (_segBound || !page) return;
  _segBound = true;
  page.addEventListener('click', e => {
    const b = e.target.closest('.pay-seg button');
    if (b) window._payFilter(b.closest('.pay-seg').dataset.payKey, b.dataset.v);
  });
}

export function renderPayments() {
  const { payments, bills } = appState;
  const el = document.getElementById('payments-card-list');
  if (!el) return;
  _bindSeg();
  const members = new Map(appState.members.map(m => [m.id, m]));

  // ── ตัวเลขสรุป ──
  const today      = todayISO();
  const todayOk    = payments.filter(p => p.paidAt.startsWith(today) && p.status === 'approved');
  const pendingPay = payments.filter(p => p.status === 'pending');
  const unpaidB    = bills.filter(b => b.status === 'overdue' || b.status === 'pending');
  const overdueB   = bills.filter(b => b.status === 'overdue');
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('pk-unpaid',    _money(_sum(unpaidB, 'total')));
  set('pk-unpaid-n',  unpaidB.length + ' บิล');
  set('pk-today',     _money(_sum(todayOk, 'amount')));
  set('pk-today-n',   todayOk.length + ' รายการ');
  set('pk-pending',   pendingPay.length + ' รายการ');
  set('pk-pending-n', pendingPay.length ? _money(_sum(pendingPay, 'amount')) : 'ไม่มีค้าง');
  set('pk-overdue',   _money(_sum(overdueB, 'total')));
  set('pk-overdue-n', new Set(overdueB.map(b => b.memberId)).size + ' ราย');
  document.getElementById('pk-pending-card')?.classList.toggle('alert', pendingPay.length > 0);
  _syncToolbar(pendingPay.length);
  _renderNewButtons();
  _renderToday(todayOk);

  // ── รายการ ──
  const sorted = payments.filter(p => _matchPay(p, members)).sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  const shown  = sorted.slice(0, _pf.limit);
  if (!shown.length) {
    const filtered = _pf.status !== 'all' || _pf.range !== 'all' || _pf.q;
    el.innerHTML = `<div class="pay-empty"><i class="ti ti-receipt-off"></i><span>${filtered ? 'ไม่พบรายการตามตัวกรอง' : 'ยังไม่มีรายการชำระเงิน'}</span>
      ${filtered ? `<button type="button" class="btn btn-secondary btn-sm" onclick="window._payReset()">ล้างตัวกรอง</button>` : ''}</div>`;
  } else {
    // จัดกลุ่มตามวัน — หัวกลุ่มบอกยอดที่อนุมัติของวันนั้น (เฉพาะรายการที่กรองแล้ว)
    const groups = new Map();
    shown.forEach(p => {
      const d = String(p.paidAt).slice(0, 10);
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(p);
    });
    el.innerHTML = [...groups.entries()].map(([d, list]) =>
      `<div class="pay-day"><span>${_dayLabel(d)}</span><small>${list.length} รายการ · รับ ${_money(_sum(list.filter(p => p.status === 'approved'), 'amount'))}</small></div>`
      + list.map(p => _payRow(p, members.get(p.memberId) || {})).join('')
    ).join('') + (sorted.length > shown.length
      ? `<button type="button" class="pay-more" onclick="window._payMore()">แสดงเพิ่ม (เหลืออีก ${sorted.length - shown.length} รายการ)</button>` : '');
  }
  set('pay-foot-txt', `แสดง ${shown.length} จาก ${sorted.length} รายการ${sorted.length !== payments.length ? ` · ทั้งหมด ${payments.length}` : ''}`);
}

const _busy = new Set();   // payment id / bill id ที่กำลังบันทึก — กันกดซ้ำ

export async function approvePayment(pid) {
  const { payments, bills } = appState;
  const p = payments.find(x => x.id === pid); if (!p) return;
  if (_busy.has(pid)) return;
  _busy.add(pid);
  const now   = nowLocal();
  const saved = await sbApprovePayment(pid, now);   // server ออกเลขใบเสร็จให้
  _busy.delete(pid);
  if (!saved) return;
  Object.assign(p, saved, { approvedBy: currentUser?.id || 'admin' });
  const receiptNo = saved.receiptNo;
  const b = bills.find(x => x.id === p.billId);
  if (b) b.status = 'paid';   // server ตั้งสถานะบิลเองจากใบเสร็จ
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
  const xfer        = document.getElementById('cp-xfer');
  const cashSection = document.getElementById('cp-cash-section');
  const refInp      = document.getElementById('cp-ref');
  const isCash      = channel === 'cash';
  if (xfer) {
    xfer.style.display = meta.showRef ? '' : 'none';
    xfer.classList.toggle('has-qr', channel === 'promptpay');
  }
  if (cashSection) cashSection.style.display  = isCash ? '' : 'none';
  if (refInp)  { refInp.placeholder = meta.refPlaceholder; refInp.value = ''; }
  document.getElementById('cp-name').value = '';
  document.getElementById('cp-note').value = '';
  _autoName = '';
  _setSlip(null);
  _clearBill();
  document.getElementById('cash-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('cp-bill-q')?.focus(), 80);
}

// ── เลือกบิล: ค้นจากชื่อ/บ้านเลขที่/มิเตอร์/เลขบิล แทน dropdown ยาว ──
// บิลและยอดเงินดึงจากระบบ — เจ้าหน้าที่แก้ไม่ได้ (ยังไม่รองรับชำระบางส่วน)
let _autoName = '';   // ชื่อที่ระบบเติมให้ — ถ้าเจ้าหน้าที่พิมพ์เองแล้วจะไม่ทับ
let _cpHits = [], _cpAct = 0;
let _cpOnly = null;      // { memberId, q } — กรองเฉพาะบิลของรายเดียว (จากลิงก์ "ดูทั้งหมด")
const _CP_MAX    = 30;   // รายการที่วาดในลิสต์ค้นหา — เกินนี้ให้พิมพ์ค้นแทนการเลื่อนหา
const _CP_OTHERS = 3;    // ลิงก์ "บิลค้างใบอื่น" ของรายเดียวกันที่แสดงในการ์ด

const _isUnpaid = b => b.status === 'overdue' || b.status === 'pending';
const _fmt = n => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

function _unpaidBills() {
  return appState.bills.filter(_isUnpaid).sort((a, b) =>
    (a.status === 'overdue' ? 0 : 1) - (b.status === 'overdue' ? 0 : 1) || String(a.dueDate).localeCompare(String(b.dueDate)));
}

window._cpFilter = function() {
  const q    = (document.getElementById('cp-bill-q')?.value || '').trim().toLowerCase();
  const list = document.getElementById('cp-bill-list');
  if (!list) return;
  const { members } = appState;
  if (_cpOnly && q !== _cpOnly.q) _cpOnly = null;   // พิมพ์ค้นใหม่ = เลิกกรองรายเดียว
  const matched = _unpaidBills().filter(b => {
    if (_cpOnly) return b.memberId === _cpOnly.memberId;
    if (!q) return true;
    const m = members.find(x => x.id === b.memberId) || {};
    return [b.id, m.id, `${m.firstName || ''} ${m.lastName || ''}`, m.houseNo, m.meter]
      .some(v => String(v || '').toLowerCase().includes(q));
  });
  _cpHits = matched.slice(0, _CP_MAX);
  _cpAct = 0;
  if (!_cpHits.length) {
    list.innerHTML = `<div class="cp-empty">${q ? 'ไม่พบบิลค้างชำระที่ตรงกับ “' + esc(q) + '”' : 'ไม่มีบิลค้างชำระ'}</div>`;
    return;
  }
  list.innerHTML = _cpHits.map((b, i) => {
    const m = members.find(x => x.id === b.memberId) || {};
    return `<div class="cp-item${i === 0 ? ' act' : ''}" role="option" onclick="window._cpPick(${jsArg(b.id)})">
      <div class="cp-item-main">
        <div class="cp-item-name">${esc(m.firstName || '')} ${esc(m.lastName || '')}${b.status === 'overdue' ? '<span class="cp-tag cp-tag-od">ค้างชำระ</span>' : ''}</div>
        <div class="cp-item-sub">${m.houseNo ? 'บ้าน ' + esc(m.houseNo) + ' · ' : ''}${esc(b.id)} · รอบ ${esc(b.period || '—')}</div>
      </div>
      <div class="cp-item-amt">฿${_fmt(b.total)}</div>
    </div>`;
  }).join('') + (matched.length > _cpHits.length
    ? `<div class="cp-more">แสดง ${_cpHits.length} จาก ${matched.length} ใบ — พิมพ์ชื่อหรือบ้านเลขที่เพื่อค้นให้แคบลง</div>` : '');
  const sum = document.getElementById('cp-find-sum');
  if (sum) sum.textContent = matched.length
    ? `${q ? 'พบ' : 'ค้างทั้งหมด'} ${matched.length} ใบ · ฿${_fmt(matched.reduce((s, b) => s + b.total, 0))}` : '';
};

window._cpFindKey = function(e) {
  const list = document.getElementById('cp-bill-list');
  if (!_cpHits.length || !list) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    _cpAct = Math.max(0, Math.min(_cpHits.length - 1, _cpAct + (e.key === 'ArrowDown' ? 1 : -1)));
    list.querySelectorAll('.cp-item').forEach((el, i) => el.classList.toggle('act', i === _cpAct));
    list.querySelector('.cp-item.act')?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    window._cpPick(_cpHits[_cpAct].id);
  }
};

window._cpPick = function(billId) {
  const { bills, members } = appState;
  const b = bills.find(x => x.id === billId);
  if (!b) return;
  const m = members.find(x => x.id === b.memberId) || {};
  document.getElementById('cp-bill').value   = b.id;
  document.getElementById('cp-amount').value = b.total;
  const nameEl = document.getElementById('cp-name');
  const full   = `${m.firstName || ''} ${m.lastName || ''}`.trim();
  if (!nameEl.value.trim() || nameEl.value.trim() === _autoName) nameEl.value = full;
  _autoName = full;

  // เรียงใบเก่าสุดก่อน — ควรรับใบที่ค้างนานที่สุดก่อน
  const others = bills.filter(x => x.memberId === b.memberId && x.id !== b.id && _isUnpaid(x))
    .sort((x, y) => String(x.dueDate).localeCompare(String(y.dueDate)));
  const chip = (icon, v) => v ? `<span><i class="ti ${icon}"></i>${v}</span>` : '';
  const line = (label, v, cls = '') => v ? `<div class="${cls}"><span>${label}</span><b>${v}</b></div>` : '';
  const card = document.getElementById('cp-bill-card');
  card.innerHTML = `
    <div class="cp-bc-top">
      <div class="cp-bc-av"><i class="ti ti-user"></i></div>
      <div class="cp-bc-who">
        <div class="cp-bc-name">${esc(full || '—')}${b.status === 'overdue' ? '<span class="cp-tag cp-tag-od">ค้างชำระ</span>' : ''}</div>
        <div class="cp-bc-sub">${m.houseNo ? 'บ้านเลขที่ ' + esc(m.houseNo) + ' ' + esc(m.village || '') + ' · ' : ''}${m.meter ? 'มิเตอร์ ' + esc(m.meter) : ''}</div>
      </div>
      <button type="button" class="btn btn-secondary cp-bc-change" onclick="window._cpClear()" title="เปลี่ยนบิล"><i class="ti ti-switch-horizontal"></i><span>เปลี่ยนบิล</span></button>
    </div>
    <div class="cp-bc-chips">
      ${chip('ti-file-invoice', esc(b.id))}
      ${chip('ti-calendar', b.period ? 'รอบ ' + esc(b.period) : '')}
      ${chip('ti-clock', b.dueDate ? 'ครบ ' + esc(b.dueDate) : '')}
    </div>
    <div class="cp-bc-lines">
      ${line('ใช้น้ำ', b.usage != null ? _fmt(b.usage) + ' m³' : '')}
      ${line('ค่าน้ำ', b.waterCharge ? '฿' + _fmt(b.waterCharge) : '')}
      ${line('ค่าบริการ', b.serviceCharge ? '฿' + _fmt(b.serviceCharge) : '')}
      ${line('ค่าปรับ', b.lateFee ? '฿' + _fmt(b.lateFee) : '', 'fee')}
      ${line('ส่วนลด', b.discount ? '−฿' + _fmt(b.discount) : '', 'disc')}
    </div>
    <div class="cp-bc-total">
      <small><i class="ti ti-lock"></i><span>ยอดที่ต้องชำระ<em>ดึงจากบิล · แก้ไม่ได้</em></span></small>
      <b>฿${_fmt(b.total)}</b>
    </div>
    ${others.length ? `<div class="cp-bc-warn"><i class="ti ti-alert-triangle"></i> ผู้ใช้น้ำรายนี้ยังมีบิลค้างอีก ${others.length} ใบ
      รวม ฿${_fmt(others.reduce((s, x) => s + x.total, 0))} — สลับไปรับ:
      ${others.slice(0, _CP_OTHERS).map(x => `<a onclick="window._cpPick(${jsArg(x.id)})">รอบ ${esc(x.period || x.id)} ฿${_fmt(x.total)}</a>`).join('')}
      ${others.length > _CP_OTHERS ? `<a onclick="window._cpMember(${jsArg(String(b.memberId))})">ดูทั้งหมด ${others.length + 1} ใบ</a>` : ''}</div>` : ''}`;
  card.style.display = '';
  document.getElementById('cp-find-row').style.display = 'none';
  const recvEl = document.getElementById('cp-received');
  if (recvEl) recvEl.value = '';
  _renderQuickCash(b.total);
  _resetChangeDisplay();
  _renderPayQr();
  const isCash = document.getElementById('cp-channel').value === 'cash';
  setTimeout(() => document.getElementById(isCash ? 'cp-received' : 'cp-ref')?.focus(), 30);
};

// กลับไปลิสต์ค้นหา โดยกรองเฉพาะบิลของรายนี้
window._cpMember = function(memberId) {
  const m = appState.members.find(x => x.id === memberId);
  _clearBill();
  const q = document.getElementById('cp-bill-q');
  if (!q || !m) return;
  q.value = `${m.firstName || ''} ${m.lastName || ''}`.trim();
  _cpOnly = { memberId, q: q.value.toLowerCase() };
  window._cpFilter();
  q.focus();
};

window._cpClear = function() {
  _clearBill();
  setTimeout(() => document.getElementById('cp-bill-q')?.focus(), 30);
};

function _clearBill() {
  document.getElementById('cp-bill').value   = '';
  document.getElementById('cp-amount').value = '';
  const q = document.getElementById('cp-bill-q');
  if (q) q.value = '';
  document.getElementById('cp-bill-card').style.display = 'none';
  document.getElementById('cp-find-row').style.display  = '';
  const nameEl = document.getElementById('cp-name');
  if (nameEl.value.trim() === _autoName) nameEl.value = '';
  _autoName = '';
  const recvEl = document.getElementById('cp-received');
  if (recvEl) recvEl.value = '';
  _renderQuickCash(0);
  _resetChangeDisplay();
  _renderPayQr();
  window._cpFilter();
}

// ปุ่มลัดเงินที่ได้รับ: พอดี + ธนบัตรที่น่าจะยื่นมา (ปัดขึ้นเป็น 100 / 500 / 1000 ก่อน แล้วเติม 50 / 20 ให้ครบ 4 ปุ่ม)
const _CP_QUICK = 4;
function _renderQuickCash(total) {
  const box = document.getElementById('cp-quick');
  if (!box) return;
  document.getElementById('cp-cash-section')?.classList.toggle('idle', !total);   // ยังไม่เลือกบิล — หรี่แผงรับเงิน
  if (!total) { box.innerHTML = ''; return; }
  const opts = [total];
  for (const d of [100, 500, 1000, 50, 20]) {
    const v = Math.ceil(total / d) * d;
    if (opts.length < _CP_QUICK && v > total && !opts.includes(v)) opts.push(v);
  }
  opts.sort((a, b) => a - b);
  box.dataset.n = opts.length;   // จำนวนคอลัมน์ปุ่มลัด — ปุ่มเต็มแถวเสมอ
  box.innerHTML = opts.map(v => `<button type="button" data-v="${v}" onclick="window._cpRecv(${v})">
      <small>${v === total ? 'พอดี' : 'ทอน ฿' + _fmt(v - total)}</small>฿${_fmt(v)}</button>`).join('');
}

window._cpRecv = function(v) {
  const el = document.getElementById('cp-received');
  if (!el) return;
  el.value = v;
  _calcChange();
  el.focus();
};

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
  const active = _activeChannels();
  document.querySelectorAll('#pay-type-modal .pay-channel-btn[data-ch]').forEach(btn => {
    btn.style.display = active.includes(btn.dataset.ch) ? 'flex' : 'none';
  });
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
  if (billId) window._cpPick(billId);
};

// ── QR พร้อมเพย์ตามยอดบิล — ให้ผู้ชำระสแกนจากหน้าจอที่จุดรับเงิน ──
// พร้อมเพย์ไอดีแบบปิดกลาง ให้เจ้าหน้าที่/ผู้จ่ายเทียบกับหน้าแอปธนาคารได้ เช่น 081-xxx-5678
function _maskPpId(id) {
  const d = String(id || '').replace(/\D/g, '');
  if (d.length === 10) return `${d.slice(0, 3)}-xxx-${d.slice(6)}`;
  return d.length > 6 ? `${d.slice(0, 2)}${'x'.repeat(d.length - 6)}${d.slice(-4)}` : d;
}

function _renderPayQr() {
  const box = document.getElementById('cp-qr');
  if (!box) return;
  const b = appState.bills.find(x => x.id === document.getElementById('cp-bill')?.value);
  document.getElementById('cp-xfer')?.classList.toggle('idle', !b);   // ยังไม่เลือกบิล — หรี่แผงโอน
  if (document.getElementById('cp-channel')?.value !== 'promptpay') { box.innerHTML = ''; return; }
  const cfg  = appState.systemConfig || {};
  const ppId = cfg.promptpay_id;
  if (!ppId) {
    box.innerHTML = `<div class="cp-qr-card cp-qr-off"><i class="ti ti-qrcode-off"></i>
      <span>ยังไม่ได้ตั้งพร้อมเพย์ไอดี</span><small>ตั้งค่า → ตั้งค่าทั่วไป</small></div>`;
    return;
  }
  const svg = b ? promptPaySvg(ppId, b.total, 148) : '';
  box.innerHTML = `<div class="cp-qr-card">
      <div class="cp-qr-hd"><i class="ti ti-qrcode"></i>THAI QR PAYMENT</div>
      <div class="cp-qr-img">${svg || '<i class="ti ti-qrcode"></i><small>เลือกบิลเพื่อสร้าง QR</small>'}</div>
      <div class="cp-qr-amt">${b ? '฿' + _fmt(b.total) : '—'}</div>
      <div class="cp-qr-to">${esc(cfg.promptpay_name || 'พร้อมเพย์')}<small>${esc(_maskPpId(ppId))}</small></div>
    </div>`;
}

// ── สลิปการโอน ─────────────────────────────────────────────────
let _slipUrl = '';   // object URL ของรูปตัวอย่าง — คืนหน่วยความจำทุกครั้งที่เปลี่ยนไฟล์
function _setSlip(file) {
  _slipFile = file;
  if (_slipUrl) URL.revokeObjectURL(_slipUrl);
  _slipUrl = file ? URL.createObjectURL(file) : '';
  const box = document.getElementById('cp-slip');
  if (!box) return;
  box.classList.toggle('has-file', !!file);
  box.innerHTML = file
    ? `<img src="${_slipUrl}" alt="สลิปการโอน"/>
       <div class="cp-slip-info"><b>${esc(file.name)}</b><small>${Math.round(file.size / 1024)} KB · คลิกเพื่อเปลี่ยนรูป</small></div>
       <button type="button" class="cp-slip-del" title="เอาสลิปออก" aria-label="เอาสลิปออก" onclick="event.stopPropagation();window._clearSlip()"><i class="ti ti-x"></i></button>`
    : `<i class="ti ti-photo-up"></i>
       <div class="cp-slip-info"><b>แนบสลิป / ถ่ายรูป</b><small>ลากไฟล์มาวาง หรือกด Ctrl+V</small></div>`;
}

window._clearSlip = () => _setSlip(null);

// วางรูปสลิปจากคลิปบอร์ด (เช่น แคปหน้าจอจาก LINE) — เฉพาะช่องทางโอน
window._pasteSlip = function (e) {
  if (document.getElementById('cp-xfer')?.style.display === 'none') return;
  const item = [...(e.clipboardData?.items || [])].find(x => x.type.startsWith('image/'));
  const f = item?.getAsFile();
  if (!f) return;
  e.preventDefault();
  _setSlip(new File([f], f.name && f.name !== 'image.png' ? f.name : `slip-${Date.now()}.png`, { type: f.type }));
};

window._pickSlip = function () {
  const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
  inp.onchange = () => { if (inp.files[0]) _setSlip(inp.files[0]); };
  inp.click();
};

window._dropSlip = function (e) {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f && f.type.startsWith('image/')) _setSlip(f);
};

export async function viewPaymentSlip(pid) {
  const p = appState.payments.find(x => x.id === pid);
  if (!p?.slipPath) return;
  const url = await signedImageUrl('payment-slips', p.slipPath);
  if (!url) return;
  openModal({
    id: 'slip-modal', title: `สลิป ${p.receiptNo || p.id}`, icon: 'ti-photo', width: 520,
    body: `<img src="${esc(url)}" alt="สลิปการโอน" style="width:100%;border-radius:var(--radius-md)"/>
      ${p.txRef ? `<div style="margin-top:8px;font-size:13px">เลขอ้างอิง <span class="mono">${esc(p.txRef)}</span></div>` : ''}
      <div style="font-size:13px">ยอด ฿${Number(p.amount).toLocaleString()} · ${esc(p.paidAt)}</div>`,
    footer: p.status === 'pending'
      ? `<button class="btn btn-danger" data-close onclick="rejectPayment(${jsArg(p.id)})">ปฏิเสธ</button>
         <button class="btn btn-primary" data-close onclick="approvePayment(${jsArg(p.id)})"><i class="ti ti-check"></i>อนุมัติ</button>`
      : '<button class="btn btn-secondary" data-close>ปิด</button>',
  });
}

function _resetChangeDisplay() {
  _setChange('', 'เงินทอน', '—');
}

// state: '' (ยังไม่กรอก) · ok · exact · short — คุมสีของกล่องเงินทอนใน payment-form.css
function _setChange(state, label, value) {
  const box = document.getElementById('cp-change-box');
  if (!box) return;
  box.className = 'cp-change' + (state ? ' ' + state : '');
  document.getElementById('cp-change-lbl').textContent     = label;
  document.getElementById('cp-change-display').textContent = value;
}

window._calcChange = function() {
  const channel = document.getElementById('cp-channel')?.value;
  if (channel !== 'cash') return;
  const amount   = parseFloat(document.getElementById('cp-amount')?.value) || 0;
  const received = parseFloat(document.getElementById('cp-received')?.value) || 0;
  const change   = received - amount;
  document.querySelectorAll('#cp-quick button').forEach(btn =>
    btn.classList.toggle('on', received > 0 && Number(btn.dataset.v) === received));
  if (received <= 0)       _setChange('', 'เงินทอน', '—');
  else if (change < 0)     _setChange('short', 'ยังขาดอีก', '฿' + _fmt(-change));
  else if (change === 0)   _setChange('exact', 'รับพอดี', 'ไม่ต้องทอน');
  else                     _setChange('ok', 'ทอนเงิน', '฿' + _fmt(change));
};

export function notifyBillDebtor(memberId) {
  sendOverdueReminders([memberId]);
}

export function cancelPayment(pid) {
  const { payments, bills } = appState;
  const p = payments.find(x => x.id === pid);
  if (!p) return;
  if (p.status !== 'approved') { toast('ยกเลิกได้เฉพาะรายการที่อนุมัติแล้ว', 'error'); return; }
  openModal({
    id: 'cancel-pay-modal', title: `ยกเลิกใบเสร็จ ${p.receiptNo || pid}`, icon: 'ti-ban', width: 420,
    body: `
      <div style="font-size:13px;margin-bottom:10px">ยอดเงิน <b>฿${p.amount.toLocaleString()}</b> — บิลจะกลับเป็นสถานะรอชำระ
        และใบเสร็จเลขนี้จะถูกประทับ "ยกเลิก" (เลขที่ไม่ถูกนำกลับมาใช้ใหม่)</div>
      <label class="form-label" for="cp-cancel-reason">เหตุผล *</label>
      <textarea class="form-input" id="cp-cancel-reason" rows="2" placeholder="เช่น บันทึกผิดบิล, รับเงินซ้ำ"></textarea>`,
    footer: `<button class="btn btn-secondary" data-close>กลับ</button>
      <button class="btn btn-danger" id="cp-cancel-ok"><i class="ti ti-ban"></i>ยืนยันยกเลิก</button>`,
  });
  document.getElementById('cp-cancel-ok').onclick = async (e) => {
    const reason = document.getElementById('cp-cancel-reason').value.trim();
    if (!reason) { toast('กรุณาระบุเหตุผล', 'error'); return; }
    const done = busyButton(e.currentTarget);
    const now  = nowLocal();
    const ok   = await sbCancelPayment(pid, now, reason);   // server ตรวจว่าวันนั้นปิดยอดแล้วหรือยัง
    done();
    if (!ok) return;
    closeModal('cancel-pay-modal');
    Object.assign(p, { status: 'cancelled', cancelledAt: now, cancelReason: reason });
    const b = bills.find(x => x.id === p.billId);
    if (b && b.status === 'paid') {
      b.status = b.dueDate < todayISO() ? 'overdue' : 'pending';   // server ปรับสถานะบิลเองแล้ว
    }
    saveToStorage();
    renderPayments();
    window.renderBilling?.();
    window.renderDebtors?.();
    toast(`ยกเลิกใบเสร็จ ${p.receiptNo || pid} แล้ว`, 'warn');
  };
}

export function printReceiptByPayment(pid) {
  printPaymentReceipt(pid);
}

export async function saveCashPayment() {
  const { bills, payments } = appState;
  const billId  = document.getElementById('cp-bill').value;
  const amount  = parseFloat(document.getElementById('cp-amount').value);
  const channel = document.getElementById('cp-channel').value || 'cash';
  const txRef   = document.getElementById('cp-ref')?.value.trim() || '';
  if (!billId) { toast('กรุณาเลือกบิล', 'error'); document.getElementById('cp-bill-q')?.focus(); return; }
  if (!amount || amount <= 0) { toast('บิลนี้ไม่มียอดที่ต้องชำระ', 'error'); return; }
  const b = bills.find(x => x.id === billId);
  if (!b) { toast('ไม่พบบิล', 'error'); return; }
  if (b.status !== 'pending' && b.status !== 'overdue') { toast('บิลนี้ไม่อยู่ในสถานะรอชำระ', 'error'); return; }
  // ยังไม่รองรับชำระบางส่วน — ยอดต้องตรงกับบิล ไม่งั้นบิลจะถูกตีว่าชำระครบทั้งที่ยังขาด
  if (Math.abs(amount - b.total) > 0.009) {
    toast(`ยอดชำระต้องเท่ากับยอดบิล ฿${b.total.toLocaleString()}`, 'error'); return;
  }
  if (channel === 'cash') {
    const received = parseFloat(document.getElementById('cp-received')?.value);
    if (!received || received <= 0) {
      const el = document.getElementById('cp-received');
      if (el) { el.style.borderColor = 'var(--red-500)'; el.focus(); setTimeout(() => el.style.borderColor = '', 1500); }
      toast('กรุณากรอกเงินที่ได้รับ', 'error'); return;
    }
    if (received < amount) { toast(`เงินที่ได้รับ (฿${received.toLocaleString()}) น้อยกว่ายอดที่ต้องชำระ (฿${amount.toLocaleString()})`, 'error'); return; }
  }
  if (_busy.has(billId)) return;
  const now      = nowLocal();
  const isCash   = channel === 'cash';
  const received = isCash ? parseFloat(document.getElementById('cp-received').value) : 0;
  const draft  = {
    id: 'PAY-'+Date.now(), billId, memberId: b.memberId, paidAt: now, amount, channel, txRef,
    payerName: document.getElementById('cp-name').value.trim(),
    slipPath: null, receiptNo: null,
    status: isCash ? 'approved' : 'pending',
    approvedBy: isCash ? (currentUser?.id || 'admin') : null,
    approvedAt: isCash ? now : null,
    rejectReason: null,
  };
  _busy.add(billId);
  let saved = null;
  const saveBtn = document.querySelector('#cash-modal .modal-footer .btn-primary');
  const done = busyButton(saveBtn);
  try {
    if (!isCash && _slipFile) {
      const [y, mo] = todayISO().split('-');
      draft.slipPath = await uploadImage('payment-slips', `${y}/${mo}/${draft.id}.jpg`, _slipFile);
      if (!draft.slipPath) return;   // อัปโหลดไม่สำเร็จ — ยังไม่บันทึกการชำระ
    }
    saved = await sbInsertPayment(draft);   // เงินสด: server ออกเลขใบเสร็จทันที
  } finally {
    _busy.delete(billId);
    done();
  }
  if (!saved) return;
  const newPay    = { ...draft, ...saved };
  const receiptNo = newPay.receiptNo;
  payments.push(newPay);
  if (isCash) b.status = 'paid';   // server ตั้งสถานะบิลเองจากใบเสร็จ
  closeCashModal();
  saveToStorage();
  renderPayments();
  window.renderBilling?.();
  window.renderDebtors?.();
  const meta = _channelMeta[channel] || _channelMeta.cash;
  if (!isCash) { toast(`บันทึก ${meta.title} ฿${amount.toLocaleString()} — รอยืนยันสลิป`, 'info'); return; }
  // สรุปหลังรับเงิน — ย้ำยอดทอน + ปุ่มพิมพ์ใบเสร็จ (ต้องกดเองเพื่อให้พิมพ์ได้บน iOS)
  const change = received - amount;
  openModal({
    id: 'cp-done-modal', title: `รับเงินแล้ว — ใบเสร็จ ${receiptNo || ''}`, icon: 'ti-circle-check', width: 380,
    body: `<div style="text-align:center">
        <div style="font-size:13px;color:var(--gray-500)">${esc(newPay.payerName || '')} · ${esc(b.id)}</div>
        <div style="display:flex;justify-content:center;gap:24px;margin:10px 0 4px;font-size:13px">
          <div>ยอดบิล<br><b style="font-size:18px">฿${_fmt(amount)}</b></div>
          <div>รับมา<br><b style="font-size:18px">฿${_fmt(received)}</b></div>
        </div>
        <div style="margin-top:10px;padding:10px;border-radius:12px;background:var(--green-50);color:var(--green-700)">
          <div style="font-size:12px;font-weight:700">เงินทอน</div>
          <div style="font-size:30px;font-weight:800">฿${_fmt(change)}</div>
        </div>
      </div>`,
    footer: `<button class="btn btn-secondary" data-close>ปิด</button>
      <button class="btn btn-primary" data-close onclick="printReceiptByPayment(${jsArg(newPay.id)})"><i class="ti ti-printer"></i>พิมพ์ใบเสร็จ</button>`,
  });
}
