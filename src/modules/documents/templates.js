// ─── Document Templates ───────────────────────────────────────
// HTML ของเอกสารสำหรับพิมพ์ — ฟังก์ชันล้วน รับข้อมูล คืน HTML string
// CSS อยู่ใน print.js (ปรับตามขนาดกระดาษ: thermal58 / thermal80 / a5 / a4)
// ──────────────────────────────────────────────────────────────
import { esc } from '../../utils/dom.util.js';
import { bahtText } from '../../utils/thai-baht.js';
import { promptPaySvg } from '../../utils/promptpay.js';

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

const CHANNEL_LABEL = { cash: 'เงินสด', promptpay: 'พร้อมเพย์', bank: 'โอนธนาคาร', mobile: 'Mobile Banking', line_pay: 'LINE Pay' };

/** 'YYYY-MM-DD' หรือ 'YYYY-MM-DD HH:mm' → '20 ต.ค. 2569' (long: '20 ตุลาคม 2569') */
export function thaiDate(value, long = false) {
  if (!value) return '—';
  const [y, m, d] = String(value).substring(0, 10).split('-').map(Number);
  if (!y || !m || !d) return esc(value);
  return `${d} ${(long ? TH_MONTHS : TH_MONTHS_SHORT)[m - 1]} ${y + 543}`;
}

const money = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ข้อมูลหน่วยงานจาก system_config */
export function orgInfo(cfg = {}) {
  return {
    name:        cfg.org_name     || 'กิจการประปาหมู่บ้าน',
    address:     cfg.org_address  || '',
    phone:       cfg.org_phone    || '',
    taxId:       cfg.org_tax_id   || '',
    signerName:  cfg.org_signer_name  || '',
    signerTitle: cfg.org_signer_title || 'ประธานคณะกรรมการบริหารกิจการประปาหมู่บ้าน',
    promptpayId:   cfg.promptpay_id   || '',
    promptpayName: cfg.promptpay_name || '',
    bankInfo:      cfg.bank_info      || '',
    footer:        cfg.receipt_footer || '',
    reconnectFee:  Number(cfg.reconnect_fee || 0),
  };
}

function orgHeader(org, title, subtitle = '') {
  return `
    <header class="doc-hd">
      <div class="org-name">${esc(org.name)}</div>
      ${org.address ? `<div class="org-sub">${esc(org.address)}</div>` : ''}
      ${org.phone || org.taxId ? `<div class="org-sub">${org.phone ? 'โทร ' + esc(org.phone) : ''}${org.phone && org.taxId ? ' · ' : ''}${org.taxId ? 'เลขประจำตัวผู้เสียภาษี ' + esc(org.taxId) : ''}</div>` : ''}
      <div class="doc-title">${esc(title)}</div>
      ${subtitle ? `<div class="doc-subtitle">${subtitle}</div>` : ''}
    </header>`;
}

function memberBlock(member) {
  const m = member || {};
  return `
    <div class="box member">
      <div class="member-name">${esc(`${m.firstName || ''} ${m.lastName || ''}`.trim() || '—')}</div>
      <div>บ้านเลขที่ ${esc(m.houseNo || '—')} ${esc(m.village || '')}</div>
      <div>เลขมิเตอร์ <span class="mono">${esc(m.meter || '—')}</span> · รหัสสมาชิก <span class="mono">${esc(m.id || '—')}</span></div>
    </div>`;
}

function chargeRows(bill, adjustments) {
  const rows = [
    [`ค่าน้ำประปา (${Number(bill.usage || 0).toLocaleString()} ลบ.ม.)`, bill.waterCharge],
    ['ค่าบริการรายเดือน', bill.serviceCharge],
  ];
  if (bill.lateFee) rows.push(['ค่าปรับชำระล่าช้า', bill.lateFee]);
  if (adjustments?.length) {
    adjustments.forEach(a => rows.push([`${a.amount < 0 ? 'ลดหนี้' : 'เพิ่มหนี้'} ${a.docNo} (${a.reason})`, a.amount]));
  } else if (bill.discount) {
    rows.push(['ส่วนลด', -bill.discount]);
  }
  return rows.map(([label, amt]) => `
    <tr><td>${esc(label)}</td><td class="num">${Number(amt) < 0 ? '-' : ''}${money(Math.abs(amt))}</td></tr>`).join('');
}

function meterBlock(reading, bill) {
  if (!reading) return '';
  return `
    <table class="meter"><tr>
      <td><div class="lbl">เลขครั้งก่อน</div><div class="val mono">${Number(reading.prevReading).toLocaleString()}</div></td>
      <td><div class="lbl">เลขครั้งนี้</div><div class="val mono">${Number(reading.currReading).toLocaleString()}</div></td>
      <td><div class="lbl">ใช้น้ำ (ลบ.ม.)</div><div class="val">${Number(bill.usage || 0).toLocaleString()}</div></td>
    </tr></table>`;
}

function payBlock(org, amount) {
  const qr = org.promptpayId ? promptPaySvg(org.promptpayId, amount, 150) : '';
  if (!qr && !org.bankInfo) return '';
  return `
    <div class="pay">
      ${qr ? `<div class="qr">${qr}<div class="qr-cap">สแกนจ่ายด้วยแอปธนาคาร<br><b>พร้อมเพย์ ${esc(org.promptpayName || '')}</b></div></div>` : ''}
      ${org.bankInfo ? `<div class="bank">${esc(org.bankInfo).replace(/\n/g, '<br>')}</div>` : ''}
    </div>`;
}

// ─── ใบแจ้งค่าน้ำ ─────────────────────────────────────────────
export function invoiceHtml({ bill, member, reading, adjustments, otherUnpaid = [], org }) {
  const prevDebt = otherUnpaid.reduce((s, b) => s + Number(b.total || 0), 0);
  return `
  <section class="doc invoice">
    ${orgHeader(org, 'ใบแจ้งค่าน้ำประปา', `รอบบิล ${esc(bill.period)}`)}
    <table class="kv">
      <tr><th>เลขที่</th><td class="mono">${esc(bill.id)}</td><th>วันที่ออก</th><td>${thaiDate(bill.issueDate)}</td></tr>
      <tr><th>กำหนดชำระ</th><td colspan="3"><b>${thaiDate(bill.dueDate)}</b></td></tr>
    </table>
    ${memberBlock(member)}
    ${meterBlock(reading, bill)}
    <table class="lines">${chargeRows(bill, adjustments)}
      <tr class="total"><td>ยอดที่ต้องชำระงวดนี้</td><td class="num">${money(bill.total)}</td></tr>
    </table>
    <div class="words">(${bahtText(bill.total)})</div>
    ${prevDebt > 0 ? `
      <div class="box warn">มียอดค้างชำระงวดก่อน ${otherUnpaid.length} งวด รวม <b>${money(prevDebt)}</b> บาท
      (${otherUnpaid.map(b => esc(b.period)).join(', ')}) — กรุณาชำระพร้อมกัน</div>` : ''}
    ${payBlock(org, bill.total)}
    <div class="note">ชำระเกินกำหนดมีค่าปรับ · เก็บใบแจ้งนี้ไว้เป็นหลักฐาน${org.phone ? ` · สอบถาม ${esc(org.phone)}` : ''}</div>
    ${org.footer ? `<div class="note">${esc(org.footer)}</div>` : ''}
  </section>`;
}

// ─── ใบเสร็จรับเงิน ────────────────────────────────────────────
export function receiptHtml({ bill, payment, member, reading, adjustments, org, printNo = 1 }) {
  const cancelled = payment.status === 'cancelled' || payment.status === 'rejected';
  const copyLabel = cancelled ? 'ยกเลิก' : printNo <= 1 ? 'ต้นฉบับ' : `สำเนา (พิมพ์ครั้งที่ ${printNo})`;
  return `
  <section class="doc receipt${cancelled ? ' is-cancelled' : ''}">
    ${cancelled ? '<div class="watermark">ยกเลิก</div>' : ''}
    ${orgHeader(org, 'ใบเสร็จรับเงิน', `<span class="badge${printNo > 1 || cancelled ? ' badge-copy' : ''}">${esc(copyLabel)}</span>`)}
    <table class="kv">
      <tr><th>เลขที่</th><td class="mono">${esc(payment.receiptNo || '—')}</td><th>วันที่</th><td>${thaiDate(payment.paidAt)}</td></tr>
      <tr><th>อ้างอิงบิล</th><td class="mono">${esc(bill.id)}</td><th>รอบบิล</th><td>${esc(bill.period)}</td></tr>
    </table>
    ${memberBlock(member)}
    ${meterBlock(reading, bill)}
    <table class="lines">${chargeRows(bill, adjustments)}
      <tr class="total"><td>รับเงินรวม</td><td class="num">${money(payment.amount)}</td></tr>
    </table>
    <div class="words">(${bahtText(payment.amount)})</div>
    <table class="kv">
      <tr><th>ชำระโดย</th><td>${esc(CHANNEL_LABEL[payment.channel] || payment.channel)}${payment.txRef ? ` <span class="mono">${esc(payment.txRef)}</span>` : ''}</td></tr>
    </table>
    ${cancelled ? `<div class="box warn">ใบเสร็จนี้ถูกยกเลิก${payment.cancelledAt ? ` เมื่อ ${thaiDate(payment.cancelledAt)}` : ''}${payment.cancelledBy ? ` โดย ${esc(payment.cancelledBy)}` : ''}</div>` : ''}
    <div class="sign">
      <div class="sign-line"></div>
      <div>ผู้รับเงิน ${payment.receivedByName ? `(${esc(payment.receivedByName)})` : ''}</div>
    </div>
    ${org.footer ? `<div class="note">${esc(org.footer)}</div>` : ''}
  </section>`;
}

// ─── หนังสือแจ้ง (A4) ─────────────────────────────────────────
const NOTICE_TEXT = {
  reminder1: {
    title: 'แจ้งเตือนการค้างชำระค่าน้ำประปา (ครั้งที่ 1)',
    body: (days) => `ตามที่ท่านเป็นผู้ใช้น้ำประปาหมู่บ้าน ปรากฏว่ายังมียอดค้างชำระค่าน้ำประปาตามรายการด้านล่าง
      จึงขอความร่วมมือให้ท่านชำระภายใน <b>${days} วัน</b> นับจากวันที่ในหนังสือนี้ หากท่านชำระแล้ว ขออภัยมา ณ ที่นี้`,
  },
  reminder2: {
    title: 'แจ้งเตือนการค้างชำระค่าน้ำประปา (ครั้งที่ 2)',
    body: (days) => `ตามที่ได้แจ้งเตือนการค้างชำระไปแล้วนั้น ปัจจุบันท่านยังมียอดค้างชำระตามรายการด้านล่าง
      ขอให้ชำระภายใน <b>${days} วัน</b> นับจากวันที่ในหนังสือนี้ <b>หากพ้นกำหนด คณะกรรมการมีความจำเป็นต้องงดจ่ายน้ำประปาชั่วคราว</b>
      ตามระเบียบการใช้น้ำประปาหมู่บ้าน`,
  },
  disconnect: {
    title: 'แจ้งงดจ่ายน้ำประปาชั่วคราว',
    body: (days, fee) => `เนื่องจากท่านค้างชำระค่าน้ำประปาตามรายการด้านล่าง และไม่ได้ชำระภายในกำหนดตามหนังสือแจ้งเตือน
      คณะกรรมการจึงมีความจำเป็นต้อง <b>งดจ่ายน้ำประปาชั่วคราวภายใน ${days} วัน</b> นับจากวันที่ในหนังสือนี้
      เมื่อท่านชำระยอดค้างครบถ้วน${fee > 0 ? ` พร้อมค่าธรรมเนียมการต่อน้ำใหม่ ${money(fee)} บาท` : ''} จะดำเนินการจ่ายน้ำให้ตามปกติ`,
  },
};

export function noticeHtml({ kind, member, bills, org, date, days = 7, refNo = '' }) {
  const t = NOTICE_TEXT[kind] || NOTICE_TEXT.reminder1;
  const total = bills.reduce((s, b) => s + Number(b.total || 0), 0);
  return `
  <section class="doc letter">
    ${orgHeader(org, '')}
    <table class="letter-meta">
      <tr><td>${refNo ? `ที่ ${esc(refNo)}` : ''}</td><td class="right">วันที่ ${thaiDate(date, true)}</td></tr>
    </table>
    <p><b>เรื่อง</b> ${esc(t.title)}</p>
    <p><b>เรียน</b> ${esc(`${member.firstName || ''} ${member.lastName || ''}`.trim())}
       บ้านเลขที่ ${esc(member.houseNo || '—')} ${esc(member.village || '')} (มิเตอร์ ${esc(member.meter || '—')})</p>
    <p class="indent">${t.body(days, org.reconnectFee)}</p>
    <table class="lines bordered">
      <tr class="head"><td>รอบบิล</td><td>เลขที่บิล</td><td>ครบกำหนด</td><td class="num">จำนวนเงิน (บาท)</td></tr>
      ${bills.map(b => `<tr><td>${esc(b.period)}</td><td class="mono">${esc(b.id)}</td><td>${thaiDate(b.dueDate)}</td><td class="num">${money(b.total)}</td></tr>`).join('')}
      <tr class="total"><td colspan="3">รวมยอดค้างชำระ</td><td class="num">${money(total)}</td></tr>
    </table>
    <div class="words">(${bahtText(total)})</div>
    ${payBlock(org, total)}
    <p class="indent">จึงเรียนมาเพื่อโปรดทราบและดำเนินการ${org.phone ? ` หากมีข้อสงสัยติดต่อ ${esc(org.phone)}` : ''}</p>
    <div class="sign right-sign">
      <div>ขอแสดงความนับถือ</div>
      <div class="sign-line"></div>
      <div>${org.signerName ? `(${esc(org.signerName)})` : '(.......................................)'}</div>
      <div>${esc(org.signerTitle)}</div>
    </div>
  </section>`;
}

// ─── ใบนำส่งเงินประจำวัน (A4) ──────────────────────────────────
export function remittanceHtml({ summary, closing, org }) {
  const c = closing || {};
  const rows = (summary.payments || []).map((p, i) => `
    <tr><td>${i + 1}</td><td class="mono">${esc(p.receipt_no || '—')}</td><td>${esc(p.member || '')} ${esc(p.house_no ? '(' + p.house_no + ')' : '')}</td>
        <td>${esc(CHANNEL_LABEL[p.channel] || p.channel)}</td><td class="num">${money(p.amount)}</td></tr>`).join('');
  return `
  <section class="doc letter remittance">
    ${orgHeader(org, 'ใบนำส่งเงินประจำวัน', c.doc_no ? `เลขที่ <span class="mono">${esc(c.doc_no)}</span>` : '<span class="badge badge-copy">ยังไม่ปิดยอด</span>')}
    <table class="kv">
      <tr><th>วันที่รับเงิน</th><td>${thaiDate(summary.date, true)}</td><th>ผู้รับเงิน</th><td>${esc(summary.cashier_name || '—')}</td></tr>
    </table>
    <table class="lines bordered">
      <tr class="head"><td>#</td><td>เลขที่ใบเสร็จ</td><td>ผู้ชำระ</td><td>ช่องทาง</td><td class="num">จำนวนเงิน</td></tr>
      ${rows || '<tr><td colspan="5" class="center">ไม่มีรายการ</td></tr>'}
    </table>
    <table class="lines summary">
      <tr><td>เงินสดตามระบบ (${summary.cash_count} รายการ)</td><td class="num">${money(summary.cash_total)}</td></tr>
      <tr><td>เงินโอน/พร้อมเพย์ (${summary.transfer_count} รายการ — เข้าบัญชีโดยตรง)</td><td class="num">${money(summary.transfer_total)}</td></tr>
      ${closing ? `
      <tr class="total"><td>เงินสดที่นับได้และนำส่ง</td><td class="num">${money(c.counted_cash)}</td></tr>
      <tr><td>ผลต่าง</td><td class="num">${Number(c.diff) > 0 ? '+' : ''}${money(c.diff)}</td></tr>` : ''}
    </table>
    ${closing ? `<div class="words">(เงินสดนำส่ง ${bahtText(c.counted_cash)})</div>` : ''}
    ${c.note ? `<div class="box">หมายเหตุ: ${esc(c.note)}</div>` : ''}
    <table class="signs"><tr>
      <td><div class="sign-line"></div>ผู้นำส่งเงิน<br>(${esc(summary.cashier_name || '')})</td>
      <td><div class="sign-line"></div>ผู้รับเงิน (เหรัญญิก)</td>
      <td><div class="sign-line"></div>ผู้ตรวจสอบ</td>
    </tr></table>
  </section>`;
}
