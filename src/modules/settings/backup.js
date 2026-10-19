// ─── Backup ───────────────────────────────────────────────────
// ดาวน์โหลดข้อมูลทั้งหมดเป็นไฟล์ JSON (RPC export_backup — admin เท่านั้น)
// ไม่รวมรหัสผ่านและ API key — เก็บไฟล์ไว้ในที่ปลอดภัย เพราะมีข้อมูลส่วนบุคคลของสมาชิก
// ──────────────────────────────────────────────────────────────
import { todayISO } from '../../utils/time.util.js';
import { appState } from '../../state/app.state.js';
import { esc, toast } from '../../utils/dom.util.js';
import { hasRole } from '../../services/auth.service.js';
import { sbExportBackup } from '../../services/data-loader.service.js';
import { busyButton } from '../../components/modal/modal.js';

export const BACKUP_REMIND_DAYS = 7;

export const canBackup = () => hasRole('super_admin', 'village_admin');

/** จำนวนวันนับจากสำรองครั้งล่าสุด (null = ไม่เคยสำรอง) */
export function daysSinceBackup() {
  const at = appState.systemConfig?.last_backup_at;
  if (!at) return null;
  const t = new Date(at).getTime();
  return isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
}

export function backupOverdue() {
  if (!canBackup()) return false;
  const d = daysSinceBackup();
  return d === null || d >= BACKUP_REMIND_DAYS;
}

export function buildBackupPanel() {
  const d    = daysSinceBackup();
  const last = appState.systemConfig?.last_backup_at;
  const lastText = last
    ? `${new Date(last).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })} (${d === 0 ? 'วันนี้' : d + ' วันที่แล้ว'})`
    : 'ยังไม่เคยสำรองข้อมูล';
  const warn = backupOverdue();
  return `
  <div class="card">
    <div class="card-hd">
      <div class="card-title"><i class="ti ti-database-export" style="color:var(--blue-500)"></i>สำรองข้อมูล</div>
    </div>
    <div class="card-body" style="display:flex;flex-direction:column;gap:14px;font-size:13px;line-height:1.7">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:var(--radius-md);
        background:${warn ? 'var(--red-50)' : 'var(--green-50)'};color:${warn ? 'var(--red-700)' : 'var(--green-800)'}">
        <i class="ti ${warn ? 'ti-alert-triangle' : 'ti-circle-check'}" style="font-size:20px"></i>
        <div><b>สำรองล่าสุด:</b> ${esc(lastText)}</div>
      </div>
      <div>
        ไฟล์สำรองมีข้อมูลสมาชิก บิล การชำระเงิน การอ่านมิเตอร์ งานซ่อม และการตั้งค่าทั้งหมด
        (ไม่รวมรหัสผ่านและ API key) ควรดาวน์โหลดอย่างน้อย <b>สัปดาห์ละครั้ง</b>
        และเก็บไว้ในที่ปลอดภัย เช่น Google Drive ของกองทุน เพราะมีข้อมูลส่วนบุคคลของสมาชิก
      </div>
      <div>
        <button class="btn btn-primary" id="backup-btn" onclick="downloadBackup()">
          <i class="ti ti-download"></i>ดาวน์โหลดไฟล์สำรอง (.json)
        </button>
      </div>
      <div id="backup-result"></div>
    </div>
  </div>`;
}

export async function downloadBackup() {
  if (!canBackup()) { toast('เฉพาะผู้ดูแลระบบ', 'error'); return; }
  const done = busyButton(document.getElementById('backup-btn'), 'กำลังเตรียมไฟล์...');
  const data = await sbExportBackup();
  done();
  if (!data) return;

  const stamp = todayISO();
  const blob  = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const url   = URL.createObjectURL(blob);
  const a     = Object.assign(document.createElement('a'), { href: url, download: `aquaflow-backup-${stamp}.json` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  appState.systemConfig.last_backup_at = data.exported_at;
  window.renderSettings?.();   // อัปเดตวันที่สำรองล่าสุด (วาด panel ใหม่)
  window._updateNotifBadge?.();
  const counts = Object.entries(data)
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => `<span class="pill pill-normal" style="font-size:11px">${esc(k)}: ${v.length}</span>`)
    .join(' ');
  const res = document.getElementById('backup-result');
  if (res) res.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px">${counts}</div>`;
  toast('ดาวน์โหลดไฟล์สำรองแล้ว', 'success');
}
