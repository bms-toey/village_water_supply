// ─── Application State ─────────────────────────────────────────
// Single mutable object holding all shared in-memory data.
// Import `appState` in any module that needs to read or write shared data.
// Use property assignment (appState.members = [...]) not reassignment.
// ──────────────────────────────────────────────────────────────

export const appState = {
  // Member data
  members:          [],
  nextMemberId:     100001,
  pendingDeleteId:  null,
  currentMeterMemberId: null,

  // Billing & payment data
  meterReadings: [],
  bills:         [],
  payments:      [],

  // Operations data
  waterProduction:   [],
  waterQuality:      [],
  maintenance:       [],
  meterReplacements: [],

  // Dynamic master data (category → item[])
  // Loaded from Supabase master_data table at startup
  masterData: {},

  // System config (key → value)
  systemConfig: {},
};
