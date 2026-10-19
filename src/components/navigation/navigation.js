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
  // หน้าที่อยู่ในเมนู "เพิ่มเติม" → ไฮไลต์ปุ่มเพิ่มเติม ให้รู้ว่าอยู่ตรงไหน
  const inMain = !!document.querySelector(`.bnav-item[data-page="${id}"]`);
  document.querySelector('.bnav-more-btn')?.classList.toggle('active', !inMain);

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

// ─── Desktop Sidebar Collapse (≥769px) ────────────────────────
const _MOBILE_MQ = '(max-width: 768px)';
const _COLLAPSE_KEY = 'af_sidebar_collapsed';

export function setSidebarCollapsed(collapsed, persist = true) {
  const app = document.querySelector('.app');
  if (!app) return;
  app.classList.toggle('sidebar-collapsed', collapsed);
  // แสดงชื่อเมนูเป็น tooltip เมื่อเหลือแต่ไอคอน
  document.querySelectorAll('.sidebar .nav-item').forEach(n => {
    // ใช้เฉพาะ text node — ไม่เอาตัวเลขใน .nav-badge
    if (collapsed) n.title = [...n.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join('').trim();
    else n.removeAttribute('title');
  });
  const btn = document.querySelector('.btn-menu');
  if (btn && !window.matchMedia(_MOBILE_MQ).matches) {
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.title = collapsed ? 'ขยายเมนู' : 'ย่อเมนู';
  }
  if (persist) {
    try { localStorage.setItem(_COLLAPSE_KEY, collapsed ? '1' : '0'); } catch {}
  }
  // ให้แผนที่/กราฟคำนวณขนาดใหม่หลัง sidebar เปลี่ยนความกว้าง
  setTimeout(() => window.dispatchEvent(new Event('resize')), 260);
}

export function toggleSidebar() {
  if (window.matchMedia(_MOBILE_MQ).matches) {
    const isOpen = document.querySelector('.sidebar')?.classList.contains('open');
    isOpen ? closeMobileSidebar() : openMobileSidebar();
    return;
  }
  const collapsed = document.querySelector('.app')?.classList.contains('sidebar-collapsed');
  setSidebarCollapsed(!collapsed);
}

function _initSidebarState() {
  let saved = null;
  try { saved = localStorage.getItem(_COLLAPSE_KEY); } catch {}
  // ไม่เคยตั้งค่า → จอแท็บเล็ต/โน้ตบุ๊กเล็ก (≤1024px) เริ่มแบบย่อ
  const collapsed = saved !== null ? saved === '1' : window.matchMedia('(max-width: 1024px)').matches;
  setSidebarCollapsed(collapsed, false);
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

  // Hamburger: mobile = slide-in, desktop = ย่อ/ขยาย sidebar
  const menuBtn = document.querySelector('.btn-menu');
  if (menuBtn) menuBtn.addEventListener('click', toggleSidebar);
  _initSidebarState();

  // Backdrop click / Esc closes mobile sidebar
  const backdrop = document.querySelector('.sidebar-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeMobileSidebar);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMobileSidebar(); });

  // หมุนจอ/ขยายหน้าต่างจาก mobile → desktop: ปิด overlay ที่ค้างอยู่
  window.matchMedia(_MOBILE_MQ).addEventListener?.('change', e => { if (!e.matches) closeMobileSidebar(); });

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
