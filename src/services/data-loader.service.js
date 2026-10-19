// ─── Data Loader & Write Helpers ──────────────────────────────
// Loads all tables from Supabase into appState at startup,
// and provides fire-and-forget write functions for each entity.
// ──────────────────────────────────────────────────────────────
import { _sb } from './supabase.service.js';
import { appState } from '../state/app.state.js';
import { rateConfig } from '../config/rate.config.js';
import {
  setVillages,
  _mFromDB, _mToDB,
  _bFromDB, _bToDB,
  _pFromDB, _pToDB,
  _rFromDB, _rToDB,
  _ntFromDB, _ntToDB,
} from './db-mapper.service.js';
import { toast } from '../utils/dom.util.js';
import { localToISO } from '../utils/time.util.js';
import { loadMasterData } from './master-data.service.js';

// Show Supabase write errors as toast so the user can see them
function _sbErr(label, error) {
  console.error(`[sb] ${label}:`, error.message, error);
  toast(`⚠ Supabase (${label}): ${error.message}`, 'error');
}

// ─── Load All ────────────────────────────────────────────────
// ให้ server อัปเดตสถานะค้างชำระ/ค่าปรับก่อนโหลดบิล (สำรองกรณีไม่มี pg_cron)
// เรียกไม่เกินชั่วโมงละครั้ง — poll ทุก 5 นาทีไม่ต้องสั่งซ้ำ
const BILLING_REFRESH_MS = 60 * 60 * 1000;
let _lastBillingRefresh = 0;

async function _refreshBillingStatus() {
  if (Date.now() - _lastBillingRefresh < BILLING_REFRESH_MS) return;
  const { error } = await _sb.rpc('refresh_billing_status');
  if (error) console.warn('[sb] refresh_billing_status:', error.message);
  else _lastBillingRefresh = Date.now();
}

export async function loadAllFromSupabase() {
  try {
    await _refreshBillingStatus();
    const [rv, rm, rb, rp, rr, rt, rn, rwp, rwq] = await Promise.all([
      _sb.from('villages').select('*').order('moo_number'),
      _sb.from('members').select('*').eq('is_deleted', false).order('id'),
      _sb.from('bills').select('*').order('period_year', { ascending: false }).order('period_month', { ascending: false }),
      _sb.from('payments').select('*').order('paid_at', { ascending: false }),
      _sb.from('meter_readings').select('*').order('reading_date', { ascending: false }),
      _sb.from('rate_tiers').select('*').order('from_unit'),
      _sb.from('maintenance_jobs').select('*').order('created_at', { ascending: false }),
      _sb.from('water_production').select('*').order('period_year', { ascending: false }),
      _sb.from('water_quality').select('*').order('test_date', { ascending: false }),
    ]);

    if (rv.error || rm.error) {
      console.error('[sb] load error:', rv.error || rm.error);
      return false;
    }

    setVillages(rv.data || []);
    appState.members         = (rm.data  || []).map(_mFromDB);
    appState.bills           = (rb.data  || []).map(_bFromDB);
    appState.payments        = (rp.data  || []).map(_pFromDB);
    appState.meterReadings   = (rr.data  || []).map(_rFromDB);
    appState.maintenance     = (rn.data  || []).map(_ntFromDB);
    appState.waterProduction = rwp.data  || [];
    appState.waterQuality    = rwq.data  || [];

    // meter_replacements loaded separately (non-blocking) — table may not exist yet
    _loadMeterReplacements();
    await loadBillingPeriods();

    const tiers = rt.data || [];
    if (tiers.length) {
      rateConfig.tiers = tiers.map(t => ({
        from: t.from_unit,
        to:   t.to_unit === null ? Infinity : t.to_unit,
        rate: parseFloat(t.rate_per_unit),
      }));
      // svcSmall, svcLarge, lateFeePerMonth are loaded from system_config (in loadMasterData)
      // Fallback to rate_tiers[0] columns for backward-compatibility
      const s = parseFloat(tiers[0].svc_charge_small);
      const l = parseFloat(tiers[0].svc_charge_large);
      const f = parseFloat(tiers[0].late_fee_per_month);
      if (!isNaN(s) && s > 0) rateConfig.svcSmall        = s;
      if (!isNaN(l) && l > 0) rateConfig.svcLarge        = l;
      if (!isNaN(f) && f > 0) rateConfig.lateFeePerMonth = f;
    }

    appState.nextMemberId = appState.members.length
      ? Math.max(...appState.members.map(m => m.id)) + 1
      : 100001;

    // Load master data (lookup tables) after villages are set
    await loadMasterData();

    return true;
  } catch (e) {
    console.error('[sb] loadAllFromSupabase exception:', e);
    return false;
  }
}

// ─── Member Write Helpers ─────────────────────────────────────
export function sbUpdateMember(m) {
  const row = _mToDB(m);
  row.id = m.id;
  _sb.from('members').upsert(row).then(({ error }) => {
    if (error) _sbErr('updateMember', error);
  });
}

/** บันทึกสมาชิกแล้วรอผล — ใช้เมื่อต้องรู้ว่าสำเร็จ (เช่น ระงับการใช้น้ำ) */
export async function sbSaveMember(m) {
  const { error } = await _sb.from('members').update(_mToDB(m)).eq('id', m.id);
  if (error) _sbErr('saveMember', error);
  return !error;
}

export async function sbInsertMember(m) {
  const { data, error } = await _sb.from('members').insert(_mToDB(m)).select('id').single();
  if (error) { _sbErr('insertMember', error); return null; }
  return data?.id || null;
}

// deletedBy: UUID ของ user ที่กดลบ (รับจาก caller เพื่อหลีกเลี่ยง circular import)
export function sbDeleteMember(id, deletedBy) {
  const now = new Date().toISOString();
  _sb.from('members').update({
    is_deleted: true,
    deleted_at: now,
    deleted_by: deletedBy || null,
  }).eq('id', id).then(({ error }) => {
    if (error) _sbErr('deleteMember', error);
  });
}

// ─── Bill Read Helpers ────────────────────────────────────────
/** Returns Set of member_id values that already have a non-cancelled bill for the given period */
export async function sbGetBilledMemberIds(periodYear, periodMonth) {
  const { data, error } = await _sb.from('bills')
    .select('member_id')
    .eq('period_year', periodYear)
    .eq('period_month', periodMonth)
    .neq('status', 'cancelled');
  if (error) console.warn('[sb] getBilledMemberIds:', error.message);
  return new Set((data || []).map(r => r.member_id));
}

// ─── Bill Write Helpers ───────────────────────────────────────
// async so callers that need ordering (e.g. saveMeter) can await it
export async function sbUpsertBill(b) {
  const { error } = await _sb.from('bills').upsert(_bToDB(b));
  if (error) _sbErr('upsertBill', error);
  return !error;
}

// บิลใหม่: server ออกเลขบิลให้ (trigger) — คืนบิลที่บันทึกแล้ว หรือ null ถ้าล้มเหลว
// ใช้ insert ไม่ใช่ upsert เพื่อไม่ให้เขียนทับบิลเดิมโดยไม่รู้ตัว
export async function sbInsertBills(list) {
  if (!list.length) return [];
  const rows = list.map(b => ({ ..._bToDB(b), id: null }));
  const { data, error } = await _sb.from('bills').insert(rows).select();
  if (error) { _sbErr('insertBills', error); return null; }
  return (data || []).map(_bFromDB);
}

export function sbUpdateBillStatus(billId, status) {
  _sb.from('bills').update({ status }).eq('id', billId).then(({ error }) => {
    if (error) _sbErr('updateBillStatus', error);
  });
}

export async function sbCancelBill(billId, cancelReason, cancelledAt) {
  const { error } = await _sb.from('bills')
    .update({ status: 'cancelled', cancel_reason: cancelReason, cancelled_at: localToISO(cancelledAt) })
    .eq('id', billId);
  if (error) _sbErr('cancelBill', error);
  return !error;
}

// ─── Billing Periods + Adjustments ───────────────────────────
export async function loadBillingPeriods() {
  const [rp, ra] = await Promise.all([
    _sb.from('billing_periods').select('period_year, period_month, status'),
    _sb.from('bill_adjustments').select('*').order('created_at'),
  ]);
  if (rp.error) console.warn('[sb] billing_periods:', rp.error.message);
  if (ra.error) console.warn('[sb] bill_adjustments:', ra.error.message);
  appState.closedPeriods = new Set((rp.data || [])
    .filter(p => p.status === 'closed')
    .map(p => `${p.period_year}-${p.period_month}`));
  appState.billAdjustments = (ra.data || []).map(a => ({
    id:        a.id,
    docNo:     a.doc_no,
    billId:    a.bill_id,
    amount:    parseFloat(a.amount) || 0,
    reason:    a.reason,
    createdAt: (a.created_at || '').replace('T', ' ').substring(0, 16),
  }));
}

export async function sbGetBillingPeriods() {
  const { data, error } = await _sb.rpc('get_billing_periods');
  if (error) { _sbErr('getBillingPeriods', error); return null; }
  return data || [];
}

export async function sbCloseBillingPeriod(year, month, note) {
  const { error } = await _sb.rpc('close_billing_period', { p_year: year, p_month: month, p_note: note || null });
  if (error) { _sbErr('closeBillingPeriod', error); return false; }
  return true;
}

export async function sbReopenBillingPeriod(year, month, reason) {
  const { error } = await _sb.rpc('reopen_billing_period', { p_year: year, p_month: month, p_reason: reason });
  if (error) { _sbErr('reopenBillingPeriod', error); return false; }
  return true;
}

// amount > 0 เพิ่มหนี้, < 0 ลดหนี้ — คืน { doc_no, bill: { id, discount, total } }
export async function sbAdjustBill(billId, amount, reason) {
  const { data, error } = await _sb.rpc('adjust_bill', { p_bill_id: billId, p_amount: amount, p_reason: reason });
  if (error) { _sbErr('adjustBill', error); return null; }
  return data;
}

export async function sbExportBackup() {
  const { data, error } = await _sb.rpc('export_backup');
  if (error) { _sbErr('exportBackup', error); return null; }
  return data;
}

// ─── Payment Write Helpers ────────────────────────────────────
// server ออกเลขใบเสร็จเมื่อสถานะเป็น approved — คืนรายการที่บันทึกแล้ว หรือ null
export async function sbInsertPayment(p) {
  const { data, error } = await _sb.from('payments')
    .insert({ ..._pToDB(p), receipt_no: null }).select().single();
  if (error) { _sbErr('insertPayment', error); return null; }
  return _pFromDB(data);
}

export async function sbCancelPayment(id, cancelledAt, reason) {
  const { error } = await _sb.from('payments')
    .update({ status: 'cancelled', cancelled_at: localToISO(cancelledAt), cancel_reason: reason })
    .eq('id', id);
  if (error) _sbErr('cancelPayment', error);
  return !error;
}

/** นับการพิมพ์ใบเสร็จ — คืนครั้งที่พิมพ์ (1 = ต้นฉบับ) หรือ null */
export async function sbMarkReceiptPrinted(paymentId) {
  const { data, error } = await _sb.rpc('mark_receipt_printed', { p_payment_id: paymentId });
  if (error) { _sbErr('markReceiptPrinted', error); return null; }
  return data;
}

// ─── Cashier day close ───────────────────────────────────────
export async function sbGetCashSummary(date, cashierId = null) {
  const { data, error } = await _sb.rpc('get_cash_summary', { p_date: date, p_cashier: cashierId });
  if (error) { _sbErr('getCashSummary', error); return null; }
  return data;
}

export async function sbCloseCashDay(date, counted, note) {
  const { data, error } = await _sb.rpc('close_cash_day', { p_date: date, p_counted: counted, p_note: note || null });
  if (error) { _sbErr('closeCashDay', error); return null; }
  return data;
}

export async function sbReopenCashDay(id, reason) {
  const { error } = await _sb.rpc('reopen_cash_day', { p_id: id, p_reason: reason });
  if (error) { _sbErr('reopenCashDay', error); return false; }
  return true;
}

export async function sbListCashClosings(limit = 60) {
  const { data, error } = await _sb.from('cash_closings').select('*')
    .order('close_date', { ascending: false }).limit(limit);
  if (error) { _sbErr('listCashClosings', error); return []; }
  return data || [];
}

// ─── Audit (server กำหนดผู้ทำรายการเอง) ──────────────────────
export function sbLogAudit(tableName, recordId, action, oldData, newData) {
  _sb.from('audit_logs').insert({
    table_name: tableName, record_id: String(recordId ?? ''), action,
    old_data: oldData ?? null, new_data: newData ?? null,
  }).then(({ error }) => { if (error) console.warn('[audit]', error.message); });
}

export async function sbApprovePayment(id, approvedAt) {
  const { data, error } = await _sb.from('payments')
    .update({ status: 'approved', approved_at: localToISO(approvedAt) }).eq('id', id).select().single();
  if (error) { _sbErr('approvePayment', error); return null; }
  return _pFromDB(data);
}

export function sbUpdatePayment(id, patch) {
  _sb.from('payments').update(patch).eq('id', id).then(({ error }) => {
    if (error) _sbErr('updatePayment', error);
  });
}

// ─── Meter Reading Write Helpers ──────────────────────────────
export function sbUpsertReading(r) {
  _sb.from('meter_readings').upsert(_rToDB(r)).then(({ error }) => {
    if (error) _sbErr('upsertReading', error);
  });
}

export function sbDeleteReading(id) {
  _sb.from('meter_readings').delete().eq('id', id).then(({ error }) => {
    if (error) _sbErr('deleteReading', error);
  });
}

// ─── Rate Tier Write Helpers ──────────────────────────────────
export async function sbSaveRateTier(fromUnit, newRate) {
  const { error } = await _sb.from('rate_tiers')
    .update({ rate_per_unit: newRate })
    .eq('from_unit', fromUnit);
  if (error) _sbErr('saveRateTier', error);
  return !error;
}

export async function sbUpdateTierTo(fromUnit, newToUnit) {
  const { error } = await _sb.from('rate_tiers')
    .update({ to_unit: newToUnit === Infinity ? null : newToUnit })
    .eq('from_unit', fromUnit);
  if (error) _sbErr('updateTierTo', error);
  return !error;
}

export async function sbInsertRateTier(fromUnit, toUnit, rate) {
  const { error } = await _sb.from('rate_tiers')
    .insert({ from_unit: fromUnit, to_unit: toUnit ?? null, rate_per_unit: rate });
  if (error) _sbErr('insertRateTier', error);
  return !error;
}

export async function sbDeleteRateTier(fromUnit) {
  const { error } = await _sb.from('rate_tiers')
    .delete().eq('from_unit', fromUnit);
  if (error) _sbErr('deleteRateTier', error);
  return !error;
}

// ─── Maintenance Write Helpers ────────────────────────────────
export function sbUpsertMaintenance(m) {
  _sb.from('maintenance_jobs').upsert(_ntToDB(m)).then(({ error }) => {
    if (error) _sbErr('upsertMaintenance', error);
  });
}

// ─── Meter Replacement Load (non-blocking) ───────────────────
async function _loadMeterReplacements() {
  try {
    const { data, error } = await _sb.from('meter_replacements')
      .select('*').order('replaced_at', { ascending: false });
    if (error) { console.warn('[sb] meter_replacements:', error.message); return; }
    appState.meterReplacements = (data || []).map(r => ({
      id:         r.id,
      memberId:   r.member_id,
      oldMeterNo: r.old_meter_no,
      newMeterNo: r.new_meter_no,
      oldReading: parseFloat(r.old_reading) || 0,
      newReading: parseFloat(r.new_reading) || 0,
      replacedAt: r.replaced_at,
      replacedBy: r.replaced_by || '',
      reason:     r.reason      || '',
      note:       r.note        || '',
    }));
  } catch (e) {
    console.warn('[sb] meter_replacements load failed:', e);
  }
}

// ─── Meter Replacement Write Helpers ─────────────────────────
export async function sbInsertMeterReplacement(r) {
  const { data, error } = await _sb.from('meter_replacements').insert({
    member_id:    r.memberId,
    old_meter_no: r.oldMeterNo,
    new_meter_no: r.newMeterNo,
    old_reading:  r.oldReading,
    new_reading:  r.newReading,
    replaced_at:  r.replacedAt,
    replaced_by:  r.replacedBy || null,
    reason:       r.reason     || null,
    note:         r.note       || null,
  }).select('id').single();
  if (error) { _sbErr('insertMeterReplacement', error); return null; }
  return data?.id || null;
}
