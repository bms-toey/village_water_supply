// ─── Supabase Client ────────────────────────────────────────────
const SUPABASE_URL      = 'https://gtflwdzatwowhufxddxs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0Zmx3ZHphdHdvd2h1ZnhkZHhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMjc5MTIsImV4cCI6MjA5NTkwMzkxMn0.n9DccSYx0knRzqdILk91aV-is-pIcgXhQpCUkMU7gK4';

// Main client (session ถาวร)
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Client แยกสำหรับสร้าง user (ไม่กระทบ session หลัก)
const _sbCreate = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'sb-admin-create' },
});

// ─── Thai month ↔ number ─────────────────────────────────────────
const _THAI_M = {'ม.ค.':1,'ก.พ.':2,'มี.ค.':3,'เม.ย.':4,'พ.ค.':5,'มิ.ย.':6,'ก.ค.':7,'ส.ค.':8,'ก.ย.':9,'ต.ค.':10,'พ.ย.':11,'ธ.ค.':12};
function _periodYM(label) {
  const p = (label||'').trim().split(' ');
  return { year: parseInt(p[1])||2566, month: _THAI_M[p[0]]||1 };
}

// ─── Village cache ───────────────────────────────────────────────
let _dbVillages = [];
function _vId(name)  { return (_dbVillages.find(v => v.name === name) || {}).id   || null; }
function _vName(id)  { return (_dbVillages.find(v => v.id   === id)   || {}).name || '';   }

// ─── Map: DB row → App object ────────────────────────────────────
function _mFromDB(r) {
  return {
    id:               r.id,
    firstName:        r.first_name,
    lastName:         r.last_name,
    nationalId:       r.national_id       || '',
    houseNo:          r.house_no          || '',
    village:          _vName(r.village_id),
    memberType:       r.member_type       || 'residential',
    householdCount:   r.household_count   || 1,
    registrationDate: r.registration_date || '',
    phone:            r.phone             || '',
    lineId:           r.line_id           || '',
    email:            r.email             || '',
    gpsLat:           r.gps_lat           || null,
    gpsLng:           r.gps_lng           || null,
    meter:            r.meter_no,
    meterSize:        r.meter_size        || '0.5',
    meterBrand:       r.meter_brand       || '',
    meterInstallDate: r.meter_install_date|| '',
    meterExpireDate:  r.meter_expire_date || '',
    lastRead:         parseFloat(r.last_read) || 0,
    lastReadDate:     r.last_read_date    || '',
    status:           r.status            || 'normal',
    notes:            r.notes             || '',
  };
}
function _mToDB(m) {
  return {
    first_name:         m.firstName,
    last_name:          m.lastName,
    national_id:        m.nationalId        || null,
    house_no:           m.houseNo           || '',
    village_id:         _vId(m.village),
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
}

function _bFromDB(r) {
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
  };
}
function _bToDB(b) {
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
    // total คือ GENERATED — ห้าม insert
    status:         b.status         || 'pending',
    sent_via:       b.sentVia        || 'none',
  };
}

function _pFromDB(r) {
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
    status:       r.status,
    approvedBy:   r.approved_by   || null,
    approvedAt:   r.approved_at   ? r.approved_at.replace('T', ' ').substring(0, 16) : null,
    rejectReason: r.reject_reason || null,
  };
}
function _pToDB(p) {
  return {
    id:           p.id,
    bill_id:      p.billId,
    member_id:    p.memberId,
    paid_at:      p.paidAt,
    amount:       p.amount,
    channel:      p.channel,
    tx_ref:       p.txRef        || null,
    payer_name:   p.payerName    || null,
    slip_url:     p.slipPath     || null,
    status:       p.status,
    approved_at:  p.approvedAt   || null,
    reject_reason:p.rejectReason || null,
  };
}

function _rFromDB(r) {
  return {
    id:            r.id,
    memberId:      r.member_id,
    meter:         r.meter_no,
    readingDate:   r.reading_date,
    prevReading:   parseFloat(r.prev_reading)   || 0,
    currReading:   parseFloat(r.curr_reading)   || 0,
    usage:         parseFloat(r.usage)          || 0,
    waterCharge:   parseFloat(r.water_charge)   || 0,
    serviceCharge: parseFloat(r.service_charge) || 0,
    total:        (parseFloat(r.water_charge)||0) + (parseFloat(r.service_charge)||0),
    readBy:        'ผู้ดูแลระบบ',
    method:        r.method  || 'manual',
    anomaly:       r.anomaly || null,
    billId:        r.bill_id || null,
  };
}
function _rToDB(r) {
  return {
    id:             r.id,
    member_id:      r.memberId,
    meter_no:       r.meter,
    reading_date:   r.readingDate,
    prev_reading:   r.prevReading,
    curr_reading:   r.currReading,
    // usage คือ GENERATED — ห้าม insert
    water_charge:   r.waterCharge,
    service_charge: r.serviceCharge,
    method:         r.method  || 'manual',
    anomaly:        r.anomaly || null,
    bill_id:        r.billId  || null,
  };
}

function _ntFromDB(r) {
  return {
    id:               r.id,
    type:             r.type,
    description:      r.description,
    location:         r.location     || '',
    reportedBy:       r.reported_by_type || 'staff',
    reportedMemberId: r.member_id    || null,
    reportedDate:     r.reported_date,
    assignedTo:       r.assigned_name|| '',
    startDate:        r.start_date   || null,
    completedDate:    r.completed_date || null,
    materials:        r.materials    || '',
    cost:             parseFloat(r.cost) || 0,
    status:           r.status,
    approvedBy:       r.approved_by  || null,
  };
}
function _ntToDB(m) {
  const vId = _dbVillages.find(v => (m.location||'').includes(v.name))?.id || null;
  return {
    id:               m.id,
    type:             m.type,
    description:      m.description,
    location:         m.location     || null,
    village_id:       vId,
    member_id:        m.reportedMemberId || null,
    reported_by_type: m.reportedBy   || 'staff',
    reported_date:    m.reportedDate,
    assigned_name:    m.assignedTo   || null,
    start_date:       m.startDate    || null,
    completed_date:   m.completedDate || null,
    materials:        m.materials    || null,
    cost:             m.cost         || 0,
    status:           m.status,
  };
}

// ─── Load ALL data from Supabase into in-memory arrays ──────────
async function loadAllFromSupabase() {
  try {
    const [rv, rm, rb, rp, rr, rt, rn, rwp, rwq] = await Promise.all([
      _sb.from('villages').select('*').order('moo_number'),
      _sb.from('members').select('*').order('id'),
      _sb.from('bills').select('*').order('period_year', { ascending: false }).order('period_month', { ascending: false }),
      _sb.from('payments').select('*').order('paid_at',   { ascending: false }),
      _sb.from('meter_readings').select('*').order('reading_date', { ascending: false }),
      _sb.from('rate_tiers').select('*').order('from_unit'),
      _sb.from('maintenance_jobs').select('*').order('created_at', { ascending: false }),
      _sb.from('water_production').select('*').order('period_year', { ascending: false }),
      _sb.from('water_quality').select('*').order('test_date',     { ascending: false }),
    ]);

    if (rv.error || rm.error) {
      console.error('[sb] load error:', rv.error || rm.error);
      return false;
    }

    _dbVillages     = rv.data || [];
    members         = (rm.data || []).map(_mFromDB);
    bills           = (rb.data || []).map(_bFromDB);
    payments        = (rp.data || []).map(_pFromDB);
    meterReadings   = (rr.data || []).map(_rFromDB);
    maintenance     = (rn.data || []).map(_ntFromDB);
    waterProduction = rwp.data || [];
    waterQuality    = rwq.data || [];

    const tiers = rt.data || [];
    if (tiers.length) {
      rateConfig.tiers = tiers.map(t => ({
        from: t.from_unit,
        to:   t.to_unit === null ? Infinity : t.to_unit,
        rate: parseFloat(t.rate_per_unit),
      }));
      rateConfig.svcSmall        = parseFloat(tiers[0].svc_charge_small)   || 20;
      rateConfig.svcLarge        = parseFloat(tiers[0].svc_charge_large)   || 30;
      rateConfig.lateFeePerMonth = parseFloat(tiers[0].late_fee_per_month) || 50;
    }

    nextMemberId = members.length
      ? Math.max(...members.map(m => m.id)) + 1
      : 100001;

    return true;
  } catch (e) {
    console.error('[sb] loadAllFromSupabase exception:', e);
    return false;
  }
}

// ─── Write helpers (fire-and-forget except sbSaveMemberNew) ─────

// Member UPDATE (fire & forget)
function sbUpdateMember(m) {
  const row = _mToDB(m);
  row.id = m.id;
  _sb.from('members').upsert(row).then(({ error }) => {
    if (error) console.error('[sb] updateMember:', error.message);
  });
}

// Member INSERT — await เพื่อได้ id จาก DB
async function sbInsertMember(m) {
  const { data, error } = await _sb.from('members').insert(_mToDB(m)).select('id').single();
  if (error) { console.error('[sb] insertMember:', error.message); return null; }
  return data?.id || null;
}

function sbDeleteMember(id) {
  _sb.from('members').delete().eq('id', id).then(({ error }) => {
    if (error) console.error('[sb] deleteMember:', error.message);
  });
}

function sbUpsertBill(b) {
  _sb.from('bills').upsert(_bToDB(b)).then(({ error }) => {
    if (error) console.error('[sb] upsertBill:', error.message);
  });
}
function sbUpsertBills(list) {
  if (!list.length) return;
  _sb.from('bills').upsert(list.map(_bToDB)).then(({ error }) => {
    if (error) console.error('[sb] upsertBills:', error.message);
  });
}
function sbUpdateBillStatus(billId, status) {
  _sb.from('bills').update({ status }).eq('id', billId).then(({ error }) => {
    if (error) console.error('[sb] updateBillStatus:', error.message);
  });
}

function sbUpsertPayment(p) {
  _sb.from('payments').upsert(_pToDB(p)).then(({ error }) => {
    if (error) console.error('[sb] upsertPayment:', error.message);
  });
}
function sbUpdatePayment(id, patch) {
  _sb.from('payments').update(patch).eq('id', id).then(({ error }) => {
    if (error) console.error('[sb] updatePayment:', error.message);
  });
}

function sbUpsertReading(r) {
  _sb.from('meter_readings').upsert(_rToDB(r)).then(({ error }) => {
    if (error) console.error('[sb] upsertReading:', error.message);
  });
}

function sbUpsertMaintenance(m) {
  _sb.from('maintenance_jobs').upsert(_ntToDB(m)).then(({ error }) => {
    if (error) console.error('[sb] upsertMaintenance:', error.message);
  });
}
