// ─── Global Error Tracking ────────────────────────────────────
window.onerror = (msg, src, line, col) => {
  const file = src ? src.split('/').pop().split('?')[0] : '?';
  console.error(`[AquaFlow] ${file}:${line}:${col} — ${msg}`);
};
window.addEventListener('unhandledrejection', (e) => {
  console.error('[AquaFlow] Unhandled promise rejection:', e.reason);
});

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
import { doSignIn, doSignOut, checkSession, registerRenderCallbacks, openChangePwdModal, closeChangePwdModal, doChangePassword } from './services/auth.service.js';
import { initRealtime, manualRefresh } from './services/realtime.service.js';

// ─── Navigation ───────────────────────────────────────────────
import { goPage, setTab, initNavigation, closeMobileSidebar } from './components/navigation/navigation.js';

// ─── Utils ────────────────────────────────────────────────────
import { toast, showConfirm, esc } from './utils/dom.util.js';

// ─── Modules ──────────────────────────────────────────────────
import { renderDashboard, setDashChartYear } from './modules/dashboard/dashboard.js';
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
  openCashModal, closeCashModal, openCashModalForBill, closePayTypeModal, notifyBillDebtor, saveCashPayment,
  cancelPayment, printReceiptByPayment
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
import {
  renderMaintenance, setMntTab,
  completeMaintenance, openAddMaintenance, openEditMaintenance, closeMntModal, saveMaintenance,
  openMeterReplaceModal, closeMeterReplaceModal, onMrMemberChange, saveMeterReplacement, genNewMeterNo,
} from './modules/maintenance/maintenance.js';
import { renderMap, closeMemberMapPopup, filterMapByVillage, filterMapByStatus } from './modules/map/map.js';
import { renderUsers, openAddUser, openEditUser, closeUserModal, saveUser, toggleUserActive } from './modules/users/users.js';
import { portalSearch } from './modules/portal/portal.js';

// ─── Register render callbacks with auth (avoid circular import) ───
const _renderCbs = {
  renderDashboard,
  renderMembers,
  renderMeter,
  populateBillingFilters,
  renderBilling,
  renderDebtors,
  renderPayments,
  renderReports,
  renderMaintenance,
  populateVillageDropdowns,
  renderSettings,
};
registerRenderCallbacks(_renderCbs);

// ─── Realtime subscription ────────────────────────────────────
initRealtime(_renderCbs);

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
  if (id === 'portal') {
    const inp = document.getElementById('portal-search-input');
    if (inp) { inp.value = ''; }
    const res = document.getElementById('portal-result');
    if (res) res.style.display = 'none';
  }
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

// Members card list — event delegation
document.getElementById('members-card-list').addEventListener('click', function (e) {
  const btn  = e.target.closest('[data-act]');
  const card = e.target.closest('.member-card-h');
  if (!card) return;
  const mid = parseInt(card.dataset.mid);
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

// Topbar search is handled by _initTopbar() → _initSearch()

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
  ['member-modal','cash-modal','confirm-modal','app-confirm-modal','rate-modal','add-tier-modal','receipt-modal','mnt-modal','mr-modal','member-qv-modal','user-modal','cancel-bill-modal','md-modal','village-modal','bnav-more-sheet','change-pwd-modal','pay-type-modal']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  _closeAllPanels();
});

// ─── Topbar Panel Functions ───────────────────────────────────

function _closeAllPanels() {
  ['notif-panel','village-panel','user-panel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const sd = document.getElementById('_search_drop');
  if (sd) sd.style.display = 'none';
}

function _togglePanel(id, fillFn) {
  const panel = document.getElementById(id);
  if (!panel) return;
  const wasOpen = panel.style.display !== 'none';
  _closeAllPanels();
  if (!wasOpen) {
    if (fillFn) fillFn();
    panel.style.display = 'block';
  }
}

// ── Notification badge count ─────────────────────────────────
function _updateNotifBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const n = (appState.payments?.filter(p => p.status === 'pending').length || 0)
          + (appState.members?.filter(m => m.status === 'overdue').length || 0)
          + (appState.maintenance?.filter(m => !['completed','cancelled'].includes(m.status)).length || 0);
  badge.style.display = n > 0 ? 'block' : 'none';
}

// ── Notification panel content ───────────────────────────────
function _fillNotifPanel() {
  const list = document.getElementById('notif-list');
  if (!list) return;

  const rows = [
    {
      icon: 'ti-credit-card', cls: 'tbd-cnt--blue',
      label: 'รอยืนยันการชำระ',
      count: appState.payments?.filter(p => p.status === 'pending').length || 0,
      page: 'payments',
    },
    {
      icon: 'ti-alert-triangle', cls: '',
      label: 'สมาชิกค้างชำระ',
      count: appState.members?.filter(m => m.status === 'overdue').length || 0,
      page: 'debtors',
    },
    {
      icon: 'ti-tool', cls: 'tbd-cnt--amber',
      label: 'งานซ่อมบำรุงค้างอยู่',
      count: appState.maintenance?.filter(m => !['completed','cancelled'].includes(m.status)).length || 0,
      page: 'maintenance',
    },
  ];

  const active = rows.filter(r => r.count > 0);
  if (!active.length) {
    list.innerHTML = '<div style="padding:20px 16px;text-align:center;color:var(--gray-400);font-size:13px"><i class="ti ti-check-circle" style="font-size:28px;display:block;margin-bottom:6px;color:#22c55e"></i>ไม่มีการแจ้งเตือน</div>';
    return;
  }
  list.innerHTML = active.map(r => `
    <div class="tbd-item" onclick="window._closeAllPanels?.();window.goPage('${r.page}')">
      <i class="ti ${r.icon}" style="font-size:18px;flex-shrink:0;color:${r.icon==='ti-credit-card'?'var(--blue-600)':r.icon==='ti-alert-triangle'?'var(--red-600)':'#d97706'}"></i>
      <span class="tbd-item-label">${esc(r.label)}</span>
      <span class="tbd-cnt ${r.cls}">${r.count}</span>
    </div>`).join('');
}

// ── Village stats panel ──────────────────────────────────────
function _fillVillagePanel() {
  const list = document.getElementById('village-list');
  if (!list) return;

  const byVillage = {};
  (appState.members || []).forEach(m => {
    const v = m.village || 'ไม่ระบุหมู่บ้าน';
    if (!byVillage[v]) byVillage[v] = { total: 0, overdue: 0 };
    byVillage[v].total++;
    if (m.status === 'overdue') byVillage[v].overdue++;
  });

  const entries = Object.entries(byVillage).sort((a, b) => b[1].total - a[1].total);
  if (!entries.length) {
    list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--gray-400);font-size:13px">ยังไม่มีข้อมูลสมาชิก</div>';
    return;
  }
  list.innerHTML = entries.map(([name, s]) => `
    <div class="tbd-item" onclick="window._closeAllPanels?.();window.goPage('members')">
      <i class="ti ti-building-community" style="font-size:18px;color:var(--blue-500);flex-shrink:0"></i>
      <span class="tbd-item-label">${esc(name)}</span>
      <span style="font-size:11.5px;color:var(--gray-400);flex-shrink:0">${s.total} ราย${s.overdue>0?` <span style="color:var(--red-500)">•ค้าง ${s.overdue}</span>`:''}</span>
    </div>`).join('');
}

// ── User account panel ───────────────────────────────────────
function _fillUserPanel() {
  const name   = document.querySelector('.user-name')?.textContent  || 'ผู้ดูแลระบบ';
  const role   = document.querySelector('.user-role')?.textContent  || '';
  const avatar = document.querySelector('.user-avatar')?.textContent || 'AD';
  const n = document.getElementById('upanel-name');
  const r = document.getElementById('upanel-role');
  const a = document.getElementById('upanel-avatar');
  if (n) n.textContent = name;
  if (r) r.textContent = role;
  if (a) a.textContent = avatar;
}

// ── Search dropdown ───────────────────────────────────────────
function _initSearch() {
  // Desktop: live dropdown from topbar search input
  const inp  = document.querySelector('.topbar-search input');
  const wrap = document.querySelector('.topbar-search');
  if (inp && wrap) {
    let drop = null;
    const _getDrop = () => {
      if (!drop) {
        drop = document.createElement('div');
        drop.id = '_search_drop';
        drop.className = 'search-drop';
        drop.style.display = 'none';
        document.body.appendChild(drop);
      }
      return drop;
    };

    const _renderDrop = () => {
      const q = inp.value.trim().toLowerCase();
      const d = _getDrop();
      if (!q) { d.style.display = 'none'; return; }

      const results = (appState.members || []).filter(m =>
        (m.firstName + ' ' + m.lastName).toLowerCase().includes(q) ||
        (m.meter || '').toLowerCase().includes(q) ||
        (m.houseNo || '').toLowerCase().includes(q)
      ).slice(0, 7);

      d.innerHTML = !results.length
        ? '<div class="sd-empty">ไม่พบผลลัพธ์</div>'
        : results.map(m =>
            `<div class="sd-item" data-mid="${m.id}">
              <div class="sd-name">${esc(m.firstName + ' ' + m.lastName)}</div>
              <div class="sd-sub">${esc(m.meter)} | ${esc(m.village||'')}${m.status==='overdue'?' <span style="color:var(--red-500)">• ค้างชำระ</span>':''}</div>
            </div>`).join('');

      d.querySelectorAll('.sd-item').forEach(el => {
        el.addEventListener('mousedown', ev => {
          ev.preventDefault();
          const m = (appState.members||[]).find(x => x.id === parseInt(el.dataset.mid));
          if (m) { gotoMeter(m.firstName+' '+m.lastName, m.meter, m.id); inp.value = ''; d.style.display = 'none'; }
        });
      });

      const rect = wrap.getBoundingClientRect();
      Object.assign(d.style, { display:'block', top:(rect.bottom+4)+'px', left:rect.left+'px', width:rect.width+'px' });
    };

    inp.addEventListener('input', _renderDrop);
    inp.addEventListener('focus', _renderDrop);
    inp.addEventListener('blur',  () => { setTimeout(() => { if (drop) drop.style.display='none'; }, 150); });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Escape') { inp.value = ''; if (drop) drop.style.display = 'none'; }
      if (e.key === 'Enter') {
        const first = drop?.querySelector('.sd-item');
        if (first) first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }
    });
  }

  // Mobile: full-screen overlay
  const mInp = document.getElementById('mobile-search-inp');
  const mRes = document.getElementById('mobile-search-results');
  if (mInp && mRes) {
    mInp.addEventListener('input', () => {
      const q = mInp.value.trim().toLowerCase();
      if (!q) { mRes.innerHTML = ''; return; }
      const results = (appState.members||[]).filter(m =>
        (m.firstName+' '+m.lastName).toLowerCase().includes(q) ||
        (m.meter||'').toLowerCase().includes(q) ||
        (m.houseNo||'').toLowerCase().includes(q)
      ).slice(0, 12);

      mRes.innerHTML = !results.length
        ? '<div style="padding:24px;text-align:center;color:var(--gray-400);font-size:14px">ไม่พบผลลัพธ์</div>'
        : results.map(m =>
            `<div class="sd-item" data-mid="${m.id}" style="border-radius:10px;margin-bottom:4px;background:var(--gray-50);border:1px solid var(--gray-100)">
              <div class="sd-name" style="font-size:14px">${esc(m.firstName+' '+m.lastName)}</div>
              <div class="sd-sub">${esc(m.meter)} | ${esc(m.village||'')} | บ้านเลขที่ ${esc(m.houseNo||'-')}${m.status==='overdue'?' <span style="color:var(--red-500)">• ค้างชำระ</span>':''}</div>
            </div>`).join('');

      mRes.querySelectorAll('.sd-item').forEach(el => {
        el.addEventListener('click', () => {
          const m = (appState.members||[]).find(x => x.id === parseInt(el.dataset.mid));
          if (m) {
            gotoMeter(m.firstName+' '+m.lastName, m.meter, m.id);
            document.getElementById('mobile-search-overlay').style.display = 'none';
            mInp.value = '';
            mRes.innerHTML = '';
          }
        });
      });
    });
  }
}

// ── Wire topbar buttons ───────────────────────────────────────
function _initTopbar() {
  document.getElementById('topbar-bell')?.addEventListener('click',
    () => _togglePanel('notif-panel', _fillNotifPanel));

  document.getElementById('topbar-village')?.addEventListener('click',
    () => _togglePanel('village-panel', _fillVillagePanel));

  document.getElementById('topbar-user-avatar')?.addEventListener('click', () => {
    _fillUserPanel();
    _togglePanel('user-panel');
  });

  document.getElementById('topbar-search-btn')?.addEventListener('click', () => {
    document.getElementById('mobile-search-overlay').style.display = 'block';
    setTimeout(() => document.getElementById('mobile-search-inp')?.focus(), 80);
  });

  // Close panels on outside click
  document.addEventListener('click', e => {
    const panelIds   = ['notif-panel','village-panel','user-panel'];
    const triggerIds = ['topbar-bell','topbar-village','topbar-user-avatar'];
    if (panelIds.some(id => document.getElementById(id)?.contains(e.target))) return;
    if (triggerIds.some(id => document.getElementById(id)?.contains(e.target))) return;
    panelIds.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  });

  // Update badge count when data loads
  window.addEventListener('aquaflow:data-ready', _updateNotifBadge);

  _initSearch();
}

// ─── Navigation init ─────────────────────────────────────────
initNavigation();
_initTopbar();

// ─── Expose to window (for onclick="" handlers in HTML) ──────
Object.assign(window, {
  // auth
  doSignIn, doSignOut, openChangePwdModal, closeChangePwdModal, doChangePassword,
  // navigation
  goPage: _goPageWithRender, setTab,
  // dashboard (called from links)
  renderDashboard, setDashChartYear,
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
  openCashModal, closeCashModal, openCashModalForBill, closePayTypeModal, notifyBillDebtor, saveCashPayment,
  approvePayment, rejectPayment, cancelPayment, printReceiptByPayment,
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
  setMntTab,
  completeMaintenance, openAddMaintenance, openEditMaintenance, closeMntModal, saveMaintenance,
  openMeterReplaceModal, closeMeterReplaceModal, onMrMemberChange, saveMeterReplacement, genNewMeterNo,
  // map
  renderMap, closeMemberMapPopup, filterMapByVillage, filterMapByStatus,
  // users
  openAddUser, openEditUser, closeUserModal, saveUser, toggleUserActive,
  _toggleVillageField,
  // portal
  portalSearch,
  // utils
  toast, showConfirm,
  // realtime
  _manualRefresh: manualRefresh,
  // topbar panels (called from injected HTML)
  _closeAllPanels,
  _updateNotifBadge,
});

// ─── Bootstrap ───────────────────────────────────────────────
checkSession();
