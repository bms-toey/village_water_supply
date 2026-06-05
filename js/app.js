// ─── goPage Override — trigger page renders on navigation ───
(function () {
  const _origGoPage = goPage;
  goPage = function (id) {
    _origGoPage(id);
    if (id === 'billing')     { _populateBillingFilters(); renderBilling(); }
    if (id === 'debtors')       renderDebtors();
    if (id === 'payments')      renderPayments();
    if (id === 'dashboard')     renderDashboard();
    if (id === 'reports')       renderReports();
    if (id === 'map')           setTimeout(renderMap, 60);
    if (id === 'maintenance')   renderMaintenance();
    if (id === 'users')         renderUsers();
    if (id === 'settings')    { renderSettingsRates(); renderSettingsVillages(); }
  };
})();

// ─── Billing Tab Filters ───
document.querySelectorAll('#page-billing .tab').forEach((t, i) => {
  t.addEventListener('click', () => {
    const filters = [null, 'overdue', 'pending', 'paid'];
    _billStatusTab = filters[i];
    renderBilling();
  });
});

// ─── Billing Search & Filter Inputs ───
(function () {
  const pg        = document.getElementById('page-billing');
  const searchEl  = pg.querySelector('.fsearch');
  const selects   = pg.querySelectorAll('.fselect');
  const villageEl = selects[0];
  const periodEl  = selects[1];
  if (searchEl)  searchEl.addEventListener('input',  () => { _billSearch  = searchEl.value.trim(); renderBilling(); });
  if (villageEl) villageEl.addEventListener('change', () => { _billVillage = villageEl.value === 'ทุกหมู่บ้าน' ? '' : villageEl.value; renderBilling(); });
  if (periodEl)  periodEl.addEventListener('change',  () => { _billPeriod  = periodEl.value.startsWith('ทุก') ? '' : periodEl.value;  renderBilling(); });
})();

// ─── Populate billing filter selects from real data ───
function _populateBillingFilters() {
  const pg        = document.getElementById('page-billing');
  const selects   = pg.querySelectorAll('.fselect');
  const villageEl = selects[0];
  const periodEl  = selects[1];
  if (villageEl && villageEl.options.length <= 1) {
    const villages = [...new Set(members.map(m => m.village))].sort();
    villageEl.innerHTML = '<option>ทุกหมู่บ้าน</option>' + villages.map(v => `<option>${esc(v)}</option>`).join('');
  }
  if (periodEl) {
    const periods = [...new Set(bills.map(b => b.period))].sort().reverse();
    const cur = periodEl.value;
    periodEl.innerHTML = '<option>ทุกรอบบิล</option>' + periods.map(p => `<option${p === cur ? ' selected' : ''}>${esc(p)}</option>`).join('');
  }
}

// ─── Debtors Severity Filter ───
(function () {
  const sel = document.getElementById('debtor-severity-select');
  if (!sel) return;
  sel.addEventListener('change', () => {
    const v = sel.value;
    _debtorSeverity = v === 'ทุกสถานะ' ? '' : v === 'ค้าง 1 เดือน' ? '1' : v === 'ค้าง 2 เดือน' ? '2' : v === 'ค้างเกิน 3 เดือน' ? '3' : '';
    renderDebtors();
  });
})();

// ─── Members Table — Event Delegation ───
document.getElementById('members-tbody').addEventListener('click', function (e) {
  const btn = e.target.closest('[data-act]');
  const row = e.target.closest('.member-row');
  if (!row) return;
  const mid = parseInt(row.dataset.mid);
  const m   = members.find(x => x.id === mid);
  if (!m) return;
  if (btn) {
    e.stopPropagation();
    const act = btn.dataset.act;
    if      (act === 'meter')   gotoMeter(m.firstName + ' ' + m.lastName, m.meter, mid);
    else if (act === 'edit')    openEditMember(mid);
    else if (act === 'delete')  confirmDeleteMember(mid);
    else if (act === 'billing') openMemberQuickView(mid);
    else if (act === 'debtors') openMemberQuickView(mid);
  } else {
    openMemberQuickView(mid);
  }
});

// ─── Members Search & Filter ───
(function () {
  const pg        = document.getElementById('page-members');
  const searchEl  = pg.querySelector('.fsearch');
  const selects   = pg.querySelectorAll('.fselect');
  const villageEl = selects[0];
  const statusEl  = selects[1];
  if (searchEl)  searchEl.addEventListener('input',  () => { _memberSearch = searchEl.value.trim(); renderMembers(); });
  if (villageEl) villageEl.addEventListener('change', () => { _memberVillage = villageEl.value === 'หมู่บ้านทั้งหมด' ? '' : villageEl.value; renderMembers(); });
  if (statusEl)  statusEl.addEventListener('change',  () => {
    const v = statusEl.value;
    _memberStatus = v === 'สถานะทั้งหมด' ? '' : v === 'ปกติ' ? 'normal' : v === 'ค้างชำระ' ? 'overdue' : v === 'ปิดมิเตอร์' ? 'closed' : '';
    renderMembers();
  });
})();

// ─── Topbar Global Search ───
(function () {
  const inp = document.querySelector('.topbar-search input');
  if (!inp) return;
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) return;
    const m = members.find(x =>
      (x.firstName + ' ' + x.lastName).toLowerCase().includes(q) ||
      x.meter.toLowerCase().includes(q) ||
      (x.houseNo || '').toLowerCase().includes(q)
    );
    if (m) {
      gotoMeter(m.firstName + ' ' + m.lastName, m.meter, m.id);
      inp.value = '';
      toast(`พบ: ${m.firstName} ${m.lastName} (${m.meter})`, 'success');
    }
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') inp.dispatchEvent(new Event('input'));
  });
})();

// ─── User modal: toggle village field by role ───
function _toggleVillageField(role) {
  const wrap = document.getElementById('uform-village-wrap');
  if (wrap) wrap.style.opacity = (role === 'super_admin' || role === 'finance') ? '.4' : '1';
  const sel = document.getElementById('uform-village');
  if (sel)  sel.disabled = (role === 'super_admin' || role === 'finance');
}

// ─── Escape key — เพิ่ม user-modal ───
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  ['member-modal','cash-modal','confirm-modal','rate-modal','receipt-modal','mnt-modal','member-qv-modal','user-modal']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
});

// ─── Initialise — session check (renders happen inside _initApp) ───
checkSession();
