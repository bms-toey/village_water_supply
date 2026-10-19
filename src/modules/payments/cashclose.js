// ─── ปิดยอดประจำวัน (แคชเชียร์) ───────────────────────────────
// ยอดทั้งหมดคำนวณที่ server (get_cash_summary) — ผู้ใช้กรอกเฉพาะเงินสดที่นับได้
// หลังปิดยอด: รับเงินสด/ยกเลิกใบเสร็จของวันนั้นไม่ได้ จนกว่า super_admin/finance เปิดยอดใหม่
// ──────────────────────────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc, toast } from '../../utils/dom.util.js';
import { todayISO, fmtLocalDateTime } from '../../utils/time.util.js';
import { currentProfile, hasRole } from '../../services/auth.service.js';
import { sbGetCashSummary, sbCloseCashDay, sbReopenCashDay, sbListCashClosings } from '../../services/data-loader.service.js';
import { openModal, closeModal, busyButton } from '../../components/modal/modal.js';
import { printRemittance } from '../documents/documents.js';
import { thaiDate } from '../documents/templates.js';

const MODAL = 'cash-close-modal';
const CH = { cash: 'เงินสด', promptpay: 'พร้อมเพย์', bank: 'โอน', mobile: 'Mobile', line_pay: 'LINE Pay' };
const fmt = n => '฿' + Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

const canSeeAll = () => hasRole('super_admin', 'village_admin', 'finance');
const canReopen = () => hasRole('super_admin', 'finance');

let _state = { date: null, cashier: null, summary: null };

/** ผู้รับเงินที่เคยรับเงิน (จากรายการชำระที่โหลดไว้) + ตัวเอง */
function _cashiers() {
  const map = new Map([[currentProfile?.id, currentProfile?.full_name || 'ฉัน']]);
  appState.payments.forEach(p => { if (p.createdBy && !map.has(p.createdBy)) map.set(p.createdBy, p.receivedByName || p.createdBy); });
  return [...map.entries()].filter(([id]) => id);
}

export function openCashClose() {
  _state = { date: todayISO(), cashier: currentProfile?.id, summary: null };
  openModal({
    id: MODAL, title: 'ปิดยอดประจำวัน', icon: 'ti-cash-register', width: 640,
    body: `
      <div class="tabs" style="margin-bottom:14px">
        <div class="tab active" data-cc-tab="day">ยอดรายวัน</div>
        <div class="tab" data-cc-tab="history">ประวัติการปิดยอด</div>
      </div>
      <div id="cc-day">
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
          <div style="flex:1;min-width:150px"><label class="form-label" for="cc-date">วันที่</label>
            <input class="form-input" id="cc-date" type="date" value="${_state.date}" max="${todayISO()}"/></div>
          ${canSeeAll() ? `<div style="flex:1;min-width:180px"><label class="form-label" for="cc-cashier">ผู้รับเงิน</label>
            <select class="form-input" id="cc-cashier">${_cashiers().map(([id, name]) =>
              `<option value="${esc(id)}"${id === _state.cashier ? ' selected' : ''}>${esc(name)}${id === currentProfile?.id ? ' (ฉัน)' : ''}</option>`).join('')}</select></div>` : ''}
        </div>
        <div id="cc-summary"></div>
      </div>
      <div id="cc-history" style="display:none"></div>`,
  });
  const el = document.getElementById(MODAL);
  el.querySelectorAll('[data-cc-tab]').forEach(t => t.addEventListener('click', () => {
    el.querySelectorAll('[data-cc-tab]').forEach(x => x.classList.toggle('active', x === t));
    el.querySelector('#cc-day').style.display     = t.dataset.ccTab === 'day' ? '' : 'none';
    el.querySelector('#cc-history').style.display = t.dataset.ccTab === 'history' ? '' : 'none';
    if (t.dataset.ccTab === 'history') _loadHistory();
  }));
  el.querySelector('#cc-date').addEventListener('change', e => { _state.date = e.target.value; _loadSummary(); });
  el.querySelector('#cc-cashier')?.addEventListener('change', e => { _state.cashier = e.target.value; _loadSummary(); });
  _loadSummary();
}

let _loadSeq = 0;

async function _loadSummary() {
  const box = document.getElementById('cc-summary');
  if (!box) return;
  // เก็บค่าที่ผู้ใช้พิมพ์ไว้ — ถ้าวาดใหม่ระหว่างกรอกจะได้ไม่หาย
  const typed = { counted: box.querySelector('#cc-counted')?.value ?? '', note: box.querySelector('#cc-note')?.value ?? '' };
  const seq = ++_loadSeq;
  box.innerHTML = '<div style="text-align:center;padding:24px;color:var(--gray-400)"><i class="ti ti-loader-2" style="animation:spin .8s linear infinite;font-size:22px"></i></div>';
  const s = await sbGetCashSummary(_state.date, _state.cashier);
  if (seq !== _loadSeq) return;   // มีการโหลดใหม่กว่าแล้ว (เปลี่ยนวัน/ผู้รับเงินระหว่างรอ)
  if (!s || !document.getElementById('cc-summary')) return;
  _state.summary = s;
  const mine = s.cashier_id === currentProfile?.id;
  const c = s.closing;

  const rows = (s.payments || []).map(p => `<tr>
      <td class="mono" style="font-size:11.5px">${esc(fmtLocalDateTime(p.paid_at).slice(11))}</td>
      <td class="mono" style="font-size:11.5px">${esc(p.receipt_no || '—')}</td>
      <td>${esc(p.member || '')}</td><td>${esc(CH[p.channel] || p.channel)}</td>
      <td style="text-align:right">${fmt(p.amount)}</td></tr>`).join('');

  box.innerHTML = `
    <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:12px">
      <div class="kpi-card"><div class="kpi-label">เงินสดตามระบบ (${s.cash_count} รายการ)</div><div class="kpi-val text-primary">${fmt(s.cash_total)}</div></div>
      <div class="kpi-card"><div class="kpi-label">โอน/พร้อมเพย์ (${s.transfer_count} รายการ)</div><div class="kpi-val" style="color:var(--cyan-800)">${fmt(s.transfer_total)}</div></div>
    </div>
    <div class="tbl-wrap" style="max-height:220px;overflow:auto;margin-bottom:12px"><table>
      <thead><tr><th>เวลา</th><th>ใบเสร็จ</th><th>ผู้ชำระ</th><th>ช่องทาง</th><th style="text-align:right">จำนวน</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:var(--gray-400);padding:16px">ไม่มีรายการรับเงิน</td></tr>'}</tbody>
    </table></div>
    ${c ? _closedBlock(c) : mine ? _closeForm(s) : '<div style="font-size:13px;color:var(--gray-500)">ยังไม่ได้ปิดยอด (ผู้รับเงินต้องปิดยอดเอง)</div>'}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap">
      <button class="btn btn-secondary" id="cc-print"><i class="ti ti-printer"></i>พิมพ์ใบนำส่งเงิน</button>
      ${c && canReopen() ? `<button class="btn btn-danger" id="cc-reopen"><i class="ti ti-lock-open"></i>เปิดยอดใหม่</button>` : ''}
      ${!c && mine ? `<button class="btn btn-primary" id="cc-close"><i class="ti ti-lock"></i>ปิดยอด</button>` : ''}
    </div>`;

  const counted = box.querySelector('#cc-counted');
  if (counted) {
    counted.value = typed.counted;
    box.querySelector('#cc-note').value = typed.note;
  }
  counted?.addEventListener('input', () => {
    const diff = (parseFloat(counted.value) || 0) - Number(s.cash_total);
    const d = box.querySelector('#cc-diff');
    d.textContent = counted.value === '' ? '' : diff === 0 ? 'ตรงกับระบบ' : `${diff > 0 ? 'เกิน' : 'ขาด'} ${fmt(Math.abs(diff))}`;
    d.style.color = diff === 0 ? 'var(--green-700)' : 'var(--red-700)';
  });
  box.querySelector('#cc-print').onclick = () => printRemittance(s, c);
  box.querySelector('#cc-close')?.addEventListener('click', e => _close(e.currentTarget));
  box.querySelector('#cc-reopen')?.addEventListener('click', () => _reopen(c));
}

function _closeForm(s) {
  return `
    <div style="background:var(--gray-50);border-radius:var(--radius-md);padding:12px 14px">
      <label class="form-label" for="cc-counted">เงินสดที่นับได้จริง (บาท) *</label>
      <div style="display:flex;gap:10px;align-items:center">
        <input class="form-input" id="cc-counted" type="number" min="0" step="0.01" inputmode="decimal" style="max-width:180px" placeholder="${Number(s.cash_total)}"/>
        <span id="cc-diff" style="font-size:13px;font-weight:700"></span>
      </div>
      <label class="form-label" for="cc-note" style="margin-top:10px">หมายเหตุ (จำเป็นถ้ายอดไม่ตรง)</label>
      <input class="form-input" id="cc-note" placeholder="เช่น เงินทอนขาด"/>
    </div>`;
}

function _closedBlock(c) {
  const diff = Number(c.diff);
  return `
    <div style="background:var(--green-50);border:1px solid var(--green-200);border-radius:var(--radius-md);padding:12px 14px;font-size:13px;line-height:1.7">
      <div><i class="ti ti-lock" style="color:var(--green-700)"></i> <b>ปิดยอดแล้ว</b> — เลขที่ <span class="mono">${esc(c.doc_no)}</span>
        เมื่อ ${esc(fmtLocalDateTime(c.created_at))}</div>
      <div>เงินสดที่นำส่ง <b>${fmt(c.counted_cash)}</b> · ผลต่าง
        <b style="color:${diff === 0 ? 'var(--green-700)' : 'var(--red-700)'}">${diff > 0 ? '+' : ''}${fmt(diff)}</b></div>
      ${c.note ? `<div>หมายเหตุ: ${esc(c.note)}</div>` : ''}
    </div>`;
}

async function _close(btn) {
  const s = _state.summary;
  const val = document.getElementById('cc-counted').value;
  const note = document.getElementById('cc-note').value.trim();
  if (val === '') { toast('กรุณากรอกจำนวนเงินสดที่นับได้', 'error'); return; }
  const counted = parseFloat(val);
  if (Math.abs(counted - Number(s.cash_total)) > 0.009 && !note) { toast('ยอดไม่ตรงกับระบบ — กรุณาระบุหมายเหตุ', 'error'); return; }
  const done = busyButton(btn);
  const closing = await sbCloseCashDay(_state.date, counted, note);
  done();
  if (!closing) return;
  toast(`ปิดยอดแล้ว — ใบนำส่งเงิน ${closing.doc_no}`, 'success');
  await _loadSummary();
  printRemittance(_state.summary, closing);
}

function _reopen(c) {
  openModal({
    id: 'cc-reopen-modal', title: `เปิดยอด ${thaiDate(c.close_date)} ใหม่`, icon: 'ti-lock-open', width: 400,
    body: `<label class="form-label" for="cc-reopen-reason">เหตุผล *</label>
      <textarea class="form-input" id="cc-reopen-reason" rows="2" placeholder="เช่น ต้องยกเลิกใบเสร็จที่บันทึกผิด"></textarea>`,
    footer: `<button class="btn btn-secondary" data-close>ยกเลิก</button>
      <button class="btn btn-danger" id="cc-reopen-ok">เปิดยอดใหม่</button>`,
  });
  document.getElementById('cc-reopen-ok').onclick = async (e) => {
    const reason = document.getElementById('cc-reopen-reason').value.trim();
    if (!reason) { toast('กรุณาระบุเหตุผล', 'error'); return; }
    const done = busyButton(e.currentTarget);
    const ok = await sbReopenCashDay(c.id, reason);
    done();
    if (!ok) return;
    closeModal('cc-reopen-modal');
    toast('เปิดยอดใหม่แล้ว', 'warn');
    _loadSummary();
  };
}

async function _loadHistory() {
  const box = document.getElementById('cc-history');
  box.innerHTML = '<div style="text-align:center;padding:24px;color:var(--gray-400)">กำลังโหลด...</div>';
  const list = await sbListCashClosings();
  box.innerHTML = list.length ? `
    <div class="tbl-wrap"><table>
      <thead><tr><th>วันที่</th><th>เลขที่</th><th>ผู้รับเงิน</th><th style="text-align:right">เงินสดระบบ</th><th style="text-align:right">นับได้</th><th style="text-align:right">ผลต่าง</th></tr></thead>
      <tbody>${list.map(c => `<tr>
        <td>${thaiDate(c.close_date)}</td><td class="mono" style="font-size:11.5px">${esc(c.doc_no)}</td><td>${esc(c.cashier_name || '')}</td>
        <td style="text-align:right">${fmt(c.cash_total)}</td><td style="text-align:right">${fmt(c.counted_cash)}</td>
        <td style="text-align:right;color:${Number(c.diff) === 0 ? 'inherit' : 'var(--red-700)'}">${Number(c.diff) > 0 ? '+' : ''}${fmt(c.diff)}</td></tr>`).join('')}
      </tbody></table></div>`
    : '<div style="text-align:center;padding:24px;color:var(--gray-400)">ยังไม่มีการปิดยอด</div>';
}
