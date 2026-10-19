// ─── Accounting & Committee Reports ───────────────────────────
// รายงานที่คำนวณจาก server (sql_phase3_accounting.sql):
//   monthly  สรุปประจำเดือน (เสนอคณะกรรมการ)   cashbook สมุดเงินสด
//   aging    อายุลูกหนี้                         nrw      น้ำสูญเสีย
//   annual   สรุปประจำปี
// + บันทึกรายรับอื่น/รายจ่าย, บันทึกการผลิตน้ำ, พิมพ์ A4, Export Excel
// ──────────────────────────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc, toast } from '../../utils/dom.util.js';
import { todayISO, toLocalDate } from '../../utils/time.util.js';
import { _sb } from '../../services/supabase.service.js';
import { hasRole } from '../../services/auth.service.js';
import { uploadImage, signedImageUrl } from '../../services/files.service.js';
import { openModal, closeModal, busyButton } from '../../components/modal/modal.js';
import { beginPrint } from '../documents/print.js';
import { orgInfo, thaiDate } from '../documents/templates.js';

export const ACCT_REPORTS = {
  monthly:  { name: 'สรุปประจำเดือน',  desc: 'งบรายรับ-รายจ่าย เสนอกรรมการ', icon: 'ti-report-money',  bg: 'var(--blue-50)',  fg: 'var(--blue-900)' },
  cashbook: { name: 'สมุดเงินสด',       desc: 'รายรับ-รายจ่าย และยอดคงเหลือ',  icon: 'ti-book',          bg: 'var(--green-50)', fg: 'var(--green-700)' },
  aging:    { name: 'อายุลูกหนี้',      desc: 'ค้าง 0-30 / 31-60 / 61-90 / 90+ วัน', icon: 'ti-hourglass', bg: 'var(--red-50)',   fg: 'var(--red-700)' },
  nrw:      { name: 'น้ำสูญเสีย (NRW)', desc: 'น้ำผลิต vs น้ำที่ออกบิล',       icon: 'ti-droplet-off',   bg: 'var(--cyan-50)',  fg: 'var(--cyan-800)' },
  annual:   { name: 'สรุปประจำปี',      desc: 'ภาพรวม 12 เดือน',               icon: 'ti-calendar-stats', bg: 'var(--amber-50)', fg: 'var(--amber-700)' },
};

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const money = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num   = n => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });

export const canSeeFinance  = () => hasRole('super_admin', 'village_admin', 'finance');
const canRecordProduction = () => hasRole('super_admin', 'village_admin');

const now = new Date();
let _state = {
  year:  now.getFullYear() + 543,
  month: now.getMonth() + 1,
  from:  toLocalDate(new Date(now.getFullYear(), now.getMonth(), 1)),
  to:    todayISO(),
  data:  null,
  type:  null,
};

async function _rpc(fn, args) {
  const { data, error } = await _sb.rpc(fn, args);
  if (error) { toast(`⚠ ${error.message}`, 'error'); return null; }
  return data;
}

/** แสดงการ์ดรายงานบัญชีต่อท้ายการ์ดเดิมในหน้ารายงาน (เพิ่มครั้งเดียว) */
export function injectAccountingCards() {
  const grid = document.querySelector('#page-reports .report-grid');
  if (!grid || grid.querySelector('[data-report="monthly"]')) return;
  grid.insertAdjacentHTML('afterbegin', Object.entries(ACCT_REPORTS).map(([k, r]) => `
    <div class="rpt-card" data-report="${k}" onclick="switchReport('${k}')">
      <div class="rpt-icon" style="background:${r.bg};color:${r.fg}"><i class="ti ${r.icon}"></i></div>
      <div class="rpt-name">${r.name}</div><div class="rpt-desc">${r.desc}</div>
    </div>`).join(''));
}

// ─── Render into the report preview card ──────────────────────
export async function renderAccounting(type) {
  _state.type = type;
  const card = document.querySelector('#page-reports .card');
  if (!card) return;
  const title = card.querySelector('.card-title');
  if (title) title.innerHTML = `<i class="ti ${ACCT_REPORTS[type].icon}" style="color:var(--blue-500)"></i>${ACCT_REPORTS[type].name}`;
  card.querySelector('.tbl-wrap').style.display = 'none';
  card.querySelector('.tbl-footer').style.display = 'none';
  let view = card.querySelector('#acct-view');
  if (!view) { view = document.createElement('div'); view.id = 'acct-view'; card.appendChild(view); }
  view.style.display = '';

  if (!canSeeFinance()) {
    view.innerHTML = '<div style="padding:32px;text-align:center;color:var(--gray-500)">รายงานการเงินดูได้เฉพาะผู้ดูแลระบบและการเงิน</div>';
    return;
  }
  view.innerHTML = `<div class="acct-toolbar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;padding:12px 16px;border-bottom:1px solid var(--gray-100)">
      ${_filters(type)}
      <div style="flex:1"></div>
      ${type === 'cashbook' || type === 'monthly' ? `
        <button class="btn btn-secondary btn-sm" onclick="openCashbookEntry('income')"><i class="ti ti-plus"></i>รายรับอื่น</button>
        <button class="btn btn-secondary btn-sm" onclick="openCashbookEntry('expense')"><i class="ti ti-minus"></i>รายจ่าย</button>` : ''}
      ${type === 'nrw' && canRecordProduction() ? '<button class="btn btn-secondary btn-sm" onclick="openProductionEntry()"><i class="ti ti-droplet-plus"></i>บันทึกการผลิตน้ำ</button>' : ''}
      <button class="btn btn-secondary btn-sm" onclick="exportAccountingExcel()"><i class="ti ti-file-spreadsheet"></i>Excel</button>
      <button class="btn btn-primary btn-sm" onclick="printAccounting()"><i class="ti ti-printer"></i>พิมพ์</button>
    </div>
    <div id="acct-body" style="padding:16px"><div style="text-align:center;padding:24px;color:var(--gray-400)"><i class="ti ti-loader-2" style="animation:spin .8s linear infinite;font-size:22px"></i></div></div>`;
  view.querySelectorAll('[data-f]').forEach(el => el.addEventListener('change', () => {
    _state[el.dataset.f] = el.type === 'date' ? el.value : parseInt(el.value);
    _load();
  }));
  _load();
}

export function hideAccounting() {
  const card = document.querySelector('#page-reports .card');
  if (!card) return;
  const view = card.querySelector('#acct-view');
  if (view) view.style.display = 'none';
  card.querySelector('.tbl-wrap').style.display = '';
  card.querySelector('.tbl-footer').style.display = '';
}

function _filters(type) {
  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() + 543 - i);
  const ySel = `<label class="form-label" style="margin:0">ปี<select class="form-input" data-f="year" style="height:32px">${years.map(y => `<option${y === _state.year ? ' selected' : ''}>${y}</option>`).join('')}</select></label>`;
  const mSel = `<label class="form-label" style="margin:0">เดือน<select class="form-input" data-f="month" style="height:32px">${TH_MONTHS.map((m, i) => `<option value="${i + 1}"${i + 1 === _state.month ? ' selected' : ''}>${m}</option>`).join('')}</select></label>`;
  if (type === 'monthly') return mSel + ySel;
  if (type === 'annual' || type === 'nrw') return ySel;
  if (type === 'cashbook') return `
    <label class="form-label" style="margin:0">ตั้งแต่<input class="form-input" type="date" data-f="from" value="${_state.from}" style="height:32px"></label>
    <label class="form-label" style="margin:0">ถึง<input class="form-input" type="date" data-f="to" value="${_state.to}" max="${todayISO()}" style="height:32px"></label>`;
  return '';
}

async function _load() {
  const t = _state.type;
  const body = document.getElementById('acct-body');
  if (!body) return;
  let data = null;
  if (t === 'monthly')  data = await _rpc('report_monthly', { p_year: _state.year, p_month: _state.month });
  if (t === 'cashbook') data = await _rpc('report_cashbook', { p_from: _state.from, p_to: _state.to });
  if (t === 'aging')    data = await _rpc('report_aging', { p_as_of: null });
  if (t === 'annual' || t === 'nrw') data = await _rpc('report_annual', { p_year: _state.year });
  if (_state.type !== t || !document.getElementById('acct-body')) return;
  _state.data = data;
  if (!data) { body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--gray-500)">โหลดรายงานไม่ได้</div>'; return; }
  body.innerHTML = _reportHtml(t, data, false);
}

// ─── Report HTML (ใช้ทั้งบนจอและตอนพิมพ์) ────────────────────
function _table(head, rows, foot = null, numericFrom = 1) {
  const td = (v, i, tag = 'td') => `<${tag}${i >= numericFrom ? ' style="text-align:right"' : ''}>${v}</${tag}>`;
  return `<table class="acct-table lines bordered">
    <thead><tr class="head">${head.map((h, i) => td(h, i, 'th')).join('')}</tr></thead>
    <tbody>${rows.length ? rows.map(r => `<tr>${r.map((v, i) => td(v, i)).join('')}</tr>`).join('') : `<tr><td colspan="${head.length}" style="text-align:center;color:#888">ไม่มีข้อมูล</td></tr>`}</tbody>
    ${foot ? `<tfoot><tr class="total">${foot.map((v, i) => td(v, i)).join('')}</tr></tfoot>` : ''}
  </table>`;
}

function _reportHtml(t, d, forPrint) {
  const kpi = (label, value, color = '') => `<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-val" style="font-size:20px;${color}">${value}</div></div>`;
  const kpis = items => forPrint
    ? `<table class="kv">${items.map(([l, v]) => `<tr><th>${l}</th><td style="text-align:right"><b>${v}</b></td></tr>`).join('')}</table>`
    : `<div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:14px">${items.map(([l, v, c]) => kpi(l, v, c)).join('')}</div>`;

  if (t === 'monthly') {
    const b = d.billing, c = d.cash, w = d.water;
    const rate = Number(b.billed) ? (Number(b.paid) / Number(b.billed) * 100).toFixed(1) : '0.0';
    return `
      <h3 class="acct-h">1. การเรียกเก็บค่าน้ำ รอบ ${TH_MONTHS[d.month - 1]} ${d.year}</h3>
      ${kpis([['จำนวนบิล', num(b.bills)], ['หน่วยน้ำที่ออกบิล', num(b.usage) + ' ลบ.ม.'], ['ยอดเรียกเก็บ', '฿' + money(b.billed)],
              ['ชำระแล้ว', '฿' + money(b.paid), 'color:var(--green-700)'], ['คงค้าง', '฿' + money(b.outstanding), 'color:var(--red-700)'], ['อัตราการจัดเก็บ', rate + '%']])}
      <h3 class="acct-h">2. รายรับ-รายจ่าย (${thaiDate(d.from)} – ${thaiDate(d.to)})</h3>
      ${_table(['รายการ', 'รายรับ', 'รายจ่าย'], [
        ['<b>ยอดกองทุนยกมา</b>', money(c.opening), ''],
        ['รับชำระค่าน้ำ', money(c.water_income), ''],
        ...c.income_by_category.map(x => [esc(x.name || x.category), money(x.amount), '']),
        ...c.expense_by_category.map(x => [esc(x.name || x.category), '', money(x.amount)]),
      ], ['<b>ยอดกองทุนคงเหลือยกไป</b>', `<b>${money(c.closing)}</b>`, ''])}
      <h3 class="acct-h">3. น้ำประปา</h3>
      ${w ? kpis([['น้ำจ่ายเข้าระบบ', num(w.distributed) + ' ลบ.ม.'], ['น้ำที่ออกบิล', num(w.billed_usage) + ' ลบ.ม.'],
                  ['น้ำสูญเสีย', num(w.nrw) + ' ลบ.ม. (' + num(w.nrw_pct) + '%)', Number(w.nrw_pct) > 25 ? 'color:var(--red-700)' : '']])
          : '<p style="color:#888">ยังไม่ได้บันทึกการผลิตน้ำของเดือนนี้ (รายงานน้ำสูญเสีย → บันทึกการผลิตน้ำ)</p>'}
      <h3 class="acct-h">4. ผู้ใช้น้ำ</h3>
      ${kpis([['ผู้ใช้น้ำทั้งหมด', num(d.members.total) + ' ราย'], ['ผู้ใช้น้ำใหม่', num(d.members.new) + ' ราย'],
              ['ถูกระงับ', num(d.members.suspended) + ' ราย'], ['ลูกหนี้ค้างชำระ (ทุกงวด)', num(d.debtors.members) + ' ราย / ฿' + money(d.debtors.amount)]])}`;
  }

  if (t === 'cashbook') {
    const rows = d.rows.map(r => [thaiDate(r.date), esc(r.doc_no || '—'), esc(r.description),
      r.income ? money(r.income) : '', r.expense ? money(r.expense) : '', money(r.balance)]);
    const inc = d.rows.reduce((s, r) => s + Number(r.income), 0), exp = d.rows.reduce((s, r) => s + Number(r.expense), 0);
    const last = d.rows.length ? Number(d.rows.at(-1).balance) : Number(d.opening);
    return `${kpis([['ยอดยกมา', '฿' + money(d.opening)], ['รายรับ', '฿' + money(inc), 'color:var(--green-700)'],
                    ['รายจ่าย', '฿' + money(exp), 'color:var(--red-700)'], ['คงเหลือ', '฿' + money(last)]])}
      ${_table(['วันที่', 'เลขที่', 'รายการ', 'รายรับ', 'รายจ่าย', 'คงเหลือ'], rows,
               ['', '', '<b>รวม</b>', `<b>${money(inc)}</b>`, `<b>${money(exp)}</b>`, `<b>${money(last)}</b>`], 3)}
      ${forPrint ? '' : `<div style="font-size:12px;color:var(--gray-500);margin-top:8px">รายการค่าน้ำรวมเป็นยอดต่อวันจากใบเสร็จที่อนุมัติแล้ว ·
        <a href="#" onclick="openCashbookList();return false">ดู/ยกเลิกรายการรายรับอื่น-รายจ่าย</a></div>`}`;
  }

  if (t === 'aging') {
    const sum = k => d.reduce((s, r) => s + Number(r[k]), 0);
    return `${kpis([['ลูกหนี้', d.length + ' ราย'], ['0-30 วัน', '฿' + money(sum('d0_30'))], ['31-60 วัน', '฿' + money(sum('d31_60'))],
                    ['61-90 วัน', '฿' + money(sum('d61_90')), 'color:var(--amber-700)'], ['เกิน 90 วัน', '฿' + money(sum('d90_plus')), 'color:var(--red-700)']])}
      ${_table(['ผู้ใช้น้ำ', 'หมู่บ้าน', '0-30', '31-60', '61-90', '90+', 'รวม'],
        d.map(r => [`${esc(r.name)} <span style="color:#888">(${esc(r.house_no || '-')}${r.status === 'suspended' ? ' · ระงับ' : ''})</span>`, esc(r.village || ''),
                    money(r.d0_30), money(r.d31_60), money(r.d61_90), money(r.d90_plus), `<b>${money(r.total)}</b>`]),
        ['<b>รวม</b>', '', money(sum('d0_30')), money(sum('d31_60')), money(sum('d61_90')), money(sum('d90_plus')), `<b>${money(sum('total'))}</b>`], 2)}`;
  }

  if (t === 'nrw') {
    const rows = d.months.map(m => [TH_MONTHS[m.month - 1], m.produced != null ? num(m.produced) : '—', num(m.usage),
      m.produced != null ? num(Number(m.produced) - Number(m.usage)) : '—',
      m.nrw_pct != null ? `<b style="color:${Number(m.nrw_pct) > 25 ? 'var(--red-700)' : 'inherit'}">${num(m.nrw_pct)}%</b>` : '—']);
    const recorded = d.months.filter(m => m.produced != null);
    const avg = recorded.length ? recorded.reduce((s, m) => s + Number(m.nrw_pct), 0) / recorded.length : null;
    return `${kpis([['เดือนที่บันทึก', recorded.length + '/12'], ['น้ำสูญเสียเฉลี่ย', avg == null ? '—' : avg.toFixed(1) + '%', avg > 25 ? 'color:var(--red-700)' : ''],
                    ['เกณฑ์ที่ดี', 'ไม่เกิน 25%']])}
      ${_table(['เดือน', 'น้ำจ่ายเข้าระบบ (ลบ.ม.)', 'น้ำที่ออกบิล', 'น้ำสูญเสีย', '%'], rows)}
      ${forPrint ? '' : '<div style="font-size:12px;color:var(--gray-500);margin-top:8px">น้ำสูญเสียสูงบ่งชี้ท่อรั่ว มิเตอร์เสีย หรือการใช้น้ำที่ไม่ได้จดมิเตอร์</div>'}`;
  }

  if (t === 'annual') {
    const rows = d.months.map(m => [TH_MONTHS[m.month - 1], money(m.billed), money(m.water_income), money(m.other_income),
      money(m.expense), money(Number(m.water_income) + Number(m.other_income) - Number(m.expense)), num(m.usage)]);
    const s = k => d.months.reduce((a, m) => a + Number(m[k] || 0), 0);
    const net = s('water_income') + s('other_income') - s('expense');
    return `${kpis([['ยอดยกมาต้นปี', '฿' + money(d.opening)], ['รายรับทั้งปี', '฿' + money(s('water_income') + s('other_income')), 'color:var(--green-700)'],
                    ['รายจ่ายทั้งปี', '฿' + money(s('expense')), 'color:var(--red-700)'], ['คงเหลือสิ้นปี', '฿' + money(Number(d.opening) + net)]])}
      ${_table(['เดือน', 'เรียกเก็บ', 'รับค่าน้ำ', 'รายรับอื่น', 'รายจ่าย', 'สุทธิ', 'หน่วยน้ำ'], rows,
        ['<b>รวม</b>', money(s('billed')), money(s('water_income')), money(s('other_income')), money(s('expense')), `<b>${money(net)}</b>`, num(s('usage'))])}`;
  }
  return '';
}

// ─── Print / Excel ────────────────────────────────────────────
function _periodText() {
  const t = _state.type;
  if (t === 'monthly') return `ประจำเดือน${TH_MONTHS[_state.month - 1]} ${_state.year}`;
  if (t === 'cashbook') return `${thaiDate(_state.from, true)} – ${thaiDate(_state.to, true)}`;
  if (t === 'aging') return `ณ วันที่ ${thaiDate(todayISO(), true)}`;
  return `ปี ${_state.year}`;
}

export async function printAccounting() {
  if (!_state.data) { toast('ยังไม่มีข้อมูลรายงาน', 'warn'); return; }
  const org = orgInfo(appState.systemConfig);
  const job = beginPrint(ACCT_REPORTS[_state.type].name);
  const html = `
    <section class="doc letter report">
      <header class="doc-hd"><div class="org-name">${esc(org.name)}</div>
        ${org.address ? `<div class="org-sub">${esc(org.address)}</div>` : ''}
        <div class="doc-title">รายงาน${ACCT_REPORTS[_state.type].name}</div><div class="doc-subtitle">${esc(_periodText())}</div></header>
      <style>.report{font-size:13px}.acct-h{font-size:14px;margin:4mm 0 2mm}.acct-table{margin-bottom:3mm}.acct-table td,.acct-table th{font-size:12px}</style>
      ${_reportHtml(_state.type, _state.data, true)}
      <table class="signs"><tr>
        <td><div class="sign-line"></div>ผู้จัดทำ (เหรัญญิก)</td>
        <td><div class="sign-line"></div>ผู้ตรวจสอบ</td>
        <td><div class="sign-line"></div>${esc(org.signerTitle)}</td>
      </tr></table>
      <div class="note">พิมพ์เมื่อ ${thaiDate(todayISO(), true)}</div>
    </section>`;
  await job.print([html], 'letter');
}

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: reject });
    document.head.appendChild(s);
  });
}

export async function exportAccountingExcel() {
  if (!_state.data) { toast('ยังไม่มีข้อมูลรายงาน', 'warn'); return; }
  try {
    await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  } catch {
    toast('โหลดตัวสร้างไฟล์ Excel ไม่ได้ — ตรวจสอบอินเทอร์เน็ต', 'error');
    return;
  }
  const t = _state.type, d = _state.data;
  let aoa;
  if (t === 'monthly') {
    const c = d.cash;
    aoa = [['รายการ', 'รายรับ', 'รายจ่าย'], ['ยอดกองทุนยกมา', Number(c.opening), null], ['รับชำระค่าน้ำ', Number(c.water_income), null],
      ...c.income_by_category.map(x => [x.name || x.category, Number(x.amount), null]),
      ...c.expense_by_category.map(x => [x.name || x.category, null, Number(x.amount)]),
      ['ยอดกองทุนคงเหลือยกไป', Number(c.closing), null], [],
      ['บิล', d.billing.bills], ['ยอดเรียกเก็บ', Number(d.billing.billed)], ['ชำระแล้ว', Number(d.billing.paid)], ['คงค้าง', Number(d.billing.outstanding)]];
  } else if (t === 'cashbook') {
    aoa = [['วันที่', 'เลขที่', 'รายการ', 'รายรับ', 'รายจ่าย', 'คงเหลือ'], ['', '', 'ยอดยกมา', null, null, Number(d.opening)],
      ...d.rows.map(r => [r.date, r.doc_no || '', r.description, Number(r.income) || null, Number(r.expense) || null, Number(r.balance)])];
  } else if (t === 'aging') {
    aoa = [['ผู้ใช้น้ำ', 'บ้านเลขที่', 'หมู่บ้าน', 'มิเตอร์', 'โทร', '0-30', '31-60', '61-90', '90+', 'รวม'],
      ...d.map(r => [r.name, r.house_no, r.village, r.meter_no, r.phone, Number(r.d0_30), Number(r.d31_60), Number(r.d61_90), Number(r.d90_plus), Number(r.total)])];
  } else {
    aoa = [['เดือน', 'เรียกเก็บ', 'รับค่าน้ำ', 'รายรับอื่น', 'รายจ่าย', 'หน่วยน้ำออกบิล', 'น้ำจ่ายเข้าระบบ', 'น้ำสูญเสีย %'],
      ...d.months.map(m => [TH_MONTHS[m.month - 1], Number(m.billed), Number(m.water_income), Number(m.other_income), Number(m.expense),
                             Number(m.usage), m.produced == null ? null : Number(m.produced), m.nrw_pct == null ? null : Number(m.nrw_pct)])];
  }
  const XLSX = window.XLSX;
  const ws = XLSX.utils.aoa_to_sheet([[`${ACCT_REPORTS[t].name} ${_periodText()}`], [], ...aoa]);
  ws['!cols'] = aoa[0].map((_, i) => ({ wch: i === 0 || (t === 'cashbook' && i === 2) ? 32 : 14 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, ACCT_REPORTS[t].name.slice(0, 30));
  XLSX.writeFile(wb, `${t}-${todayISO()}.xlsx`);
}

// ─── Cashbook entry ───────────────────────────────────────────
export function openCashbookEntry(kind) {
  if (!canSeeFinance()) { toast('เฉพาะผู้ดูแลระบบ/การเงิน', 'error'); return; }
  const cats = (appState.masterData?.[`${kind}_category`] || []).filter(c => c.isActive !== false && c.is_active !== false);
  const isIncome = kind === 'income';
  openModal({
    id: 'cashbook-modal', title: isIncome ? 'บันทึกรายรับอื่น' : 'บันทึกรายจ่าย', icon: isIncome ? 'ti-cash' : 'ti-receipt-tax', width: 460,
    body: `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group"><label class="form-label" for="cb-date">วันที่</label>
          <input class="form-input" id="cb-date" type="date" value="${todayISO()}" max="${todayISO()}"/></div>
        <div class="form-group"><label class="form-label" for="cb-amount">จำนวนเงิน (บาท) *</label>
          <input class="form-input" id="cb-amount" type="number" min="0.01" step="0.01" inputmode="decimal"/></div>
      </div>
      <div class="form-group" style="margin-top:10px"><label class="form-label" for="cb-cat">หมวด</label>
        <select class="form-input" id="cb-cat">${cats.map(c => `<option value="${esc(c.code)}">${esc(c.nameTh || c.name_th || c.code)}</option>`).join('')
          || '<option value="other">อื่นๆ</option>'}</select></div>
      <div class="form-group" style="margin-top:10px"><label class="form-label" for="cb-desc">รายละเอียด *</label>
        <input class="form-input" id="cb-desc" placeholder="${isIncome ? 'เช่น ค่าแรกเข้าสมาชิกใหม่ นายสมชาย' : 'เช่น ค่าไฟฟ้าสูบน้ำ เดือน ต.ค.'}"/></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
        <div class="form-group"><label class="form-label" for="cb-payee">${isIncome ? 'รับจาก' : 'จ่ายให้'}</label><input class="form-input" id="cb-payee"/></div>
        <div class="form-group"><label class="form-label" for="cb-ref">เลขที่ใบเสร็จ/อ้างอิง</label><input class="form-input" id="cb-ref"/></div>
      </div>
      <button class="btn btn-secondary btn-sm" id="cb-file" style="margin-top:12px"><i class="ti ti-paperclip"></i><span>แนบรูปใบเสร็จ (ถ้ามี)</span></button>`,
    footer: `<button class="btn btn-secondary" data-close>ยกเลิก</button>
      <button class="btn btn-primary" id="cb-ok"><i class="ti ti-check"></i>บันทึก</button>`,
  });
  let file = null;
  document.getElementById('cb-file').onclick = () => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
    inp.onchange = () => { file = inp.files[0]; if (file) document.querySelector('#cb-file span').textContent = file.name; };
    inp.click();
  };
  document.getElementById('cb-ok').onclick = async (e) => {
    const amount = parseFloat(document.getElementById('cb-amount').value);
    const desc   = document.getElementById('cb-desc').value.trim();
    if (!(amount > 0)) { toast('กรุณากรอกจำนวนเงิน', 'error'); return; }
    if (!desc) { toast('กรุณาระบุรายละเอียด', 'error'); return; }
    const done = busyButton(e.currentTarget);
    let attachment = null;
    if (file) {
      const [y, m] = todayISO().split('-');
      attachment = await uploadImage('finance-docs', `${y}/${m}/${kind}-${Date.now()}.jpg`, file);
      if (!attachment) { done(); return; }
    }
    const row = await _rpc('cashbook_add', {
      p_kind: kind, p_date: document.getElementById('cb-date').value, p_category: document.getElementById('cb-cat').value,
      p_amount: amount, p_description: desc, p_payee: document.getElementById('cb-payee').value.trim(),
      p_ref: document.getElementById('cb-ref').value.trim(), p_attachment: attachment,
    });
    done();
    if (!row) return;
    closeModal('cashbook-modal');
    toast(`บันทึก ${row.doc_no} แล้ว`, 'success');
    if (_state.type) _load();
  };
}

export async function openCashbookList() {
  const { data, error } = await _sb.from('cashbook_entries').select('*')
    .gte('entry_date', _state.from).lte('entry_date', _state.to).order('entry_date', { ascending: false });
  if (error) { toast(error.message, 'error'); return; }
  const canVoid = hasRole('super_admin', 'finance');
  openModal({
    id: 'cashbook-list', title: 'รายการรายรับอื่น-รายจ่าย', icon: 'ti-list', width: 720,
    body: `<div class="tbl-wrap" style="max-height:60vh;overflow:auto"><table>
      <thead><tr><th>วันที่</th><th>เลขที่</th><th>รายการ</th><th style="text-align:right">จำนวน</th><th>โดย</th><th></th></tr></thead>
      <tbody>${(data || []).map(r => `<tr style="${r.voided_at ? 'opacity:.5;text-decoration:line-through' : ''}">
        <td>${thaiDate(r.entry_date)}</td><td class="mono" style="font-size:11px">${esc(r.doc_no)}</td>
        <td>${esc(r.description)}${r.payee ? ` <span style="color:var(--gray-500)">— ${esc(r.payee)}</span>` : ''}
          ${r.voided_at ? `<div style="font-size:11px;color:var(--red-700);text-decoration:none">ยกเลิก: ${esc(r.void_reason)} (${esc(r.voided_by || '')})</div>` : ''}</td>
        <td style="text-align:right;color:${r.kind === 'income' ? 'var(--green-700)' : 'var(--red-700)'}">${r.kind === 'income' ? '+' : '-'}${money(r.amount)}</td>
        <td style="font-size:11.5px">${esc(r.created_by_name || '')}</td>
        <td style="white-space:nowrap">${r.attachment ? `<button class="btn-icon" title="ดูเอกสาร" onclick="viewFinanceDoc('${esc(r.attachment)}')"><i class="ti ti-paperclip"></i></button>` : ''}
          ${canVoid && !r.voided_at ? `<button class="btn-icon" title="ยกเลิกรายการ" onclick="voidCashbookEntry(${r.id}, '${esc(r.doc_no)}')"><i class="ti ti-ban"></i></button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:20px">ไม่มีรายการในช่วงวันที่นี้</td></tr>'}</tbody></table></div>`,
  });
}

export async function viewFinanceDoc(path) {
  const url = await signedImageUrl('finance-docs', path);
  if (url) window.open(url, '_blank', 'noopener');
}

export function voidCashbookEntry(id, docNo) {
  const reason = prompt(`ยกเลิกรายการ ${docNo}\nระบุเหตุผล:`);
  if (reason === null) return;
  if (!reason.trim()) { toast('กรุณาระบุเหตุผล', 'error'); return; }
  _sb.rpc('cashbook_void', { p_id: id, p_reason: reason.trim() }).then(({ error }) => {
    if (error) { toast(`⚠ ${error.message}`, 'error'); return; }
    toast(`ยกเลิก ${docNo} แล้ว`, 'warn');
    closeModal('cashbook-list');
    _load();
  });
}

// ─── Water production entry ──────────────────────────────────
export function openProductionEntry() {
  const existing = (appState.waterProduction || []).find(r => +r.period_year === _state.year && +r.period_month === _state.month) || {};
  openModal({
    id: 'production-modal', title: 'บันทึกการผลิตน้ำประจำเดือน', icon: 'ti-droplet-plus', width: 460,
    body: `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group"><label class="form-label" for="wp-month">เดือน</label>
          <select class="form-input" id="wp-month">${TH_MONTHS.map((m, i) => `<option value="${i + 1}"${i + 1 === _state.month ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label" for="wp-year">ปี</label>
          <input class="form-input" id="wp-year" type="number" value="${_state.year}"/></div>
      </div>
      <div class="form-group" style="margin-top:10px"><label class="form-label" for="wp-raw">น้ำดิบที่สูบเข้า (ลบ.ม.)</label>
        <input class="form-input" id="wp-raw" type="number" min="0" step="0.01" value="${esc(existing.raw_water_in ?? '')}"/></div>
      <div class="form-group" style="margin-top:10px"><label class="form-label" for="wp-produced">น้ำที่ผลิตได้ (ลบ.ม.)</label>
        <input class="form-input" id="wp-produced" type="number" min="0" step="0.01" value="${esc(existing.water_produced ?? '')}"/></div>
      <div class="form-group" style="margin-top:10px"><label class="form-label" for="wp-dist">น้ำจ่ายเข้าระบบ — จากมิเตอร์หลัก (ลบ.ม.) *</label>
        <input class="form-input" id="wp-dist" type="number" min="0" step="0.01" value="${esc(existing.water_distributed ?? '')}"/></div>
      <div class="form-group" style="margin-top:10px"><label class="form-label" for="wp-notes">หมายเหตุ</label>
        <input class="form-input" id="wp-notes" value="${esc(existing.notes ?? '')}"/></div>
      <div style="font-size:11.5px;color:var(--gray-500);margin-top:10px">หน่วยน้ำที่ออกบิลของเดือนนั้นจะถูกดึงจากบิลอัตโนมัติ เพื่อคำนวณน้ำสูญเสีย</div>`,
    footer: `<button class="btn btn-secondary" data-close>ยกเลิก</button>
      <button class="btn btn-primary" id="wp-ok"><i class="ti ti-check"></i>บันทึก</button>`,
  });
  document.getElementById('wp-ok').onclick = async (e) => {
    const val = id => { const v = document.getElementById(id).value; return v === '' ? null : parseFloat(v); };
    if (!(val('wp-dist') > 0)) { toast('กรุณากรอกปริมาณน้ำจ่ายเข้าระบบ', 'error'); return; }
    const done = busyButton(e.currentTarget);
    const row = await _rpc('save_water_production', {
      p_year: parseInt(document.getElementById('wp-year').value), p_month: parseInt(document.getElementById('wp-month').value),
      p_raw: val('wp-raw'), p_produced: val('wp-produced'), p_distributed: val('wp-dist'),
      p_notes: document.getElementById('wp-notes').value.trim(),
    });
    done();
    if (!row) return;
    const list = appState.waterProduction || (appState.waterProduction = []);
    const i = list.findIndex(r => r.id === row.id);
    if (i >= 0) list[i] = row; else list.unshift(row);
    closeModal('production-modal');
    toast(`บันทึกแล้ว — น้ำสูญเสีย ${row.nrw_pct}%`, Number(row.nrw_pct) > 25 ? 'warn' : 'success');
    window.renderDashboard?.();
    if (_state.type) _load();
  };
}

Object.assign(window, {
  openCashbookEntry, openCashbookList, voidCashbookEntry, viewFinanceDoc,
  openProductionEntry, printAccounting, exportAccountingExcel,
});
