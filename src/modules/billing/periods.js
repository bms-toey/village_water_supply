// ─── Billing Periods & Adjustments ────────────────────────────
// ปิดงวด / เปิดงวดใหม่ / ปรับปรุงยอดบิล (ใบลดหนี้ CN, ใบเพิ่มหนี้ DN)
// สิทธิ์จริงบังคับที่ server (sql_phase0_finance.sql) — ฝั่งนี้แค่ซ่อนปุ่ม
// ──────────────────────────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc, toast, showConfirm } from '../../utils/dom.util.js';
import { periodLabel, isPeriodClosed } from '../../utils/date.util.js';
import { hasRole } from '../../services/auth.service.js';
import {
  sbGetBillingPeriods, sbCloseBillingPeriod, sbReopenBillingPeriod,
  sbAdjustBill, loadBillingPeriods,
} from '../../services/data-loader.service.js';
import { saveToStorage } from '../../services/storage.service.js';
import { openModal, closeModal, busyButton } from '../../components/modal/modal.js';

const MODAL_PERIODS = 'periods-modal';
const MODAL_REOPEN  = 'period-reopen-modal';
const MODAL_ADJUST  = 'bill-adjust-modal';

const fmt = n => '฿' + Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

export const canClosePeriod  = () => hasRole('super_admin', 'village_admin', 'finance');
export const canReopenPeriod = () => hasRole('super_admin');
export const canAdjustBill   = () => hasRole('super_admin', 'village_admin', 'finance');

/** บิลอยู่ในงวดที่ปิดแล้ว — แก้ยอด/ยกเลิกไม่ได้ */
export function isBillLocked(bill) {
  if (!bill) return false;
  if (bill.periodYear && bill.periodMonth) return appState.closedPeriods.has(`${bill.periodYear}-${bill.periodMonth}`);
  return isPeriodClosed(bill.period);
}

// ─── Periods list ─────────────────────────────────────────────
export async function openBillingPeriods() {
  openModal({
    id: MODAL_PERIODS, title: 'งวดบิล', icon: 'ti-calendar-stats', width: 760,
    body: '<div style="text-align:center;padding:32px;color:var(--gray-400)"><i class="ti ti-loader-2" style="animation:spin .8s linear infinite;font-size:24px"></i></div>',
  });
  const rows = await sbGetBillingPeriods();
  const el = document.getElementById(MODAL_PERIODS);
  if (!el) return;
  const body = el.querySelector('.modal-body');
  if (!rows) { body.innerHTML = '<div class="text-error" style="padding:16px">โหลดข้อมูลงวดไม่ได้</div>'; return; }
  if (!rows.length) { body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--gray-400)">ยังไม่มีบิล</div>'; return; }

  body.innerHTML = `
    <div style="font-size:12.5px;color:var(--gray-600);margin-bottom:12px;line-height:1.6">
      <i class="ti ti-info-circle" style="color:var(--blue-500)"></i>
      ปิดงวดเมื่อตรวจยอดของเดือนนั้นเรียบร้อยแล้ว — หลังปิด แก้ยอดหรือยกเลิกบิลในงวดไม่ได้
      (ยังรับชำระได้ตามปกติ) ถ้าต้องแก้ยอดให้ใช้ <b>ปรับปรุงยอด</b> ในหน้าบิลแทน
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr>
        <th>งวด</th><th style="text-align:right">บิล</th><th style="text-align:right">เรียกเก็บ</th>
        <th style="text-align:right">ชำระแล้ว</th><th style="text-align:right">ค้างชำระ</th>
        <th>สถานะ</th><th></th>
      </tr></thead>
      <tbody>${rows.map(_periodRow).join('')}</tbody>
    </table></div>`;
}

function _periodRow(p) {
  const label  = p.period_label || periodLabel(p.period_year, p.period_month);
  const closed = p.status === 'closed';
  const args   = `${p.period_year},${p.period_month},'${esc(label)}'`;
  const action = closed
    ? (canReopenPeriod() ? `<button class="btn btn-secondary btn-xs" onclick="reopenBillingPeriod(${args})"><i class="ti ti-lock-open"></i>เปิดงวด</button>` : '')
    : (canClosePeriod()  ? `<button class="btn btn-primary btn-xs" onclick="closeBillingPeriod(${args})"><i class="ti ti-lock"></i>ปิดงวด</button>` : '');
  const status = closed
    ? `<span class="pill pill-closed" style="font-size:11px" title="${esc(p.closed_by ? 'ปิดโดย ' + p.closed_by : '')}"><i class="ti ti-lock" style="font-size:11px"></i> ปิดแล้ว</span>`
    : '<span class="pill pill-normal" style="font-size:11px">เปิด</span>';
  return `<tr>
    <td class="text-bold">${esc(label)}${p.note ? `<div class="text-muted" style="font-size:11px;font-weight:400">${esc(p.note)}</div>` : ''}</td>
    <td style="text-align:right">${p.bill_count}</td>
    <td style="text-align:right">${fmt(p.billed_total)}</td>
    <td style="text-align:right;color:var(--green-700)">${fmt(p.paid_total)}</td>
    <td style="text-align:right;color:${Number(p.unpaid_total) > 0 ? 'var(--red-700)' : 'inherit'}">${fmt(p.unpaid_total)}</td>
    <td>${status}</td>
    <td style="text-align:right">${action}</td>
  </tr>`;
}

export function closeBillingPeriod(year, month, label) {
  showConfirm({
    title:   `ปิดงวด ${label}`,
    message: 'หลังปิดงวด จะแก้ยอดหรือยกเลิกบิลในงวดนี้ไม่ได้\nยังรับชำระและคิดค่าปรับได้ตามปกติ\n\nยืนยันปิดงวด?',
    okText:  'ปิดงวด',
    okClass: 'btn-primary',
    icon:    'ti-lock',
    iconBg:  'var(--blue-50)',
    iconColor: 'var(--blue-700)',
    async onOk() {
      if (!(await sbCloseBillingPeriod(year, month, ''))) return;
      await _afterPeriodChange();
      toast(`ปิดงวด ${label} แล้ว`, 'success');
    },
  });
}

export function reopenBillingPeriod(year, month, label) {
  openModal({
    id: MODAL_REOPEN, title: `เปิดงวด ${label} ใหม่`, icon: 'ti-lock-open', width: 420,
    body: `
      <div class="warning-box" style="margin-bottom:12px;font-size:12.5px">
        การเปิดงวดที่ปิดแล้วจะถูกบันทึกในบันทึกกิจกรรม ควรทำเมื่อคณะกรรมการอนุมัติเท่านั้น
      </div>
      <label class="form-label" for="reopen-reason">เหตุผล *</label>
      <textarea class="form-input" id="reopen-reason" rows="3" placeholder="เช่น กรรมการอนุมัติให้แก้เลขมิเตอร์ที่จดผิด"></textarea>`,
    footer: `
      <button class="btn btn-secondary" data-close>ยกเลิก</button>
      <button class="btn btn-danger" id="reopen-ok"><i class="ti ti-lock-open"></i>เปิดงวด</button>`,
  });
  document.getElementById('reopen-ok').onclick = async (e) => {
    const reason = document.getElementById('reopen-reason').value.trim();
    if (!reason) { toast('กรุณาระบุเหตุผล', 'error'); return; }
    const done = busyButton(e.currentTarget);
    const ok = await sbReopenBillingPeriod(year, month, reason);
    done();
    if (!ok) return;
    closeModal(MODAL_REOPEN);
    await _afterPeriodChange();
    toast(`เปิดงวด ${label} แล้ว`, 'warn');
  };
}

async function _afterPeriodChange() {
  await loadBillingPeriods();
  saveToStorage();
  window.renderBilling?.();
  if (document.getElementById(MODAL_PERIODS)) openBillingPeriods();
}

// ─── Adjust bill (CN / DN) ────────────────────────────────────
export function openAdjustBill(billId) {
  const b = appState.bills.find(x => x.id === billId);
  if (!b) return;
  openModal({
    id: MODAL_ADJUST, title: `ปรับปรุงยอดบิล ${b.id}`, icon: 'ti-adjustments-dollar', width: 440,
    body: `
      <div style="background:var(--gray-50);border-radius:var(--radius-md);padding:10px 14px;margin-bottom:14px;font-size:13px;display:flex;justify-content:space-between">
        <span>ยอดปัจจุบัน</span><b>${fmt(b.total)}</b>
      </div>
      <div class="form-group" style="margin-bottom:12px">
        <label class="form-label" for="adj-type">ประเภท</label>
        <select class="form-input" id="adj-type">
          <option value="-1">ใบลดหนี้ (ลดยอด) — เช่น จดมิเตอร์ผิด, ส่วนลด</option>
          <option value="1">ใบเพิ่มหนี้ (เพิ่มยอด) — เช่น ค่าซ่อม, ค่าต่อน้ำ</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom:12px">
        <label class="form-label" for="adj-amount">จำนวนเงิน (บาท) *</label>
        <input class="form-input" id="adj-amount" type="number" min="0.01" step="0.01" inputmode="decimal"/>
      </div>
      <div class="form-group">
        <label class="form-label" for="adj-reason">เหตุผล *</label>
        <textarea class="form-input" id="adj-reason" rows="2"></textarea>
      </div>
      <div style="font-size:11.5px;color:var(--gray-500);margin-top:10px">
        ระบบจะออกเลขที่เอกสาร (CN/DN) และบันทึกผู้ทำรายการไว้ แก้ไขหรือลบภายหลังไม่ได้
      </div>`,
    footer: `
      <button class="btn btn-secondary" data-close>ยกเลิก</button>
      <button class="btn btn-primary" id="adj-ok"><i class="ti ti-check"></i>บันทึก</button>`,
  });
  document.getElementById('adj-ok').onclick = e => _saveAdjust(billId, e.currentTarget);
}

async function _saveAdjust(billId, btn) {
  const sign   = parseInt(document.getElementById('adj-type').value);
  const amount = parseFloat(document.getElementById('adj-amount').value);
  const reason = document.getElementById('adj-reason').value.trim();
  if (!(amount > 0)) { toast('กรุณากรอกจำนวนเงิน', 'error'); return; }
  if (!reason)       { toast('กรุณาระบุเหตุผล', 'error'); return; }

  const done = busyButton(btn);
  const res  = await sbAdjustBill(billId, sign * amount, reason);
  done();
  if (!res) return;

  const b = appState.bills.find(x => x.id === billId);
  if (b) {
    b.discount = parseFloat(res.bill.discount) || 0;
    b.total    = parseFloat(res.bill.total)    || 0;
  }
  await loadBillingPeriods();   // โหลดรายการ CN/DN ใหม่
  saveToStorage();
  closeModal(MODAL_ADJUST);
  window.renderBilling?.();
  window.renderDebtors?.();
  window.openBillReceipt?.(billId);
  toast(`ออก${sign < 0 ? 'ใบลดหนี้' : 'ใบเพิ่มหนี้'} ${res.doc_no} แล้ว`, 'success');
}
