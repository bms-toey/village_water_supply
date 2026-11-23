// ─── localStorage Service ──────────────────────────────────────
// Offline fallback: persist and restore appState from localStorage.
// Only used when Supabase is unreachable.
// ──────────────────────────────────────────────────────────────
import { appState } from '../state/app.state.js';
import { rateConfig } from '../config/rate.config.js';

const CACHE_SAVED_AT_KEY = 'aq_cache_saved_at';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function _cacheIsFresh() {
  try {
    const savedAt = Number(localStorage.getItem(CACHE_SAVED_AT_KEY));
    return Number.isFinite(savedAt) && savedAt > 0 && Date.now() - savedAt <= CACHE_TTL_MS;
  } catch {
    return false;
  }
}

export function saveToStorage() {
  try {
    localStorage.setItem('aq_members',       JSON.stringify(appState.members));
    localStorage.setItem('aq_bills',         JSON.stringify(appState.bills));
    localStorage.setItem('aq_payments',      JSON.stringify(appState.payments));
    localStorage.setItem('aq_meterReadings', JSON.stringify(appState.meterReadings));
    localStorage.setItem('aq_nextMemberId',  String(appState.nextMemberId));
    localStorage.setItem(CACHE_SAVED_AT_KEY,  String(Date.now()));
  } catch (_) {}
}

export function loadFromStorage() {
  if (!_cacheIsFresh()) {
    clearOfflineCache();
    return false;
  }
  try {
    const m  = localStorage.getItem('aq_members');       if (m)  appState.members       = JSON.parse(m);
    const b  = localStorage.getItem('aq_bills');         if (b)  appState.bills         = JSON.parse(b);
    const p  = localStorage.getItem('aq_payments');      if (p)  appState.payments      = JSON.parse(p);
    const mr = localStorage.getItem('aq_meterReadings'); if (mr) appState.meterReadings = JSON.parse(mr);
    const ni = localStorage.getItem('aq_nextMemberId');  if (ni) appState.nextMemberId  = parseInt(ni);
    return true;
  } catch (_) {
    clearOfflineCache();
    return false;
  }
}

// เรียกตอนออกจากระบบ — ไม่ทิ้งข้อมูลสมาชิก/การเงินไว้ในเครื่องที่ใช้ร่วมกัน
export function clearOfflineCache() {
  ['aq_members', 'aq_bills', 'aq_payments', 'aq_meterReadings', 'aq_nextMemberId', 'aq_maintenance', CACHE_SAVED_AT_KEY]
    .forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
}

export function saveRateConfig() {
  try { localStorage.setItem('aq_rateConfig', JSON.stringify(rateConfig)); } catch (_) {}
}

export function loadRateConfig() {
  try {
    const r = localStorage.getItem('aq_rateConfig');
    if (r) Object.assign(rateConfig, JSON.parse(r));
  } catch (_) {}
}

export function loadMaintenanceFromStorage() {
  if (!_cacheIsFresh()) return;
  try {
    const m = localStorage.getItem('aq_maintenance');
    if (m) appState.maintenance = JSON.parse(m);
  } catch (_) {}
}
