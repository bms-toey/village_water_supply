// ─── Backup ───────────────────────────────────────────────────
// ดาวน์โหลดข้อมูลทั้งหมด (RPC export_backup — admin เท่านั้น) แล้วเข้ารหัสในเครื่องด้วยรหัสผ่าน
// (PBKDF2-SHA256 + AES-256-GCM) ก่อนบันทึกเป็นไฟล์ — ไฟล์มีข้อมูลส่วนบุคคลของสมาชิก จึงไม่เก็บแบบอ่านได้
// ไม่รวมรหัสผ่านและ API key
// ──────────────────────────────────────────────────────────────
import { todayISO } from '../../utils/time.util.js';
import { appState } from '../../state/app.state.js';
import { esc, toast } from '../../utils/dom.util.js';
import { hasRole } from '../../services/auth.service.js';
import { sbExportBackup, sbLogAudit } from '../../services/data-loader.service.js';
import { openModal, closeModal, busyButton } from '../../components/modal/modal.js';

export const BACKUP_REMIND_DAYS = 7;

const ENC_FORMAT     = 'aquaflow-backup-enc-v1';
const KDF_ITERATIONS = 310000;
const MIN_PASSPHRASE = 10;

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
      </div>
      <div style="display:flex;gap:8px;align-items:flex-start;padding:10px 12px;border-radius:var(--radius-md);background:var(--blue-50);color:var(--blue-900)">
        <i class="ti ti-lock" style="font-size:18px;margin-top:2px"></i>
        <div>ไฟล์สำรองถูกเข้ารหัสแล้ว เก็บรหัสผ่านแยกจากไฟล์ — ถ้าลืมรหัสจะเปิดไฟล์ไม่ได้</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="backup-btn" onclick="downloadBackup()">
          <i class="ti ti-download"></i>ดาวน์โหลดไฟล์สำรอง (เข้ารหัส)
        </button>
        <button class="btn btn-secondary" id="backup-decrypt-btn" onclick="decryptBackupFile()">
          <i class="ti ti-lock-open"></i>ถอดรหัสไฟล์สำรอง
        </button>
      </div>
      <div id="backup-result"></div>
    </div>
  </div>`;
}

// ─── WebCrypto ─────────────────────────────────────────────────
const _b64 = buf => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const _unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));

async function _deriveKey(passphrase, salt, iterations, usage) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

async function _encrypt(obj, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await _deriveKey(passphrase, salt, KDF_ITERATIONS, 'encrypt');
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return {
    format: ENC_FORMAT,
    created_at: new Date().toISOString(),
    kdf:    { name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS, salt: _b64(salt) },
    cipher: { name: 'AES-GCM', iv: _b64(iv) },
    data:   _b64(data),
  };
}

async function _decrypt(env, passphrase) {
  if (env?.format !== ENC_FORMAT) throw new Error('ไม่ใช่ไฟล์สำรองแบบเข้ารหัสของ AquaFlow');
  const key = await _deriveKey(passphrase, _unb64(env.kdf.salt), Number(env.kdf.iterations), 'decrypt');
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _unb64(env.cipher.iv) }, key, _unb64(env.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error('รหัสผ่านไม่ถูกต้อง หรือไฟล์เสียหาย');
  }
}

function _saveFile(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ─── Export ────────────────────────────────────────────────────
export function downloadBackup() {
  if (!canBackup()) { toast('เฉพาะผู้ดูแลระบบ', 'error'); return; }
  if (!window.crypto?.subtle) { toast('เบราว์เซอร์นี้เข้ารหัสไฟล์ไม่ได้ (ต้องเปิดผ่าน https)', 'error'); return; }
  openModal({
    id: 'backup-pass-modal', title: 'ตั้งรหัสผ่านไฟล์สำรอง', icon: 'ti-lock', width: 420,
    body: `
      <div style="font-size:12.5px;color:var(--gray-600);margin-bottom:10px">
        อย่างน้อย ${MIN_PASSPHRASE} ตัวอักษร · เก็บรหัสผ่านแยกจากไฟล์ — ถ้าลืมรหัสจะเปิดไฟล์ไม่ได้</div>
      <label class="form-label" for="bk-pass1">รหัสผ่าน</label>
      <input class="form-input" id="bk-pass1" type="password" autocomplete="new-password"/>
      <label class="form-label" for="bk-pass2" style="margin-top:10px">ยืนยันรหัสผ่าน</label>
      <input class="form-input" id="bk-pass2" type="password" autocomplete="new-password"/>`,
    footer: `<button class="btn btn-secondary" data-close>ยกเลิก</button>
      <button class="btn btn-primary" id="bk-pass-ok"><i class="ti ti-download"></i>เข้ารหัสและดาวน์โหลด</button>`,
  });
  document.getElementById('bk-pass1')?.focus();
  document.getElementById('bk-pass-ok').addEventListener('click', async e => {
    const p1 = document.getElementById('bk-pass1').value;
    const p2 = document.getElementById('bk-pass2').value;
    if (p1.length < MIN_PASSPHRASE) { toast(`รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSPHRASE} ตัวอักษร`, 'error'); return; }
    if (p1 !== p2) { toast('รหัสผ่านทั้งสองช่องไม่ตรงกัน', 'error'); return; }
    const done = busyButton(e.currentTarget, 'กำลังเตรียมไฟล์...');
    try {
      await _exportEncrypted(p1);
      closeModal('backup-pass-modal');
    } finally {
      done();
    }
  });
}

async function _exportEncrypted(passphrase) {
  const data = await sbExportBackup();
  if (!data) return;

  const stamp = todayISO();
  let env;
  try { env = await _encrypt(data, passphrase); }
  catch (err) { toast(`เข้ารหัสไม่สำเร็จ: ${err.message}`, 'error'); return; }
  _saveFile(`aquaflow-backup-${stamp}.aqbk.json`, JSON.stringify(env));

  const counts = Object.entries(data).filter(([, v]) => Array.isArray(v));
  sbLogAudit('backup', stamp, 'export_encrypted', null,
    { format: ENC_FORMAT, tables: Object.fromEntries(counts.map(([k, v]) => [k, v.length])) });

  appState.systemConfig.last_backup_at = data.exported_at;
  window.renderSettings?.();   // อัปเดตวันที่สำรองล่าสุด (วาด panel ใหม่)
  window._updateNotifBadge?.();
  const res = document.getElementById('backup-result');
  if (res) res.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:6px">${counts
    .map(([k, v]) => `<span class="pill pill-normal" style="font-size:11px">${esc(k)}: ${v.length}</span>`).join(' ')}</div>`;
  toast('ดาวน์โหลดไฟล์สำรอง (เข้ารหัส) แล้ว', 'success');
}

// ─── Decrypt (กู้คืน/ตรวจสอบไฟล์) ───────────────────────────────
export function decryptBackupFile() {
  if (!canBackup()) { toast('เฉพาะผู้ดูแลระบบ', 'error'); return; }
  if (!window.crypto?.subtle) { toast('เบราว์เซอร์นี้ถอดรหัสไม่ได้ (ต้องเปิดผ่าน https)', 'error'); return; }
  openModal({
    id: 'backup-decrypt-modal', title: 'ถอดรหัสไฟล์สำรอง', icon: 'ti-lock-open', width: 420,
    body: `
      <div style="font-size:12.5px;color:var(--gray-600);margin-bottom:10px">
        ได้ไฟล์ JSON ที่อ่านได้ (มีข้อมูลส่วนบุคคล) — ใช้เสร็จแล้วลบทิ้ง อย่าเก็บไว้ในเครื่องที่ใช้ร่วมกัน</div>
      <label class="form-label" for="bk-dec-file">ไฟล์ .aqbk.json</label>
      <input class="form-input" id="bk-dec-file" type="file" accept=".json,application/json"/>
      <label class="form-label" for="bk-dec-pass" style="margin-top:10px">รหัสผ่าน</label>
      <input class="form-input" id="bk-dec-pass" type="password" autocomplete="off"/>`,
    footer: `<button class="btn btn-secondary" data-close>ยกเลิก</button>
      <button class="btn btn-primary" id="bk-dec-ok"><i class="ti ti-lock-open"></i>ถอดรหัส</button>`,
  });
  document.getElementById('bk-dec-ok').addEventListener('click', async e => {
    const file = document.getElementById('bk-dec-file').files?.[0];
    const pass = document.getElementById('bk-dec-pass').value;
    if (!file) { toast('กรุณาเลือกไฟล์', 'error'); return; }
    if (!pass) { toast('กรุณากรอกรหัสผ่าน', 'error'); return; }
    const done = busyButton(e.currentTarget, 'กำลังถอดรหัส...');
    try {
      let env;
      try { env = JSON.parse(await file.text()); } catch { throw new Error('ไฟล์ไม่ใช่ JSON'); }
      const data = await _decrypt(env, pass);
      _saveFile(file.name.replace(/\.aqbk\.json$|\.json$/i, '') + '.decrypted.json', JSON.stringify(data, null, 1));
      closeModal('backup-decrypt-modal');
      toast('ถอดรหัสแล้ว', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      done();
    }
  });
}

window.decryptBackupFile = decryptBackupFile;
