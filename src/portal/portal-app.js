// ─── Portal ผู้ใช้น้ำ ────────────────────────────────────────────
// เข้าด้วยเลขมิเตอร์ + รหัส 6 หลัก (RPC member_login) — token ของสมาชิกเรียกได้เฉพาะ
// RPC สำหรับสมาชิก (member_overview / member_submit_payment / member_report_issue)
// ลิงก์ตรง: portal.html#m=<เลขมิเตอร์>&c=<รหัส>  (QR บนใบแจ้งค่าน้ำ)
// ──────────────────────────────────────────────────────────────
import { esc } from '../utils/dom.util.js';
import { promptPaySvg } from '../utils/promptpay.js';
import { compressImage } from '../utils/image.util.js';
import { thaiDate } from '../modules/documents/templates.js';

const SESSION_KEY = 'aquaflow_member_session';
const $ = id => document.getElementById(id);
const baht = n => '฿' + Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

let session = _readSession();
let data    = null;

const cfg = window.APP_CONFIG || {};
const sb  = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  accessToken: async () => (session && session.expires_at > Date.now() / 1000 ? session.token : null),
});

function _readSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return s?.token && s.expires_at > Date.now() / 1000 ? s : null;
  } catch { return null; }
}
function _saveSession(s) {
  session = s;
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch { /* blocked */ }
}

function toast(msg, isError = false) {
  const t = $('pt-toast');
  t.textContent = msg;
  t.className = 'pt-toast' + (isError ? ' err' : '');
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 3500);
}

function show(view) {
  $('pt-loading').hidden = view !== 'loading';
  $('pt-login').hidden   = view !== 'login';
  $('pt-app').hidden     = view !== 'app';
  $('pt-logout').hidden  = view !== 'app';
}

function openSheet(title, html) {
  $('pt-sheet-title').textContent = title;
  $('pt-sheet-body').innerHTML = html;
  $('pt-sheet').hidden = false;
}
function closeSheet() { $('pt-sheet').hidden = true; }

// ─── Login ────────────────────────────────────────────────────
async function login(meter, code) {
  const err = $('pt-login-error');
  err.hidden = true;
  const btn = $('pt-login-btn');
  btn.disabled = true;
  const { data: res, error } = await sb.rpc('member_login', { p_meter: meter, p_code: code });
  btn.disabled = false;
  if (error || !res?.token) {
    err.textContent = res?.error || (error ? 'เชื่อมต่อไม่ได้ กรุณาลองใหม่' : 'เข้าสู่ระบบไม่ได้');
    err.hidden = false;
    show('login');
    return;
  }
  _saveSession(res);
  await load();
}

async function load() {
  show('loading');
  const { data: res, error } = await sb.rpc('member_overview');
  if (error || !res) {
    _saveSession(null);
    show('login');
    if (error && !/SESSION_REVOKED/.test(error.message)) toast('โหลดข้อมูลไม่ได้ กรุณาลองใหม่', true);
    return;
  }
  data = res;
  render();
  show('app');
}

// ─── Render ───────────────────────────────────────────────────
function render() {
  const { member, org, bills } = data;
  $('pt-org').textContent = org.org_name || 'ประปาหมู่บ้าน';
  document.title = `ค่าน้ำ — ${org.org_name || 'ประปาหมู่บ้าน'}`;
  $('pt-me').innerHTML = `
    <div class="pt-avatar"><i class="ti ti-home"></i></div>
    <div><b>${esc(member.name)}</b><span class="pt-muted">บ้านเลขที่ ${esc(member.house_no || '-')} ${esc(member.village || '')} · มิเตอร์ ${esc(member.meter_no)}</span></div>`;

  const unpaid = bills.filter(b => b.status === 'pending' || b.status === 'overdue');
  const total  = unpaid.reduce((s, b) => s + Number(b.total), 0);
  const overdue = unpaid.some(b => b.status === 'overdue');
  $('pt-unpaid').innerHTML = unpaid.length ? `
    <div class="pt-card pt-due${overdue ? ' is-overdue' : ''}">
      <div class="pt-muted">${overdue ? 'มียอดเลยกำหนดชำระ' : 'ยอดที่ต้องชำระ'}</div>
      <div class="pt-due-amt">${baht(total)}</div>
      <div class="pt-muted">${unpaid.length} บิล · ครบกำหนด ${thaiDate(unpaid[unpaid.length - 1].due_date)}</div>
      ${unpaid.map(b => b.pending_payment
        ? `<div class="pt-btn pt-btn-light" style="cursor:default"><i class="ti ti-clock"></i>${esc(b.period)} — ส่งสลิปแล้ว รอเจ้าหน้าที่ตรวจสอบ</div>`
        : `<button class="pt-btn ${b.status === 'overdue' ? 'pt-btn-primary' : 'pt-btn-green'}" data-pay="${esc(b.id)}"><i class="ti ti-qrcode"></i>จ่ายบิล ${esc(b.period)} ${baht(b.total)}</button>`).join('')}
    </div>` : `<div class="pt-card"><div class="pt-ok"><i class="ti ti-circle-check"></i>ไม่มียอดค้างชำระ ขอบคุณที่ชำระตรงเวลา</div></div>`;
  $('pt-unpaid').querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => openPay(b.dataset.pay)));

  renderBills();
  renderUsage();
  renderIssues();
}

const STATUS = { paid: ['paid', 'ชำระแล้ว'], pending: ['pending', 'รอชำระ'], overdue: ['overdue', 'เลยกำหนด'] };

function renderBills() {
  const rows = data.bills.map(b => {
    const [cls, label] = b.pending_payment ? ['review', 'รอตรวจสลิป'] : (STATUS[b.status] || ['pending', b.status]);
    return `<div class="pt-bill">
      <div><b>${esc(b.period)}</b><div class="pt-muted">ใช้น้ำ ${Number(b.usage)} ลบ.ม.${b.receipt_no ? ` · ใบเสร็จ ${esc(b.receipt_no)}` : ` · ครบกำหนด ${thaiDate(b.due_date)}`}</div></div>
      <div><div class="pt-bill-amt">${baht(b.total)}</div><span class="pt-pill ${cls}">${label}</span></div>
    </div>`;
  }).join('');
  $('pt-tab-bills').innerHTML = `<div class="pt-card">${rows || '<p class="pt-muted">ยังไม่มีบิล</p>'}</div>`;
}

function renderUsage() {
  const list = [...data.bills].reverse().slice(-12);
  const max = Math.max(1, ...list.map(b => Number(b.usage)));
  const avg = list.length ? list.reduce((s, b) => s + Number(b.usage), 0) / list.length : 0;
  $('pt-tab-usage').innerHTML = `
    <div class="pt-card">
      <b>ปริมาณน้ำที่ใช้ (ลบ.ม.)</b>
      <div class="pt-muted">เฉลี่ย ${avg.toFixed(1)} ลบ.ม./เดือน</div>
      <div class="pt-bars">${list.map(b => `
        <div class="pt-bar"><em>${Number(b.usage)}</em><span style="height:${Math.round(Number(b.usage) / max * 100)}%"></span><small>${esc(String(b.period).split(' ')[0])}</small></div>`).join('')}
      </div>
      ${list.length ? '' : '<p class="pt-muted">ยังไม่มีข้อมูล</p>'}
    </div>`;
}

const ISSUE_STATUS = { pending: 'รอดำเนินการ', in_progress: 'กำลังซ่อม', completed: 'เสร็จแล้ว', cancelled: 'ยกเลิก' };

function renderIssues() {
  $('pt-tab-issue').innerHTML = `
    <div class="pt-card">
      <b>แจ้งปัญหา / แจ้งซ่อม</b>
      <label class="pt-label" for="pt-issue-type">เรื่อง</label>
      <select class="pt-input" id="pt-issue-type">
        <option value="leak_fix">น้ำรั่ว / ท่อแตก</option>
        <option value="pipe_repair">น้ำไม่ไหล / น้ำไหลอ่อน</option>
        <option value="meter_replace">มิเตอร์เสีย</option>
        <option value="other">อื่นๆ (น้ำขุ่น ฯลฯ)</option>
      </select>
      <label class="pt-label" for="pt-issue-desc">รายละเอียด</label>
      <textarea class="pt-input" id="pt-issue-desc" placeholder="เช่น ท่อแตกหน้าบ้าน น้ำไหลตลอดเวลา"></textarea>
      <label class="pt-label" for="pt-issue-loc">จุดที่พบ (ถ้าไม่ใช่ที่บ้าน)</label>
      <input class="pt-input" id="pt-issue-loc" placeholder="เช่น หน้าศาลาหมู่บ้าน"/>
      <button class="pt-file" id="pt-issue-photo" type="button"><i class="ti ti-camera"></i><span>แนบรูป (ถ้ามี)</span></button>
      <button class="pt-btn pt-btn-primary" id="pt-issue-send"><i class="ti ti-send"></i>ส่งเรื่อง</button>
    </div>
    <div class="pt-card"><b>เรื่องที่แจ้งไว้</b>
      ${data.issues.length ? data.issues.map(j => `<div class="pt-bill"><div>${esc(j.description)}<div class="pt-muted">${thaiDate(j.reported_date)}</div></div>
        <span class="pt-pill ${j.status === 'completed' ? 'paid' : j.status === 'in_progress' ? 'review' : 'pending'}">${esc(ISSUE_STATUS[j.status] || j.status)}</span></div>`).join('')
        : '<p class="pt-muted">ยังไม่มี</p>'}
    </div>`;
  let photo = null;
  $('pt-issue-photo').onclick = () => pickImage(f => {
    photo = f;
    $('pt-issue-photo').classList.add('has');
    $('pt-issue-photo').querySelector('span').textContent = f.name;
  });
  $('pt-issue-send').onclick = async (e) => {
    const desc = $('pt-issue-desc').value.trim();
    if (!desc) { toast('กรุณาอธิบายปัญหา', true); return; }
    e.currentTarget.disabled = true;
    try {
      const path = photo ? await upload(photo, 'issue') : '';
      if (photo && !path) return;
      const { error } = await sb.rpc('member_report_issue', {
        p_type: $('pt-issue-type').value, p_description: desc, p_location: $('pt-issue-loc').value.trim(), p_photo_path: path,
      });
      if (error) { toast(error.message, true); return; }
      toast('ส่งเรื่องแล้ว เจ้าหน้าที่จะติดต่อกลับ');
      await load();
      switchTab('issue');
    } finally {
      if ($('pt-issue-send')) $('pt-issue-send').disabled = false;
    }
  };
}

// ─── Pay with QR + slip ───────────────────────────────────────
function openPay(billId) {
  const b = data.bills.find(x => x.id === billId);
  const org = data.org;
  const qr = org.promptpay_id ? promptPaySvg(org.promptpay_id, b.total, 220) : '';
  openSheet(`จ่ายบิล ${b.period}`, `
    <div class="pt-qr">${qr || '<p class="pt-muted">ยังไม่ได้ตั้งค่าพร้อมเพย์ — ชำระที่เจ้าหน้าที่</p>'}</div>
    <p style="text-align:center;margin:6px 0 2px"><b style="font-size:24px">${baht(b.total)}</b></p>
    <p class="pt-muted" style="text-align:center">พร้อมเพย์ ${esc(org.promptpay_name || '')}<br>บันทึกรูป QR หรือสแกนจากแอปธนาคาร แล้วแนบสลิปด้านล่าง</p>
    ${org.bank_info ? `<p class="pt-muted" style="text-align:center;margin-top:6px">${esc(org.bank_info).replace(/\n/g, '<br>')}</p>` : ''}
    <button class="pt-file" id="pt-slip" type="button"><i class="ti ti-photo-up"></i><span>แนบสลิปการโอน</span></button>
    <label class="pt-label" for="pt-ref">เลขอ้างอิง (ถ้ามี)</label>
    <input class="pt-input" id="pt-ref"/>
    <button class="pt-btn pt-btn-green" id="pt-send-slip" disabled><i class="ti ti-send"></i>ส่งสลิปให้เจ้าหน้าที่</button>`);
  let slip = null;
  $('pt-slip').onclick = () => pickImage(f => {
    slip = f;
    $('pt-slip').classList.add('has');
    $('pt-slip').querySelector('span').textContent = f.name;
    $('pt-send-slip').disabled = false;
  });
  $('pt-send-slip').onclick = async (e) => {
    e.currentTarget.disabled = true;
    const path = await upload(slip, 'slip');
    if (!path) { e.currentTarget.disabled = false; return; }
    const { error } = await sb.rpc('member_submit_payment', {
      p_bill_id: b.id, p_amount: b.total, p_ref: $('pt-ref').value.trim(), p_slip_path: path,
    });
    if (error) { toast(error.message, true); e.currentTarget.disabled = false; return; }
    closeSheet();
    toast('ส่งสลิปแล้ว เจ้าหน้าที่จะตรวจสอบและออกใบเสร็จ');
    await load();
  };
}

function pickImage(cb) {
  const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
  inp.onchange = () => inp.files[0] && cb(inp.files[0]);
  inp.click();
}

async function upload(file, kind) {
  const blob = await compressImage(file);
  if (blob.size > 5 * 1024 * 1024) { toast('ไฟล์รูปใหญ่เกิน 5MB', true); return null; }
  const path = `m${data.member.id}/${kind}-${Date.now()}.jpg`;
  const { error } = await sb.storage.from('member-uploads').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
  if (error) { toast('อัปโหลดรูปไม่สำเร็จ: ' + error.message, true); return null; }
  return path;
}

// ─── Tabs / bootstrap ─────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.pt-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  ['bills', 'usage', 'issue'].forEach(k => { $(`pt-tab-${k}`).hidden = k !== tab; });
}

document.querySelectorAll('.pt-tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
$('pt-sheet-close').onclick = closeSheet;
$('pt-sheet').addEventListener('click', e => { if (e.target.id === 'pt-sheet') closeSheet(); });
$('pt-logout').onclick = () => { _saveSession(null); data = null; show('login'); };
$('pt-login-form').addEventListener('submit', e => {
  e.preventDefault();
  login($('pt-meter').value, $('pt-code').value);
});

(async function init() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('m') && h.get('c')) {
    history.replaceState(null, '', location.pathname + location.search);   // ไม่ทิ้งรหัสไว้ในประวัติเบราว์เซอร์
    $('pt-meter').value = h.get('m');
    $('pt-code').value  = h.get('c');
    await login(h.get('m'), h.get('c'));
    return;
  }
  if (session) { await load(); return; }
  show('login');
})();
