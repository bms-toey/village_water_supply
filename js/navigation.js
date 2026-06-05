// ─── Page Labels ───
const pageLabels = {
  dashboard: 'Dashboard',
  members:   'สมาชิก',
  meter:     'จดมิเตอร์',
  billing:   'ระบบออกบิล',
  payments:  'รับชำระเงิน',
  debtors:   'ลูกหนี้',
  reports:     'รายงาน',
  map:         'แผนที่',
  maintenance: 'ซ่อมบำรุง',
  settings:    'ตั้งค่า',
  users:       'จัดการผู้ใช้',
};

// ─── Page Navigation ───
function goPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pg = document.getElementById('page-' + id);
  if (pg) { pg.classList.add('active'); pg.closest('.content-area').scrollTop = 0; }
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === id));
  const lbl = document.getElementById('topbar-page');
  if (lbl) lbl.textContent = pageLabels[id] || id;
}

// ─── Tab Switch ───
function setTab(el) {
  el.closest('.tabs').querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
}

// Wire sidebar nav items
document.querySelectorAll('.nav-item[data-page]').forEach(n => {
  n.addEventListener('click', () => goPage(n.dataset.page));
});
