// ─── Database ↔ App Object Mappers ────────────────────────────
// Pure functions that translate between Supabase row format
// and the in-memory app object format used across all modules.
// ──────────────────────────────────────────────────────────────

import { fmtLocalDateTime, localToISO } from '../utils/time.util.js';
import { esc } from '../utils/dom.util.js';

// ─── Village Cache ───────────────────────────────────────────
export let _dbVillages = [];
export function _vId(name)  { return (_dbVillages.find(v => v.name === name) || {}).id   || null; }
export function _vName(id)  { return (_dbVillages.find(v => v.id   === id)   || {}).name || '';   }
export function setVillages(list) { _dbVillages.length = 0; list.forEach(v => _dbVillages.push(v)); }
/** <option> ของหมู่บ้านที่ใช้งาน — value เป็น id เสมอ (ห้ามใช้ชื่อเป็นตัวเชื่อม) */
export function villageOptions(selectedId = null, { all = false } = {}) {
  return [..._dbVillages]
    .filter(v => all || v.is_active !== false)
    .sort((a, b) => (a.moo_number || 0) - (b.moo_number || 0))
    .map(v => `<option value="${v.id}"${String(v.id) === String(selectedId) ? ' selected' : ''}>${v.moo_number ? `หมู่ ${v.moo_number} · ` : ''}${esc(v.name)}</option>`)
    .join('');
}

// ─── Thai Month Map ───────────────────────────────────────────
const _THAI_M = {
  'ม.ค.':1, 'ก.พ.':2, 'มี.ค.':3, 'เม.ย.':4, 'พ.ค.':5,  'มิ.ย.':6,
  'ก.ค.':7, 'ส.ค.':8, 'ก.ย.':9,  'ต.ค.':10, 'พ.ย.':11, 'ธ.ค.':12,
};
const _THAI_MO = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
/** ป้ายงวด → { year, month } — ป้ายผิดรูปแบบ throw (เดิมตกเป็น ม.ค. 2566 เงียบๆ ทำให้บิลผิดงวด) */
export function _periodYM(label) {
  const p = (label || '').trim().split(/\s+/);
  const year = parseInt(p[1]), month = _THAI_M[p[0]];
  if (!month || !(year > 2500)) throw new Error(`งวดไม่ถูกต้อง: "${label}"`);
  return { year, month };
}
/** (ปี พ.ศ., เดือน) → ป้ายงวด เช่น "ต.ค. 2569" — แบบเดียวกับที่ server สร้าง */
export function periodLabel(year, month) {
  return year && month ? `${_THAI_MO[month - 1]} ${year}` : '';
}
/** Convert ISO date string (YYYY-MM-DD) → Thai BE period label e.g. "มิ.ย. 2569" */
export function _dateToPeriod(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return _THAI_MO[d.getMonth()] + ' ' + (d.getFullYear() + 543);
}

// ─── Member ───────────────────────────────────────────────────
export function _mFromDB(r) {
  return {
    id:               r.id,
    firstName:        r.first_name,
    lastName:         r.last_name,
    // เลขบัตรเต็มไม่ส่งมาที่แอป (server เข้ารหัสไว้) — แสดงได้แค่ 4 ตัวท้าย
    nationalIdLast4:  r.national_id_last4  || '',
    houseNo:          r.house_no           || '',
    villageId:        r.village_id         ?? null,
    village:          _vName(r.village_id),
    memberType:       r.member_type        || 'residential',
    householdCount:   r.household_count    || 1,
    registrationDate: r.registration_date  || '',
    phone:            r.phone              || '',
    lineId:           r.line_id            || '',
    email:            r.email              || '',
    gpsLat:           r.gps_lat            || null,
    gpsLng:           r.gps_lng            || null,
    meter:            r.meter_no,
    meterSize:        r.meter_size === '1.0' ? '1' : (r.meter_size || '0.5'),   // ให้ตรงรหัสใน master_data
    meterBrand:       r.meter_brand        || '',
    meterInstallDate: r.meter_install_date || '',
    meterExpireDate:  r.meter_expire_date  || '',
    lastRead:         parseFloat(r.last_read) || 0,
    lastReadDate:     r.last_read_date     || '',
    status:           r.status             || 'normal',
    notes:            r.notes              || '',
    routeOrder:       r.route_order        ?? null,
  };
}
export function _mToDB(m) {
  const villageId = m.villageId ?? _vId(m.village);
  const row = {
    first_name:         m.firstName,
    last_name:          m.lastName,
    house_no:           m.houseNo           || '',
    member_type:        m.memberType        || 'residential',
    household_count:    m.householdCount    || 1,
    registration_date:  m.registrationDate  || null,
    phone:              m.phone             || null,
    line_id:            m.lineId            || null,
    email:              m.email             || null,
    gps_lat:            m.gpsLat            || null,
    gps_lng:            m.gpsLng            || null,
    meter_no:           m.meter,
    meter_size:         m.meterSize         || '0.5',
    meter_brand:        m.meterBrand        || null,
    meter_install_date: m.meterInstallDate  || null,
    meter_expire_date:  m.meterExpireDate   || null,
    status:             m.status            || 'normal',
    notes:              m.notes             || null,
  };
  if (villageId != null) row.village_id = villageId;
  // เลขบัตร: ส่งเฉพาะเมื่อกรอกใหม่ ('' = ลบ) — ไม่ส่ง = คงค่าเดิมที่ server
  if (m.nationalIdInput !== undefined) row.national_id = m.nationalIdInput;
  return row;
}

// ─── Bill ─────────────────────────────────────────────────────
export function _bFromDB(r) {
  return {
    id:            r.id,
    memberId:      r.member_id,
    period:        r.period_label,
    periodYear:    r.period_year,
    periodMonth:   r.period_month,
    issueDate:     r.issue_date,
    dueDate:       r.due_date,
    usage:         parseFloat(r.usage)          || 0,
    waterCharge:   parseFloat(r.water_charge)   || 0,
    serviceCharge: parseFloat(r.service_charge) || 0,
    lateFee:       parseFloat(r.late_fee)       || 0,
    discount:      parseFloat(r.discount)       || 0,
    total:         parseFloat(r.total)          || 0,
    status:        r.status   || 'pending',
    sentVia:       r.sent_via || 'none',
    issuedById:    r.issued_by || null,
    cancelReason:  r.cancel_reason || null,
    cancelledBy:   r.cancelled_by  || null,        // ชื่อผู้ยกเลิก ณ เวลานั้น (สำเนาเพื่อแสดง)
    cancelledById: r.cancelled_by_id || null,
    cancelledAt:   r.cancelled_at  ? fmtLocalDateTime(r.cancelled_at) : null,
  };
}
export function _bToDB(b) {
  const { year, month } = b.periodYear && b.periodMonth
    ? { year: b.periodYear, month: b.periodMonth } : _periodYM(b.period);
  return {
    id:             b.id,
    member_id:      b.memberId,
    period_year:    year,
    period_month:   month,
    period_label:   periodLabel(year, month),   // server สร้างใหม่จาก (ปี, เดือน) อยู่แล้ว
    issue_date:     b.issueDate,
    due_date:       b.dueDate,
    usage:          b.usage          || 0,
    water_charge:   b.waterCharge    || 0,
    service_charge: b.serviceCharge  || 0,
    late_fee:       b.lateFee        || 0,
    discount:       b.discount       || 0,
    // total is a GENERATED column — omit from inserts
    status:         b.status         || 'pending',
    sent_via:       b.sentVia        || 'none',
    cancel_reason:  b.cancelReason   || null,
    // ผู้ยกเลิก/เวลา server กำหนดจาก JWT
  };
}

// ─── Payment ──────────────────────────────────────────────────
export function _pFromDB(r) {
  return {
    id:           r.id,
    billId:       r.bill_id,
    memberId:     r.member_id,
    paidAt:       fmtLocalDateTime(r.paid_at),
    amount:       parseFloat(r.amount) || 0,
    channel:      r.channel,
    txRef:        r.tx_ref        || '',
    payerName:    r.payer_name    || '',
    slipPath:     r.slip_url      || null,
    receiptNo:    r.receipt_no    || null,
    status:       r.status,
    approvedBy:   r.approved_by   || null,
    approvedAt:   r.approved_at ? fmtLocalDateTime(r.approved_at) : null,
    rejectReason: r.reject_reason || null,
    createdBy:      r.created_by       || null,
    receivedByName: r.received_by_name || '',
    printCount:     r.print_count      || 0,
    cancelledAt:    r.cancelled_at ? fmtLocalDateTime(r.cancelled_at) : null,
    cancelledBy:    r.cancelled_by     || '',
    cancelledById:  r.cancelled_by_id  || null,
    cancelReason:   r.cancel_reason    || '',
  };
}
export function _pToDB(p) {
  return {
    id:            p.id,
    bill_id:       p.billId,
    member_id:     p.memberId,
    paid_at:       localToISO(p.paidAt),
    amount:        p.amount,
    channel:       p.channel,
    tx_ref:        p.txRef        || null,
    payer_name:    p.payerName    || null,
    slip_url:      p.slipPath     || null,
    // receipt_no — column not yet in DB; stored in memory/localStorage only.
    // After running the SQL migration, uncomment the line below:
    receipt_no: p.receiptNo || null,
    status:        p.status,
    approved_at:   localToISO(p.approvedAt),
    reject_reason: p.rejectReason || null,
  };
}

// ─── Meter Reading ────────────────────────────────────────────
// มิเตอร์วนรอบ: DB เก็บ prev_reading เลื่อนไป 1 รอบ (ติดลบ) ให้ usage = curr − prev ถูกต้อง
// แอปใช้เลขจริงเสมอ (prevReading = เลขบนหน้าปัดครั้งก่อน)
const _rollShift = r => (r.rollover ? Number(r.meter_max ?? r.meterMax) + 1 : 0);

export function _rFromDB(r) {
  return {
    id:            r.id,
    memberId:      r.member_id,
    meter:         r.meter_no,
    readingDate:   r.reading_date,
    periodYear:    r.period_year  ?? null,
    periodMonth:   r.period_month ?? null,
    period:        r.period_year ? periodLabel(r.period_year, r.period_month) : _dateToPeriod(r.reading_date),
    prevReading:   (parseFloat(r.prev_reading) || 0) + _rollShift(r),
    rollover:      !!r.rollover,
    meterMax:      r.meter_max ?? null,
    currReading:   parseFloat(r.curr_reading)   || 0,
    usage:         parseFloat(r.usage)          || 0,
    waterCharge:   parseFloat(r.water_charge)   || 0,
    serviceCharge: parseFloat(r.service_charge) || 0,
    total:        (parseFloat(r.water_charge) || 0) + (parseFloat(r.service_charge) || 0),
    readById:      r.read_by || null,
    method:        r.method  || 'manual',
    anomaly:       r.anomaly || null,
    billId:        r.bill_id || null,
    photoUrl:      r.photo_url || null,
  };
}
export function _rToDB(r) {
  return {
    id:             r.id,
    member_id:      r.memberId,
    meter_no:       r.meter,
    reading_date:   r.readingDate,
    prev_reading:   r.prevReading - _rollShift(r),
    // ส่งคอลัมน์วนรอบเฉพาะเมื่อวนรอบจริง — ฐานข้อมูลที่ยังไม่ได้รัน sql_phase4 ยังจดมิเตอร์ปกติได้
    ...(r.rollover ? { rollover: true, meter_max: r.meterMax } : {}),
    curr_reading:   r.currReading,
    // usage is GENERATED — omit from inserts
    water_charge:   r.waterCharge,
    service_charge: r.serviceCharge,
    method:         r.method  || 'manual',
    anomaly:        r.anomaly || null,
    bill_id:        r.billId  || null,
    photo_url:      r.photoUrl || null,
  };
}

// ─── Maintenance Job ──────────────────────────────────────────
export function _ntFromDB(r) {
  return {
    id:               r.id,
    type:             r.type,
    description:      r.description,
    location:         r.location       || '',
    villageId:        r.village_id     ?? null,
    reportedBy:       r.reported_by_type || 'staff',
    reportedMemberId: r.member_id       || null,
    reportedDate:     r.reported_date,
    assignedTo:       r.assigned_name  || '',        // ชื่อ (ผู้รับเหมาภายนอก หรือสำเนาชื่อเจ้าหน้าที่)
    assignedToId:     r.assigned_to    || null,
    startDate:        r.start_date     || null,
    completedDate:    r.completed_date || null,
    materials:        r.materials      || '',
    cost:             parseFloat(r.cost) || 0,
    status:           r.status,
    approvedBy:       r.approved_by    || null,
    photos:           r.photos         || [],
  };
}
export function _ntToDB(m) {
  return {
    id:               m.id || null,
    type:             m.type,
    description:      m.description,
    location:         m.location      || null,
    // หมู่บ้านเป็น id เสมอ — ไม่เดาจากข้อความสถานที่ (server เติมจากสมาชิกที่แจ้งถ้าไม่ระบุ)
    ...(m.villageId !== undefined ? { village_id: m.villageId } : {}),
    member_id:        m.reportedMemberId || null,
    reported_by_type: m.reportedBy    || 'staff',
    reported_date:    m.reportedDate,
    assigned_to:      m.assignedToId  || null,
    assigned_name:    m.assignedTo    || null,
    start_date:       m.startDate     || null,
    completed_date:   m.completedDate || null,
    materials:        m.materials     || null,
    cost:             m.cost          || 0,
    status:           m.status,
  };
}
