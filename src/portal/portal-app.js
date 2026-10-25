// ─── Portal ผู้ใช้น้ำ ────────────────────────────────────────────
// เข้าด้วยเลขมิเตอร์ + รหัส 6 หลัก (RPC member_login) — token ของสมาชิกเรียกได้เฉพาะ
// RPC สำหรับสมาชิก (member_overview / member_submit_payment / member_report_issue /
// member_my_data / member_ack_privacy / member_privacy_request — PDPA)
// ลิงก์ตรง: portal.html#m=<เลขมิเตอร์>&c=<รหัส>  (QR บนใบแจ้งค่าน้ำ)
// ──────────────────────────────────────────────────────────────
import { esc } from '../utils/dom.util.js';
import { promptPaySvg } from '../utils/promptpay.js';
import { compressImage } from '../utils/image.util.js';
import { thaiDate } from '../modules/documents/templates.js';
import { initSelectPicker } from '../components/ux/select-picker.js';

const SESSION_KEY = 'aquaflow_member_session';
const PRIVACY_VERSION = '2026-10';   // ต้องตรงกับฉบับใน privacy.html
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
  checkPrivacyAck();
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
  if (!$('pt-tab-mydata').hidden) renderMyData();
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

// ─── PDPA: ประกาศความเป็นส่วนตัว / ข้อมูลของฉัน / คำขอใช้สิทธิ์ ──────
// ฐานข้อมูลรุ่นเก่า (ยังไม่ได้รัน sql_phase5) ไม่มี RPC เหล่านี้ — ไม่ให้กระทบการดูบิล
let myData = null;

async function checkPrivacyAck() {
  const box = $('pt-privacy');
  const { data: md, error } = await sb.rpc('member_my_data');
  if (error || !md) { if (error) console.warn('[portal] member_my_data:', error.message); box.hidden = true; return; }
  myData = md;
  if (md.privacy_ack?.version === PRIVACY_VERSION) { box.hidden = true; return; }
  box.innerHTML = `
    <div class="pt-card pt-privacy">
      <b><i class="ti ti-shield-lock"></i> ประกาศความเป็นส่วนตัว</b>
      <p class="pt-muted">เราเก็บและใช้ข้อมูลของท่าน (ชื่อ ที่อยู่ เบอร์โทร ประวัติใช้น้ำ บิล และการชำระเงิน) เพื่อให้บริการน้ำประปาและจัดทำบัญชี
        ข้อมูลถูกเข้ารหัสและจำกัดสิทธิ์การเข้าถึง ท่านขอดู ขอสำเนา แก้ไข หรือขอลบข้อมูลได้ที่แท็บ "ข้อมูลของฉัน"</p>
      <a class="pt-link" href="privacy.html" target="_blank" rel="noopener"><i class="ti ti-file-text"></i>อ่านประกาศฉบับเต็ม</a>
      <button class="pt-btn pt-btn-primary" id="pt-privacy-ok"><i class="ti ti-check"></i>รับทราบ</button>
    </div>`;
  box.hidden = false;
  $('pt-privacy-ok').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const { error: ackErr } = await sb.rpc('member_ack_privacy', { p_version: PRIVACY_VERSION });
    if (ackErr) { console.warn('[portal] member_ack_privacy:', ackErr.message); btn.disabled = false; toast('บันทึกไม่สำเร็จ กรุณาลองใหม่', true); return; }
    box.hidden = true;
    if (myData) myData.privacy_ack = { version: PRIVACY_VERSION, at: new Date().toISOString() };
  };
}

const REQUEST_KINDS = {
  access:           'ขอสำเนา / ขอเข้าถึงข้อมูล',
  rectify:          'ขอแก้ไขข้อมูลให้ถูกต้อง',
  erase:            'ขอลบข้อมูล',
  object:           'คัดค้านการใช้ข้อมูล',
  restrict:         'ขอระงับการใช้ข้อมูล',
  withdraw_consent: 'ถอนความยินยอม (LINE)',
  portability:      'ขอโอนย้ายข้อมูล',
};
const REQUEST_STATUS = { open: ['pending', 'รอดำเนินการ'], in_progress: ['review', 'กำลังดำเนินการ'], done: ['paid', 'เสร็จแล้ว'], rejected: ['overdue', 'ปฏิเสธ'] };

async function renderMyData() {
  const el = $('pt-tab-mydata');
  if (!myData) {
    el.innerHTML = '<div class="pt-loading"><i class="ti ti-loader-2"></i></div>';
    const { data: md, error } = await sb.rpc('member_my_data');
    if (error || !md) {
      el.innerHTML = '<div class="pt-card"><p class="pt-muted">ยังเปิดใช้ส่วนนี้ไม่ได้ กรุณาติดต่อเจ้าหน้าที่ประปาหมู่บ้าน</p></div>';
      return;
    }
    myData = md;
  }
  const p = myData.profile || {};
  const row = (label, v) => `<div class="pt-kv"><span class="pt-muted">${label}</span><span>${v ? esc(v) : '<span class="pt-muted">—</span>'}</span></div>`;
  const reqs = myData.requests || [];
  el.innerHTML = `
    <div class="pt-card">
      <b>ข้อมูลส่วนบุคคลที่เก็บไว้</b>
      ${row('ชื่อ–นามสกุล', [p.first_name, p.last_name].filter(Boolean).join(' '))}
      ${row('เลขบัตรประชาชน', p.national_id)}
      ${row('บ้านเลขที่', p.house_no)}
      ${row('หมู่บ้าน', p.village)}
      ${row('เบอร์โทร', p.phone)}
      ${row('อีเมล', p.email)}
      ${row('LINE ID', p.line_id)}
      ${row('พิกัดบ้าน', p.gps ? `${p.gps.lat}, ${p.gps.lng}` : '')}
      ${row('เลขมิเตอร์', p.meter_no)}
      ${row('ผูกบัญชี LINE', myData.line_linked ? `ผูกแล้ว${myData.line_linked_at ? ' (' + thaiDate(myData.line_linked_at) + ')' : ''}` : 'ไม่ได้ผูก')}
      <p class="pt-muted pt-note">ประวัติบิล ${(myData.bills || []).length} รายการ · การชำระ ${(myData.payments || []).length} รายการ · การจดมิเตอร์ ${(myData.readings || []).length} ครั้ง</p>
      <button class="pt-btn pt-btn-light" id="pt-mydata-dl"><i class="ti ti-download"></i>ดาวน์โหลดข้อมูลของฉัน (JSON)</button>
      <a class="pt-link" href="privacy.html" target="_blank" rel="noopener"><i class="ti ti-file-text"></i>ประกาศความเป็นส่วนตัว</a>
    </div>
    <div class="pt-card">
      <b>ส่งคำขอใช้สิทธิ์เจ้าของข้อมูล</b>
      <label class="pt-label" for="pt-req-kind">เรื่อง</label>
      <select class="pt-input" id="pt-req-kind">
        ${Object.entries(REQUEST_KINDS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
      </select>
      <label class="pt-label" for="pt-req-detail">รายละเอียด</label>
      <textarea class="pt-input" id="pt-req-detail" maxlength="2000" placeholder="เช่น เบอร์โทรเปลี่ยนเป็นเบอร์ใหม่"></textarea>
      <button class="pt-btn pt-btn-primary" id="pt-req-send"><i class="ti ti-send"></i>ส่งคำขอ</button>
    </div>
    <div class="pt-card"><b>คำขอที่ส่งไว้</b>
      ${reqs.length ? reqs.map(q => {
        const [cls, label] = REQUEST_STATUS[q.status] || ['pending', q.status];
        return `<div class="pt-bill"><div>${esc(REQUEST_KINDS[q.kind] || q.kind)}<div class="pt-muted">ส่งเมื่อ ${thaiDate(q.created_at)} · ครบกำหนดตอบ ${thaiDate(q.due_at)}</div>
          ${q.response ? `<div class="pt-muted">คำตอบ: ${esc(q.response)}</div>` : ''}</div>
          <span class="pt-pill ${cls}">${esc(label)}</span></div>`;
      }).join('') : '<p class="pt-muted">ยังไม่มี</p>'}
    </div>`;
  initSelectPicker();
  $('pt-mydata-dl').onclick = () => {
    const blob = new Blob([JSON.stringify(myData, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: `aquaflow-my-data-${new Date().toISOString().slice(0, 10)}.json`,
    });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('pt-req-send').onclick = async (e) => {
    const btn = e.currentTarget;
    const kind = $('pt-req-kind').value;
    const detail = $('pt-req-detail').value.trim();
    if (['rectify', 'erase', 'object', 'restrict'].includes(kind) && !detail) { toast('กรุณาระบุรายละเอียด', true); return; }
    btn.disabled = true;
    const { error } = await sb.rpc('member_privacy_request', { p_kind: kind, p_detail: detail });
    if (error) { toast(error.message, true); btn.disabled = false; return; }
    toast('ส่งคำขอแล้ว เจ้าหน้าที่จะตอบภายใน 30 วัน');
    myData = null;
    await renderMyData();
  };
}

// ─── Tabs / bootstrap ─────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.pt-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  ['bills', 'usage', 'issue', 'mydata'].forEach(k => { $(`pt-tab-${k}`).hidden = k !== tab; });
  if (tab === 'mydata') renderMyData();
}

document.querySelectorAll('.pt-tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
$('pt-sheet-close').onclick = closeSheet;
$('pt-sheet').addEventListener('click', e => { if (e.target.id === 'pt-sheet') closeSheet(); });
$('pt-logout').onclick = () => {
  // เพิกถอน token ที่ server ก่อนลบในเครื่อง (รอไม่เกิน 3 วินาที — ออฟไลน์ก็ออกจากระบบได้)
  const old = session;
  const clear = () => { if (session === old) _saveSession(null); };
  if (old) {
    Promise.race([sb.rpc('logout_session'), new Promise(r => setTimeout(r, 3000))])
      .then(res => { if (res?.error) console.warn('[portal] logout:', res.error.message); }, () => {})
      .finally(clear);
  }
  data = null; myData = null;
  $('pt-privacy').hidden = true;
  show('login');
};
$('pt-login-form').addEventListener('submit', e => {
  e.preventDefault();
  login($('pt-meter').value, $('pt-code').value);
});

initSelectPicker();

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
