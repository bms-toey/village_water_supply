// ─── PromptPay QR (Thai QR Payment, EMVCo) ─────────────────────
// สร้าง payload สำหรับ QR พร้อมเพย์ที่ระบุยอดเงิน — แอปธนาคารทุกแห่งสแกนได้
// ไม่ต้องใช้ API ธนาคาร (เงินเข้าบัญชีพร้อมเพย์ของกองทุนโดยตรง)
// ไม่ import อะไร — ใช้ได้ทั้งในแอปและในหน้าพิมพ์
// ──────────────────────────────────────────────────────────────

const AID_PROMPTPAY = 'A000000677010111';

const tlv = (id, value) => id + String(value.length).padStart(2, '0') + value;

/** CRC16-CCITT (poly 0x1021, init 0xFFFF) ตามมาตรฐาน EMVCo */
function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * แปลงพร้อมเพย์ไอดีเป็น sub-tag ของ tag 29
 * เบอร์มือถือ 10 หลัก → 01 + 0066xxxxxxxxx, เลขบัตรประชาชน/นิติบุคคล 13 หลัก → 02,
 * e-Wallet 15 หลัก → 03
 * @returns {string|null} null ถ้ารูปแบบไม่ถูกต้อง
 */
function accountTag(id) {
  const digits = String(id || '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) return tlv('01', '0066' + digits.slice(1));
  if (digits.length === 13) return tlv('02', digits);
  if (digits.length === 15) return tlv('03', digits);
  return null;
}

/** พร้อมเพย์ไอดีรูปแบบถูกต้องหรือไม่ */
export function isValidPromptPayId(id) {
  return accountTag(id) !== null;
}

/**
 * @param {string} id      เบอร์มือถือ / เลขประจำตัวผู้เสียภาษี / e-Wallet ID
 * @param {number} [amount] ยอดเงิน (ไม่ระบุ = QR ให้ผู้จ่ายกรอกยอดเอง)
 * @returns {string|null}
 */
export function promptPayPayload(id, amount) {
  const acc = accountTag(id);
  if (!acc) return null;
  const hasAmount = Number(amount) > 0;
  const body =
    tlv('00', '01') +
    tlv('01', hasAmount ? '12' : '11') +
    tlv('29', tlv('00', AID_PROMPTPAY) + acc) +
    tlv('58', 'TH') +
    tlv('53', '764') +
    (hasAmount ? tlv('54', Number(amount).toFixed(2)) : '') +
    '6304';
  return body + crc16(body);
}

/**
 * SVG ของ QR สำหรับข้อความใดๆ (ต้องโหลด qrcode-generator จาก CDN แล้ว)
 * @returns {string} SVG markup หรือข้อความว่างถ้าสร้างไม่ได้
 */
export function qrSvg(text, sizePx = 160, label = 'QR code') {
  if (!text || typeof window === 'undefined' || typeof window.qrcode !== 'function') return '';
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
    .replace('<svg ', `<svg width="${sizePx}" height="${sizePx}" role="img" aria-label="${label}" `);
}

/** SVG ของ QR พร้อมเพย์ระบุยอด */
export function promptPaySvg(id, amount, sizePx = 160) {
  return qrSvg(promptPayPayload(id, amount), sizePx, 'QR พร้อมเพย์');
}
