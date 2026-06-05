// ─── Meter Module ──────────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc, toast } from '../../utils/dom.util.js';
import { currentPeriod, nextBillNo } from '../../utils/date.util.js';
import { calcWaterCharge, calcWaterBreakdown } from '../../config/rate.config.js';
import { anomalyMap, methodMap } from '../../config/ui.config.js';
import { sbUpsertReading, sbUpsertBill, sbUpdateMember } from '../../services/data-loader.service.js';
import { saveToStorage } from '../../services/storage.service.js';
import { goPage } from '../../components/navigation/navigation.js';
import { _dbVillages } from '../../services/db-mapper.service.js';

// ─── Filter State ─────────────────────────────────────────────
let _meterSearch        = '';
let _meterStatusFilter  = 'pending'; // 'pending' | 'done' | 'all'
let _meterVillageFilter = '';        // '' = ทุกหมู่บ้าน

// Exposed to window for inline onchange/onclick in generated HTML
window._setMeterStatus  = (v) => { _meterStatusFilter  = v; renderMeter(); };
window._setMeterVillage = (v) => { _meterVillageFilter = v; renderMeter(); };

// ─── Render: Member Selection List ───────────────────────────
export function renderMeter(searchOverride) {
  if (searchOverride !== undefined) _meterSearch = searchOverride;
  const { members, meterReadings } = appState;
  const period = currentPeriod();
  const wrap   = document.getElementById('meter-member-list');
  if (!wrap) return;

  if (appState.currentMeterMemberId) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';

  const q         = _meterSearch.toLowerCase().trim();
  const allActive = members.filter(m => m.status !== 'closed');
  const readSet   = new Set(meterReadings.filter(r => r.period === period).map(r => r.memberId));

  // ── Global progress counts ──────────────────────────────────
  const totalAll   = allActive.length;
  const doneAll    = allActive.filter(m =>  readSet.has(m.id)).length;
  const pendingAll = totalAll - doneAll;
  const pct        = totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : 0;

  // ── Per-village sequence numbers (from ALL active members) ──
  // Sequence = position within village sorted by house number (1-based)
  const villageSeqMap = new Map();
  const tempVillGroups = {};
  allActive.forEach(m => {
    const v = m.village || '—';
    if (!tempVillGroups[v]) tempVillGroups[v] = [];
    tempVillGroups[v].push(m);
  });
  Object.values(tempVillGroups).forEach(mems => {
    mems.sort((a, b) => (a.houseNo || '').localeCompare(b.houseNo || '', 'th'));
    mems.forEach((m, i) => villageSeqMap.set(m.id, i + 1));
  });

  // ── Apply search + village filter ───────────────────────────
  let filtered = allActive;
  if (q) filtered = filtered.filter(m =>
    (m.firstName + ' ' + m.lastName).toLowerCase().includes(q) ||
    (m.meter    || '').toLowerCase().includes(q) ||
    (m.village  || '').toLowerCase().includes(q) ||
    (m.houseNo  || '').includes(q)
  );
  if (_meterVillageFilter) filtered = filtered.filter(m => m.village === _meterVillageFilter);

  // Filtered counts for tab badges
  const filtPending = filtered.filter(m => !readSet.has(m.id)).length;
  const filtDone    = filtered.filter(m =>  readSet.has(m.id)).length;
  const filtTotal   = filtered.length;

  // ── Apply status filter ─────────────────────────────────────
  let displayList = filtered;
  if (_meterStatusFilter === 'pending') displayList = filtered.filter(m => !readSet.has(m.id));
  if (_meterStatusFilter === 'done')    displayList = filtered.filter(m =>  readSet.has(m.id));

  // ── Sort: moo_number → pending first → houseNo ─────────────
  const villMooMap = {};
  _dbVillages.forEach(v => { villMooMap[v.name] = v.moo_number || 999; });
  displayList.sort((a, b) => {
    const mooA = villMooMap[a.village] || 999;
    const mooB = villMooMap[b.village] || 999;
    if (mooA !== mooB) return mooA - mooB;
    const pendA = readSet.has(a.id) ? 1 : 0;
    const pendB = readSet.has(b.id) ? 1 : 0;
    if (pendA !== pendB) return pendA - pendB; // pending before done
    return (a.houseNo || '').localeCompare(b.houseNo || '', 'th');
  });

  // ── Group by village (preserving sort order) ────────────────
  const groups = [];
  displayList.forEach(m => {
    const v    = m.village || '—';
    const last = groups[groups.length - 1];
    if (!last || last.village !== v) groups.push({ village: v, members: [] });
    groups[groups.length - 1].members.push(m);
  });

  // ── Village dropdown options ────────────────────────────────
  const activeVillages = [..._dbVillages]
    .filter(v => v.is_active !== false)
    .sort((a, b) => (a.moo_number || 0) - (b.moo_number || 0));
  const villageOpts = activeVillages.map(v =>
    `<option value="${esc(v.name)}"${_meterVillageFilter === v.name ? ' selected' : ''}>${esc(v.name)}</option>`
  ).join('');

  // ── Empty-state message ─────────────────────────────────────
  const emptyMsg = _meterStatusFilter === 'pending' && !q && !_meterVillageFilter
    ? '<span style="font-size:28px">🎉</span><br>จดมิเตอร์ครบทุกรายในรอบนี้แล้ว!'
    : 'ไม่พบสมาชิกตามเงื่อนไขที่เลือก';

  const _tab = (label, status) => {
    const active = _meterStatusFilter === status;
    return `<button
      style="background:${active ? 'var(--blue-600)' : 'transparent'};
             color:${active ? '#fff' : 'var(--gray-600)'};
             border:none;border-radius:8px;padding:5px 12px;
             font-size:12px;font-weight:${active ? '700' : '500'};
             cursor:pointer;white-space:nowrap;flex-shrink:0"
      onclick="window._setMeterStatus('${status}')">${label}</button>`;
  };

  wrap.innerHTML = `
  <!-- ─── Header: Progress + Filters ─── -->
  <div style="padding:20px 24px 16px;border-bottom:1px solid var(--gray-100)">

    <!-- Title -->
    <div style="font-size:15px;font-weight:700;color:var(--blue-900);margin-bottom:12px">
      <i class="ti ti-gauge" style="color:var(--blue-500);margin-right:6px"></i>
      จดมิเตอร์ — รอบ <span style="color:var(--blue-600)">${esc(period)}</span>
    </div>

    <!-- Progress box -->
    <div style="background:var(--gray-50);border-radius:12px;padding:12px 16px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:7px">
        <span style="font-size:13px;font-weight:600;color:var(--blue-900)">ความคืบหน้ารอบนี้</span>
        <span style="font-size:14px;font-weight:800;color:${pct >= 100 ? 'var(--green-600)' : 'var(--blue-600)'}">
          ${pct}%
        </span>
      </div>
      <div style="background:var(--gray-200);border-radius:20px;height:10px;overflow:hidden;margin-bottom:9px">
        <div style="height:100%;background:linear-gradient(90deg,var(--blue-500),var(--green-400));
          border-radius:20px;width:${pct}%;transition:width .4s ease"></div>
      </div>
      <div style="display:flex;gap:6px;font-size:12.5px;flex-wrap:wrap;align-items:center">
        <span style="background:var(--green-100);color:var(--green-700);padding:3px 10px;border-radius:20px;font-weight:700;white-space:nowrap">
          จดแล้ว ${doneAll} ราย
        </span>
        <span style="background:var(--amber-100);color:var(--amber-700);padding:3px 10px;border-radius:20px;font-weight:700;white-space:nowrap">
          ยังไม่จด ${pendingAll} ราย
        </span>
        <span style="color:var(--gray-400);font-size:12px;white-space:nowrap">รวม ${totalAll} ราย</span>
      </div>
    </div>

    <!-- Filters row -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input id="meter-search-inp" class="form-input" type="text"
        placeholder="🔍 ค้นหาชื่อ, มิเตอร์, บ้านเลขที่..."
        value="${esc(_meterSearch)}" oninput="renderMeter(this.value)"
        style="min-width:180px;flex:1"/>
      <select class="form-input" style="width:150px;flex-shrink:0" onchange="window._setMeterVillage(this.value)">
        <option value="">ทุกหมู่บ้าน</option>
        ${villageOpts}
      </select>
      <div style="display:flex;gap:2px;background:var(--gray-100);border-radius:10px;padding:3px;flex-shrink:0;white-space:nowrap">
        ${_tab(`ยังไม่จด&nbsp;(${filtPending})`, 'pending')}
        ${_tab(`จดแล้ว&nbsp;(${filtDone})`, 'done')}
        ${_tab(`ทั้งหมด&nbsp;(${filtTotal})`, 'all')}
      </div>
    </div>
  </div>

  <!-- ─── Member list grouped by village ─── -->
  <div style="padding:0 24px 28px">
    ${!displayList.length
      ? `<div style="text-align:center;padding:52px 24px;color:var(--gray-400);font-size:14px;line-height:2">${emptyMsg}</div>`
      : groups.map(g => {
          const vInfo  = _dbVillages.find(v => v.name === g.village);
          const mooTxt = vInfo?.moo_number ? `หมู่ ${vInfo.moo_number} · ` : '';
          const gPend  = g.members.filter(m => !readSet.has(m.id)).length;
          const gDone  = g.members.length - gPend;
          return `
          <div style="margin-top:24px">
            <!-- Village header -->
            <div style="display:flex;align-items:center;gap:10px;padding:9px 14px;
              background:var(--blue-50);border-radius:10px;border-left:4px solid var(--blue-500);
              margin-bottom:0">
              <i class="ti ti-home-2" style="color:var(--blue-500);font-size:16px;flex-shrink:0"></i>
              <span style="font-weight:700;color:var(--blue-900);font-size:13.5px">${mooTxt}${esc(g.village)}</span>
              <div style="margin-left:auto;display:flex;gap:5px;align-items:center;flex-shrink:0">
                ${gPend > 0 ? `<span style="background:var(--amber-100);color:var(--amber-700);font-size:11px;padding:2px 9px;border-radius:12px;font-weight:600;white-space:nowrap">ยังไม่จด ${gPend}</span>` : ''}
                ${gDone > 0 ? `<span style="background:var(--green-100);color:var(--green-700);font-size:11px;padding:2px 9px;border-radius:12px;font-weight:600;white-space:nowrap">จดแล้ว ${gDone}</span>` : ''}
                <span style="font-size:11.5px;color:var(--gray-400);white-space:nowrap">รวม ${g.members.length}</span>
              </div>
            </div>

            <!-- Member table -->
            <div class="tbl-wrap" style="border-top:none;border-radius:0 0 10px 10px">
              <table>
                <thead><tr style="font-size:11px;color:var(--gray-400);letter-spacing:.03em">
                  <th style="width:44px;text-align:center">ลำดับ</th>
                  <th>ชื่อ-สกุล</th>
                  <th>บ้านเลขที่</th>
                  <th style="text-align:center;font-family:'IBM Plex Mono',monospace">เลขมิเตอร์</th>
                  <th style="text-align:right">ค่าล่าสุด</th>
                  <th style="text-align:center;width:100px">สถานะ</th>
                  <th style="text-align:right;width:100px"></th>
                </tr></thead>
                <tbody>
                  ${g.members.map(m => {
                    const done = readSet.has(m.id);
                    const seq  = villageSeqMap.get(m.id) || '—';
                    return `<tr style="cursor:pointer${done ? ';opacity:.72' : ''}"
                      onmouseenter="this.style.background='var(--blue-50)'"
                      onmouseleave="this.style.background=''"
                      onclick="gotoMeter('${esc(m.firstName+' '+m.lastName)}','${esc(m.meter||'')}',${m.id})">
                      <td style="text-align:center;font-size:12px;color:var(--gray-400);font-family:'IBM Plex Mono',monospace;font-weight:700">${seq}</td>
                      <td>
                        <span style="font-weight:600;font-size:13px;color:var(--blue-900)">${esc(m.firstName)} ${esc(m.lastName)}</span>
                      </td>
                      <td style="font-size:12.5px;color:var(--gray-600)">${esc(m.houseNo||'—')}</td>
                      <td style="text-align:center;font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--blue-700)">${esc(m.meter||'—')}</td>
                      <td style="text-align:right;font-size:13px;font-weight:600">${Number(m.lastRead).toLocaleString()}</td>
                      <td style="text-align:center;white-space:nowrap">
                        ${done
                          ? `<span class="pill pill-paid"    style="font-size:11px;white-space:nowrap">จดแล้ว</span>`
                          : `<span class="pill pill-pending" style="font-size:11px;white-space:nowrap">ยังไม่จด</span>`
                        }
                      </td>
                      <td style="text-align:right">
                        <button class="btn btn-primary btn-xs"
                          onclick="event.stopPropagation();gotoMeter('${esc(m.firstName+' '+m.lastName)}','${esc(m.meter||'')}',${m.id})">
                          <i class="ti ti-pencil"></i>${done ? 'แก้ไข' : 'จดมิเตอร์'}
                        </button>
                      </td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>`;
        }).join('')
    }
  </div>`;
}

export function gotoMeter(name, meterId, memberId) {
  appState.currentMeterMemberId = memberId || null;
  document.getElementById('meter-hd-name').textContent = 'จดมิเตอร์: ' + name;
  document.getElementById('meter-hd-id').textContent   = 'รหัสมิเตอร์: ' + meterId + ' • ' + name;
  const inp = document.getElementById('meter-new-val');
  if (inp) { inp.value = ''; calcMeter(''); }
  if (memberId) {
    const m = appState.members.find(x => x.id === memberId);
    const prevEl = document.getElementById('m-prev');
    if (prevEl && m) prevEl.textContent = Number(m.lastRead).toLocaleString();
    renderMeterHistory(memberId);
  }
  const listEl    = document.getElementById('meter-member-list');
  const formEl    = document.getElementById('meter-form-area');
  const actionsEl = document.getElementById('meter-hd-actions');
  if (listEl)    listEl.style.display    = 'none';
  if (formEl)    formEl.style.display    = '';
  if (actionsEl) actionsEl.style.display = '';
  goPage('meter');
}

export function resetMeterSelection() {
  appState.currentMeterMemberId = null;
  _meterSearch        = '';
  _meterStatusFilter  = 'pending';
  _meterVillageFilter = '';
  const listEl    = document.getElementById('meter-member-list');
  const formEl    = document.getElementById('meter-form-area');
  const actionsEl = document.getElementById('meter-hd-actions');
  const hdName    = document.getElementById('meter-hd-name');
  const hdId      = document.getElementById('meter-hd-id');
  if (listEl)    listEl.style.display    = '';
  if (formEl)    formEl.style.display    = 'none';
  if (actionsEl) actionsEl.style.display = 'none';
  if (hdName)    hdName.textContent      = 'จดมิเตอร์';
  if (hdId)      hdId.textContent        = 'เลือกสมาชิกด้านล่างเพื่อเริ่มจดมิเตอร์';
  renderMeter();
}

export function calcMeter(val) {
  const { currentMeterMemberId, members } = appState;
  const member = currentMeterMemberId ? members.find(m => m.id === currentMeterMemberId) : null;
  const prev   = member ? Number(member.lastRead) : 0;
  const curr   = parseFloat(val);
  const uEl    = document.getElementById('m-usage');
  const eEl    = document.getElementById('m-est');
  const pEl    = document.getElementById('m-pct');
  const p2El   = document.getElementById('m-pct2');
  const prEl   = document.getElementById('m-prog');
  const wEl    = document.getElementById('meter-warn');
  if (!val || isNaN(curr) || curr <= prev) {
    [uEl, eEl].forEach(e => { if (e) e.textContent = '—'; });
    if (pEl)  pEl.textContent  = 'รอกรอกข้อมูล';
    if (p2El) p2El.textContent = '—';
    if (prEl) prEl.style.width = '0%';
    if (wEl)  wEl.style.display = 'none';
    const bdEl = document.getElementById('m-charge-breakdown');
    if (bdEl) bdEl.style.display = 'none';
    return;
  }
  const usage     = curr - prev;
  const meterSize = member?.meterSize || '0.5';
  const charges   = calcWaterCharge(usage, meterSize);
  if (uEl)  uEl.textContent = usage.toFixed(1) + ' m³';
  if (eEl)  eEl.textContent = '฿' + charges.total.toLocaleString();
  const pct = Math.round((usage / 15) * 100);
  if (pEl)  pEl.textContent  = pct + '% ของค่าเฉลี่ย';
  if (p2El) p2El.textContent = pct + '%';
  if (prEl) prEl.style.width = Math.min(pct, 200) + '%';
  if (wEl)  wEl.style.display = usage > 45 ? 'block' : 'none';

  const bdEl = document.getElementById('m-charge-breakdown');
  if (bdEl && usage > 0) {
    const rows = calcWaterBreakdown(usage).map(b => {
      const lbl = (b.to === Infinity || b.to === null) ? `${b.from}+` : `${b.from}–${b.to}`;
      return `<div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--gray-600)">
        <span>${lbl} หน่วย × ${b.units} × ฿${b.rate}</span>
        <span style="font-weight:600">฿${Math.round(b.charge).toLocaleString()}</span>
      </div>`;
    }).join('');
    bdEl.innerHTML = rows +
      `<div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--gray-600);border-top:1px solid var(--gray-100);margin-top:4px;padding-top:4px">
        <span>ค่าบริการรายเดือน (มิเตอร์ ${meterSize}")</span>
        <span style="font-weight:600">฿${charges.serviceCharge}</span>
      </div>`;
    bdEl.style.display = '';
  } else if (bdEl) {
    bdEl.style.display = 'none';
  }
}

export async function saveMeter() {
  const { bills, members, meterReadings, currentMeterMemberId } = appState;
  const v = document.getElementById('meter-new-val').value;
  if (!v) { toast('กรุณากรอกเลขมิเตอร์', 'error'); return; }
  const curr = parseFloat(v);
  if (!currentMeterMemberId) { toast('ไม่พบข้อมูลสมาชิก', 'error'); return; }
  const member = members.find(m => m.id === currentMeterMemberId);
  if (!member) { toast('ไม่พบข้อมูลสมาชิก', 'error'); return; }
  if (curr <= Number(member.lastRead)) { toast('เลขมิเตอร์ต้องมากกว่าค่าเดิม', 'error'); return; }

  const period = currentPeriod();
  const today  = new Date().toISOString().split('T')[0];

  // ── Duplicate reading check ──────────────────────────────────
  const dupReading = meterReadings.find(r =>
    r.memberId === currentMeterMemberId && r.period === period
  );
  if (dupReading) {
    const dupBill          = dupReading.billId ? bills.find(b => b.id === dupReading.billId) : null;
    const dupBillCancelled = !dupBill || dupBill.status === 'cancelled';
    if (!dupBillCancelled) {
      toast(
        `จดมิเตอร์รอบ ${period} ไปแล้ว (${dupReading.readingDate} · ${dupReading.currReading.toLocaleString()} หน่วย)`,
        'error'
      );
      return;
    }
    // Bill was cancelled — reuse reading, create new bill only
    const charges  = calcWaterCharge(dupReading.usage, member.meterSize || '0.5');
    const newBillId = nextBillNo();
    const dueDate   = new Date(); dueDate.setDate(dueDate.getDate() + 15);
    const rebill = {
      id: newBillId, memberId: currentMeterMemberId, period,
      issueDate: today, dueDate: dueDate.toISOString().split('T')[0],
      usage: dupReading.usage, waterCharge: charges.waterCharge,
      serviceCharge: charges.serviceCharge, lateFee: 0, discount: 0,
      total: charges.total, status: 'pending', sentVia: '', issuedBy: 'admin',
    };
    bills.push(rebill);
    dupReading.billId = newBillId;
    await sbUpsertBill(rebill);
    sbUpsertReading(dupReading);
    saveToStorage();
    window.populateBillingFilters?.();
    window.renderBilling?.();
    toast(`ออกบิลใหม่รอบ ${period} — ฿${charges.total.toLocaleString()} (ใช้ข้อมูลมิเตอร์เดิม)`, 'success');
    window._afterReceiptClose = resetMeterSelection;
    window.openBillReceipt?.(newBillId);
    return;
  }

  const prev    = Number(member.lastRead);
  const usage   = Math.round(curr - prev);
  const charges = calcWaterCharge(usage, member.meterSize || '0.5');

  const existingBill = bills.find(b => b.memberId === currentMeterMemberId && b.period === period && b.status !== 'cancelled');
  const billId = existingBill ? existingBill.id : nextBillNo();

  const newReading = {
    id: 'MR-'+Date.now(), memberId: currentMeterMemberId, meter: member.meter,
    readingDate: today, period, prevReading: prev, currReading: curr, usage,
    waterCharge: charges.waterCharge, serviceCharge: charges.serviceCharge,
    total: charges.total, readBy: 'ผู้ดูแลระบบ', method: 'manual',
    anomaly: usage > 45 ? 'high_usage' : null, billId,
  };
  meterReadings.push(newReading);

  if (existingBill) {
    existingBill.usage = usage;
    existingBill.waterCharge   = charges.waterCharge;
    existingBill.serviceCharge = charges.serviceCharge;
    existingBill.total         = charges.total;
    existingBill.issueDate     = today;
  } else {
    const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 15);
    bills.push({
      id: billId, memberId: currentMeterMemberId, period,
      issueDate: today, dueDate: dueDate.toISOString().split('T')[0],
      usage, waterCharge: charges.waterCharge, serviceCharge: charges.serviceCharge,
      lateFee: 0, discount: 0, total: charges.total,
      status: 'pending', sentVia: '', issuedBy: 'admin',
    });
  }
  member.lastRead = curr; member.lastReadDate = today;

  const savedBill = bills.find(b => b.id === billId);
  if (savedBill) await sbUpsertBill(savedBill);
  sbUpsertReading(newReading);
  sbUpdateMember(member);
  saveToStorage();
  window.populateBillingFilters?.();
  window.renderBilling?.();
  toast(`บันทึกแล้ว — ${member.firstName} ใช้ ${usage} m³ ค่าน้ำ ฿${charges.total.toLocaleString()}`, 'success');
  window._afterReceiptClose = resetMeterSelection;
  window.openBillReceipt?.(billId);
}

export function renderMeterHistory(memberId) {
  const { meterReadings } = appState;
  const tbody = document.getElementById('meter-history-tbody');
  if (!tbody) return;
  const history = meterReadings
    .filter(r => r.memberId === memberId)
    .sort((a, b) => b.readingDate.localeCompare(a.readingDate))
    .slice(0, 6);
  if (!history.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--gray-500);padding:20px">ไม่มีประวัติการอ่านมิเตอร์</td></tr>';
    return;
  }
  tbody.innerHTML = history.map(r => `<tr>
    <td class="text-muted" style="font-size:12px">${r.readingDate}</td>
    <td class="mono">${r.prevReading.toLocaleString()}</td>
    <td class="mono text-bold" style="color:var(--blue-900)">${r.currReading.toLocaleString()}</td>
    <td><strong>${r.usage}</strong> m³</td>
    <td class="text-bold">฿${r.total.toLocaleString()}</td>
    <td>${r.anomaly
      ? `<span class="pill pill-overdue" style="font-size:10px;padding:2px 7px">${anomalyMap[r.anomaly]||r.anomaly}</span>`
      : `<span class="pill pill-normal" style="font-size:10px;padding:2px 7px">ปกติ</span>`
    }</td>
    <td class="text-muted" style="font-size:11px">${methodMap[r.method]||r.method} · ${r.readBy}</td>
  </tr>`).join('');
}
