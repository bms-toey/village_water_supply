// ─── Dynamic Modal ─────────────────────────────────────────────
// สร้าง modal จาก JS (ไม่ต้องเพิ่ม markup ใน index.html)
// ใช้ class เดียวกับ modal เดิม: .modal-overlay / .modal / .modal-hd ...
// ปิดได้ด้วย: ปุ่ม ✕, คลิกพื้นหลัง, ปุ่มที่มี data-close, หรือ Escape (app.js)
// ──────────────────────────────────────────────────────────────
import { esc } from '../../utils/dom.util.js';

/**
 * @param {object} o
 * @param {string} o.id      element id (เปิดซ้ำ id เดิมจะแทนที่ของเก่า)
 * @param {string} o.title
 * @param {string} [o.icon]  tabler icon class เช่น 'ti-lock'
 * @param {string} o.body    HTML (caller ต้อง esc() ข้อมูลผู้ใช้เอง)
 * @param {string} [o.footer] HTML ปุ่มด้านล่าง
 * @param {number} [o.width]
 * @returns {HTMLElement} overlay element
 */
export function openModal({ id, title, icon = 'ti-file', body, footer = '', width = 480 }) {
  closeModal(id);
  const el = document.createElement('div');
  el.id = id;
  el.className = 'modal-overlay';
  el.dataset.dynamicModal = '';
  el.innerHTML = `
    <div class="modal" style="max-width:${width}px" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
      <div class="modal-hd">
        <div class="modal-title"><i class="ti ${icon}"></i><span id="${id}-title">${esc(title)}</span></div>
        <button class="modal-close" data-close aria-label="ปิด"><i class="ti ti-x"></i></button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    </div>`;
  el.addEventListener('click', e => {
    if (e.target === el || e.target.closest('[data-close]')) closeModal(id);
  });
  document.body.appendChild(el);
  setTimeout(() => el.querySelector('input:not([type=hidden]),select,textarea')?.focus(), 60);
  return el;
}

export function closeModal(id) {
  document.getElementById(id)?.remove();
}

export function closeAllDynamicModals() {
  document.querySelectorAll('[data-dynamic-modal]').forEach(el => el.remove());
}

/** ปุ่มบันทึก: ปิดการกดซ้ำและแสดง spinner ระหว่างรอ — คืนฟังก์ชันคืนสภาพปุ่ม */
export function busyButton(btn, label = 'กำลังบันทึก...') {
  if (!btn) return () => {};
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> ${esc(label)}`;
  return () => { btn.disabled = false; btn.innerHTML = html; };
}
