// ─── Map Module ────────────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc } from '../../utils/dom.util.js';
import { statusMap } from '../../config/ui.config.js';

let _mapInstance  = null;
let _mapMarkers   = [];

const villageCenters = {
  'หมู่ 1 บ้านป่า':   [18.7883, 98.9853],
  'หมู่ 2 บ้านคลอง':  [18.7860, 98.9840],
  'หมู่ 3 หนองใหญ่':  [18.7900, 98.9870],
  'หมู่ 3 ท่าช้าง':   [18.7920, 98.9890],
  'หมู่ 4 โคกสูง':    [18.7940, 98.9850],
};
const villageColors = {
  'หมู่ 1 บ้านป่า':   '#3b82f6',
  'หมู่ 2 บ้านคลอง':  '#10b981',
  'หมู่ 3 หนองใหญ่':  '#f59e0b',
  'หมู่ 3 ท่าช้าง':   '#8b5cf6',
  'หมู่ 4 โคกสูง':    '#ef4444',
};
const statusFill = { normal: '#16a34a', overdue: '#dc2626', closed: '#6b7280', suspended: '#d97706' };

function _effectiveLatLng(m) {
  if (m.gpsLat && m.gpsLng) return [m.gpsLat, m.gpsLng];
  const center = villageCenters[m.village] || [18.7900, 98.9870];
  const seed  = (m.id * 9301 + 49297) % 233280;
  const seed2 = (m.id * 1234 + 5678)  % 9999;
  return [center[0] + (seed / 233280 - 0.5) * 0.003, center[1] + (seed2 / 9999 - 0.5) * 0.003];
}

export function renderMap() {
  const { members, bills, meterReadings } = appState;
  const container = document.getElementById('map-container');
  if (!container) return;

  if (typeof L === 'undefined') {
    container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--gray-500)"><div style="text-align:center;padding:32px"><i class="ti ti-map-off" style="font-size:48px;display:block;margin-bottom:12px"></i><div style="font-size:14px;font-weight:600">กำลังโหลดไลบรารีแผนที่...</div><div style="font-size:12px;margin-top:8px">กรุณารอสักครู่แล้วกดรีเฟรช</div></div></div>`;
    setTimeout(renderMap, 800);
    return;
  }

  _renderMapStats();

  if (!members.length) {
    container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--gray-500)"><div style="text-align:center;padding:32px"><i class="ti ti-users-group" style="font-size:48px;display:block;margin-bottom:12px"></i><div style="font-size:14px;font-weight:600">ยังไม่มีข้อมูลสมาชิก</div><div style="font-size:12px;margin-top:8px">กรุณาเพิ่มสมาชิกหรือตรวจสอบการเชื่อมต่อ Supabase</div></div></div>`;
    return;
  }

  if (_mapInstance) { _mapInstance.remove(); _mapInstance = null; }
  _mapMarkers = [];

  const coords = members.map(m => _effectiveLatLng(m));
  const avgLat = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const avgLng = coords.reduce((s, c) => s + c[1], 0) / coords.length;

  _mapInstance = L.map(container, { zoomControl: true }).setView([avgLat, avgLng], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(_mapInstance);

  // Village zones
  const vGroups = {};
  members.forEach(m => {
    const v = m.village || 'อื่น ๆ';
    if (!vGroups[v]) vGroups[v] = { lats: [], lngs: [] };
    const [lat, lng] = _effectiveLatLng(m);
    vGroups[v].lats.push(lat); vGroups[v].lngs.push(lng);
  });
  Object.entries(vGroups).forEach(([v, g]) => {
    const cLat = g.lats.reduce((s, x) => s + x, 0) / g.lats.length;
    const cLng = g.lngs.reduce((s, x) => s + x, 0) / g.lngs.length;
    const color = villageColors[v] || '#94a3b8';
    L.circle([cLat, cLng], { radius: 120, color, fillColor: color, fillOpacity: 0.1, weight: 2, dashArray: '7 5' })
      .bindTooltip(`<strong style="font-family:'Sarabun',sans-serif">${v}</strong><br><span style="font-size:11px">${g.lats.length} หลังคา</span>`, { sticky: true })
      .addTo(_mapInstance);
  });

  // Member markers
  members.forEach(m => {
    const [lat, lng]   = _effectiveLatLng(m);
    const fill         = statusFill[m.status] || statusFill.normal;
    const memberBills  = bills.filter(b => b.memberId === m.id);
    const latestBill   = [...memberBills].sort((a, b) => b.period.localeCompare(a.period))[0];
    const totalDebt    = memberBills.filter(b => b.status === 'overdue').reduce((s, b) => s + b.total, 0);
    const usage        = latestBill ? latestBill.usage : 0;
    const radius       = Math.max(7, Math.min(18, 7 + usage / 4));
    const st           = statusMap[m.status] || statusMap.normal;
    const marker = L.circleMarker([lat, lng], { radius, color: '#fff', weight: 2, fillColor: fill, fillOpacity: 0.9 });
    marker.bindPopup(`<div style="font-family:'Sarabun',sans-serif;min-width:200px;padding:2px">
        <div style="font-weight:800;font-size:14px">${esc(m.firstName)} ${esc(m.lastName)}</div>
        <div style="font-size:12px;color:#555;margin-top:2px">${esc(m.houseNo||'—')} ${esc(m.village)}</div>
        <div style="font-size:12px;color:#555">มิเตอร์: <strong>${esc(m.meter)}</strong></div>
        <div style="margin-top:6px;display:flex;align-items:center;gap:6px;font-size:12px">
          <span style="background:${fill};color:#fff;padding:2px 8px;border-radius:10px;font-weight:700">${st.label}</span>
          <span style="color:#666">${usage} m³/เดือน</span>
        </div>
        ${totalDebt>0?`<div style="color:#dc2626;font-weight:700;font-size:12px;margin-top:4px">ค้างชำระ ฿${totalDebt.toLocaleString()}</div>`:''}
        <div style="display:flex;gap:6px;margin-top:10px">
          <button onclick="closeMemberMapPopup();openMemberQuickView(${m.id})"
            style="flex:1;padding:5px;background:#00236f;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-family:'Sarabun',sans-serif;font-weight:600">&#128196; ดูบิล</button>
          <button onclick="closeMemberMapPopup();gotoMeter('${esc(m.firstName+' '+m.lastName)}','${esc(m.meter)}',${m.id})"
            style="flex:1;padding:5px;background:#0ea5e9;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-family:'Sarabun',sans-serif;font-weight:600">&#128338; จดมิเตอร์</button>
        </div>
      </div>`, { maxWidth: 240 });
    marker.addTo(_mapInstance);
    _mapMarkers.push({ marker, memberId: m.id, village: m.village, status: m.status });
  });

  setTimeout(() => { if (_mapInstance) _mapInstance.invalidateSize(); }, 200);
  setTimeout(() => { if (_mapInstance) _mapInstance.invalidateSize(); }, 600);
}

export function closeMemberMapPopup() { if (_mapInstance) _mapInstance.closePopup(); }

export function filterMapByVillage(village) {
  if (!_mapInstance) return;
  _mapMarkers.forEach(({ marker, village: v }) => {
    if (!village || v === village) marker.addTo(_mapInstance); else marker.remove();
  });
}

export function filterMapByStatus(status) {
  if (!_mapInstance) return;
  _mapMarkers.forEach(({ marker, status: s }) => {
    if (!status || s === status) marker.addTo(_mapInstance); else marker.remove();
  });
}

function _renderMapStats() {
  const el = document.getElementById('map-stats-body');
  if (!el) return;
  const { members, meterReadings } = appState;
  const villages = [...new Set(members.map(m => m.village))].sort();
  el.innerHTML = villages.map(v => {
    const vm     = members.filter(x => x.village === v);
    const vUsage = meterReadings.filter(r => vm.some(x => x.id === r.memberId)).reduce((s, r) => s + r.usage, 0);
    const vOvd   = vm.filter(x => x.status === 'overdue').length;
    const color  = villageColors[v] || '#94a3b8';
    const badge  = vOvd > 0
      ? `<span style="background:#fee2e2;color:#dc2626;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap">ค้าง ${vOvd}</span>`
      : `<span style="background:#dcfce7;color:#16a34a;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">ปกติ</span>`;
    return `<div style="display:flex;align-items:center;gap:9px;padding:8px 0;border-bottom:1px solid var(--gray-100)">
      <div style="width:11px;height:11px;border-radius:50%;background:${color};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div class="text-bold" style="font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v)}</div>
        <div class="text-muted" style="font-size:11px">${vm.length} หลังคา · ${vUsage.toLocaleString()} m³</div>
      </div>
      ${badge}
    </div>`;
  }).join('');
}
