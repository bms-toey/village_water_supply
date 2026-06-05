// ─── UI Configuration ──────────────────────────────────────────
// Provides display maps for labels, CSS classes, and icons.
// Dynamic data (member_type, meter_size, etc.) is read from
// appState.masterData (loaded from Supabase master_data table).
// Hardcoded fallbacks below are used only when masterData is empty.
// ──────────────────────────────────────────────────────────────
import { appState } from '../state/app.state.js';

// ─── Static system status maps (not user-editable) ────────────
export const statusMap = {
  normal:    { cls: 'pill-normal',   label: 'ปกติ' },
  overdue:   { cls: 'pill-overdue',  label: 'ค้างชำระ' },
  closed:    { cls: 'pill-closed',   label: 'ปิดมิเตอร์' },
  suspended: { cls: 'pill-inactive', label: 'ระงับชั่วคราว' },
};

export const anomalyMap = {
  high_usage:     'ใช้สูงผิดปกติ',
  meter_fault:    'มิเตอร์เสีย',
  suspected_leak: 'สงสัยรั่ว',
};

export const methodMap = {
  manual:  'Manual',
  ai_scan: 'AI Scan',
  remote:  'Remote',
};

export const roleLabels = {
  super_admin:   'Super Admin',
  village_admin: 'Village Admin',
  meter_reader:  'พนักงานจดมิเตอร์',
  finance:       'การเงิน',
};

// ─── Hardcoded fallbacks (used when masterData not yet loaded) ─
export const memberTypeMap = {
  residential: { label: 'บ้านอยู่อาศัย', cls: 'mtype-residential' },
  commercial:  { label: 'พาณิชยกรรม',    cls: 'mtype-commercial'  },
  agriculture: { label: 'เกษตรกรรม',     cls: 'mtype-agriculture' },
  institution: { label: 'หน่วยงาน',      cls: 'mtype-institution' },
};

export const meterSizeMap = {
  '0.5':  '½"',
  '0.75': '¾"',
  '1':    '1"',
  '1.5':  '1½"',
};

export const channelMap = {
  promptpay: { label: 'PromptPay',   icon: 'ti-qrcode' },
  bank:      { label: 'โอนธนาคาร', icon: 'ti-building-bank' },
  cash:      { label: 'เงินสด',     icon: 'ti-cash' },
  mobile:    { label: 'Mobile App',  icon: 'ti-device-mobile' },
};

// ─── Dynamic getters (prefer masterData, fall back to hardcoded) ─

/** Get label + css class for member type from masterData or fallback */
export function getMemberTypeDisplay(code) {
  const item = (appState.masterData?.member_type || []).find(x => x.code === code && x.isActive);
  if (item) return { label: item.nameTh, cls: item.metadata?.cls || 'mtype-residential', icon: item.icon, color: item.color };
  return memberTypeMap[code] || { label: code || '—', cls: 'mtype-residential' };
}

/** Get display string for meter size */
export function getMeterSizeDisplay(code) {
  const item = (appState.masterData?.meter_size || []).find(x => x.code === code);
  if (item) return item.metadata?.display || item.nameTh;
  return meterSizeMap[code] || code || '';
}

/** Get label + icon for payment channel */
export function getChannelDisplay(code) {
  const item = (appState.masterData?.payment_channel || []).find(x => x.code === code);
  if (item) return { label: item.nameTh, icon: item.icon || 'ti-credit-card', color: item.color };
  return channelMap[code] || { label: code, icon: 'ti-credit-card' };
}

/** Get label for anomaly type */
export function getAnomalyLabel(code) {
  const item = (appState.masterData?.anomaly_type || []).find(x => x.code === code);
  return item ? item.nameTh : (anomalyMap[code] || code || '—');
}

/** Get full maintenance type info */
export function getMaintenanceTypeDisplay(code) {
  const item = (appState.masterData?.maintenance_type || []).find(x => x.code === code);
  if (item) return { label: item.nameTh, icon: item.icon || 'ti-tool', cls: item.metadata?.cls || 'pill-normal', color: item.color };
  return { label: code, icon: 'ti-tool', cls: 'pill-normal' };
}
