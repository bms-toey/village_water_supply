// ─── Meter Module ──────────────────────────────────────────────
import { toLocalDate, todayISO } from '../../utils/time.util.js';
import { appState } from '../../state/app.state.js';
import { esc, jsArg, toast } from '../../utils/dom.util.js';
import { _sb } from '../../services/supabase.service.js';
import { currentPeriod, isPeriodClosed } from '../../utils/date.util.js';
import { calcWaterCharge, calcWaterBreakdown, rateConfig } from '../../config/rate.config.js';
import { anomalyMap, methodMap, getMeterSizeDisplay } from '../../config/ui.config.js';
import { sbSaveMeterReading, staffName, loadAllFromSupabase } from '../../services/data-loader.service.js';
import { saveToStorage } from '../../services/storage.service.js';
import { goPage } from '../../components/navigation/navigation.js';
import { _dbVillages, _periodYM } from '../../services/db-mapper.service.js';
import { uploadImage, signedImageUrl } from '../../services/files.service.js';
import {
  rolloverUsage, meterMax, askConfirm, enqueueReading, syncQueue, queuedMemberIds, isNetworkFailure,
  queueBannerHtml, openQueueConflicts, discardQueued, openMeterSkip, renderFieldBar, skipFor, SKIP_REASONS,
  routeCompare, openRouteOrder, saveMemberGps,
} from './field.js';
import { openModal } from '../../components/modal/modal.js';

// ─── Meter Photo / AI OCR ─────────────────────────────────────

// AI อ่านเลขมิเตอร์ผ่าน Edge Function meter-ocr — API key อยู่ที่ server ไม่ส่งมาที่ browser
let _saving = false;   // กันกดบันทึกซ้ำระหว่างรอ server ออกเลขบิล
let _photoFile = null; // รูปมิเตอร์ที่ถ่ายไว้ — อัปโหลดเป็นหลักฐานตอนบันทึก

function _getFileInput(id, capture) {
  let inp = document.getElementById(id);
  if (!inp) {
    inp = document.createElement('input');
    inp.type   = 'file';
    inp.accept = 'image/*';
    inp.id     = id;
    inp.style.display = 'none';
    if (capture) inp.setAttribute('capture', capture);
    document.body.appendChild(inp);
    inp.addEventListener('change', function () {
      if (this.files[0]) _processMeterPhoto(this.files[0]);
      this.value = '';
    });
  }
  return inp;
}

async function _processMeterPhoto(file) {
  const statusEl  = document.getElementById('meter-ocr-status');
  const wrap      = document.getElementById('meter-photo-wrap');
  const drop      = document.getElementById('meter-photo-drop');
  const preview   = document.getElementById('meter-photo-preview');
  const clearBtn  = document.getElementById('meter-photo-clear-btn');
  const aiBtn     = document.getElementById('meter-ai-btn');

  _photoFile = file;
  // Show preview
  const url = URL.createObjectURL(file);
  if (preview) preview.src = url;
  if (wrap)     wrap.style.display  = '';
  if (drop)     drop.style.display  = 'none';
  if (clearBtn) clearBtn.style.display = '';

  // Status: loading
  if (statusEl) {
    statusEl.style.display = '';
    statusEl.style.color   = 'var(--gray-600)';
    statusEl.innerHTML     = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite;margin-right:6px"></i>กำลังวิเคราะห์ตัวเลขมิเตอร์...';
  }
  if (aiBtn) { aiBtn.disabled = true; aiBtn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i>กำลังอ่าน...'; }

  const done = () => {
    if (aiBtn) { aiBtn.disabled = false; aiBtn.innerHTML = '<i class="ti ti-scan"></i>AI Scan'; }
  };

  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const { data, error } = await _sb.functions.invoke('meter-ocr', {
      body: { image: base64, mime: file.type || 'image/jpeg' },
    });
    if (error) throw new Error('บริการ AI ไม่พร้อมใช้งาน');

    const text   = String(data?.text ?? '').trim();
    const digits = String(data?.reading ?? text).replace(/\D/g, '');

    if (digits.length >= 3) {
      const val = parseInt(digits, 10);
      const inp = document.getElementById('meter-new-val');
      if (inp) { inp.value = val; inp.dispatchEvent(new Event('input')); }
      calcMeter(String(val));
      if (statusEl) {
        statusEl.innerHTML = `<i class="ti ti-check" style="color:var(--green-700);margin-right:4px"></i>` +
          `AI อ่านได้: <strong>${val.toLocaleString()}</strong> — กรุณาตรวจสอบความถูกต้อง`;
        statusEl.style.color = 'var(--green-700)';
      }
    } else {
      if (statusEl) {
        statusEl.innerHTML = `<i class="ti ti-alert-triangle" style="margin-right:4px"></i>อ่านไม่ได้ชัดเจน (AI ตอบว่า: "${esc(text.slice(0, 40) || 'ไม่มีข้อมูล')}") — กรุณากรอกเอง`;
        statusEl.style.color = 'var(--amber-700)';
      }
    }
  } catch (err) {
    console.error('[Meter AI]', err);
    if (statusEl) {
      statusEl.innerHTML = `<i class="ti ti-alert-triangle" style="margin-right:4px"></i>เกิดข้อผิดพลาด: ${esc(err.message)} — กรุณากรอกเอง`;
      statusEl.style.color = 'var(--red-700)';
    }
  }
  done();
}

// Exposed to window — called from inline onclick
window._startMeterScan = function () {
  _getFileInput('meter-cam-input', 'environment').click();
};

window._openMeterGallery = function () {
  _getFileInput('meter-gallery-input', '').click();
};

window._handleMeterDrop = function (e) {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('image/')) _processMeterPhoto(file);
};

window._clearMeterPhoto = function () {
  _photoFile = null;
  const preview  = document.getElementById('meter-photo-preview');
  const wrap     = document.getElementById('meter-photo-wrap');
  const drop     = document.getElementById('meter-photo-drop');
  const status   = document.getElementById('meter-ocr-status');
  const clearBtn = document.getElementById('meter-photo-clear-btn');
  if (preview)  { preview.src = ''; URL.revokeObjectURL(preview.src); }
  if (wrap)     wrap.style.display  = 'none';
  if (drop)     drop.style.display  = '';
  if (status)   status.style.display = 'none';
  if (clearBtn) clearBtn.style.display = 'none';
};

// Reset photo when member changes
function _resetMeterPhoto() {
  window._clearMeterPhoto?.();
}

// ─── Filter State ─────────────────────────────────────────────
let _meterSearch        = '';
let _meterStatusFilter  = 'pending'; // 'pending' | 'done' | 'all'
let _meterVillageFilter = '';        // '' = ทุกหมู่บ้าน

// Exposed to window for inline onchange/onclick in generated HTML
window._setMeterStatus  = (v) => { _meterStatusFilter  = v; renderMeter(); };
window._setMeterVillage = (v) => { _meterVillageFilter = v; renderMeter(); };

// ─── Render: Member Selection List ───────────────────────────
// โครง (สไตล์ที่ styles/meter.css → .mtl-*):
//   หัวเพจ   : รอบ + ความคืบหน้า (#meter-hd-progress)
//   แถบกรอง  : ค้นหา / หมู่บ้าน / สถานะ — ติดหัวจอเวลาเลื่อน
//   รายการ   : จัดกลุ่มตามหมู่บ้าน, แถวละ 2 บรรทัด, จอกว้าง 2 คอลัมน์
export function renderMeter(searchOverride) {
  if (searchOverride !== undefined) _meterSearch = searchOverride;
  const { members, meterReadings } = appState;
  const period = currentPeriod();
  const wrap   = document.getElementById('meter-member-list');
  const hdProg = document.getElementById('meter-hd-progress');
  if (!wrap) return;

  if (appState.currentMeterMemberId) {
    wrap.style.display = 'none';
    if (hdProg) hdProg.style.display = 'none';
    return;
  }
  wrap.style.display = '';

  const q         = _meterSearch.toLowerCase().trim();
  const allActive = members.filter(m => m.status !== 'closed');
  const readSet   = new Set(
    meterReadings
      .filter(r => r.period === period)
      .filter(r => { const b = appState.bills.find(x => x.id === r.billId); return b && b.status !== 'cancelled'; })
      .map(r => r.memberId)
  );
  queuedMemberIds(period).forEach(id => readSet.add(id));   // จดไว้ในเครื่อง รอซิงก์ — ถือว่าจดแล้ว

  // ── Global progress counts ──────────────────────────────────
  const totalAll   = allActive.length;
  const doneAll    = allActive.filter(m =>  readSet.has(m.id)).length;
  const pendingAll = totalAll - doneAll;
  const skipAll    = allActive.filter(m => !readSet.has(m.id) && skipFor(m.id, period)).length;
  const pct        = totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : 0;

  // ── การอ่านรอบนี้ (บิลไม่ถูกยกเลิก) + ค่าเฉลี่ย 4 รอบก่อน (เกณฑ์เดียวกับ _avgUsage) — วนรอบเดียวทั้งรายการ ──
  const curReading = new Map();
  const pastUsage  = new Map();
  [...meterReadings].sort((a, b) => b.readingDate.localeCompare(a.readingDate)).forEach(r => {
    if (r.period === period) {
      const b = appState.bills.find(x => x.id === r.billId);
      if (b && b.status !== 'cancelled' && !curReading.has(r.memberId)) curReading.set(r.memberId, r);
      return;
    }
    if (!(r.usage > 0)) return;
    const arr = pastUsage.get(r.memberId) || [];
    if (arr.length < 4) { arr.push(r.usage); pastUsage.set(r.memberId, arr); }
  });
  const avgOf = id => { const a = pastUsage.get(id); return a && a.length >= 2 ? a.reduce((s, u) => s + u, 0) / a.length : null; };

  // ── Per-village sequence numbers (from ALL active members) ──
  // Sequence = position within village sorted by route order → house number (1-based)
  const villageSeqMap = new Map();
  const tempVillGroups = {};
  allActive.forEach(m => {
    const v = m.village || '—';
    if (!tempVillGroups[v]) tempVillGroups[v] = [];
    tempVillGroups[v].push(m);
  });
  Object.values(tempVillGroups).forEach(mems => {
    mems.sort(routeCompare);
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
  if (_meterVillageFilter) filtered = filtered.filter(m => String(m.villageId) === _meterVillageFilter);

  // Filtered counts for tab badges
  const filtPending = filtered.filter(m => !readSet.has(m.id)).length;
  const filtDone    = filtered.filter(m =>  readSet.has(m.id)).length;
  const filtTotal   = filtered.length;

  // ── Apply status filter ─────────────────────────────────────
  let displayList = filtered;
  if (_meterStatusFilter === 'pending') displayList = filtered.filter(m => !readSet.has(m.id));
  if (_meterStatusFilter === 'done')    displayList = filtered.filter(m =>  readSet.has(m.id));

  // ── Sort: moo_number → pending first → route/houseNo ────────
  const villMooMap = {};
  _dbVillages.forEach(v => { villMooMap[v.name] = v.moo_number || 999; });
  displayList.sort((a, b) => {
    const mooA = villMooMap[a.village] || 999;
    const mooB = villMooMap[b.village] || 999;
    if (mooA !== mooB) return mooA - mooB;
    const pendA = readSet.has(a.id) ? 1 : 0;
    const pendB = readSet.has(b.id) ? 1 : 0;
    if (pendA !== pendB) return pendA - pendB; // pending before done
    return routeCompare(a, b);                  // ลำดับเส้นทาง → บ้านเลขที่
  });

  // ── Group by village (preserving sort order) ────────────────
  const groups = [];
  displayList.forEach(m => {
    const v    = m.village || '—';
    const last = groups[groups.length - 1];
    if (!last || last.village !== v) groups.push({ village: v, villageId: m.villageId, members: [] });
    groups[groups.length - 1].members.push(m);
  });

  // ── Village dropdown options ────────────────────────────────
  const activeVillages = [..._dbVillages]
    .filter(v => v.is_active !== false)
    .sort((a, b) => (a.moo_number || 0) - (b.moo_number || 0));
  const villageOpts = activeVillages.map(v =>
    `<option value="${v.id}"${_meterVillageFilter === String(v.id) ? ' selected' : ''}>${v.moo_number ? `หมู่ ${v.moo_number} · ` : ''}${esc(v.name)}</option>`
  ).join('');

  // ── หัวเพจ: รอบ + ความคืบหน้า ──────────────────────────────
  const hdId = document.getElementById('meter-hd-id');
  if (hdId) hdId.textContent = `รอบ ${period} · แตะรายชื่อเพื่อเริ่มจด`;
  if (hdProg) {
    hdProg.style.display = '';
    hdProg.innerHTML = `
      <div class="mtl-ring${pct >= 100 ? ' is-full' : ''}" style="--p:${pct}" role="img" aria-label="ความคืบหน้า ${pct}%"><b>${pct}<small>%</small></b></div>
      <div class="mtl-kpis">
        <div class="mtl-kpi is-done"><span>จดแล้ว</span><b>${doneAll.toLocaleString()}</b></div>
        <div class="mtl-kpi is-pend"><span>รอจด</span><b>${pendingAll.toLocaleString()}</b></div>
        <div class="mtl-kpi is-skip"><span>จดไม่ได้</span><b>${skipAll.toLocaleString()}</b></div>
        <div class="mtl-kpi"><span>ทั้งหมด</span><b>${totalAll.toLocaleString()}</b></div>
      </div>`;
  }

  // ── Empty-state message ─────────────────────────────────────
  const emptyMsg = _meterStatusFilter === 'pending' && !q && !_meterVillageFilter
    ? '<i class="ti ti-circle-check"></i><b>จดมิเตอร์ครบทุกรายในรอบนี้แล้ว</b>'
    : '<i class="ti ti-search-off"></i><b>ไม่พบสมาชิกตามเงื่อนไขที่เลือก</b>';

  const _searchWasFocused = document.activeElement?.id === 'meter-search-inp';

  const _tab = (label, n, status) =>
    `<button type="button" class="mtl-tab is-${status}${_meterStatusFilter === status ? ' active' : ''}"
      aria-pressed="${_meterStatusFilter === status}" onclick="window._setMeterStatus(${jsArg(status)})">${label}<b>${n}</b></button>`;

  const _row = m => {
    const done    = readSet.has(m.id);
    const seq     = villageSeqMap.get(m.id) || '—';
    const reading = done ? curReading.get(m.id) : null;
    const skip    = !done ? skipFor(m.id, period) : null;
    const queued  = done && !reading;
    const size    = getMeterSizeDisplay(m.meterSize || '0.5');
    const avg     = avgOf(m.id);
    const state   = queued ? 'queued' : done ? 'done' : skip ? 'skip' : 'pend';

    const badge = queued ? '<span class="mtl-badge is-queued"><i class="ti ti-cloud-upload"></i>รอส่ง</span>'
      : done ? '<span class="mtl-badge is-done"><i class="ti ti-check"></i>จดแล้ว</span>'
      : skip ? `<span class="mtl-badge is-skip"><i class="ti ${SKIP_REASONS[skip.reason]?.icon || 'ti-ban'}"></i>${esc(SKIP_REASONS[skip.reason]?.label || 'จดไม่ได้')}</span>`
      : '';
    const anomaly = reading?.anomaly && anomalyMap[reading.anomaly]
      ? `<span class="mtl-badge is-warn"><i class="ti ti-alert-triangle"></i>${esc(anomalyMap[reading.anomaly])}</span>` : '';

    // ด้านขวา: จดแล้ว = ก่อน → ใหม่ + หน่วย/ยอด, ยังไม่จด = เลขล่าสุด + ค่าเฉลี่ย
    const right = reading
      ? `<span class="mtl-read"><small>${Number(reading.prevReading).toLocaleString()} →</small><b>${Number(reading.currReading).toLocaleString()}</b></span>
         <span class="mtl-sub">${Number(reading.usage).toLocaleString()} m³${reading.total != null ? ` · <em>฿${Number(reading.total).toLocaleString()}</em>` : ''}</span>`
      : `<span class="mtl-read"><small>ล่าสุด</small><b>${_effectivePrev(m.id).toLocaleString()}</b></span>
         <span class="mtl-sub">${queued ? 'บันทึกในเครื่อง' : avg !== null ? `เฉลี่ย ${Math.round(avg).toLocaleString()} m³` : 'ยังไม่มีประวัติ'}</span>`;

    return `
      <button type="button" class="mtl-row is-${state}"
        onclick="gotoMeter(${jsArg(m.firstName + ' ' + m.lastName)},${jsArg(m.meter || '')},${Number(m.id)})">
        <span class="mtl-seq">${seq}</span>
        <span class="mtl-main">
          <span class="mtl-name"><b>${esc(m.firstName)} ${esc(m.lastName)}</b>${badge}${anomaly}</span>
          <span class="mtl-meta">
            <span><i class="ti ti-home"></i>${esc(m.houseNo || '—')}</span>
            <span class="mtl-mono">${esc(m.meter || '—')}</span>
            ${size ? `<span>${esc(size)}</span>` : ''}
          </span>
        </span>
        <span class="mtl-right">${right}</span>
        <i class="ti ti-chevron-right mtl-go"></i>
      </button>`;
  };

  wrap.innerHTML = `
  <!-- ─── แถบค้นหา/กรอง (sticky) ─── -->
  <div class="mtl-bar">
    <input id="meter-search-inp" class="form-input lx-search mtl-search" type="search" enterkeyhint="search"
      placeholder="ค้นหาชื่อ, มิเตอร์, บ้านเลขที่..." aria-label="ค้นหาสมาชิก"
      value="${esc(_meterSearch)}" oninput="renderMeter(this.value)"/>
    <select class="form-input mtl-village" aria-label="กรองหมู่บ้าน" onchange="window._setMeterVillage(this.value)">
      <option value="">ทุกหมู่บ้าน</option>
      ${villageOpts}
    </select>
    <div class="mtl-tabs" role="group" aria-label="สถานะการจด">
      ${_tab('รอจด', filtPending, 'pending')}
      ${_tab('จดแล้ว', filtDone, 'done')}
      ${_tab('ทั้งหมด', filtTotal, 'all')}
    </div>
  </div>
  ${queueBannerHtml()}

  <!-- ─── รายชื่อ จัดกลุ่มตามหมู่บ้าน ─── -->
  ${!displayList.length
    ? `<div class="mtl-empty">${emptyMsg}</div>`
    : groups.map(g => {
        const vInfo  = _dbVillages.find(v => v.id === g.villageId);
        const mooTxt = vInfo?.moo_number ? `หมู่ ${vInfo.moo_number} · ` : '';
        const vAll   = tempVillGroups[g.village] || g.members;
        const vDone  = vAll.filter(m => readSet.has(m.id)).length;
        const vPct   = vAll.length ? Math.round(vDone / vAll.length * 100) : 0;
        return `
        <section class="mtl-group">
          <div class="mtl-ghd">
            <i class="ti ti-map-pin"></i>
            <span class="mtl-gname">${mooTxt}${esc(g.village)}</span>
            <span class="mtl-gbar" title="จดแล้ว ${vDone} จาก ${vAll.length} ราย"><span style="width:${vPct}%"></span></span>
            <span class="mtl-gcount"><b>${vDone}</b>/${vAll.length}</span>
            ${g.village !== '—' ? `<button type="button" class="mtl-groute" title="ลำดับเส้นทาง" aria-label="ลำดับเส้นทาง ${esc(g.village)}" onclick="openRouteOrder(${jsArg(g.villageId)})"><i class="ti ti-route"></i></button>` : ''}
          </div>
          <div class="mtl-list">${g.members.map(_row).join('')}</div>
        </section>`;
      }).join('')
  }

  <!-- ─── FAB: จดถัดไป ─── -->
  ${pendingAll > 0 ? `
  <button type="button" class="meter-fab mtl-fab" onclick="window._gotoNextPending()">
    <i class="ti ti-player-skip-forward"></i>จดถัดไป<span>${pendingAll}</span>
  </button>` : `
  <div class="meter-fab mtl-fab is-complete"><i class="ti ti-circle-check"></i>จดครบแล้ว!</div>`}
  `;

  if (_searchWasFocused) {
    const inp = document.getElementById('meter-search-inp');
    if (inp) { inp.focus(); const len = inp.value.length; inp.setSelectionRange(len, len); }
  }
}

// FAB: ข้ามไปสมาชิกถัดไปที่ยังไม่จด (เรียงตามลำดับหมู่บ้าน → บ้านเลขที่)
window._gotoNextPending = function () {
  const period  = currentPeriod();
  const readSet = new Set(
    appState.meterReadings
      .filter(r => r.period === period)
      .filter(r => { const b = appState.bills.find(x => x.id === r.billId); return b && b.status !== 'cancelled'; })
      .map(r => r.memberId)
  );
  const pending = appState.members.filter(m => m.status !== 'closed' && !readSet.has(m.id));
  if (!pending.length) return;
  const villMooMap = {};
  _dbVillages.forEach(v => { villMooMap[v.name] = v.moo_number || 999; });
  const queued = queuedMemberIds(period);
  const todo = pending.filter(m => !queued.has(m.id));
  if (!todo.length) return;
  todo.sort((a, b) => {
    const mA = villMooMap[a.village] || 999, mB = villMooMap[b.village] || 999;
    if (mA !== mB) return mA - mB;
    return routeCompare(a, b);
  });
  const m = todo[0];
  gotoMeter(m.firstName + ' ' + m.lastName, m.meter || '', m.id);
};

export function gotoMeter(name, meterId, memberId) {
  appState.currentMeterMemberId = memberId || null;
  const period = currentPeriod();
  document.getElementById('meter-hd-name').textContent = 'จดมิเตอร์: ' + name;
  document.getElementById('meter-hd-id').textContent   = 'รหัสมิเตอร์: ' + meterId + ' • รอบ ' + period;
  const tagEl = document.getElementById('meter-period-tag');
  if (tagEl) tagEl.textContent = 'รอบ ' + period;
  _renderMemberChips(memberId && appState.members.find(x => x.id === memberId), meterId);
  const inp = document.getElementById('meter-new-val');
  if (inp) { inp.value = ''; calcMeter(''); }
  _resetMeterPhoto();
  if (memberId) {
    const prevEl = document.getElementById('m-prev');
    if (prevEl) prevEl.textContent = _effectivePrev(memberId).toLocaleString();
    renderMeterHistory(memberId);
    renderFieldBar(appState.members.find(x => x.id === memberId), currentPeriod());
  }
  const listEl    = document.getElementById('meter-member-list');
  const formEl    = document.getElementById('meter-form-area');
  const actionsEl = document.getElementById('meter-hd-actions');
  if (listEl)    listEl.style.display    = 'none';
  if (formEl)    formEl.style.display    = '';
  if (actionsEl) actionsEl.style.display = '';
  const progEl = document.getElementById('meter-hd-progress');
  if (progEl) progEl.style.display = 'none';
  goPage('meter');
  // คีย์บอร์ด/เมาส์ → พร้อมพิมพ์ทันที (มือถือไม่ focus เอง กันคีย์บอร์ดบังข้อมูลบ้าน)
  if (inp && window.matchMedia?.('(pointer:fine)').matches) setTimeout(() => inp.focus(), 120);
}

// ชิปข้อมูลบ้านใต้หัวเพจ — บ้านเลขที่ / หมู่บ้าน / มิเตอร์ / ขนาด / ลำดับรอบนี้
function _renderMemberChips(member, meterId) {
  const el = document.getElementById('meter-member-chips');
  if (!el) return;
  if (!member) { el.innerHTML = ''; return; }
  const chip = (icon, text, cls = '') => text ? `<span class="mtr-chip ${cls}"><i class="ti ${icon}"></i>${esc(text)}</span>` : '';
  const size = getMeterSizeDisplay(member.meterSize || '0.5');
  el.innerHTML =
    chip('ti-home', member.houseNo ? 'บ้านเลขที่ ' + member.houseNo : '') +
    chip('ti-map-pin', member.village || '') +
    chip('ti-gauge', (meterId || member.meter || '—') + (size ? ` · ${size}` : ''), 'mtr-chip-mono');
}

// ค่าเฉลี่ยการใช้น้ำของบ้านนี้ (4 รอบล่าสุดที่มีการใช้ ไม่นับรอบปัจจุบัน) — มีไม่ถึง 2 รอบใช้ 15 m³
function _avgUsage(memberId) {
  const period = currentPeriod();
  const hist = appState.meterReadings
    .filter(r => r.memberId === memberId && r.period !== period && r.usage > 0)
    .sort((a, b) => b.readingDate.localeCompare(a.readingDate))
    .slice(0, 4);
  return hist.length >= 2 ? hist.reduce((s, r) => s + r.usage, 0) / hist.length : 15;
}

// ตารางอัตราค่าน้ำจาก rateConfig — ไฮไลต์ขั้นที่ใช้จริงพร้อมยอดแต่ละขั้น
function _renderRateList(usage, meterSize) {
  const el = document.getElementById('meter-rate-list');
  if (!el) return;
  const used = new Map((usage > 0 ? calcWaterBreakdown(usage) : []).map(b => [b.from, b]));
  const rows = rateConfig.tiers.map(t => {
    const lbl = (t.to === Infinity || t.to === null) ? `${t.from}+ หน่วย` : `${t.from}–${t.to} หน่วย`;
    const b   = used.get(t.from);
    return `<div class="mtr-rate${b ? ' is-used' : ''}">
      <span class="mtr-rate-range">${lbl}</span>
      <span class="mtr-rate-calc">${b ? `${b.units} × ฿${b.rate} = <b>฿${Math.round(b.charge).toLocaleString()}</b>` : ''}</span>
      <span class="mtr-rate-val">${Number(t.rate).toFixed(2)} ฿</span>
    </div>`;
  }).join('');
  const svc = usage > 0 ? calcWaterCharge(usage, meterSize).serviceCharge : null;
  el.innerHTML = rows + `
    <div class="mtr-rate mtr-rate-svc${svc !== null ? ' is-used' : ''}">
      <span class="mtr-rate-range">ค่าบริการรายเดือน</span>
      <span class="mtr-rate-calc">${svc !== null ? `มิเตอร์ ${esc(getMeterSizeDisplay(meterSize))} = <b>฿${svc}</b>` : ''}</span>
      <span class="mtr-rate-val">${rateConfig.svcSmall}–${rateConfig.svcLarge} ฿</span>
    </div>`;
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
  if (hdId)      hdId.textContent        = 'แตะรายชื่อเพื่อเริ่มจด';
  renderMeter();
}

export function calcMeter(val) {
  const { currentMeterMemberId, members } = appState;
  const member = currentMeterMemberId ? members.find(m => m.id === currentMeterMemberId) : null;
  const prev   = member ? _effectivePrev(member.id) : 0;
  const curr   = parseFloat(val);
  const meterSize = member?.meterSize || '0.5';
  const avg    = member ? _avgUsage(member.id) : 15;
  const uEl    = document.getElementById('m-usage');
  const eEl    = document.getElementById('m-est');
  const esEl   = document.getElementById('m-est-sub');
  const pEl    = document.getElementById('m-pct');
  const p2El   = document.getElementById('m-pct2');
  const prEl   = document.getElementById('m-prog');
  const avgEl  = document.getElementById('m-avg');
  const boxEl  = document.getElementById('m-avg-box');
  const wEl    = document.getElementById('meter-warn');
  if (avgEl) avgEl.textContent = `${Math.round(avg)} m³`;
  const roll = !isNaN(curr) && curr < prev ? rolloverUsage(prev, curr) : null;
  if (!val || isNaN(curr) || (curr <= prev && roll === null)) {
    [uEl, eEl, p2El].forEach(e => { if (e) e.textContent = '—'; });
    if (pEl)   pEl.textContent  = val && !isNaN(curr) ? `ต้องมากกว่า ${prev.toLocaleString()}` : 'รอกรอกเลขมิเตอร์';
    if (esEl)  esEl.textContent = 'ยังไม่ยืนยัน';
    if (prEl)  prEl.style.width = '0%';
    if (boxEl) boxEl.dataset.level = '';
    if (wEl)   wEl.style.display = 'none';
    _renderRateList(0, meterSize);
    return;
  }
  const usage   = roll ?? (curr - prev);
  const charges = calcWaterCharge(usage, meterSize);
  if (uEl)  uEl.textContent  = Number(usage.toFixed(1)).toLocaleString() + ' m³';
  if (pEl)  pEl.textContent  = roll !== null ? 'มิเตอร์วนรอบ' : `${prev.toLocaleString()} → ${curr.toLocaleString()}`;
  if (eEl)  eEl.textContent  = '฿' + charges.total.toLocaleString();
  if (esEl) esEl.textContent = `น้ำ ฿${charges.waterCharge.toLocaleString()} + บริการ ฿${charges.serviceCharge}`;
  const pct  = Math.round((usage / avg) * 100);
  const high = usage > Math.max(avg * 3, 45);   // เกณฑ์เดียวกับ _detectAnomaly → high_usage
  if (p2El)  p2El.textContent = pct + '%';
  if (prEl)  prEl.style.width = Math.min(pct, 100) + '%';
  if (boxEl) boxEl.dataset.level = high ? 'high' : pct > 150 ? 'warn' : 'ok';
  if (wEl)   wEl.style.display = high ? '' : 'none';
  _renderRateList(usage, meterSize);
}

// คืนค่า "เลขอ่านครั้งก่อน" ที่ถูกต้อง — ถ้าบิลปัจจุบันถูกยกเลิก ให้ใช้ prevReading ของ reading นั้นแทน lastRead
function _effectivePrev(memberId) {
  const m = appState.members.find(x => x.id === memberId);
  if (!m) return 0;
  const period = currentPeriod();
  const dr = appState.meterReadings.find(r => r.memberId === memberId && r.period === period);
  if (!dr) return Number(m.lastRead);
  const bill = dr.billId ? appState.bills.find(b => b.id === dr.billId) : null;
  return (!bill || bill.status === 'cancelled') ? Number(dr.prevReading) : Number(m.lastRead);
}

function _detectAnomaly(usage, member, allReadings) {
  if (usage === 0) return 'meter_fault';

  const history = allReadings
    .filter(r => r.memberId === member.id && r.usage > 0)
    .sort((a, b) => b.readingDate.localeCompare(a.readingDate))
    .slice(0, 4);

  const avg = history.length >= 2
    ? history.reduce((s, r) => s + r.usage, 0) / history.length
    : 15;

  if (usage > Math.max(avg * 3, 45)) return 'high_usage';
  if (avg > 10 && usage > 0 && usage < 2) return 'suspected_leak';
  return null;
}

export async function saveMeter() {
  const { bills, members, meterReadings, currentMeterMemberId } = appState;
  const v = document.getElementById('meter-new-val').value;
  if (!v) { toast('กรุณากรอกเลขมิเตอร์', 'error'); return; }
  const curr = parseFloat(v);
  if (!currentMeterMemberId) { toast('ไม่พบข้อมูลสมาชิก', 'error'); return; }
  const member = members.find(m => m.id === currentMeterMemberId);
  if (!member) { toast('ไม่พบข้อมูลสมาชิก', 'error'); return; }

  const period = currentPeriod();
  const today  = todayISO();

  if (isPeriodClosed(period)) {
    toast(`งวด ${period} ปิดแล้ว — บันทึกมิเตอร์/ออกบิลในงวดนี้ไม่ได้`, 'error');
    return;
  }
  if (_saving) return;
  if (queuedMemberIds(period).has(currentMeterMemberId)) {
    toast('บ้านนี้จดไว้ในเครื่องแล้ว รอส่งขึ้นระบบ', 'warn');
    return;
  }

  // ── จดซ้ำในงวดนี้? (server ตรวจซ้ำอีกชั้น และลบการอ่านเดิมให้เองถ้าบิลถูกยกเลิก) ──
  const dupReading = meterReadings.find(r => r.memberId === currentMeterMemberId && r.period === period);
  if (dupReading) {
    const dupBill = dupReading.billId ? bills.find(b => b.id === dupReading.billId) : null;
    if (dupBill && dupBill.status !== 'cancelled') {
      toast(
        `จดมิเตอร์รอบ ${period} ไปแล้ว (${dupReading.readingDate} · ${dupReading.currReading.toLocaleString()} หน่วย)`,
        'error'
      );
      return;
    }
    member.lastRead = dupReading.prevReading;   // บิลเดิมถูกยกเลิก: จดใหม่จากเลขก่อนหน้า
  }

  const prev = Number(member.lastRead);
  let usage = Math.round(curr - prev), rollover = false;
  if (curr <= prev) {
    const roll = rolloverUsage(prev, curr);
    if (roll === null) { toast('เลขมิเตอร์ต้องมากกว่าค่าเดิม', 'error'); return; }
    const okRoll = await askConfirm({
      title: 'มิเตอร์หมุนครบรอบ?', okText: 'ใช่ — วนรอบ', okClass: 'btn-primary', icon: 'ti-rotate-clockwise',
      iconBg: 'var(--blue-50)', iconColor: 'var(--blue-700)',
      message: `เลขใหม่ ${curr.toLocaleString()} น้อยกว่าครั้งก่อน ${prev.toLocaleString()}\nถ้ามิเตอร์หมุนเกิน ${meterMax().toLocaleString()} แล้วเริ่มนับใหม่ จะคิดใช้น้ำ ${roll} หน่วย\n\nถ้ากรอกผิด ให้กดยกเลิกแล้วแก้ไข`,
    });
    if (!okRoll) return;
    usage = Math.round(roll); rollover = true;
  }

  const entry = {
    id: 'MR-' + Date.now(), memberId: currentMeterMemberId, period, readingDate: today,
    prev, curr, usage, rollover, meterMax: rollover ? meterMax() : null,
  };

  // ไม่มีสัญญาณ → เก็บไว้ในเครื่อง ส่งเองเมื่อออนไลน์
  if (!navigator.onLine) {
    await enqueueReading(entry, _photoFile);
    saveToStorage();
    resetMeterSelection();
    return;
  }

  const billId = await persistMeterReading(entry, { photoFile: _photoFile });
  if (!billId) {
    if (isNetworkFailure()) { await enqueueReading(entry, _photoFile); saveToStorage(); resetMeterSelection(); }
    return;
  }
  saveToStorage();
  window.populateBillingFilters?.();
  window.renderBilling?.();
  toast(`บันทึกแล้ว — ${member.firstName} ใช้ ${usage} m³`, 'success');
  window._afterReceiptClose = resetMeterSelection;
  window.openBillReceipt?.(billId);
}

/**
 * บันทึกบิล + การอ่านมิเตอร์ที่ server (RPC save_meter_reading — transaction เดียว, server คิดค่าน้ำเอง)
 * คืนเลขบิล หรือ null ถ้าไม่สำเร็จ
 * ใช้ทั้งตอนจดปกติ และตอนส่งข้อมูลที่จดไว้ในเครื่อง (field.js → syncQueue)
 */
export async function persistMeterReading(entry, { photoFile = null } = {}) {
  const { bills, meterReadings, members } = appState;
  const member = members.find(m => m.id === entry.memberId);
  if (!member) return null;
  const { year, month } = _periodYM(entry.period);

  _saving = true;
  let res;
  try {
    let photoPath = null;
    if (photoFile) {
      photoPath = await uploadImage('meter-photos', `${entry.readingDate.slice(0, 7)}/${entry.id}.jpg`, photoFile);
      // อัปโหลดรูปไม่ได้ ยังบันทึกการอ่านต่อ (แจ้งเตือนแล้ว)
    }
    res = await sbSaveMeterReading({
      ...entry, periodYear: year, periodMonth: month, photoPath, method: entry.method || 'manual',
      anomaly: _detectAnomaly(entry.usage, member, meterReadings),
    });
  } finally {
    _saving = false;
  }
  if (res.error) {
    if (!isNetworkFailure()) toast(res.message, 'error', 6000);
    if (res.code === 'PREV_MISMATCH') loadAllFromSupabase().then(() => window.renderMeter?.());   // ข้อมูลในเครื่องเก่า — ดึงเลขล่าสุด
    return null;
  }

  // แทนที่ข้อมูลในเครื่องด้วยแถวจริงจาก server
  const { bill, reading } = res;
  const bi = bills.findIndex(b => b.id === bill.id);
  if (bi >= 0) bills[bi] = bill; else bills.push(bill);
  const stale = meterReadings.findIndex(r => r.memberId === reading.memberId && r.period === reading.period);
  if (stale >= 0) meterReadings.splice(stale, 1);
  meterReadings.push(reading);
  member.lastRead = reading.currReading; member.lastReadDate = reading.readingDate;
  return bill.id;
}

// ─── ส่งข้อมูลที่จดไว้ในเครื่อง ──────────────────────────────────
export function syncMeterQueue() {
  return syncQueue(persistMeterReading).then(() => { saveToStorage(); window.renderBilling?.(); });
}
window.addEventListener('online', () => syncMeterQueue());
window.addEventListener('aquaflow:data-ready', () => syncMeterQueue());
Object.assign(window, { syncMeterQueue, openQueueConflicts, discardQueued, openMeterSkip, openRouteOrder, saveMemberGps });

window._viewMeterPhoto = async function (readingId) {
  const r = appState.meterReadings.find(x => x.id === readingId);
  const url = r && await signedImageUrl('meter-photos', r.photoUrl);
  if (!url) return;
  openModal({
    id: 'meter-photo-modal', title: `รูปมิเตอร์ ${r.meter} — ${r.readingDate}`, icon: 'ti-photo', width: 520,
    body: `<img src="${esc(url)}" alt="รูปมิเตอร์" style="width:100%;border-radius:var(--radius-md)"/>
      <div style="margin-top:8px;font-size:13px">เลขที่จด <b>${r.currReading.toLocaleString()}</b> · ใช้น้ำ ${r.usage} ลบ.ม.</div>`,
  });
};

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
    <td class="text-muted" style="font-size:11px">${methodMap[r.method]||r.method} · ${esc(staffName(r.readById) || '—')}${r.photoUrl
      ? ` <button class="btn-icon" style="width:24px;height:24px;font-size:13px" title="ดูรูปมิเตอร์" aria-label="ดูรูปมิเตอร์" onclick="_viewMeterPhoto(${jsArg(r.id)})"><i class="ti ti-photo"></i></button>` : ''}</td>
  </tr>`).join('');
}
