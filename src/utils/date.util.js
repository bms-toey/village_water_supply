// ─── Date & Sync Utilities ─────────────────────────────────────
// Thai Buddhist Era date helpers and overdue status sync.
// ──────────────────────────────────────────────────────────────
import { appState } from '../state/app.state.js';

const _MONTHS_TH = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/** Returns current billing period label, e.g. "ต.ค. 2566" (Buddhist Era). */
export function currentPeriod() {
  const d = new Date();
  return _MONTHS_TH[d.getMonth()] + ' ' + (d.getFullYear() + 543);
}

/**
 * Sequential bill number: B-{BE-YY}{MM}-{NNNN}
 * e.g. B-6906-0001 (มิถุนายน 2569, บิลที่ 1)
 * Uses bills array length so each call returns the next unused number.
 */
export function nextBillNo() {
  const d   = new Date();
  const yy  = String(d.getFullYear() + 543).slice(-2);
  const mm  = String(d.getMonth() + 1).padStart(2, '0');
  const seq = String(appState.bills.length + 1).padStart(4, '0');
  return `B-${yy}${mm}-${seq}`;
}

/**
 * Sequential receipt number: R-{BE-YY}{MM}-{NNNN}
 * e.g. R-6906-0001 (มิถุนายน 2569, ใบเสร็จที่ 1)
 * Uses payments array length so each call returns the next unused number.
 */
export function nextReceiptNo() {
  const d   = new Date();
  const yy  = String(d.getFullYear() + 543).slice(-2);
  const mm  = String(d.getMonth() + 1).padStart(2, '0');
  const seq = String(appState.payments.length + 1).padStart(4, '0');
  return `R-${yy}${mm}-${seq}`;
}

/**
 * Sync overdue status for bills and members based on today's date.
 * @returns {boolean} true if any data was changed
 */
export function syncOverdueStatus() {
  const today = new Date().toISOString().split('T')[0];
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
