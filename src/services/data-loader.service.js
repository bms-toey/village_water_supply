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
import { loadMasterData } from './master-data.service.js';

// Show Supabase write errors as toast so the user can see them
function _sbErr(label, error) {
  console.error(`[sb] ${label}:`, error.message, error);
  toast(`⚠ Supabase (${label}): ${error.message}`, 'error');
}

// ─── Load All ────────────────────────────────────────────────
export async function loadAllFromSupabase() {
  try {
    const [rv, rm, rb, rp, rr, rt, rn, rwp, rwq, rmr] = await Promise.all([
      _sb.from('villages').select('*').order('moo_number'),
      _sb.from('members').select('*').eq('is_deleted', false).order('id'),
      _sb.from('bills').select('*').order('period_year', { ascending: false }).order('period_month', { ascending: false }),
      _sb.from('payments').select('*').order('paid_at', { ascending: false }),
      _sb.from('meter_readings').select('*').order('reading_date', { ascending: false }),
      _sb.from('rate_tiers').select('*').order('from_unit'),
      _sb.from('maintenance_jobs').select('*').order('created_at', { ascending: false }),
      _sb.from('water_production').select('*').order('period_year', { ascending: false }),
      _sb.from('water_quality').select('*').order('test_date', { ascending: false }),
      _sb.from('meter_replacements').select('*').order('replaced_at', { ascending: false }),
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
    appState.maintenance       = (rn.data  || []).map(_ntFromDB);
    appState.waterProduction   = rwp.data  || [];
    appState.waterQuality      = rwq.data  || [];
    appState.meterReplacements = (rmr.data || []).map(r => ({
      id:          r.id,
      memberId:    r.member_id,
      oldMeterNo:  r.old_meter_no,
      newMeterNo:  r.new_meter_no,
      oldReading:  parseFloat(r.old_reading) || 0,
      newReading:  parseFloat(r.new_reading) || 0,
      replacedAt:  r.replaced_at,
      replacedBy:  r.replaced_by || '',
      reason:      r.reason      || '',
      note:        r.note        || '',
    }));

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

export function sbUpsertBills(list) {
  if (!list.length) return;
  _sb.from('bills').upsert(list.map(_bToDB)).then(({ error }) => {
    if (error) _sbErr('upsertBills', error);
  });
}

export function sbUpdateBillStatus(billId, status) {
  _sb.from('bills').update({ status }).eq('id', billId).then(({ error }) => {
    if (error) _sbErr('updateBillStatus', error);
  });
}

export function sbUpdateBillFees(billId, lateFee, total) {
  _sb.from('bills').update({ late_fee: lateFee, total }).eq('id', billId).then(({ error }) => {
    if (error) _sbErr('updateBillFees', error);
  });
}

export function sbCancelBill(billId, cancelReason, cancelledAt) {
  _sb.from('bills').update({ status: 'cancelled', cancel_reason: cancelReason, cancelled_at: cancelledAt }).eq('id', billId).then(({ error }) => {
    if (error) _sbErr('cancelBill', error);
  });
}

// ─── Payment Write Helpers ────────────────────────────────────
export function sbUpsertPayment(p) {
  _sb.from('payments').upsert(_pToDB(p)).then(({ error }) => {
    if (error) _sbErr('upsertPayment', error);
  });
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
