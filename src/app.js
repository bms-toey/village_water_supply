// ─── Application Entry Point ───────────────────────────────────
// Single <script type="module"> in index.html loads this file.
// It imports all modules and re-exports to window.* so that
// inline onclick="" handlers in the HTML continue to work.
//
// Dependency order:
//   supabase (CDN) → state → config → utils → services → modules
// ──────────────────────────────────────────────────────────────

// ─── State ───────────────────────────────────────────────────
import { appState } from './state/app.state.js';

// ─── Services ────────────────────────────────────────────────
import { doSignIn, doSignOut, checkSession, registerRenderCallbacks } from './services/auth.service.js';

// ─── Navigation ───────────────────────────────────────────────
import { goPage, setTab, initNavigation, closeMobileSidebar } from './components/navigation/navigation.js';

// ─── Utils ────────────────────────────────────────────────────
import { toast } from './utils/dom.util.js';

// ─── Modules ──────────────────────────────────────────────────
import { renderDashboard } from './modules/dashboard/dashboard.js';
import {
  renderMembers, openAddMember, openEditMember, closeMemberModal, saveMember,
  switchModalTab, openMemberQuickView, closeMemberQV, openEditMemberFromQV, gotoMeterFromQV,
  confirmDeleteMember, closeConfirm, doDeleteMember,
  getMemberLocation, _toggleGpsPicker, setMemberFilters, generateMeterNo
} from './modules/members/members.js';
import { gotoMeter, calcMeter, saveMeter, renderMeterHistory, renderMeter, resetMeterSelection } from './modules/meter/meter.js';
import {
  renderBilling, populateBillingFilters, autoBill, openBillReceipt, closeReceiptModal, printReceipt,
  setBillFilters, cancelBill, closeCancelBillModal, confirmCancelBill
} from './modules/billing/billing.js';
import {
  renderPayments, approvePayment, rejectPayment,
  openCashModal, closeCashModal, openCashModalForBill, notifyBillDebtor, saveCashPayment
} from './modules/payments/payments.js';
import { renderDebtors, notifyAllDebtors, suspendAllOverdue3Months, notifyDebtor, setDebtorSeverity } from './modules/debtors/debtors.js';
import { renderReports, switchReport, exportCurrentReport, exportBillingCSV, exportMembersCSV } from './modules/reports/reports.js';
import {
  renderSettings, setSettingsTab,
  renderSettingsRates, renderSettingsVillages,
  openRateEditModal, closeRateModal, saveRateTier, saveSettings,
  openAddTierModal, closeAddTierModal, saveNewTierHandler, deleteLastTierConfirm,
  saveSvcChargesHandler, saveLateFeeHandler,
  openMdModal, closeMdModal, saveMdItemHandler,
  deleteMdItemConfirm, toggleMdItemHandler,
  openVillageModal, closeVillageModal, saveVillageHandler, deleteVillageConfirm, toggleVillageHandler,
  saveSystemConfigHandler,
  _populateMemberFormDropdowns, _populateMaintenanceTypeSelect,
  populateVillageDropdowns,
} from './modules/settings/settings.js';
import { renderMaintenance, completeMaintenance, openAddMaintenance, openEditMaintenance, closeMntModal, saveMaintenance } from './modules/maintenance/maintenance.js';
import { renderMap, closeMemberMapPopup, filterMapByVillage, filterMapByStatus } from './modules/map/map.js';
import { renderUsers, openAddUser, openEditUser, closeUserModal, saveUser, toggleUserActive } from './modules/users/users.js';

// ─── Register render callbacks with auth (avoid circular import) ───
registerRenderCallbacks({
  renderDashboard,
  renderMembers,
  populateBillingFilters,
  renderBilling,
  renderDebtors,
  renderPayments,
  renderReports,
  renderMaintenance,
  populateVillageDropdowns,
  renderSettings,
});

// ─── goPage override — trigger renders on navigation ─────────
const _origGoPage = goPage;
const _goPageWithRender = (id) => {
  _origGoPage(id);
  if (id === 'billing')     { populateBillingFilters(); renderBilling(); }
  if (id === 'debtors')       renderDebtors();
  if (id === 'payments')      renderPayments();
  if (id === 'dashboard')     renderDashboard();
  if (id === 'reports')       renderReports();
  if (id === 'meter')           renderMeter();
  if (id === 'map')           setTimeout(renderMap, 60);
  if (id === 'maintenance')   renderMaintenance();
  if (id === 'users')         renderUsers();
  if (id === 'settings')      renderSettings();
};

// ─── Event wiring ─────────────────────────────────────────────
// Billing tabs
document.querySelectorAll('#page-billing .tab').forEach((t, i) => {
  t.addEventListener('click', () => {
    const filters = [null, 'overdue', 'pending', 'paid'];
    setBillFilters({ statusTab: filters[i] });
    renderBilling();
  });
});

// Billing search + filter
(function () {
  const pg        = document.getElementById('page-billing');
  const searchEl  = pg.querySelector('.fsearch');
  const selects   = pg.querySelectorAll('.fselect');
  if (searchEl)   searchEl.addEventListener('input',  () => { setBillFilters({ search: searchEl.value.trim() }); renderBilling(); });
  if (selects[0]) selects[0].addEventListener('change', () => { setBillFilters({ village: selects[0].value === 'ทุกหมู่บ้าน' ? '' : selects[0].value }); renderBilling(); });
  if (selects[1]) selects[1].addEventListener('change', () => { setBillFilters({ period: selects[1].value.startsWith('ทุก') ? '' : selects[1].value }); renderBilling(); });
})();

// Debtors severity filter
(function () {
  const sel = document.getElementById('debtor-severity-select');
  if (!sel) return;
  sel.addEventListener('change', () => {
    const v = sel.value;
    setDebtorSeverity(v==='ทุกสถานะ' ? '' : v==='ค้าง 1 เดือน' ? '1' : v==='ค้าง 2 เดือน' ? '2' : v==='ค้างเกิน 3 เดือน' ? '3' : '');
    renderDebtors();
  });
})();

// Members table — event delegation
document.getElementById('members-tbody').addEventListener('click', function (e) {
  const btn = e.target.closest('[data-act]');
  const row = e.target.closest('.member-row');
  if (!row) return;
  const mid = parseInt(row.dataset.mid);
  const m   = appState.members.find(x => x.id === mid);
  if (!m) return;
  if (btn) {
    e.stopPropagation();
    const act = btn.dataset.act;
    if      (act === 'meter')   gotoMeter(m.firstName+' '+m.lastName, m.meter, mid);
    else if (act === 'edit')    openEditMember(mid);
    else if (act === 'delete')  confirmDeleteMember(mid);
    else if (act === 'billing') openMemberQuickView(mid);
    else if (act === 'debtors') openMemberQuickView(mid);
  } else {
    openMemberQuickView(mid);
  }
});

// Members search + filter
(function () {
  const pg        = document.getElementById('page-members');
  const searchEl  = pg.querySelector('.fsearch');
  const selects   = pg.querySelectorAll('.fselect');
  if (searchEl)   searchEl.addEventListener('input',  () => { setMemberFilters({ search: searchEl.value.trim() }); renderMembers(); });
  if (selects[0]) selects[0].addEventListener('change', () => { setMemberFilters({ village: selects[0].value === 'หมู่บ้านทั้งหมด' ? '' : selects[0].value }); renderMembers(); });
  if (selects[1]) selects[1].addEventListener('change', () => {
    const v = selects[1].value;
    setMemberFilters({ status: v==='สถานะทั้งหมด' ? '' : v==='ปกติ' ? 'normal' : v==='ค้างชำระ' ? 'overdue' : v==='ปิดมิเตอร์' ? 'closed' : '' });
    renderMembers();
  });
})();

// Topbar global search
(function () {
  const inp = document.querySelector('.topbar-search input');
  if (!inp) return;
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) return;
    const m = appState.members.find(x =>
      (x.firstName+' '+x.lastName).toLowerCase().includes(q) ||
      x.meter.toLowerCase().includes(q) ||
      (x.houseNo||'').toLowerCase().includes(q)
    );
    if (m) { gotoMeter(m.firstName+' '+m.lastName, m.meter, m.id); inp.value = ''; toast(`พบ: ${m.firstName} ${m.lastName} (${m.meter})`, 'success'); }
  });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.dispatchEvent(new Event('input')); });
})();

// User modal — toggle village field
function _toggleVillageField(role) {
  const wrap = document.getElementById('uform-village-wrap');
  if (wrap) wrap.style.opacity = (role==='super_admin'||role==='finance') ? '.4' : '1';
  const sel = document.getElementById('uform-village');
  if (sel)  sel.disabled = (role==='super_admin'||role==='finance');
}

// Escape key — close all modals
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  ['member-modal','cash-modal','confirm-modal','rate-modal','add-tier-modal','receipt-modal','mnt-modal','member-qv-modal','user-modal','cancel-bill-modal','md-modal','village-modal','bnav-more-sheet']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
});

// ─── Navigation init ─────────────────────────────────────────
initNavigation();

// ─── Expose to window (for onclick="" handlers in HTML) ──────
Object.assign(window, {
  // auth
  doSignIn, doSignOut,
  // navigation
  goPage: _goPageWithRender, setTab,
  // dashboard (called from links)
  renderDashboard,
  // members
  openAddMember, openEditMember, closeMemberModal, saveMember,
  switchModalTab, openMemberQuickView, closeMemberQV, openEditMemberFromQV, gotoMeterFromQV,
  confirmDeleteMember, closeConfirm, doDeleteMember,
  getMemberLocation, _toggleGpsPicker, generateMeterNo,
  exportMembersCSV,
  // meter
  gotoMeter, calcMeter, saveMeter, renderMeter, resetMeterSelection,
  // billing
  autoBill, openBillReceipt, closeReceiptModal, printReceipt,
  cancelBill, closeCancelBillModal, confirmCancelBill,
  // payments
  openCashModal, closeCashModal, openCashModalForBill, notifyBillDebtor, saveCashPayment,
  approvePayment, rejectPayment,
  // debtors
  notifyAllDebtors, suspendAllOverdue3Months, notifyDebtor,
  renderDebtors, renderMembers, renderBilling, populateBillingFilters,
  // reports
  switchReport, exportCurrentReport, exportBillingCSV,
  // settings
  renderSettings, setSettingsTab,
  openRateEditModal, closeRateModal, saveRateTier, saveSettings,
  openAddTierModal, closeAddTierModal, saveNewTierHandler, deleteLastTierConfirm,
  saveSvcChargesHandler, saveLateFeeHandler,
  openMdModal, closeMdModal, saveMdItemHandler,
  deleteMdItemConfirm, toggleMdItemHandler,
  openVillageModal, closeVillageModal, saveVillageHandler, deleteVillageConfirm, toggleVillageHandler,
  saveSystemConfigHandler, populateVillageDropdowns,
  _populateMemberFormDropdowns, _populateMaintenanceTypeSelect,
  // maintenance
  completeMaintenance, openAddMaintenance, openEditMaintenance, closeMntModal, saveMaintenance,
  // map
  renderMap, closeMemberMapPopup, filterMapByVillage, filterMapByStatus,
  // users
  openAddUser, openEditUser, closeUserModal, saveUser, toggleUserActive,
  _toggleVillageField,
  // utils
  toast,
});

// ─── Bootstrap ───────────────────────────────────────────────
checkSession();
