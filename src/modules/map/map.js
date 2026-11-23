// ─── Thailand 3D drilldown map ──────────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc, jsArg } from '../../utils/dom.util.js';
import { statusMap } from '../../config/ui.config.js';
import { _dbVillages } from '../../services/db-mapper.service.js';

const MAPLIBRE_URL = 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.16.0/dist/maplibre-gl.mjs';
const PROVINCES_URL = 'https://cdn.jsdelivr.net/gh/GeoThai/boundaries@v2026.10.23/provinces.geojson';
const DISTRICTS_URL = 'https://cdn.jsdelivr.net/gh/GeoThai/boundaries@v2026.10.23/districts.geojson';
const THAILAND_BOUNDS = [[97.15, 5.55], [105.75, 20.55]];
const FALLBACK_CENTER = { lat: 18.79, lng: 98.987 };
const STATUS_FILL = { normal: '#16a34a', overdue: '#dc2626', closed: '#6b7280', suspended: '#d97706' };

let _maplibrePromise = null;
let _maplibre = null;
let _mapInstance = null;
let _popup = null;
let _provinceData = null;
let _districtData = null;
let _level = 'country';
let _selectedProvince = null;
let _selectedDistrict = null;
let _villageFilter = '';
let _statusFilter = '';
let _renderToken = 0;
const _boundsCache = new WeakMap();

const EMPTY_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'ocean-background', type: 'background', paint: { 'background-color': '#082546' } }],
};

function _loadMapLibre() {
  if (!_maplibrePromise) _maplibrePromise = import(MAPLIBRE_URL);
  return _maplibrePromise;
}

function _effectiveLatLng(member) {
  const lat = Number(member.gpsLat);
  const lng = Number(member.gpsLng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat && lng) return [lat, lng];

  const index = Math.max(0, _dbVillages.findIndex(v => v.id === member.villageId || v.name === member.village));
  const count = Math.max(_dbVillages.length, 1);
  const angle = (index / count) * Math.PI * 2;
  const centerLat = FALLBACK_CENTER.lat + Math.cos(angle) * 0.004;
  const centerLng = FALLBACK_CENTER.lng + Math.sin(angle) * 0.004;
  const seed = (Number(member.id) * 9301 + 49297) % 233280;
  const seed2 = (Number(member.id) * 1234 + 5678) % 9999;
  return [
    centerLat + (seed / 233280 - 0.5) * 0.002,
    centerLng + (seed2 / 9999 - 0.5) * 0.002,
  ];
}

function _filteredMembers() {
  return appState.members.filter(member => {
    const villageOk = !_villageFilter || String(member.villageId) === String(_villageFilter);
    const statusOk = !_statusFilter || member.status === _statusFilter;
    return villageOk && statusOk;
  });
}

function _memberUsage(member) {
  const latest = appState.bills
    .filter(bill => bill.memberId === member.id)
    .sort((a, b) => String(b.period).localeCompare(String(a.period)))[0];
  return Number(latest?.usage) || 0;
}

function _memberDebt(member) {
  return appState.bills
    .filter(bill => bill.memberId === member.id && bill.status === 'overdue')
    .reduce((sum, bill) => sum + (Number(bill.total) || 0), 0);
}

function _pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

function _pointInFeature(point, feature) {
  const geometry = feature?.geometry;
  if (!geometry) return false;
  const bounds = _featureBounds(feature);
  if (point[0] < bounds[0][0] || point[0] > bounds[1][0] || point[1] < bounds[0][1] || point[1] > bounds[1][1]) return false;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(polygon => {
    if (!_pointInRing(point, polygon[0])) return false;
    return !polygon.slice(1).some(hole => _pointInRing(point, hole));
  });
}

function _membersInFeature(feature, members = _filteredMembers()) {
  return members.filter(member => {
    const [lat, lng] = _effectiveLatLng(member);
    return _pointInFeature([lng, lat], feature);
  });
}

function _featureBounds(feature) {
  if (_boundsCache.has(feature)) return _boundsCache.get(feature);
  const bounds = [[Infinity, Infinity], [-Infinity, -Infinity]];
  const walk = coordinates => {
    if (typeof coordinates?.[0] === 'number') {
      bounds[0][0] = Math.min(bounds[0][0], coordinates[0]);
      bounds[0][1] = Math.min(bounds[0][1], coordinates[1]);
      bounds[1][0] = Math.max(bounds[1][0], coordinates[0]);
      bounds[1][1] = Math.max(bounds[1][1], coordinates[1]);
      return;
    }
    coordinates?.forEach(walk);
  };
  walk(feature.geometry.coordinates);
  _boundsCache.set(feature, bounds);
  return bounds;
}

function _enrichFeatures(collection, members, baseHeight, memberHeight) {
  return {
    type: 'FeatureCollection',
    features: collection.features.map(feature => {
      const areaMembers = _membersInFeature(feature, members);
      const usage = areaMembers.reduce((sum, member) => sum + _memberUsage(member), 0);
      const overdue = areaMembers.filter(member => member.status === 'overdue' || _memberDebt(member) > 0).length;
      const height = baseHeight + areaMembers.length * memberHeight + Math.min(usage * memberHeight * 0.08, memberHeight * 10);
      return {
        ...feature,
        properties: {
          ...feature.properties,
          memberCount: areaMembers.length,
          usage: Math.round(usage),
          overdue,
          height,
          color: overdue > 0 ? '#f25f5c' : areaMembers.length > 0 ? '#19b5e8' : '#8faecb',
        },
      };
    }),
  };
}

function _provinceCollection() {
  return _enrichFeatures(_provinceData, _filteredMembers(), 9000, 15000);
}

function _districtCollection(provinceCode) {
  const features = _districtData.features.filter(feature => String(feature.properties.province_code) === String(provinceCode));
  return _enrichFeatures({ type: 'FeatureCollection', features }, _filteredMembers(), 800, 1800);
}

function _memberCollection(feature = null) {
  const members = feature ? _membersInFeature(feature) : _filteredMembers();
  return {
    type: 'FeatureCollection',
    features: members.map(member => {
      const [lat, lng] = _effectiveLatLng(member);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {
          id: member.id,
          name: `${member.firstName || ''} ${member.lastName || ''}`.trim(),
          village: member.village || '-',
          villageId: member.villageId ?? '',
          meter: member.meter || '-',
          houseNo: member.houseNo || '-',
          status: member.status || 'normal',
          usage: _memberUsage(member),
          debt: _memberDebt(member),
          color: STATUS_FILL[member.status] || STATUS_FILL.normal,
        },
      };
    }),
  };
}

function _addCountryLayers() {
  _mapInstance.addSource('provinces', { type: 'geojson', data: _provinceCollection() });
  _mapInstance.addLayer({
    id: 'province-extrusion', type: 'fill-extrusion', source: 'provinces',
    paint: {
      'fill-extrusion-color': ['get', 'color'],
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.82,
      'fill-extrusion-vertical-gradient': true,
    },
  });
  _mapInstance.addLayer({
    id: 'province-outline', type: 'line', source: 'provinces',
    paint: { 'line-color': '#d9efff', 'line-width': 1.15, 'line-opacity': 0.82 },
  });
}

function _addDistrictLayers(data) {
  if (_mapInstance.getSource('districts')) {
    _mapInstance.getSource('districts').setData(data);
    return;
  }
  _mapInstance.addSource('districts', { type: 'geojson', data });
  _mapInstance.addLayer({
    id: 'district-extrusion', type: 'fill-extrusion', source: 'districts',
    paint: {
      'fill-extrusion-color': ['get', 'color'],
      'fill-extrusion-height': ['get', 'height'],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.86,
      'fill-extrusion-vertical-gradient': true,
    },
  });
  _mapInstance.addLayer({
    id: 'district-outline', type: 'line', source: 'districts',
    paint: { 'line-color': '#eaf8ff', 'line-width': 1.2, 'line-opacity': 0.9 },
  });
}

function _addOrUpdateMemberLayers(feature = null) {
  const data = _memberCollection(feature);
  if (_mapInstance.getSource('map-members')) {
    _mapInstance.getSource('map-members').setData(data);
    return;
  }
  _mapInstance.addSource('map-members', { type: 'geojson', data });
  _mapInstance.addLayer({
    id: 'member-halo', type: 'circle', source: 'map-members',
    paint: {
      'circle-radius': ['+', 9, ['min', 10, ['/', ['to-number', ['get', 'usage']], 5]]],
      'circle-color': ['get', 'color'], 'circle-opacity': 0.2, 'circle-blur': 0.45,
    },
  });
  _mapInstance.addLayer({
    id: 'member-points', type: 'circle', source: 'map-members',
    paint: {
      'circle-radius': ['+', 5, ['min', 8, ['/', ['to-number', ['get', 'usage']], 6]]],
      'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2, 'circle-opacity': 0.96,
    },
  });
}

function _setLayerVisibility(layerId, visible) {
  if (_mapInstance?.getLayer(layerId)) _mapInstance.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}

function _setCountryView(animated = true) {
  _level = 'country';
  _selectedProvince = null;
  _selectedDistrict = null;
  closeMemberMapPopup();
  _setLayerVisibility('province-extrusion', true);
  _setLayerVisibility('province-outline', true);
  _setLayerVisibility('district-extrusion', false);
  _setLayerVisibility('district-outline', false);
  _setLayerVisibility('member-halo', false);
  _setLayerVisibility('member-points', false);
  if (_mapInstance.getLayer('district-extrusion')) _mapInstance.setFilter('district-extrusion', null);
  if (_mapInstance.getLayer('district-outline')) _mapInstance.setFilter('district-outline', null);
  _mapInstance.setPaintProperty('province-extrusion', 'fill-extrusion-opacity', 0.82);
  _mapInstance.fitBounds(THAILAND_BOUNDS, { padding: 42, pitch: 47, bearing: -9, duration: animated ? 900 : 0 });
  _updateDrillbar();
}

async function _enterProvince(code, animated = true) {
  const province = _provinceData.features.find(feature => String(feature.properties.code) === String(code));
  if (!province) return;
  _level = 'province';
  _selectedProvince = province;
  _selectedDistrict = null;
  _updateDrillbar(true);

  try {
    if (!_districtData) {
      _setLoading(true, 'กำลังโหลดขอบเขตอำเภอ...');
      _districtData = await fetch(DISTRICTS_URL).then(response => {
        if (!response.ok) throw new Error(`โหลดขอบเขตอำเภอไม่สำเร็จ (${response.status})`);
        return response.json();
      });
    }
    _addDistrictLayers(_districtCollection(province.properties.code));
    if (_mapInstance.getLayer('district-extrusion')) _mapInstance.setFilter('district-extrusion', null);
    if (_mapInstance.getLayer('district-outline')) _mapInstance.setFilter('district-outline', null);
    _addOrUpdateMemberLayers(province);
    _setLayerVisibility('province-extrusion', false);
    _setLayerVisibility('province-outline', true);
    _setLayerVisibility('district-extrusion', true);
    _setLayerVisibility('district-outline', true);
    _setLayerVisibility('member-halo', true);
    _setLayerVisibility('member-points', true);
    _mapInstance.fitBounds(_featureBounds(province), { padding: 58, pitch: 52, bearing: -12, duration: animated ? 850 : 0 });
    _updateDrillbar();
  } catch (error) {
    _showMapError(error);
  } finally {
    _setLoading(false);
  }
}

function _enterDistrict(code) {
  const district = _districtData?.features.find(feature => String(feature.properties.code) === String(code));
  if (!district) return;
  _level = 'district';
  _selectedDistrict = district;
  _addOrUpdateMemberLayers(district);
  _mapInstance.setPaintProperty('district-extrusion', 'fill-extrusion-opacity', 0.3);
  _mapInstance.setFilter('district-extrusion', ['==', ['get', 'code'], district.properties.code]);
  _mapInstance.setFilter('district-outline', ['==', ['get', 'code'], district.properties.code]);
  _mapInstance.fitBounds(_featureBounds(district), { padding: 76, pitch: 58, bearing: -16, duration: 850 });
  _updateDrillbar();
}

function _backOneLevel() {
  if (_level === 'district' && _selectedProvince) {
    if (_mapInstance.getLayer('district-extrusion')) _mapInstance.setFilter('district-extrusion', null);
    if (_mapInstance.getLayer('district-outline')) _mapInstance.setFilter('district-outline', null);
    _enterProvince(_selectedProvince.properties.code);
  } else if (_mapInstance) {
    if (_mapInstance.getLayer('district-extrusion')) _mapInstance.setFilter('district-extrusion', null);
    if (_mapInstance.getLayer('district-outline')) _mapInstance.setFilter('district-outline', null);
    _setCountryView();
  }
}

function _updateDrillbar(loading = false) {
  const crumb = document.getElementById('map-breadcrumb');
  const pill = document.getElementById('map-level-pill');
  if (!crumb || !pill) return;
  const provinceName = _selectedProvince?.properties?.name_th || '';
  const districtName = _selectedDistrict?.properties?.name_th || '';
  if (_level === 'country') {
    crumb.innerHTML = '<strong>ประเทศไทย</strong>';
    pill.textContent = '77 จังหวัด';
  } else if (_level === 'province') {
    crumb.innerHTML = `<button type="button" data-map-level="country">ประเทศไทย</button><span class="map-crumb-sep">/</span><strong>${esc(provinceName)}</strong>`;
    pill.textContent = loading ? 'กำลังโหลด...' : 'เลือกอำเภอ';
  } else {
    crumb.innerHTML = `<button type="button" data-map-level="country">ประเทศไทย</button><span class="map-crumb-sep">/</span><button type="button" data-map-level="province">${esc(provinceName)}</button><span class="map-crumb-sep">/</span><strong>${esc(districtName)}</strong>`;
    pill.textContent = `${_memberCollection(_selectedDistrict).features.length} มิเตอร์`;
  }
}

function _showTip(event, properties, kind) {
  const tip = document.getElementById('map-tip');
  const stage = tip?.parentElement;
  if (!tip || !stage) return;
  const rect = stage.getBoundingClientRect();
  const name = properties.name_th || properties.name || '-';
  tip.innerHTML = `<strong>${kind}${esc(name)}</strong><div class="map-tip-grid"><span>ครัวเรือน</span><b>${Number(properties.memberCount || 0).toLocaleString()}</b><span>การใช้น้ำ</span><b>${Number(properties.usage || 0).toLocaleString()} m³</b><span>ค้างชำระ</span><b>${Number(properties.overdue || 0).toLocaleString()}</b></div>`;
  tip.style.left = `${Math.max(8, Math.min(event.originalEvent.clientX - rect.left + 14, rect.width - 264))}px`;
  tip.style.top = `${Math.max(8, Math.min(event.originalEvent.clientY - rect.top + 14, rect.height - 150))}px`;
  tip.hidden = false;
}

function _hideTip() {
  const tip = document.getElementById('map-tip');
  if (tip) tip.hidden = true;
}

function _showMemberPopup(feature, coordinates) {
  const properties = feature.properties;
  const status = statusMap[properties.status] || statusMap.normal;
  const debt = Number(properties.debt) || 0;
  const fill = STATUS_FILL[properties.status] || STATUS_FILL.normal;
  const memberId = Number(properties.id);
  _popup?.remove();
  _popup = new _maplibre.Popup({ closeButton: true, maxWidth: '270px', offset: 14 })
    .setLngLat(coordinates)
    .setHTML(`<div style="min-width:210px;padding:3px 2px;font-family:'Sarabun',sans-serif"><div style="font-size:15px;font-weight:800;color:#10243d;padding-right:20px">${esc(properties.name)}</div><div style="font-size:12px;color:#65758a;margin-top:3px">บ้านเลขที่ ${esc(properties.houseNo)} · ${esc(properties.village)}</div><div style="font-size:12px;color:#65758a">มิเตอร์ <strong>${esc(properties.meter)}</strong></div><div style="display:flex;align-items:center;gap:7px;margin-top:8px;font-size:12px"><span style="padding:2px 8px;border-radius:999px;background:${fill};color:#fff;font-weight:700">${esc(status.label)}</span><span>${Number(properties.usage).toLocaleString()} m³/เดือน</span></div>${debt > 0 ? `<div style="margin-top:6px;color:#dc2626;font-size:12px;font-weight:700">ค้างชำระ ฿${debt.toLocaleString()}</div>` : ''}<div style="display:flex;gap:7px;margin-top:11px"><button onclick="closeMemberMapPopup();openMemberQuickView(${memberId})" style="flex:1;border:0;border-radius:8px;background:#082f6f;color:#fff;padding:7px;font-family:inherit;font-weight:700;cursor:pointer">ดูบิล</button><button onclick="closeMemberMapPopup();gotoMeter(${jsArg(properties.name)},${jsArg(properties.meter)},${memberId})" style="flex:1;border:0;border-radius:8px;background:#0ea5e9;color:#fff;padding:7px;font-family:inherit;font-weight:700;cursor:pointer">จดมิเตอร์</button></div></div>`)
    .addTo(_mapInstance);
}

function _bindMapEvents() {
  _mapInstance.on('mousemove', 'province-extrusion', event => {
    if (_level !== 'country' || !event.features?.length) return;
    _mapInstance.getCanvas().style.cursor = 'pointer';
    _showTip(event, event.features[0].properties, 'จังหวัด');
  });
  _mapInstance.on('mouseleave', 'province-extrusion', () => { _mapInstance.getCanvas().style.cursor = ''; _hideTip(); });
  _mapInstance.on('click', 'province-extrusion', event => {
    if (_level === 'country' && event.features?.length) _enterProvince(event.features[0].properties.code);
  });
  _mapInstance.on('mousemove', 'district-extrusion', event => {
    if (_level !== 'province' || !event.features?.length) return;
    _mapInstance.getCanvas().style.cursor = 'pointer';
    _showTip(event, event.features[0].properties, 'อำเภอ');
  });
  _mapInstance.on('mouseleave', 'district-extrusion', () => { _mapInstance.getCanvas().style.cursor = ''; _hideTip(); });
  _mapInstance.on('click', 'district-extrusion', event => {
    const memberHit = _mapInstance.queryRenderedFeatures(event.point, { layers: ['member-points'] });
    if (_level === 'province' && event.features?.length && !memberHit.length) _enterDistrict(event.features[0].properties.code);
  });
  _mapInstance.on('mouseenter', 'member-points', () => { _mapInstance.getCanvas().style.cursor = 'pointer'; });
  _mapInstance.on('mouseleave', 'member-points', () => { _mapInstance.getCanvas().style.cursor = ''; });
  _mapInstance.on('click', 'member-points', event => {
    if (!event.features?.length) return;
    event.originalEvent.stopPropagation();
    _showMemberPopup(event.features[0], event.features[0].geometry.coordinates);
  });
}

function _setLoading(show, message = 'กำลังสร้างแผนที่ 3D...') {
  const loading = document.getElementById('map-loading');
  if (!loading) return;
  loading.innerHTML = '<span class="spinner"></span><span></span>';
  loading.lastElementChild.textContent = message;
  loading.classList.toggle('is-hidden', !show);
}

function _showMapError(error) {
  const loading = document.getElementById('map-loading');
  if (!loading) return;
  loading.classList.remove('is-hidden');
  loading.innerHTML = `<div style="max-width:360px;padding:24px;text-align:center"><i class="ti ti-map-off" style="display:block;margin-bottom:10px;font-size:38px;color:#f4bd4f"></i><strong style="display:block;font-size:15px">เปิดแผนที่ 3D ไม่สำเร็จ</strong><span style="display:block;margin:7px 0 14px;color:#aac1d9;font-size:12px">${esc(error?.message || 'กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต')}</span><button type="button" onclick="renderMap()" style="border:0;border-radius:9px;background:#19b5e8;color:#fff;padding:8px 16px;font-family:inherit;font-weight:700;cursor:pointer">ลองอีกครั้ง</button></div>`;
}

function _renderMapStats() {
  const el = document.getElementById('map-stats-body');
  if (!el) return;
  const villages = [...new Set(appState.members.map(member => member.village).filter(Boolean))].sort();
  el.innerHTML = villages.map((village, index) => {
    const members = appState.members.filter(member => member.village === village);
    const usage = members.reduce((sum, member) => sum + _memberUsage(member), 0);
    const overdue = members.filter(member => member.status === 'overdue' || _memberDebt(member) > 0).length;
    const color = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'][index % 6];
    const badge = overdue > 0
      ? `<span style="background:#fee2e2;color:#dc2626;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap">ค้าง ${overdue}</span>`
      : '<span style="background:#dcfce7;color:#16a34a;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">ปกติ</span>';
    return `<div style="display:flex;align-items:center;gap:9px;padding:9px 0;border-bottom:1px solid var(--gray-100)"><div style="width:11px;height:11px;border-radius:3px;background:${color};flex-shrink:0"></div><div style="flex:1;min-width:0"><div class="text-bold" style="font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(village)}</div><div class="text-muted" style="font-size:11px">${members.length} หลังคา · ${usage.toLocaleString()} m³</div></div>${badge}</div>`;
  }).join('') || '<div style="text-align:center;color:var(--gray-500);padding:20px;font-size:12px">ยังไม่มีข้อมูลหมู่บ้าน</div>';
}

export async function renderMap() {
  const container = document.getElementById('map-container');
  if (!container) return;
  const token = ++_renderToken;
  _renderMapStats();
  _setLoading(true);
  closeMemberMapPopup();
  if (_mapInstance) { _mapInstance.remove(); _mapInstance = null; }

  try {
    const [maplibre, provinces] = await Promise.all([
      _loadMapLibre(),
      _provinceData ? Promise.resolve(_provinceData) : fetch(PROVINCES_URL).then(response => {
        if (!response.ok) throw new Error(`โหลดขอบเขตจังหวัดไม่สำเร็จ (${response.status})`);
        return response.json();
      }),
    ]);
    if (token !== _renderToken || !document.getElementById('map-container')) return;
    _maplibre = maplibre;
    _provinceData = provinces;
    _mapInstance = new maplibre.Map({
      container, style: EMPTY_STYLE, center: [100.6, 13.2], zoom: 4.6, pitch: 47, bearing: -9,
      antialias: true, attributionControl: false, localIdeographFontFamily: "'Sarabun', sans-serif",
    });
    _mapInstance.addControl(new maplibre.NavigationControl({ visualizePitch: true }), 'bottom-left');
    _mapInstance.addControl(new maplibre.AttributionControl({ compact: true, customAttribution: 'ขอบเขต: GeoThai / DOPA' }), 'bottom-right');
    await new Promise((resolve, reject) => {
      _mapInstance.once('load', resolve);
      _mapInstance.once('error', event => reject(event.error || new Error('เริ่มต้นแผนที่ไม่สำเร็จ')));
    });
    if (token !== _renderToken) return;
    _addCountryLayers();
    _addDistrictLayers({ type: 'FeatureCollection', features: [] });
    _addOrUpdateMemberLayers();
    _bindMapEvents();
    _setCountryView(false);
    _setLoading(false);
    setTimeout(() => _mapInstance?.resize(), 120);
  } catch (error) {
    if (token === _renderToken) _showMapError(error);
  }
}

export function closeMemberMapPopup() {
  _popup?.remove();
  _popup = null;
}

export function filterMapByVillage(village) {
  _villageFilter = village && village !== 'ทุกหมู่บ้าน' ? String(village) : '';
  _refreshMapData();
}

export function filterMapByStatus(status) {
  _statusFilter = status || '';
  _refreshMapData();
}

function _refreshMapData() {
  _renderMapStats();
  if (!_mapInstance || !_provinceData) return;
  _mapInstance.getSource('provinces')?.setData(_provinceCollection());
  if (_selectedProvince && _districtData) _mapInstance.getSource('districts')?.setData(_districtCollection(_selectedProvince.properties.code));
  _addOrUpdateMemberLayers(_selectedDistrict || _selectedProvince || null);
  _updateDrillbar();
}

document.addEventListener('click', event => {
  if (event.target.closest('#map-home-btn')) _backOneLevel();
  const crumb = event.target.closest('[data-map-level]');
  if (!crumb) return;
  if (crumb.dataset.mapLevel === 'country') _setCountryView();
  if (crumb.dataset.mapLevel === 'province' && _selectedProvince) _enterProvince(_selectedProvince.properties.code);
});
