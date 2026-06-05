// ─── XSS Protection ───
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Avatar ───
const avatarColors = [
  'var(--blue-800)', 'var(--blue-500)', '#7c3aed',
  '#0891b2', '#dc2626', '#059669', '#d97706',
];
function getAvatarColor(id) { return avatarColors[id % avatarColors.length]; }
function getInitials(fn, ln) { return ((fn && fn[0]) || '') + ((ln && ln[0]) || ''); }

// ─── Date Helpers ───
function currentPeriod() {
  const d = new Date();
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return months[d.getMonth()] + ' ' + (d.getFullYear() + 543);
}

// ─── Auto-Overdue Sync ───
// Returns true if any data changed (caller should saveToStorage if so)
function syncOverdueStatus() {
  const today = new Date().toISOString().split('T')[0];
  let changed = false;
  bills.forEach(b => {
    if (b.status === 'pending' && b.dueDate < today) {
      b.status = 'overdue';
      changed = true;
    }
  });
  members.forEach(m => {
    if (m.status === 'closed' || m.status === 'suspended') return;
    const hasOverdue = bills.some(b => b.memberId === m.id && b.status === 'overdue');
    const wanted = hasOverdue ? 'overdue' : 'normal';
    if (m.status !== wanted) { m.status = wanted; changed = true; }
  });
  return changed;
}

// ─── Toast Notifications ───
function toast(msg, type = 'info', duration = 3000) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const icons = { success: 'ti-circle-check', error: 'ti-alert-circle', info: 'ti-info-circle', warn: 'ti-alert-triangle' };
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<i class="ti ${icons[type] || 'ti-info-circle'}" style="font-size:18px;flex-shrink:0"></i><span>${esc(msg)}</span>`;
  c.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'toastOut .2s ease forwards';
    setTimeout(() => t.remove(), 200);
  }, duration);
}
