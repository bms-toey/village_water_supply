// ─── Navigation Component ──────────────────────────────────────
// Page routing for the SPA: goPage, setTab, and mobile sidebar toggle.
// ──────────────────────────────────────────────────────────────

const _pageLabels = {
  dashboard:   'Dashboard',
  members:     'สมาชิก',
  meter:       'จดมิเตอร์',
  billing:     'ระบบออกบิล',
  payments:    'รับชำระเงิน',
  debtors:     'ลูกหนี้',
  reports:     'รายงาน',
  map:         'แผนที่',
  maintenance: 'ซ่อมบำรุง',
  settings:    'ตั้งค่า',
  users:       'จัดการผู้ใช้',
};

export function goPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pg = document.getElementById('page-' + id);
  if (pg) {
    pg.classList.add('active');
    pg.closest('.content-area').scrollTop = 0;
  }
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === id));

  // Sync bottom navigation
  document.querySelectorAll('.bnav-item[data-page]').forEach(n => n.classList.toggle('active', n.dataset.page === id));
  document.querySelectorAll('.bnav-more-item[data-page]').forEach(n => n.classList.toggle('active-page', n.dataset.page === id));

  const lbl = document.getElementById('topbar-page');
  if (lbl) lbl.textContent = _pageLabels[id] || id;

  // Close mobile sidebar when navigating
  closeMobileSidebar();
}

export function setTab(el) {
  el.closest('.tabs').querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
}

// ─── Mobile Sidebar Toggle ────────────────────────────────────
export function openMobileSidebar() {
  document.querySelector('.sidebar')?.classList.add('open');
  document.querySelector('.sidebar-backdrop')?.classList.add('visible');
}

export function closeMobileSidebar() {
  document.querySelector('.sidebar')?.classList.remove('open');
  document.querySelector('.sidebar-backdrop')?.classList.remove('visible');
}

// ─── Bottom Nav More Menu ─────────────────────────────────
export function openBnavMore() {
  const sheet = document.getElementById('bnav-more-sheet');
  if (sheet) sheet.style.display = 'block';
}

export function closeBnavMore() {
  const sheet = document.getElementById('bnav-more-sheet');
  if (sheet) sheet.style.display = 'none';
}

export function toggleBnavMore() {
  const sheet = document.getElementById('bnav-more-sheet');
  if (!sheet) return;
  if (sheet.style.display === 'none' || !sheet.style.display) {
    sheet.style.display = 'block';
  } else {
    sheet.style.display = 'none';
  }
}

export function initNavigation() {
  // Wire sidebar nav items — use window.goPage when available so that
  // app.js render-callbacks (_goPageWithRender override) fire on every nav click.
  document.querySelectorAll('.nav-item[data-page]').forEach(n => {
    n.addEventListener('click', () => (window.goPage || goPage)(n.dataset.page));
  });

  // Wire mobile hamburger button
  const menuBtn = document.querySelector('.btn-menu');
  if (menuBtn) menuBtn.addEventListener('click', openMobileSidebar);

  // Backdrop click closes sidebar
  const backdrop = document.querySelector('.sidebar-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeMobileSidebar);

  // Expose bottom nav more menu to window
  window._toggleBnavMore = toggleBnavMore;
  window._closeBnavMore  = closeBnavMore;
  window._openBnavMore   = openBnavMore;

  // Set initial active state on bottom nav (matches whichever .page is currently active)
  const activePage = document.querySelector('.page.active');
  if (activePage) {
    const activeId = activePage.id.replace('page-', '');
    document.querySelectorAll('.bnav-item[data-page]').forEach(n => n.classList.toggle('active', n.dataset.page === activeId));
  }
}
