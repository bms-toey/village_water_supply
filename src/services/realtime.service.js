// ─── Realtime Service ──────────────────────────────────────────
// Subscribes to Supabase postgres_changes for all core tables.
// Patches appState in-place and schedules debounced re-renders.
//
// Supabase prerequisite: enable Realtime on each table via:
//   Dashboard → Table Editor → (table) → Realtime toggle ON
//   OR SQL: ALTER PUBLICATION supabase_realtime ADD TABLE tablename;
// ──────────────────────────────────────────────────────────────
import { _sb }         from './supabase.service.js';
import { appState }    from '../state/app.state.js';
import { rateConfig }  from '../config/rate.config.js';
import {
  _mFromDB, _bFromDB, _pFromDB, _rFromDB, _ntFromDB,
  setVillages,
} from './db-mapper.service.js';
import { loadAllFromSupabase } from './data-loader.service.js';
import { loadMasterData }      from './master-data.service.js';
import { toast }               from '../utils/dom.util.js';

// ── Render map: table → callback names ──────────────────────
const _RENDER_MAP = {
  members:          ['renderMembers', 'renderDashboard', 'renderDebtors'],
  bills:            ['renderBilling', 'renderDashboard', 'renderDebtors', 'renderReports'],
  payments:         ['renderPayments', 'renderDashboard', 'renderBilling', 'renderReports'],
  meter_readings:   ['renderDashboard', 'renderReports'],
  maintenance_jobs: ['renderMaintenance', 'renderDashboard'],
  water_production: ['renderDashboard', 'renderReports'],
  water_quality:    ['renderDashboard', 'renderReports'],
  villages:         ['renderMembers', 'renderSettings', 'populateVillageDropdowns'],
  rate_tiers:       ['renderSettings'],
  master_data:      ['renderSettings'],
};

let _callbacks     = null;
let _channel       = null;
let _fallbackTimer = null;
let _pendingRenders = new Set();
let _renderTimer    = null;
let _refreshing     = false;

// ── Public API ────────────────────────────────────────────────
export function initRealtime(callbacks) {
  _callbacks = callbacks;
  _subscribe();
  _startFallback();
  // Set initial timestamp once data is loaded
  window.addEventListener('aquaflow:data-ready', markUpdated, { once: false });
}

export function stopRealtime() {
  if (_channel) { _sb.removeChannel(_channel); _channel = null; }
  if (_fallbackTimer) { clearInterval(_fallbackTimer); _fallbackTimer = null; }
}

export async function manualRefresh() {
  if (_refreshing) return;
  _refreshing = true;
  _setRefreshUI(true);
  try {
    const ok = await loadAllFromSupabase();
    if (ok) {
      _flushAll();
      toast('รีเฟรชข้อมูลสำเร็จ', 'success');
    } else {
      toast('ไม่สามารถดึงข้อมูลได้ (offline?)', 'warn');
    }
  } catch (e) {
    console.error('[RT] manualRefresh:', e);
    toast('เกิดข้อผิดพลาดในการรีเฟรช', 'error');
  } finally {
    _refreshing = false;
    _setRefreshUI(false);
    markUpdated();
  }
}

export function markUpdated() {
  const el = document.getElementById('rt-time');
  if (!el) return;
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  el.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// ── Supabase Realtime subscription ───────────────────────────
function _subscribe() {
  if (_channel) _sb.removeChannel(_channel);

  _channel = _sb
    .channel('aquaflow-rt-v1')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'members' },
        e => _onEvent('members', e))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bills' },
        e => _onEvent('bills', e))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' },
        e => _onEvent('payments', e))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'meter_readings' },
        e => _onEvent('meter_readings', e))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_jobs' },
        e => _onEvent('maintenance_jobs', e))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'water_production' },
        e => _onEvent('water_production', e))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'water_quality' },
        e => _onEvent('water_quality', e))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'villages' },
        e => _onEvent('villages', e))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rate_tiers' },
        e => _onEvent('rate_tiers', e))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'master_data' },
        e => _onEvent('master_data', e))
    .subscribe(status => {
      _setStatusDot(status);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[RT] subscription error:', status, '— retrying in 8s');
        setTimeout(_subscribe, 8000);
      }
    });
}

// ── Patch appState from Realtime payload ─────────────────────
function _onEvent(table, payload) {
  const { eventType } = payload;
  const newRec = payload.new || {};
  const oldRec = payload.old || {};

  try {
    switch (table) {

      case 'members': {
        if (eventType === 'INSERT') {
          if (!newRec.is_deleted) appState.members.push(_mFromDB(newRec));
        } else if (eventType === 'UPDATE') {
          if (newRec.is_deleted) {
            appState.members = appState.members.filter(m => m.id !== newRec.id);
          } else {
            const idx = appState.members.findIndex(m => m.id === newRec.id);
            const mapped = _mFromDB(newRec);
            if (idx >= 0) appState.members[idx] = mapped;
            else appState.members.push(mapped);
          }
          if (appState.members.length)
            appState.nextMemberId = Math.max(...appState.members.map(m => m.id)) + 1;
        } else if (eventType === 'DELETE') {
          appState.members = appState.members.filter(m => m.id !== (oldRec.id ?? newRec.id));
        }
        break;
      }

      case 'bills': {
        if (eventType === 'INSERT') {
          appState.bills.unshift(_bFromDB(newRec));
        } else if (eventType === 'UPDATE') {
          const idx = appState.bills.findIndex(b => b.id === newRec.id);
          const mapped = _bFromDB(newRec);
          if (idx >= 0) appState.bills[idx] = mapped;
          else appState.bills.unshift(mapped);
        } else if (eventType === 'DELETE') {
          appState.bills = appState.bills.filter(b => b.id !== (oldRec.id ?? newRec.id));
        }
        break;
      }

      case 'payments': {
        if (eventType === 'INSERT') {
          appState.payments.unshift(_pFromDB(newRec));
        } else if (eventType === 'UPDATE') {
          const idx = appState.payments.findIndex(p => p.id === newRec.id);
          const mapped = _pFromDB(newRec);
          if (idx >= 0) appState.payments[idx] = mapped;
          else appState.payments.unshift(mapped);
        } else if (eventType === 'DELETE') {
          appState.payments = appState.payments.filter(p => p.id !== (oldRec.id ?? newRec.id));
        }
        break;
      }

      case 'meter_readings': {
        if (eventType === 'INSERT') {
          appState.meterReadings.unshift(_rFromDB(newRec));
        } else if (eventType === 'UPDATE') {
          const idx = appState.meterReadings.findIndex(r => r.id === newRec.id);
          const mapped = _rFromDB(newRec);
          if (idx >= 0) appState.meterReadings[idx] = mapped;
          else appState.meterReadings.unshift(mapped);
        } else if (eventType === 'DELETE') {
          appState.meterReadings = appState.meterReadings.filter(r => r.id !== (oldRec.id ?? newRec.id));
        }
        break;
      }

      case 'maintenance_jobs': {
        if (eventType === 'INSERT') {
          appState.maintenance.unshift(_ntFromDB(newRec));
        } else if (eventType === 'UPDATE') {
          const idx = appState.maintenance.findIndex(m => m.id === newRec.id);
          const mapped = _ntFromDB(newRec);
          if (idx >= 0) appState.maintenance[idx] = mapped;
          else appState.maintenance.unshift(mapped);
        } else if (eventType === 'DELETE') {
          appState.maintenance = appState.maintenance.filter(m => m.id !== (oldRec.id ?? newRec.id));
        }
        break;
      }

      case 'water_production': {
        if (eventType === 'INSERT') {
          appState.waterProduction.unshift(newRec);
        } else if (eventType === 'UPDATE') {
          const idx = appState.waterProduction.findIndex(r => r.id === newRec.id);
          if (idx >= 0) appState.waterProduction[idx] = newRec;
          else appState.waterProduction.unshift(newRec);
        } else if (eventType === 'DELETE') {
          appState.waterProduction = appState.waterProduction.filter(r => r.id !== (oldRec.id ?? newRec.id));
        }
        break;
      }

      case 'water_quality': {
        if (eventType === 'INSERT') {
          appState.waterQuality.unshift(newRec);
        } else if (eventType === 'UPDATE') {
          const idx = appState.waterQuality.findIndex(r => r.id === newRec.id);
          if (idx >= 0) appState.waterQuality[idx] = newRec;
          else appState.waterQuality.unshift(newRec);
        } else if (eventType === 'DELETE') {
          appState.waterQuality = appState.waterQuality.filter(r => r.id !== (oldRec.id ?? newRec.id));
        }
        break;
      }

      // Config tables — full reload to keep derived values consistent
      case 'villages':
      case 'rate_tiers':
      case 'master_data': {
        loadAllFromSupabase().then(ok => { if (ok) _flushAll(); });
        return;
      }
    }

    markUpdated();
    _scheduleRender(table);

  } catch (e) {
    console.warn('[RT] patch error on', table, e);
  }
}

// ── Debounced render queue ────────────────────────────────────
function _scheduleRender(table) {
  (_RENDER_MAP[table] || []).forEach(fn => _pendingRenders.add(fn));
  if (_renderTimer) clearTimeout(_renderTimer);
  _renderTimer = setTimeout(_flushPending, 350);
}

function _flushPending() {
  _renderTimer = null;
  const fns = [..._pendingRenders];
  _pendingRenders.clear();
  _runRenders(fns);
}

function _flushAll() {
  if (_renderTimer) clearTimeout(_renderTimer);
  _renderTimer = null;
  _pendingRenders.clear();
  _runRenders(Object.values(_RENDER_MAP).flat());
  markUpdated();
}

function _runRenders(fnNames) {
  const unique = [...new Set(fnNames)];
  unique.forEach(name => {
    if (typeof _callbacks?.[name] === 'function') {
      try { _callbacks[name](); } catch (e) { console.warn(`[RT] ${name}:`, e); }
    }
  });
}

// ── Background fallback poll (every 5 min) ───────────────────
// Catches any events missed during connection drops
function _startFallback() {
  if (_fallbackTimer) clearInterval(_fallbackTimer);
  _fallbackTimer = setInterval(async () => {
    const ok = await loadAllFromSupabase();
    if (ok) { _flushAll(); }
  }, 5 * 60 * 1000);
}

// ── UI helpers ────────────────────────────────────────────────
function _setStatusDot(status) {
  const dot     = document.getElementById('rt-dot');
  const wrapper = document.getElementById('topbar-realtime');
  if (!dot) return;

  dot.className = 'rt-dot';
  if (status === 'SUBSCRIBED') {
    dot.classList.add('rt-dot--on');
    if (wrapper) wrapper.title = 'Realtime เชื่อมต่อแล้ว — คลิกเพื่อรีเฟรช';
  } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
    dot.classList.add('rt-dot--off');
    if (wrapper) wrapper.title = 'ขาดการเชื่อมต่อ — คลิกเพื่อรีเฟรช';
  } else {
    dot.classList.add('rt-dot--wait');
    if (wrapper) wrapper.title = 'กำลังเชื่อมต่อ... — คลิกเพื่อรีเฟรช';
  }
}

function _setRefreshUI(loading) {
  const icon = document.getElementById('rt-icon');
  if (!icon) return;
  if (loading) {
    icon.className = 'ti ti-loader-2';
    icon.style.animation = 'spin .8s linear infinite';
  } else {
    icon.className = 'ti ti-refresh';
    icon.style.animation = '';
  }
}
