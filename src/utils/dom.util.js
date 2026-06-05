// ─── DOM Utilities ─────────────────────────────────────────────
// XSS escaping, toast notifications, and avatar helpers.
// No imports required — pure DOM functions.
// ──────────────────────────────────────────────────────────────

/** Escape HTML to prevent XSS in innerHTML assignments. */
export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const _avatarColors = [
  'var(--blue-800)', 'var(--blue-500)', '#7c3aed',
  '#0891b2', '#dc2626', '#059669', '#d97706',
];

export function getAvatarColor(id) {
  return _avatarColors[id % _avatarColors.length];
}

export function getInitials(firstName, lastName) {
  return ((firstName && firstName[0]) || '') + ((lastName && lastName[0]) || '');
}

/**
 * Show a toast notification.
 * @param {string} msg      - Message text
 * @param {'success'|'error'|'info'|'warn'} type
 * @param {number} duration - Auto-dismiss delay in ms
 */
export function toast(msg, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = {
    success: 'ti-circle-check',
    error:   'ti-alert-circle',
    info:    'ti-info-circle',
    warn:    'ti-alert-triangle',
  };

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<i class="ti ${icons[type] || 'ti-info-circle'}" style="font-size:18px;flex-shrink:0"></i><span>${esc(msg)}</span>`;
  container.appendChild(el);

  setTimeout(() => {
    el.style.animation = 'toastOut .2s ease forwards';
    setTimeout(() => el.remove(), 200);
  }, duration);
}
