// ─── Field work: offline queue / rollover / skips / route ─────
// งานจดมิเตอร์ภาคสนาม
//   - จดตอนไม่มีสัญญาณ: เก็บในเครื่อง (localStorage + รูปใน IndexedDB) แล้วซิงก์เองเมื่อกลับมาออนไลน์
//     ถ้ามีคนจดบ้านเดียวกันไปแล้ว (ออกบิลบน server แล้ว) จะไม่ส่งซ้ำ — แสดงเป็น "ขัดแย้ง" ให้ตรวจ
//   - มิเตอร์วนรอบ (9999 → 0000)
//   - บันทึกเหตุผลที่จดไม่ได้ / นำทางด้วย Google Maps / บันทึกพิกัดหน้าบ้าน / โทรหาเจ้าของบ้าน
//   - จัดลำดับเส้นทางเดินจดในแต่ละหมู่บ้าน (ถ้าไม่ได้ตั้ง ใช้ลำดับที่จดจริงในรอบก่อน)
// ──────────────────────────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc, jsArg, toast, showConfirm } from '../../utils/dom.util.js';
import { currentPeriod } from '../../utils/date.util.js';
import { _periodYM, _vName } from '../../services/db-mapper.service.js';
import { sbRecordMeterSkip, sbSetRouteOrder, sbFindBill, sbSaveMember, lastSbError } from '../../services/data-loader.service.js';
import { saveToStorage } from '../../services/storage.service.js';
import { getSession } from '../../services/session.service.js';
import { openModal, closeModal, busyButton } from '../../components/modal/modal.js';

const QUEUE_KEY = 'aq_meter_queue';
const ROLLOVER_MAX_USAGE = 1000;   // ใช้น้ำเกินนี้หลังวนรอบ = น่าจะกรอกผิด ไม่ใช่วนรอบ

export const SKIP_REASONS = {
  house_closed: { label: 'บ้านปิด / ไม่มีคนอยู่', icon: 'ti-door' },
  locked:       { label: 'ประตูล็อก / เข้าไม่ได้', icon: 'ti-lock' },
  dog:          { label: 'สุนัขดุ',               icon: 'ti-dog' },
  meter_broken: { label: 'มิเตอร์เสีย / อ่านไม่ได้', icon: 'ti-gauge-off' },
  other:        { label: 'อื่นๆ',                  icon: 'ti-dots' },
};

// ─── Rollover ─────────────────────────────────────────────────
export function meterMax() {
  const v = parseInt(appState.systemConfig?.meter_max_reading);
  return v > 0 ? v : 9999;
}

/** ถ้าเลขใหม่น้อยกว่าเลขเดิม และเข้าข่ายมิเตอร์วนรอบ คืนหน่วยที่ใช้ — ไม่งั้นคืน null */
export function rolloverUsage(prev, curr) {
  const max = meterMax();
  if (!(curr < prev) || prev > max || curr > max) return null;
  const usage = (max + 1 - prev) + curr;
  return usage <= ROLLOVER_MAX_USAGE ? usage : null;
}

/** showConfirm แบบ await ได้ — คืน true/false */
export function askConfirm(opts) {
  return new Promise(resolve => {
    showConfirm({ ...opts, onOk: () => resolve(true) });
    const cancel = document.getElementById('app-confirm-cancel');
    const modal  = document.getElementById('app-confirm-modal');
    const no = () => { modal.style.display = 'none'; resolve(false); };
    if (cancel) cancel.onclick = no;
    if (modal) modal.onclick = e => { if (e.target === modal) no(); };
  });
}

// ─── Offline queue ────────────────────────────────────────────
// คิวผูกกับผู้จด — คนอื่นที่ login เครื่องเดียวกันส่งแทนไม่ได้ (server บันทึกผู้จดตาม token ที่ส่ง)
const _me = () => getSession()?.profile?.id || null;
function _allQueued() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
}
export function getQueue() {
  return _allQueued().filter(i => !i.profileId || i.profileId === _me());
}
/** มีรายการที่ยังไม่ได้ส่งของผู้ใช้นี้ (เตือนก่อนออกจากระบบ) */
export function pendingQueueCount() {
  return getQueue().filter(i => i.status === 'pending').length;
}
function _setQueue(q) {
  const others = _allQueued().filter(i => i.profileId && i.profileId !== _me());
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify([...others, ...q])); } catch { toast('พื้นที่เก็บข้อมูลในเครื่องเต็ม', 'error'); }
  window.renderMeter?.();
}

/** สมาชิกที่จดไว้ในเครื่องแล้วแต่ยังไม่ส่ง (นับเป็น "จดแล้ว" ในรายการ — กันจดซ้ำ) */
export function queuedMemberIds(period) {
  return new Set(getQueue().filter(i => i.period === period).map(i => i.memberId));
}

export function isNetworkFailure() {
  return !navigator.onLine || /fetch|network|load failed|timeout/i.test(lastSbError?.message || '');
}

// รูปเก็บใน IndexedDB (localStorage เล็กเกินสำหรับรูป)
function _idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('aquaflow', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function _photo(op, key, value) {
  try {
    const db = await _idb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('photos', op === 'get' ? 'readonly' : 'readwrite');
      const st = tx.objectStore('photos');
      const req = op === 'get' ? st.get(key) : op === 'put' ? st.put(value, key) : st.delete(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}

/** เก็บการจดมิเตอร์ไว้ในเครื่อง — entry: { id, memberId, period, readingDate, prev, curr, usage, rollover, meterMax } */
export async function enqueueReading(entry, photoFile) {
  const member = appState.members.find(m => m.id === entry.memberId);
  if (photoFile) await _photo('put', entry.id, photoFile);
  _setQueue([...getQueue(), { ...entry, profileId: _me(), hasPhoto: !!photoFile, status: 'pending', queuedAt: new Date().toISOString() }]);
  if (member) { member.lastRead = entry.curr; member.lastReadDate = entry.readingDate; }
  toast(`ไม่มีสัญญาณ — บันทึก ${member?.firstName || ''} ไว้ในเครื่องแล้ว จะส่งเองเมื่อออนไลน์`, 'warn', 5000);
}

let _syncing = false;

/** ส่งรายการในเครื่องขึ้น server ทีละรายการ — persist คือฟังก์ชันบันทึกเดียวกับตอนออนไลน์ */
export async function syncQueue(persist, { silent = false } = {}) {
  if (_syncing || !navigator.onLine) return;
  const pending = getQueue().filter(i => i.status === 'pending');
  if (!pending.length) return;
  _syncing = true;
  let sent = 0, conflicts = 0;
  try {
    for (const item of pending) {
      const { year, month } = _periodYM(item.period);
      let serverBill;
      try { serverBill = await sbFindBill(item.memberId, year, month); }
      catch { break; }   // ยังออฟไลน์ — ลองใหม่ครั้งหน้า
      if (serverBill) {
        // มีบิลงวดนี้บน server แล้ว: ถ้าเป็นข้อมูลชุดเดียวกัน (ส่งไปแล้วแต่ไม่ได้รับคำตอบ) ถือว่าสำเร็จ
        if (Number(serverBill.usage) === Number(item.usage)) { _drop(item.id); sent++; continue; }
        _mark(item.id, { status: 'conflict', serverBill: { id: serverBill.id, usage: serverBill.usage, total: serverBill.total } });
        conflicts++;
        continue;
      }
      const photo = item.hasPhoto ? await _photo('get', item.id) : null;
      const billId = await persist(item, { photoFile: photo });
      if (!billId) { if (isNetworkFailure()) break; _mark(item.id, { status: 'conflict', error: lastSbError?.message || 'บันทึกไม่สำเร็จ' }); conflicts++; continue; }
      _drop(item.id);
      sent++;
    }
  } finally {
    _syncing = false;
    window.renderMeter?.();
  }
  if (!silent || sent || conflicts) {
    if (sent) toast(`ส่งข้อมูลมิเตอร์ที่จดไว้ในเครื่อง ${sent} รายการแล้ว`, 'success');
    if (conflicts) toast(`${conflicts} รายการมีคนจดไปแล้ว — ตรวจสอบในหน้าจดมิเตอร์`, 'warn', 6000);
  }
}

function _mark(id, patch) { _setQueue(getQueue().map(i => (i.id === id ? { ...i, ...patch } : i))); }
function _drop(id) { _setQueue(getQueue().filter(i => i.id !== id)); _photo('delete', id); }

export function queueBannerHtml() {
  const q = getQueue();
  if (!q.length) return '';
  const pend = q.filter(i => i.status === 'pending').length;
  const conf = q.filter(i => i.status === 'conflict').length;
  return `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0 0;padding:10px 12px;border-radius:10px;
      background:${conf ? 'var(--red-50)' : 'var(--amber-50)'};font-size:12.5px">
      <i class="ti ${navigator.onLine ? 'ti-cloud-upload' : 'ti-wifi-off'}" style="font-size:18px;color:var(--amber-700)"></i>
      <span style="flex:1">${pend ? `จดไว้ในเครื่อง <b>${pend}</b> รายการ ${navigator.onLine ? '' : '(ออฟไลน์)'}` : ''}
        ${conf ? `<b style="color:var(--red-700)">ขัดแย้ง ${conf} รายการ</b>` : ''}</span>
      ${pend && navigator.onLine ? '<button class="btn btn-secondary btn-xs" onclick="syncMeterQueue()"><i class="ti ti-refresh"></i>ส่งตอนนี้</button>' : ''}
      ${conf ? '<button class="btn btn-secondary btn-xs" onclick="openQueueConflicts()">ตรวจสอบ</button>' : ''}
    </div>`;
}

export function openQueueConflicts() {
  const conf = getQueue().filter(i => i.status === 'conflict');
  openModal({
    id: 'queue-conflicts', title: 'รายการที่ส่งไม่ได้', icon: 'ti-alert-triangle', width: 520,
    body: `<p style="font-size:12.5px;color:var(--gray-600);margin-bottom:10px">มีการจดมิเตอร์บ้านเหล่านี้บน server แล้ว (อาจเป็นเจ้าหน้าที่อีกคน)
      ตรวจบิลที่มีอยู่ ถ้าถูกต้องให้ทิ้งรายการในเครื่อง</p>
      ${conf.map(i => {
        const m = appState.members.find(x => x.id === i.memberId) || {};
        return `<div style="display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--gray-100);font-size:13px">
          <div style="flex:1"><b>${esc(`${m.firstName || ''} ${m.lastName || ''}`)}</b> · ${esc(i.period)}<br>
            <span style="color:var(--gray-500)">ในเครื่อง: ${i.curr.toLocaleString()} (ใช้ ${i.usage} หน่วย)
            ${i.serverBill ? ` · บน server: บิล ${esc(i.serverBill.id)} ใช้ ${i.serverBill.usage} หน่วย` : ` · ${esc(i.error || '')}`}</span></div>
          ${i.serverBill ? `<button class="btn btn-secondary btn-xs" onclick="openBillReceipt(${jsArg(i.serverBill.id)})">ดูบิล</button>` : ''}
          <button class="btn btn-danger btn-xs" onclick="discardQueued(${jsArg(i.id)})">ทิ้ง</button>
        </div>`;
      }).join('') || '<div style="color:var(--gray-400)">ไม่มี</div>'}`,
  });
}

export function discardQueued(id) {
  _drop(id);
  closeModal('queue-conflicts');
  if (getQueue().some(i => i.status === 'conflict')) openQueueConflicts();
  toast('ทิ้งรายการในเครื่องแล้ว', 'info');
}

// ─── Skips ────────────────────────────────────────────────────
export function skipFor(memberId, period) {
  const { year, month } = _periodYM(period);
  return (appState.meterSkips || []).find(s => s.member_id === memberId && s.period_year === year && s.period_month === month) || null;
}

export function openMeterSkip(memberId) {
  const m = appState.members.find(x => x.id === memberId);
  if (!m) return;
  openModal({
    id: 'meter-skip-modal', title: `จดไม่ได้ — ${m.firstName} ${m.lastName}`, icon: 'ti-gauge-off', width: 420,
    body: `
      <div style="display:grid;gap:8px">${Object.entries(SKIP_REASONS).map(([k, r], i) => `
        <label style="display:flex;gap:10px;align-items:center;padding:10px 12px;border:1.5px solid var(--gray-200);border-radius:10px;cursor:pointer">
          <input type="radio" name="skip-reason" value="${k}"${i === 0 ? ' checked' : ''}/><i class="ti ${r.icon}" style="font-size:18px;color:var(--blue-500)"></i>${r.label}
        </label>`).join('')}</div>
      <label class="form-label" for="skip-note" style="margin-top:12px">หมายเหตุ</label>
      <input class="form-input" id="skip-note" placeholder="เช่น นัดจดใหม่วันเสาร์"/>
      <div style="font-size:11.5px;color:var(--gray-500);margin-top:8px">บ้านนี้จะยังอยู่ในรายการ "ยังไม่จด" พร้อมเหตุผล · มิเตอร์เสียจะเปิดงานเปลี่ยนมิเตอร์ให้อัตโนมัติ</div>`,
    footer: `<button class="btn btn-secondary" data-close>ยกเลิก</button>
      <button class="btn btn-primary" id="skip-ok"><i class="ti ti-check"></i>บันทึก</button>`,
  });
  document.getElementById('skip-ok').onclick = async (e) => {
    if (!navigator.onLine) { toast('ต้องเชื่อมต่ออินเทอร์เน็ตเพื่อบันทึก', 'error'); return; }
    const reason = document.querySelector('input[name="skip-reason"]:checked').value;
    const done = busyButton(e.currentTarget);
    const row = await sbRecordMeterSkip(memberId, reason, document.getElementById('skip-note').value.trim());
    done();
    if (!row) return;
    const list = appState.meterSkips || (appState.meterSkips = []);
    const i = list.findIndex(s => s.member_id === row.member_id && s.period_year === row.period_year && s.period_month === row.period_month);
    if (i >= 0) list[i] = row; else list.unshift(row);
    closeModal('meter-skip-modal');
    toast(row.maintenance_job ? `บันทึกแล้ว — เปิดงานเปลี่ยนมิเตอร์ ${row.maintenance_job}` : 'บันทึกเหตุผลแล้ว', 'success');
    window.resetMeterSelection?.();
  };
}

// ─── แถบเครื่องมือในฟอร์มจดมิเตอร์ ─────────────────────────────
export function renderFieldBar(member, period) {
  const form = document.getElementById('meter-form-area');
  if (!form || !member) return;
  let bar = document.getElementById('meter-field-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'meter-field-bar';
    bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px';
    form.prepend(bar);
  }
  const skip = skipFor(member.id, period);
  const hasGps = member.gpsLat && member.gpsLng;
  bar.innerHTML = `
    ${hasGps ? `<a class="btn btn-secondary btn-sm" target="_blank" rel="noopener"
       href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${member.gpsLat},${member.gpsLng}`)}"><i class="ti ti-navigation"></i>นำทาง</a>`
      : `<button class="btn btn-secondary btn-sm" onclick="saveMemberGps(${member.id}, this)" title="ยืนอยู่หน้าบ้านแล้วกด — รอบหน้าจะมีปุ่มนำทาง"><i class="ti ti-map-pin-plus"></i>บันทึกพิกัดบ้านนี้</button>`}
    ${member.phone ? `<a class="btn btn-secondary btn-sm" href="tel:${esc(member.phone.replace(/[^0-9+]/g, ''))}"><i class="ti ti-phone"></i>โทร</a>` : ''}
    <button class="btn btn-secondary btn-sm" onclick="openMeterSkip(${member.id})"><i class="ti ti-gauge-off"></i>จดไม่ได้</button>
    ${skip ? `<span class="pill pill-pending" style="font-size:11.5px">รอบนี้: ${esc(SKIP_REASONS[skip.reason]?.label || skip.reason)}${skip.note ? ' — ' + esc(skip.note) : ''}</span>` : ''}`;
}

/** ยืนหน้าบ้านแล้วกด — เก็บพิกัด GPS ของมือถือเป็นพิกัดบ้าน (ใช้นำทาง/แผนที่ในรอบถัดไป) */
export function saveMemberGps(memberId, btn) {
  const m = appState.members.find(x => x.id === memberId);
  if (!m) return;
  if (!navigator.geolocation) { toast('อุปกรณ์นี้ไม่รองรับ GPS', 'error'); return; }
  if (!navigator.onLine) { toast('ต้องเชื่อมต่ออินเทอร์เน็ตเพื่อบันทึกพิกัด', 'error'); return; }
  const done = busyButton(btn, 'กำลังหาตำแหน่ง...');
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude, longitude, accuracy } = pos.coords;
    if (accuracy > 50) {
      const ok = await askConfirm({
        title: 'สัญญาณ GPS ยังไม่แม่น', okText: 'บันทึกเลย', okClass: 'btn-primary', icon: 'ti-map-pin',
        iconBg: 'var(--amber-50)', iconColor: 'var(--amber-700)',
        message: `ตำแหน่งคลาดเคลื่อนได้ประมาณ ${Math.round(accuracy)} เมตร\nถ้าอยู่ในบ้านหรือใต้หลังคา ลองออกมาที่โล่งแล้วกดใหม่`,
      });
      if (!ok) { done(); return; }
    }
    const before = { gpsLat: m.gpsLat, gpsLng: m.gpsLng };
    m.gpsLat = parseFloat(latitude.toFixed(6));
    m.gpsLng = parseFloat(longitude.toFixed(6));
    const ok = await sbSaveMember(m);
    done();
    if (!ok) { Object.assign(m, before); return; }
    saveToStorage();
    toast(`บันทึกพิกัดบ้าน ${m.houseNo || ''} แล้ว — รอบหน้ากดนำทางได้เลย`, 'success');
    renderFieldBar(m, currentPeriod());
  }, err => {
    done();
    toast(err.code === 1 ? 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — เปิดสิทธิ์ตำแหน่งให้เบราว์เซอร์ก่อน' : 'หาตำแหน่งไม่ได้ ลองใหม่อีกครั้ง', 'error');
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}

// ─── Route order ──────────────────────────────────────────────
// id การอ่านมิเตอร์คือ 'MR-' + เวลาที่กดบันทึก (ms) — จดออฟไลน์ก็เป็นเวลาที่จดจริง ไม่ใช่เวลาซิงก์
const _readAt = r => { const t = /^MR-(\d{12,})$/.exec(r.id || ''); return t ? Number(t[1]) : null; };

let _visitCache = { key: '', rank: new Map() };

/**
 * memberId → ลำดับที่เดินจดจริงในรอบล่าสุดก่อนรอบนี้ (แยกตามหมู่บ้าน)
 * ใช้เฉพาะหมู่บ้านที่รอบนั้นมีเวลาจดอย่างน้อยครึ่งหนึ่งของบ้านทั้งหมด — ข้อมูลน้อยกว่านี้เรียงแล้วจะมั่ว
 */
export function visitRank() {
  const { meterReadings, members } = appState;
  const period = currentPeriod();
  const key = `${period}|${meterReadings.length}|${members.length}`;
  if (_visitCache.key === key) return _visitCache.rank;

  const active = members.filter(m => m.status !== 'closed');
  const villageOf = new Map(active.map(m => [m.id, m.villageId]));
  const villageSize = {};
  active.forEach(m => { villageSize[m.villageId] = (villageSize[m.villageId] || 0) + 1; });

  const byVillage = {};
  for (const r of meterReadings) {
    if (r.period === period) continue;
    const t = _readAt(r);
    const v = villageOf.get(r.memberId);
    if (t === null || !v) continue;
    (byVillage[v] ||= []).push({ memberId: r.memberId, period: r.period, t });
  }

  const rank = new Map();
  for (const [v, list] of Object.entries(byVillage)) {
    const lastPeriod = list.reduce((a, b) => (b.t > a.t ? b : a)).period;
    const visits = list.filter(x => x.period === lastPeriod).sort((a, b) => a.t - b.t);
    if (visits.length * 2 < villageSize[v]) continue;
    visits.forEach((x, i) => { if (!rank.has(x.memberId)) rank.set(x.memberId, i + 1); });
  }
  _visitCache = { key, rank };
  return rank;
}

const _houseCompare = (a, b) => String(a.houseNo || '').localeCompare(String(b.houseNo || ''), 'th', { numeric: true });

/** ลำดับสำหรับเรียงในหมู่บ้าน: route_order (ถ้าตั้งไว้) → ลำดับที่จดจริงรอบก่อน → บ้านเลขที่ */
export function routeCompare(a, b) {
  const ra = a.routeOrder ?? Infinity, rb = b.routeOrder ?? Infinity;
  if (ra !== rb) return ra - rb;
  const visit = visitRank();
  const va = visit.get(a.id) ?? Infinity, vb = visit.get(b.id) ?? Infinity;
  if (va !== vb) return va - vb;
  return _houseCompare(a, b);
}

export function openRouteOrder(villageId) {
  const village = _vName(villageId);
  const list = appState.members.filter(m => m.villageId === villageId && m.status !== 'closed').sort(routeCompare);
  const render = () => list.map((m, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid var(--gray-100);font-size:13px">
      <span class="mono" style="width:26px;color:var(--gray-400)">${i + 1}</span>
      <span style="flex:1"><b>${esc(m.houseNo || '—')}</b> ${esc(m.firstName)} ${esc(m.lastName)}</span>
      <button class="btn-icon" data-up="${i}" aria-label="เลื่อนขึ้น" ${i === 0 ? 'disabled' : ''}><i class="ti ti-arrow-up"></i></button>
      <button class="btn-icon" data-down="${i}" aria-label="เลื่อนลง" ${i === list.length - 1 ? 'disabled' : ''}><i class="ti ti-arrow-down"></i></button>
    </div>`).join('');
  const visit = visitRank();
  const hasVisits = list.some(m => visit.has(m.id));
  openModal({
    id: 'route-modal', title: `ลำดับเส้นทาง — ${village}`, icon: 'ti-route', width: 460,
    body: `<p style="font-size:12.5px;color:var(--gray-600);margin-bottom:8px">เรียงตามลำดับที่เดินจดจริง — ปุ่ม "จดถัดไป" จะพาไปตามลำดับนี้<br>
      <span style="color:var(--gray-500)">ถ้าไม่ได้ตั้งเอง ระบบจะใช้ลำดับที่จดจริงในรอบก่อนให้อัตโนมัติ</span></p>
      <div id="route-list" style="max-height:55vh;overflow:auto">${render()}</div>`,
    footer: `<button class="btn btn-secondary" id="route-reset">เรียงตามบ้านเลขที่</button>
      ${hasVisits ? '<button class="btn btn-secondary" id="route-visit"><i class="ti ti-history"></i>ตามที่จดรอบก่อน</button>' : ''}
      <button class="btn btn-primary" id="route-ok"><i class="ti ti-check"></i>บันทึก</button>`,
  });
  const box = document.getElementById('route-list');
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-up],[data-down]');
    if (!b) return;
    const i = Number(b.dataset.up ?? b.dataset.down);
    const j = b.dataset.up !== undefined ? i - 1 : i + 1;
    [list[i], list[j]] = [list[j], list[i]];
    box.innerHTML = render();
  });
  document.getElementById('route-reset').onclick = () => {
    list.sort(_houseCompare);
    box.innerHTML = render();
  };
  const visitBtn = document.getElementById('route-visit');
  if (visitBtn) visitBtn.onclick = () => {
    list.sort((a, b) => (visit.get(a.id) ?? Infinity) - (visit.get(b.id) ?? Infinity) || _houseCompare(a, b));
    box.innerHTML = render();
  };
  document.getElementById('route-ok').onclick = async (e) => {
    const done = busyButton(e.currentTarget);
    const ok = await sbSetRouteOrder(list.map(m => m.id));
    done();
    if (!ok) return;
    list.forEach((m, i) => { m.routeOrder = i + 1; });
    closeModal('route-modal');
    toast('บันทึกลำดับเส้นทางแล้ว', 'success');
    window.renderMeter?.();
  };
}
