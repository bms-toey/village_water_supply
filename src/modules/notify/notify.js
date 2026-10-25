// ─── Notifications / Member portal / LINE (staff side) ────────
// - การแจ้งเตือนเจ้าหน้าที่ (ตาราง notifications + realtime)
// - รหัส portal ของสมาชิก + สถานะผูก LINE
// - ส่งเตือนค้างชำระ / ประกาศ ผ่านคิว outbox (LINE / SMS)
// - หน้าตั้งค่า "แจ้งเตือน & LINE"
// ──────────────────────────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc, toast } from '../../utils/dom.util.js';
import { hasRole } from '../../services/auth.service.js';
import {
  sbLoadNotifications, sbMarkNotificationsRead, sbGetPortalCodes, sbRegeneratePortalCode,
  sbSendOverdueReminders, sbBroadcast, sbOutboxStats,
} from '../../services/data-loader.service.js';
import { saveSystemConfig } from '../../services/master-data.service.js';
import { openModal, closeModal, busyButton } from '../../components/modal/modal.js';
import { fmtLocalDateTime } from '../../utils/time.util.js';
import { villageOptions } from '../../services/db-mapper.service.js';

export const canMessage   = () => hasRole('super_admin', 'village_admin', 'finance');
export const canBroadcast = () => hasRole('super_admin', 'village_admin');

// ─── Staff notifications ──────────────────────────────────────
export async function loadNotifications() {
  appState.notifications = await sbLoadNotifications();
  window._updateNotifBadge?.();
}

export const unreadCount = () => (appState.notifications || []).filter(n => !n.read_at).length;

/** realtime: แจ้งเตือนใหม่เข้ามา */
export function onNotificationEvent(eventType, row) {
  if (!row?.id) return;
  const list = appState.notifications || (appState.notifications = []);
  const i = list.findIndex(n => n.id === row.id);
  if (eventType === 'INSERT' && i < 0) {
    list.unshift(row);
    toast(`🔔 ${row.title}`, 'info', 5000);
  } else if (i >= 0) {
    list[i] = row;
  }
  window._updateNotifBadge?.();
}

export function notificationListHtml() {
  const list = (appState.notifications || []).slice(0, 15);
  if (!list.length) return '';
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px 4px;font-size:12px;color:var(--gray-500)">
      <b>ล่าสุด</b>${unreadCount() ? `<a href="#" onclick="markAllNotificationsRead();return false" style="color:var(--blue-500)">อ่านทั้งหมด</a>` : ''}
    </div>
    ${list.map(n => `
      <div class="tbd-item" style="${n.read_at ? 'opacity:.6' : ''}" onclick="openNotification(${n.id})">
        <i class="ti ${n.kind === 'slip_pending' ? 'ti-receipt' : n.kind === 'meter_anomaly' ? 'ti-gauge' : n.kind === 'member_issue' ? 'ti-tool' : 'ti-bell'}"
           style="font-size:17px;flex-shrink:0;color:${n.read_at ? 'var(--gray-400)' : 'var(--blue-600)'}"></i>
        <span class="tbd-item-label"><b style="font-weight:${n.read_at ? 500 : 700}">${esc(n.title)}</b>
          <span style="display:block;font-size:11px;color:var(--gray-500)">${esc(n.body || '')}${n.body ? ' · ' : ''}${esc(fmtLocalDateTime(n.created_at))}</span></span>
      </div>`).join('')}`;
}

export async function openNotification(id) {
  const n = (appState.notifications || []).find(x => x.id === id);
  if (!n) return;
  window._closeAllPanels?.();
  if (!n.read_at) {
    n.read_at = new Date().toISOString();
    sbMarkNotificationsRead([id]);
    window._updateNotifBadge?.();
  }
  if (n.link_page) window.goPage?.(n.link_page);
  if (n.kind === 'slip_pending' && n.link_ref) window.viewPaymentSlip?.(n.link_ref);
}

export async function markAllNotificationsRead() {
  (appState.notifications || []).forEach(n => { n.read_at = n.read_at || new Date().toISOString(); });
  await sbMarkNotificationsRead(null);
  window._updateNotifBadge?.();
  window._closeAllPanels?.();
}

// ─── Portal access on member card ─────────────────────────────
export function portalUrl() {
  const cfg = appState.systemConfig?.portal_url;
  return cfg || new URL('portal.html', location.href.split('#')[0]).href;
}

export function portalDeepLink(meter, code) {
  return `${portalUrl()}#m=${encodeURIComponent(meter)}&c=${encodeURIComponent(code)}`;
}

export async function renderPortalAccess(member, el) {
  if (!el) return;
  const codes = await sbGetPortalCodes([member.id]);
  const a = codes[member.id];
  if (!a) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div style="background:var(--gray-50);border-radius:var(--radius-md);padding:10px 12px;margin-bottom:12px;font-size:12.5px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <i class="ti ti-world" style="font-size:18px;color:var(--blue-500)"></i>
      <div style="flex:1;min-width:160px">ดูบิลออนไลน์ · รหัส <b class="mono" style="letter-spacing:2px">${esc(a.code)}</b>
        <div style="color:var(--gray-500)">${a.lineLinked ? '<i class="ti ti-brand-line" style="color:#06c755"></i> ผูก LINE แล้ว' : 'ยังไม่ผูก LINE'}</div></div>
      <button class="btn btn-secondary btn-xs" id="pa-copy"><i class="ti ti-link"></i>คัดลอกลิงก์</button>
      ${canMessage() ? '<button class="btn btn-secondary btn-xs" id="pa-regen" title="สร้างรหัสใหม่ (รหัสเดิมใช้ไม่ได้)"><i class="ti ti-refresh"></i></button>' : ''}
    </div>`;
  el.querySelector('#pa-copy').onclick = async () => {
    const link = portalDeepLink(member.meter, a.code);
    try { await navigator.clipboard.writeText(link); toast('คัดลอกลิงก์แล้ว — ส่งให้สมาชิกได้เลย', 'success'); }
    catch { prompt('คัดลอกลิงก์นี้', link); }
  };
  const regen = el.querySelector('#pa-regen');
  if (regen) regen.onclick = async () => {
    if (!confirm('สร้างรหัสใหม่? รหัสเดิมและการเข้าสู่ระบบเดิมของสมาชิกจะใช้ไม่ได้')) return;
    const code = await sbRegeneratePortalCode(member.id);
    if (code) { toast(`รหัสใหม่: ${code}`, 'success'); renderPortalAccess(member, el); }
  };
}

// ─── Reminders / announcements ────────────────────────────────
function _reportQueued(r, what) {
  if (!r) return;
  const tail = r.no_channel ? ` · ${r.no_channel} ราย ยังไม่ผูก LINE/ไม่มีช่องทาง — พิมพ์หนังสือแจ้งแทน` : '';
  toast(`เข้าคิวส่ง${what} ${r.queued} ราย${tail}`, r.queued ? 'success' : 'warn', 6000);
}

export async function sendOverdueReminders(memberIds = null) {
  if (!canMessage()) { toast('ไม่มีสิทธิ์ส่งแจ้งเตือน', 'error'); return; }
  _reportQueued(await sbSendOverdueReminders(memberIds), 'แจ้งเตือนค้างชำระ');
}

export function openAnnouncement() {
  if (!canBroadcast()) { toast('เฉพาะผู้ดูแลระบบ', 'error'); return; }
  openModal({
    id: 'announce-modal', title: 'ส่งประกาศถึงผู้ใช้น้ำ', icon: 'ti-speakerphone', width: 460,
    body: `
      <div class="form-group" style="margin-bottom:12px"><label class="form-label" for="an-title">หัวข้อ *</label>
        <input class="form-input" id="an-title" placeholder="เช่น แจ้งปิดน้ำชั่วคราว"/></div>
      <div class="form-group" style="margin-bottom:12px"><label class="form-label" for="an-msg">ข้อความ *</label>
        <textarea class="form-input" id="an-msg" rows="4" placeholder="เช่น วันที่ 25 ต.ค. เวลา 09:00–12:00 น. ปิดน้ำเพื่อซ่อมท่อเมน"></textarea></div>
      <div class="form-group"><label class="form-label" for="an-village">ส่งถึง</label>
        <select class="form-input" id="an-village"><option value="">ทุกหมู่บ้าน</option>${villageOptions()}</select></div>
      <div style="font-size:11.5px;color:var(--gray-500);margin-top:10px">ส่งทาง LINE ให้สมาชิกที่ผูกบัญชีแล้ว (และ SMS ถ้าเปิดใช้)</div>`,
    footer: `<button class="btn btn-secondary" data-close>ยกเลิก</button>
      <button class="btn btn-primary" id="an-ok"><i class="ti ti-send"></i>ส่งประกาศ</button>`,
  });
  document.getElementById('an-ok').onclick = async (e) => {
    const title = document.getElementById('an-title').value.trim();
    const msg   = document.getElementById('an-msg').value.trim();
    if (!title || !msg) { toast('กรุณากรอกหัวข้อและข้อความ', 'error'); return; }
    // value เป็น village id — เลือกหมู่บ้านแล้วแต่ id ไม่ถูกต้อง ห้ามตกไปเป็น "ทุกหมู่บ้าน"
    const vSel = document.getElementById('an-village').value;
    const vId  = vSel ? Number(vSel) : null;
    if (vSel && !(vId > 0)) { toast('หมู่บ้านไม่ถูกต้อง', 'error'); return; }
    const done  = busyButton(e.currentTarget, 'กำลังส่ง...');
    const r = await sbBroadcast(title, msg, vId);
    done();
    if (!r) return;
    closeModal('announce-modal');
    _reportQueued({ queued: r.queued, no_channel: r.no_channel }, 'ประกาศ');
    window.renderSettings?.();
  };
}

// ─── Settings tab: แจ้งเตือน & LINE ───────────────────────────
const KIND_LABEL = { bill_issued: 'ใบแจ้งค่าน้ำ', due_soon: 'ใกล้ครบกำหนด', overdue: 'เลยกำหนด', overdue_reminder: 'เตือนค้างชำระ',
  payment_received: 'รับชำระแล้ว', announcement: 'ประกาศ' };
const STATUS_LABEL = { pending: 'รอส่ง', sending: 'กำลังส่ง', sent: 'ส่งแล้ว', failed: 'ส่งไม่สำเร็จ' };

export function buildNotifyPanel() {
  setTimeout(_fillNotifyStats, 0);
  const cfg = appState.systemConfig || {};
  return `
  <div class="card" style="margin-bottom:14px">
    <div class="card-hd">
      <div class="card-title"><i class="ti ti-brand-line" style="color:#06c755"></i>แจ้งเตือนผู้ใช้น้ำ (LINE / SMS)</div>
      ${canBroadcast() ? '<button class="btn btn-primary btn-sm" onclick="openAnnouncement()"><i class="ti ti-speakerphone"></i>ส่งประกาศ</button>' : ''}
    </div>
    <div class="card-body" id="notify-stats" style="font-size:13px">กำลังโหลด...</div>
  </div>
  <div class="card" style="margin-bottom:14px">
    <div class="card-hd"><div class="card-title"><i class="ti ti-settings" style="color:var(--blue-500)"></i>ตั้งค่า</div>
      <button class="btn btn-primary btn-sm" id="notify-save"><i class="ti ti-device-floppy"></i>บันทึก</button></div>
    <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
      <div class="syconf-row"><label class="form-label" for="nf-portal" style="min-width:200px">ลิงก์ Portal ผู้ใช้น้ำ</label>
        <input class="form-input" id="nf-portal" value="${esc(cfg.portal_url || '')}" placeholder="${esc(portalUrl())}"/></div>
      <div class="syconf-row"><label class="form-label" for="nf-line-id" style="min-width:200px">LINE OA ID (เช่น @abc1234)</label>
        <input class="form-input" id="nf-line-id" value="${esc(cfg.line_oa_id || '')}" placeholder="@..."/></div>
      <div class="syconf-row"><label class="form-label" for="nf-sms" style="min-width:200px">ส่ง SMS ให้คนที่ไม่มี LINE</label>
        <select class="form-input" id="nf-sms"><option value="false">ปิด</option><option value="true"${cfg.sms_enabled === 'true' ? ' selected' : ''}>เปิด (มีค่าใช้จ่ายต่อข้อความ)</option></select></div>
    </div>
  </div>
  <div class="card">
    <div class="card-hd"><div class="card-title"><i class="ti ti-list-check" style="color:var(--blue-500)"></i>ขั้นตอนเปิดใช้ LINE OA</div></div>
    <div class="card-body" style="font-size:13px;line-height:1.8">
      <ol style="padding-left:18px">
        <li>สร้าง LINE Official Account (ฟรี) ที่ <b>manager.line.biz</b> แล้วเปิด Messaging API</li>
        <li>คัดลอก <b>Channel secret</b> และ <b>Channel access token</b> จาก LINE Developers Console</li>
        <li>Deploy Edge Function <code>line-webhook</code> และ <code>line-dispatch</code> ตั้งค่า secret ตามไฟล์ <code>docs/LINE_SETUP.md</code></li>
        <li>ตั้ง Webhook URL ใน LINE เป็น <code>https://&lt;project&gt;.supabase.co/functions/v1/line-webhook</code></li>
        <li>สมาชิกเพิ่มเพื่อน แล้วพิมพ์ <code>ผูก &lt;เลขมิเตอร์&gt; &lt;รหัส 6 หลัก&gt;</code> (รหัสพิมพ์อยู่บนใบแจ้งค่าน้ำ)</li>
      </ol>
      <div style="color:var(--gray-500)">ระหว่างยังไม่เปิดใช้ ข้อความจะรอในคิว — สมาชิกยังใช้ Portal ดูบิล/จ่าย QR ได้ตามปกติ</div>
    </div>
  </div>`;
}

async function _fillNotifyStats() {
  const save = document.getElementById('notify-save');
  if (save) save.onclick = async () => {
    const done = busyButton(save);
    const r = await Promise.all([
      saveSystemConfig('portal_url', document.getElementById('nf-portal').value.trim()),
      saveSystemConfig('line_oa_id', document.getElementById('nf-line-id').value.trim()),
      saveSystemConfig('sms_enabled', document.getElementById('nf-sms').value),
    ]);
    done();
    const err = r.find(x => x.error);
    toast(err ? `⚠ ${err.error}` : 'บันทึกแล้ว', err ? 'error' : 'success');
  };
  const box = document.getElementById('notify-stats');
  if (!box) return;
  if (!canMessage()) { box.textContent = 'เฉพาะผู้ดูแลระบบ/การเงิน'; return; }
  const s = await sbOutboxStats();
  if (!s || !document.getElementById('notify-stats')) return;
  const by = s.by_status || {};
  box.innerHTML = `
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px">
      <div class="kpi-card"><div class="kpi-label">ผูก LINE แล้ว</div><div class="kpi-val text-primary">${s.members_line}/${s.members_total}</div></div>
      <div class="kpi-card"><div class="kpi-label">รอส่ง</div><div class="kpi-val" style="color:var(--amber-700)">${(by.pending || 0) + (by.sending || 0)}</div></div>
      <div class="kpi-card"><div class="kpi-label">ส่งแล้ว / ไม่สำเร็จ</div><div class="kpi-val">${by.sent || 0} / <span class="text-error">${by.failed || 0}</span></div></div>
    </div>
    ${s.recent.length ? `<div class="tbl-wrap" style="max-height:260px;overflow:auto"><table>
      <thead><tr><th>เวลา</th><th>ถึง</th><th>เรื่อง</th><th>ช่องทาง</th><th>สถานะ</th></tr></thead>
      <tbody>${s.recent.map(r => `<tr>
        <td class="mono" style="font-size:11px">${esc(fmtLocalDateTime(r.created_at))}</td><td>${esc(r.member || '—')}</td>
        <td>${esc(KIND_LABEL[r.kind] || r.kind)}</td><td>${r.channel === 'line' ? 'LINE' : 'SMS'}</td>
        <td title="${esc(r.last_error || '')}">${esc(STATUS_LABEL[r.status] || r.status)}${r.last_error ? ' <i class="ti ti-alert-circle" style="color:var(--red-700)"></i>' : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div style="color:var(--gray-400)">ยังไม่มีข้อความในคิว</div>'}`;
}
