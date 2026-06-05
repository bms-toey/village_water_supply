// ─── Persist to localStorage ───
function saveToStorage() {
  try {
    localStorage.setItem('aq_members',       JSON.stringify(members));
    localStorage.setItem('aq_bills',         JSON.stringify(bills));
    localStorage.setItem('aq_payments',      JSON.stringify(payments));
    localStorage.setItem('aq_meterReadings', JSON.stringify(meterReadings));
    localStorage.setItem('aq_nextMemberId',  String(nextMemberId));
  } catch (e) {}
  renderDashboard();
}

// ─── Restore from localStorage ───
function loadFromStorage() {
  try {
    const m  = localStorage.getItem('aq_members');       if (m)  members       = JSON.parse(m);
    const b  = localStorage.getItem('aq_bills');         if (b)  bills         = JSON.parse(b);
    const p  = localStorage.getItem('aq_payments');      if (p)  payments      = JSON.parse(p);
    const mr = localStorage.getItem('aq_meterReadings'); if (mr) meterReadings = JSON.parse(mr);
    const ni = localStorage.getItem('aq_nextMemberId');  if (ni) nextMemberId  = parseInt(ni);
  } catch (e) {}
}

// ─── Persist / Restore Rate Config ───
function saveRateConfig() {
  try { localStorage.setItem('aq_rateConfig', JSON.stringify(rateConfig)); } catch (e) {}
}
function loadRateConfig() {
  try {
    const r = localStorage.getItem('aq_rateConfig');
    if (r) rateConfig = JSON.parse(r);
  } catch (e) {}
}
