// ─── Master Data Service ───────────────────────────────────────
// CRUD + Audit for master_data, villages, system_config tables.
// All lookup/dropdown data is managed here — never hardcoded.
// ──────────────────────────────────────────────────────────────
import { _sb } from './supabase.service.js';
import { appState } from '../state/app.state.js';
import { _dbVillages, setVillages } from './db-mapper.service.js';
import { rateConfig } from '../config/rate.config.js';

// ─── Load ─────────────────────────────────────────────────────
export async function loadMasterData() {
  const [{ data: mdData, error: mdErr }, { data: cfData, error: cfErr }] = await Promise.all([
    _sb.from('master_data').select('*').order('sort_order'),
    _sb.from('system_config').select('*'),
  ]);
  if (mdErr) console.warn('[md] load:', mdErr.message);
  if (cfErr) console.warn('[cfg] load:', cfErr.message);

  // Group by category
  const grouped = {};
  for (const row of mdData || []) {
    if (!grouped[row.category]) grouped[row.category] = [];
    grouped[row.category].push(_mdFromDB(row));
  }
  // Assign without replacing the object reference
  Object.keys(appState.masterData).forEach(k => delete appState.masterData[k]);
  Object.assign(appState.masterData, grouped);

  appState.systemConfig = {};
  for (const row of cfData || []) {
    appState.systemConfig[row.key] = row.value_json !== null ? row.value_json : (row.value || '');
  }

  // Sync rate-related system_config keys into rateConfig so calcWaterCharge uses DB values
  const sc = appState.systemConfig;
  if (sc.svc_charge_small   && !isNaN(parseFloat(sc.svc_charge_small)))   rateConfig.svcSmall        = parseFloat(sc.svc_charge_small);
  if (sc.svc_charge_large   && !isNaN(parseFloat(sc.svc_charge_large)))   rateConfig.svcLarge        = parseFloat(sc.svc_charge_large);
  if (sc.late_fee_per_month && !isNaN(parseFloat(sc.late_fee_per_month))) rateConfig.lateFeePerMonth = parseFloat(sc.late_fee_per_month);

  return true;
}

// ─── Getters ──────────────────────────────────────────────────
/** Active items for a category, sorted by sort_order */
export function getMdItems(category, activeOnly = true) {
  const items = appState.masterData[category] || [];
  return activeOnly ? items.filter(x => x.isActive) : items;
}

/** Single item by code */
export function getMdItem(category, code) {
  return (appState.masterData[category] || []).find(x => x.code === code) || null;
}

/** Get display name (Thai) for a code, with fallback */
export function getMdLabel(category, code, fallback) {
  const item = getMdItem(category, code);
  return item ? item.nameTh : (fallback || code || '—');
}

// ─── Master Data CRUD ──────────────────────────────────────────
export async function saveMdItem(item) {
  const isEdit = !!item.id;

  // Duplicate code check within same category
  const dup = (appState.masterData[item.category] || [])
    .find(x => x.code === item.code && x.id !== item.id);
  if (dup) return { error: `รหัส "${item.code}" มีอยู่แล้วในหมวด ${item.category}` };

  const row = _mdToDB(item);
  const { data, error } = await _sb.from('master_data').upsert(row).select().single();
  if (error) return { error: error.message };

  const saved = _mdFromDB(data);
  const cat = appState.masterData[item.category] || [];
  if (isEdit) {
    const idx = cat.findIndex(x => x.id === saved.id);
    if (idx >= 0) cat[idx] = saved; else cat.push(saved);
  } else {
    cat.push(saved);
  }
  appState.masterData[item.category] = [...cat].sort((a, b) => a.sortOrder - b.sortOrder);

  await _logAudit('master_data', saved.id, isEdit ? 'update' : 'insert', isEdit ? item : null, saved);
  return { data: saved };
}

export async function deleteMdItem(id, category) {
  const old = (appState.masterData[category] || []).find(x => x.id === id);
  const { error } = await _sb.from('master_data').delete().eq('id', id);
  if (error) return { error: error.message };
  appState.masterData[category] = (appState.masterData[category] || []).filter(x => x.id !== id);
  await _logAudit('master_data', id, 'delete', old, null);
  return { ok: true };
}

export async function toggleMdItem(id, category, isActive) {
  const { error } = await _sb.from('master_data')
    .update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return { error: error.message };
  const item = (appState.masterData[category] || []).find(x => x.id === id);
  if (item) item.isActive = isActive;
  await _logAudit('master_data', id, isActive ? 'activate' : 'deactivate', { isActive: !isActive }, { isActive });
  return { ok: true };
}

// ─── Village CRUD ──────────────────────────────────────────────
export async function saveVillage(v) {
  const isEdit = !!v.id;
  const row = {
    moo_number:  v.mooNumber,
    name:        v.name,
    description: v.description || null,
    is_active:   v.isActive !== false,
  };
  if (isEdit) row.id = v.id;

  const { data, error } = await _sb.from('villages').upsert(row).select().single();
  if (error) return { error: error.message };

  // Refresh _dbVillages cache
  const { data: all } = await _sb.from('villages').select('*').order('moo_number');
  if (all) setVillages(all);

  await _logAudit('villages', String(data.id), isEdit ? 'update' : 'insert', isEdit ? v : null, data);
  return { data };
}

export async function deleteVillage(id) {
  const old = _dbVillages.find(v => v.id === id);
  const { error } = await _sb.from('villages').delete().eq('id', id);
  if (error) return { error: error.message };
  setVillages(_dbVillages.filter(v => v.id !== id));
  await _logAudit('villages', String(id), 'delete', old, null);
  return { ok: true };
}

export async function toggleVillage(id, isActive) {
  const { error } = await _sb.from('villages').update({ is_active: isActive }).eq('id', id);
  if (error) return { error: error.message };
  const v = _dbVillages.find(x => x.id === id);
  if (v) v.is_active = isActive;
  await _logAudit('villages', String(id), isActive ? 'activate' : 'deactivate', { is_active: !isActive }, { is_active: isActive });
  return { ok: true };
}

// ─── System Config ─────────────────────────────────────────────
export async function saveSystemConfig(key, value) {
  const { error } = await _sb.from('system_config').upsert({
    key, value: String(value), updated_at: new Date().toISOString(),
  });
  if (error) return { error: error.message };
  appState.systemConfig[key] = value;
  await _logAudit('system_config', key, 'update', null, { key, value });
  return { ok: true };
}

// ─── Audit Log ─────────────────────────────────────────────────
async function _logAudit(tableName, recordId, action, oldData, newData) {
  const user = _sb.auth.getUser ? (await _sb.auth.getUser()).data?.user?.email : null;
  await _sb.from('audit_logs').insert({
    table_name:   tableName,
    record_id:    String(recordId || ''),
    action,
    old_data:     oldData  ? JSON.parse(JSON.stringify(oldData))  : null,
    new_data:     newData  ? JSON.parse(JSON.stringify(newData))  : null,
    performed_by: user || 'system',
  });
}

export async function loadAuditLogs(limit = 100, tableFilter = '') {
  let q = _sb.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(limit);
  if (tableFilter) q = q.eq('table_name', tableFilter);
  const { data, error } = await q;
  if (error) console.warn('[audit]', error.message);
  return data || [];
}

// ─── Mappers ───────────────────────────────────────────────────
function _mdFromDB(r) {
  return {
    id:          r.id,
    category:    r.category,
    code:        r.code,
    nameTh:      r.name_th,
    nameEn:      r.name_en      || '',
    description: r.description  || '',
    icon:        r.icon         || '',
    color:       r.color        || '',
    metadata:    r.metadata     || {},
    sortOrder:   r.sort_order   || 0,
    isActive:    r.is_active    !== false,
    createdBy:   r.created_by   || '',
    createdAt:   (r.created_at  || '').substring(0, 16).replace('T', ' '),
    updatedBy:   r.updated_by   || '',
    updatedAt:   (r.updated_at  || '').substring(0, 16).replace('T', ' '),
  };
}

function _mdToDB(item) {
  const row = {
    category:   item.category,
    code:       item.code,
    name_th:    item.nameTh,
    name_en:    item.nameEn     || null,
    description:item.description|| null,
    icon:       item.icon       || null,
    color:      item.color      || null,
    metadata:   item.metadata   || {},
    sort_order: item.sortOrder  || 0,
    is_active:  item.isActive   !== false,
    updated_at: new Date().toISOString(),
  };
  if (item.id) row.id = item.id;
  return row;
}
