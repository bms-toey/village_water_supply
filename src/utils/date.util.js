// ─── Date & Sync Utilities ─────────────────────────────────────
// Thai Buddhist Era date helpers and overdue status sync.
// ──────────────────────────────────────────────────────────────
import { todayISO } from './time.util.js';
import { appState } from '../state/app.state.js';
import { _periodYM } from '../services/db-mapper.service.js';

const _MONTHS_TH = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/** ป้ายงวดจากปี พ.ศ. + เดือน เช่น (2569, 10) → "ต.ค. 2569" */
export function periodLabel(year, month) {
  return _MONTHS_TH[month - 1] + ' ' + year;
}

/** Returns current billing period label, e.g. "ต.ค. 2566" (Buddhist Era). */
export function currentPeriod() {
  const d = new Date();
  return _MONTHS_TH[d.getMonth()] + ' ' + (d.getFullYear() + 543);
}

// เลขบิล (B-YYMM-NNNN) และเลขใบเสร็จ (R-YYMM-NNNN) ออกโดย server
// ดู sql/sql_phase0_finance.sql

/** งวดของบิลนี้ถูกปิดแล้วหรือไม่ (แก้ยอด/ยกเลิกไม่ได้ ต้องปรับผ่านใบลดหนี้/เพิ่มหนี้) */
export function isPeriodClosed(periodLabel) {
  let ym;
  try { ym = _periodYM(periodLabel); } catch { return false; }   // server ตรวจงวดปิดซ้ำอยู่แล้ว
  return appState.closedPeriods.has(`${ym.year}-${ym.month}`);
}

/**
 * Sync overdue status for bills and members based on today's date.
 * ใช้ตอนออฟไลน์เท่านั้น — ปกติ server อัปเดตสถานะให้ (refresh_billing_status)
 * @returns {boolean} true if any data was changed
 */
export function syncOverdueStatus() {
  const today = todayISO();
  let changed = false;

  appState.bills.forEach(b => {
    if (b.status === 'pending' && b.dueDate < today) {
      b.status = 'overdue';
      changed = true;
    }
  });

  appState.members.forEach(m => {
    if (m.status === 'closed' || m.status === 'suspended') return;
    const hasOverdue = appState.bills.some(b => b.memberId === m.id && b.status === 'overdue');
    const wanted = hasOverdue ? 'overdue' : 'normal';
    if (m.status !== wanted) { m.status = wanted; changed = true; }
  });

  return changed;
}

// ค่าปรับล่าช้าคำนวณที่ server ทุกวัน (app_private.run_daily_billing)
