// ─── จำนวนเงินเป็นตัวอักษรภาษาไทย ─────────────────────────────
// 350 → "สามร้อยห้าสิบบาทถ้วน", 1234.5 → "หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์"
// ──────────────────────────────────────────────────────────────

const DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

// อ่านเลขไม่เกิน 6 หลัก (0–999,999) — hasHigher: มีหลักล้านนำหน้า (1 ตัวท้ายอ่าน "เอ็ด")
function readGroup(n, hasHigher = false) {
  const s = String(n);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const d   = Number(s[i]);
    const pos = s.length - i - 1;
    if (d === 0) continue;
    if (pos === 0 && d === 1 && (s.length > 1 || hasHigher)) out += 'เอ็ด';
    else if (pos === 1 && d === 2) out += 'ยี่';
    else if (pos === 1 && d === 1) out += '';
    else out += DIGITS[d];
    out += PLACES[pos];
  }
  return out;
}

function readInteger(n) {
  if (n === 0) return 'ศูนย์';
  let out = '';
  const millions = Math.floor(n / 1e6);
  const rest     = n % 1e6;
  if (millions > 0) out += readInteger(millions) + 'ล้าน';
  if (rest > 0) out += readGroup(rest, millions > 0);
  return out;
}

export function bahtText(amount) {
  const value = Math.round(Math.abs(Number(amount) || 0) * 100);
  const baht  = Math.floor(value / 100);
  const satang = value % 100;
  let out = '';
  if (baht > 0 || satang === 0) out += readInteger(baht) + 'บาท';
  out += satang === 0 ? 'ถ้วน' : readInteger(satang) + 'สตางค์';
  return (Number(amount) < 0 ? 'ลบ' : '') + out;
}
