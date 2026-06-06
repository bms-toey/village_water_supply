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

/**
 * Show a custom confirm dialog (replaces native confirm()).
 * @param {object} opts
 * @param {string}   opts.title     - Bold heading
 * @param {string}   opts.message   - Body text (may contain \n → <br>)
 * @param {string}   [opts.okText]  - OK button label (default: 'ยืนยัน')
 * @param {string}   [opts.okClass] - Extra CSS class on OK btn (default: 'btn-danger')
 * @param {string}   [opts.icon]    - Tabler icon class (default: 'ti-alert-triangle')
 * @param {string}   [opts.iconBg]  - Icon circle background (default: var(--red-50))
 * @param {string}   [opts.iconColor] - Icon color (default: var(--red-700))
 * @param {Function} opts.onOk      - Called when user clicks OK
 */
export function showConfirm({ title, message, okText = 'ยืนยัน', okClass = 'btn-danger', icon = 'ti-alert-triangle', iconBg = 'var(--red-50)', iconColor = 'var(--red-700)', onOk }) {
  const modal    = document.getElementById('app-confirm-modal');
  const iconEl   = document.getElementById('app-confirm-icon');
  const titleEl  = document.getElementById('app-confirm-title');
  const bodyEl   = document.getElementById('app-confirm-body');
  const okBtn    = document.getElementById('app-confirm-ok');
  const cancelBtn = document.getElementById('app-confirm-cancel');
  if (!modal) return;

  iconEl.className = 'ti ' + icon;
  iconEl.parentElement.style.background = iconBg;
  iconEl.style.color = iconColor;
  titleEl.textContent = title;
  bodyEl.innerHTML = esc(message).replace(/\n/g, '<br>');
  okBtn.textContent = okText;
  okBtn.className = 'btn ' + okClass;

  const close = () => { modal.style.display = 'none'; };
  okBtn.onclick    = () => { close(); onOk?.(); };
  cancelBtn.onclick = close;
  modal.onclick    = (e) => { if (e.target === modal) close(); };

  modal.style.display = 'flex';
  okBtn.focus();
}
