// ─── Database ↔ App Object Mappers ────────────────────────────
// Pure functions that translate between Supabase row format
// and the in-memory app object format used across all modules.
// ──────────────────────────────────────────────────────────────

// ─── Village Cache ───────────────────────────────────────────
export let _dbVillages = [];
export function _vId(name)  { return (_dbVillages.find(v => v.name === name) || {}).id   || null; }
export function _vName(id)  { return (_dbVillages.find(v => v.id   === id)   || {}).name || '';   }
export function setVillages(list) { _dbVillages.length = 0; list.forEach(v => _dbVillages.push(v)); }

// ─── Thai Month Map ───────────────────────────────────────────
const _THAI_M = {
  'ม.ค.':1, 'ก.พ.':2, 'มี.ค.':3, 'เม.ย.':4, 'พ.ค.':5,  'มิ.ย.':6,
  'ก.ค.':7, 'ส.ค.':8, 'ก.ย.':9,  'ต.ค.':10, 'พ.ย.':11, 'ธ.ค.':12,
};
const _THAI_MO = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
export function _periodYM(label) {
  const p = (label || '').trim().split(' ');
  return { year: parseInt(p[1]) || 2566, month: _THAI_M[p[0]] || 1 };
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
    nationalId:       r.national_id        || '',
    houseNo:          r.house_no           || '',
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
    meterSize:        r.meter_size         || '0.5',
    meterBrand:       r.meter_brand        || '',
    meterInstallDate: r.meter_install_date || '',
    meterExpireDate:  r.meter_expire_date  || '',
    lastRead:         parseFloat(r.last_read) || 0,
    lastReadDate:     r.last_read_date     || '',
    status:           r.status             || 'normal',
    notes:            r.notes              || '',
  };
}
export function _mToDB(m) {
  const villageId = _vId(m.village);
  const row = {
    first_name:         m.firstName,
    last_name:          m.lastName,
    national_id:        m.nationalId        || null,
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
  // Only include village_id when resolved — avoids NOT NULL violation
  // when village name doesn't match _dbVillages yet
  if (villageId !== null) row.village_id = villageId;
  return row;
}

// ─── Bill ─────────────────────────────────────────────────────
export function _bFromDB(r) {
  return {
    id:            r.id,
    memberId:      r.member_id,
    period:        r.period_label,
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
    issuedBy:      'admin',
    cancelReason:  r.cancel_reason || null,
    cancelledBy:   r.cancelled_by  || null,
    cancelledAt:   r.cancelled_at  ? r.cancelled_at.substring(0, 16).replace('T', ' ') : null,
  };
}
export function _bToDB(b) {
  const { year, month } = _periodYM(b.period);
  return {
    id:             b.id,
    member_id:      b.memberId,
    period_year:    year,
    period_month:   month,
    period_label:   b.period,
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
    cancelled_by:   b.cancelledBy    || null,
    cancelled_at:   b.cancelledAt    || null,
  };
}

// ─── Payment ──────────────────────────────────────────────────
export function _pFromDB(r) {
  return {
    id:           r.id,
    billId:       r.bill_id,
    memberId:     r.member_id,
    paidAt:       (r.paid_at || '').replace('T', ' ').substring(0, 16),
    amount:       parseFloat(r.amount) || 0,
    channel:      r.channel,
    txRef:        r.tx_ref        || '',
    payerName:    r.payer_name    || '',
    slipPath:     r.slip_url      || null,
    receiptNo:    r.receipt_no    || null,
    status:       r.status,
    approvedBy:   r.approved_by   || null,
    approvedAt:   r.approved_at ? r.approved_at.replace('T', ' ').substring(0, 16) : null,
    rejectReason: r.reject_reason || null,
  };
}
export function _pToDB(p) {
  return {
    id:            p.id,
    bill_id:       p.billId,
    member_id:     p.memberId,
    paid_at:       p.paidAt,
    amount:        p.amount,
    channel:       p.channel,
    tx_ref:        p.txRef        || null,
    payer_name:    p.payerName    || null,
    slip_url:      p.slipPath     || null,
    // receipt_no — column not yet in DB; stored in memory/localStorage only.
    // After running the SQL migration, uncomment the line below:
    receipt_no: p.receiptNo || null,
    status:        p.status,
    approved_at:   p.approvedAt   || null,
    reject_reason: p.rejectReason || null,
  };
}

// ─── Meter Reading ────────────────────────────────────────────
export function _rFromDB(r) {
  return {
    id:            r.id,
    memberId:      r.member_id,
    meter:         r.meter_no,
    readingDate:   r.reading_date,
    period:        _dateToPeriod(r.reading_date),
    prevReading:   parseFloat(r.prev_reading)   || 0,
    currReading:   parseFloat(r.curr_reading)   || 0,
    usage:         parseFloat(r.usage)          || 0,
    waterCharge:   parseFloat(r.water_charge)   || 0,
    serviceCharge: parseFloat(r.service_charge) || 0,
    total:        (parseFloat(r.water_charge) || 0) + (parseFloat(r.service_charge) || 0),
    readBy:        'ผู้ดูแลระบบ',
    method:        r.method  || 'manual',
    anomaly:       r.anomaly || null,
    billId:        r.bill_id || null,
  };
}
export function _rToDB(r) {
  return {
    id:             r.id,
    member_id:      r.memberId,
    meter_no:       r.meter,
    reading_date:   r.readingDate,
    prev_reading:   r.prevReading,
    curr_reading:   r.currReading,
    // usage is GENERATED — omit from inserts
    water_charge:   r.waterCharge,
    service_charge: r.serviceCharge,
    method:         r.method  || 'manual',
    anomaly:        r.anomaly || null,
    bill_id:        r.billId  || null,
  };
}

// ─── Maintenance Job ──────────────────────────────────────────
export function _ntFromDB(r) {
  return {
    id:               r.id,
    type:             r.type,
    description:      r.description,
    location:         r.location       || '',
    reportedBy:       r.reported_by_type || 'staff',
    reportedMemberId: r.member_id       || null,
    reportedDate:     r.reported_date,
    assignedTo:       r.assigned_name  || '',
    startDate:        r.start_date     || null,
    completedDate:    r.completed_date || null,
    materials:        r.materials      || '',
    cost:             parseFloat(r.cost) || 0,
    status:           r.status,
    approvedBy:       r.approved_by    || null,
  };
}
export function _ntToDB(m) {
  const vId = _dbVillages.find(v => (m.location || '').includes(v.name))?.id || null;
  return {
    id:               m.id,
    type:             m.type,
    description:      m.description,
    location:         m.location      || null,
    village_id:       vId,
    member_id:        m.reportedMemberId || null,
    reported_by_type: m.reportedBy    || 'staff',
    reported_date:    m.reportedDate,
    assigned_name:    m.assignedTo    || null,
    start_date:       m.startDate     || null,
    completed_date:   m.completedDate || null,
    materials:        m.materials     || null,
    cost:             m.cost          || 0,
    status:           m.status,
  };
}
