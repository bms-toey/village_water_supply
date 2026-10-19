// ─── Local Time Helpers ────────────────────────────────────────
// ใช้เวลาท้องถิ่นของเครื่อง (ไทย) เสมอ — toISOString() เป็น UTC จะทำให้
// รายการช่วง 00:00–07:00 ได้วันที่ของเมื่อวาน
//
// รูปแบบในแอป:  วันที่ 'YYYY-MM-DD', วันเวลา 'YYYY-MM-DD HH:mm' (เวลาท้องถิ่น)
// รูปแบบในฐานข้อมูล: date = 'YYYY-MM-DD', timestamptz = ISO มีโซนเวลา
// ไม่ import อะไร — ใช้ได้จากทุก module รวมถึง db-mapper
// ──────────────────────────────────────────────────────────────

const pad = n => String(n).padStart(2, '0');

/** Date → 'YYYY-MM-DD' ตามเวลาท้องถิ่น */
export function toLocalDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** วันนี้ 'YYYY-MM-DD' (เวลาท้องถิ่น) */
export function todayISO() {
  return toLocalDate(new Date());
}

/** วันนี้ + n วัน 'YYYY-MM-DD' */
export function addDaysISO(days, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
}

/** ตอนนี้ 'YYYY-MM-DD HH:mm' (เวลาท้องถิ่น) — รูปแบบที่แอปใช้แสดงผล */
export function nowLocal() {
  const d = new Date();
  return `${toLocalDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** timestamptz จากฐานข้อมูล → 'YYYY-MM-DD HH:mm' เวลาท้องถิ่น */
export function fmtLocalDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts).replace('T', ' ').substring(0, 16);
  return `${toLocalDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 'YYYY-MM-DD HH:mm' (เวลาท้องถิ่น) → ISO มีโซนเวลา สำหรับบันทึกลงฐานข้อมูล */
export function localToISO(local) {
  if (!local) return null;
  const d = new Date(String(local).replace(' ', 'T'));
  return isNaN(d.getTime()) ? local : d.toISOString();
}
