// ─── System Settings Module ────────────────────────────────────
// Full master-data management: CRUD for all lookup tables,
// village management, rate tiers, system config, and audit log.
// ──────────────────────────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc, toast } from '../../utils/dom.util.js';
import { rateConfig, calcWaterCharge, calcWaterBreakdown } from '../../config/rate.config.js';
import { saveRateConfig } from '../../services/storage.service.js';
import {
  sbSaveRateTier, sbUpdateTierTo, sbInsertRateTier, sbDeleteRateTier,
} from '../../services/data-loader.service.js';
import { _dbVillages } from '../../services/db-mapper.service.js';
import {
  getMdItems, saveMdItem, deleteMdItem, toggleMdItem,
  saveVillage, deleteVillage, toggleVillage,
  saveSystemConfig, loadAuditLogs,
} from '../../services/master-data.service.js';

// ─── Tab Configuration ─────────────────────────────────────────
const TABS = [
  { id: 'rates',            label: 'อัตราค่าน้ำ',          icon: 'ti-coin',           type: 'custom' },
  { id: 'villages',         label: 'หมู่บ้าน',              icon: 'ti-home-2',         type: 'custom' },
  { id: 'member_type',      label: 'ประเภทสมาชิก',          icon: 'ti-users',          type: 'master' },
  { id: 'meter_size',       label: 'ขนาดมิเตอร์',           icon: 'ti-gauge',          type: 'master' },
  { id: 'payment_channel',  label: 'ช่องทางชำระ',           icon: 'ti-credit-card',    type: 'master' },
  { id: 'maintenance_type', label: 'ประเภทงานซ่อม',          icon: 'ti-tool',           type: 'master' },
  { id: 'anomaly_type',     label: 'ความผิดปกติ',            icon: 'ti-alert-triangle', type: 'master' },
  { id: 'reading_method',   label: 'วิธีจดมิเตอร์',          icon: 'ti-pencil',         type: 'master' },
  { id: 'system_config',    label: 'ตั้งค่าทั่วไป',          icon: 'ti-settings',       type: 'custom' },
  { id: 'audit_log',        label: 'บันทึกกิจกรรม',          icon: 'ti-history',        type: 'custom' },
];

const SYSTEM_CONFIG_FIELDS = [
  { key: 'org_name',           label: 'ชื่อองค์กร',                    type: 'text',     placeholder: 'ประปาหมู่บ้าน...' },
  { key: 'org_address',        label: 'ที่อยู่',                        type: 'text',     placeholder: 'ที่อยู่...' },
  { key: 'org_phone',          label: 'เบอร์โทรติดต่อ',                 type: 'text',     placeholder: '081-234-5678' },
  { key: 'billing_due_days',   label: 'วันครบกำหนดชำระ (หลังออกบิล)', type: 'number',   placeholder: '15' },
  { key: 'line_notify_token',  label: 'LINE Notify Token',              type: 'password', placeholder: 'token...' },
  { key: 'openrouter_api_key', label: 'OpenRouter API Key (จดมิเตอร์ AI)', type: 'password', placeholder: 'sk-or-v1-...' },
];

let _activeTab = 'rates';
let _mdSearch  = '';
let _mdEditId  = null;
let _mdCategory = '';
let _rateEditIdx = -1;
let _villageEditId = null;

// ─── Main Render ───────────────────────────────────────────────
export function renderSettings() {
  _renderTabsBar();
  _renderPanel(_activeTab);
}

export function setSettingsTab(tabId) {
  _activeTab = tabId;
  _mdSearch  = '';
  const search = document.getElementById('md-search');
  if (search) search.value = '';
  _renderTabsBar();
  _renderPanel(tabId);
}

function _renderTabsBar() {
  const bar = document.getElementById('settings-tabs-bar');
  if (!bar) return;
  bar.innerHTML = TABS.map(t => `
    <button class="stab-btn${_activeTab === t.id ? ' active' : ''}" onclick="setSettingsTab('${t.id}')">
      <i class="ti ${t.icon}"></i>${esc(t.label)}
    </button>`).join('');
}

function _renderPanel(tabId) {
  const tab = TABS.find(t => t.id === tabId);
  const el  = document.getElementById('settings-panel');
  if (!el || !tab) return;

  if (tab.type === 'master') {
    el.innerHTML = _buildMasterPanel(tab);
  } else if (tabId === 'rates') {
    el.innerHTML = _buildRatesPanel();
    renderSettingsRates();
  } else if (tabId === 'villages') {
    el.innerHTML = _buildVillagesPanel();
    renderSettingsVillages();
  } else if (tabId === 'system_config') {
    el.innerHTML = _buildSystemConfigPanel();
  } else if (tabId === 'audit_log') {
    el.innerHTML = _buildAuditPanel();
    _loadAndRenderAudit();
  }
}

// ─── Master Data Panel ─────────────────────────────────────────
function _buildMasterPanel(tab) {
  return `
  <div class="card">
    <div class="card-hd">
      <div class="card-title"><i class="ti ${tab.icon}" style="color:var(--blue-500)"></i>${esc(tab.label)}</div>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="form-input" id="md-search" placeholder="ค้นหา..." style="width:200px"
          oninput="window._mdFilter(this.value,'${tab.id}')"/>
        <button class="btn btn-primary btn-sm" onclick="openMdModal('${tab.id}')">
          <i class="ti ti-plus"></i>เพิ่ม
        </button>
      </div>
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th style="width:56px">ลำดับ</th>
          <th style="width:130px">รหัส</th>
          <th>ชื่อ (ไทย)</th>
          <th>ชื่อ (EN)</th>
          <th style="width:70px">ไอคอน</th>
          <th style="width:80px">สถานะ</th>
          <th style="width:90px;text-align:right">จัดการ</th>
        </tr></thead>
        <tbody id="md-tbody-${tab.id}">${_renderMasterRows(tab.id, '')}</tbody>
      </table>
    </div>
    <div class="tbl-footer"><span id="md-footer-${tab.id}">${_mdFooterText(tab.id)}</span></div>
  </div>`;
}

function _renderMasterRows(category, search) {
  const items = getMdItems(category, false);
  const q = (search || '').toLowerCase();
  const filtered = q ? items.filter(x =>
    x.code.toLowerCase().includes(q) || x.nameTh.toLowerCase().includes(q) || (x.nameEn||'').toLowerCase().includes(q)
  ) : items;

  if (!filtered.length) return `<tr><td colspan="7" style="text-align:center;color:var(--gray-400);padding:24px">ไม่มีข้อมูล</td></tr>`;
  return filtered.map(x => {
    const iconPreview = x.icon
      ? `<i class="ti ${esc(x.icon)}" style="font-size:18px;color:${esc(x.color||'#444651')}"></i>`
      : `<span style="color:var(--gray-300)">—</span>`;
    return `<tr style="${!x.isActive ? 'opacity:.5' : ''}">
      <td class="mono text-muted">${x.sortOrder}</td>
      <td><code style="font-size:11.5px;background:var(--gray-100);padding:2px 7px;border-radius:6px">${esc(x.code)}</code></td>
      <td><div style="display:flex;align-items:center;gap:8px">
        ${x.icon ? `<i class="ti ${esc(x.icon)}" style="color:${esc(x.color||'#444651')}"></i>` : ''}
        <span class="text-bold">${esc(x.nameTh)}</span>
        ${x.description ? `<span class="text-muted" style="font-size:11px">${esc(x.description)}</span>` : ''}
      </div></td>
      <td class="text-muted">${esc(x.nameEn||'—')}</td>
      <td style="text-align:center">${iconPreview}</td>
      <td>
        <div class="toggle${x.isActive ? ' on' : ''}"
          onclick="window.toggleMdItemHandler('${x.id}','${esc(category)}',${!x.isActive})">
          <div class="toggle-thumb"></div>
        </div>
      </td>
      <td>
        <div style="display:flex;gap:4px;justify-content:flex-end">
          <button class="btn-icon" title="แก้ไข" onclick="openMdModal('${esc(category)}','${x.id}')"><i class="ti ti-edit"></i></button>
          <button class="btn-icon" title="ลบ" style="color:var(--red-700);border-color:var(--red-100)"
            onclick="window.deleteMdItemConfirm('${x.id}','${esc(category)}')"><i class="ti ti-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function _mdFooterText(category) {
  const all    = getMdItems(category, false);
  const active = all.filter(x => x.isActive).length;
  return `ทั้งหมด ${all.length} รายการ · ใช้งาน ${active} · ปิด ${all.length - active}`;
}

// ─── Master Data Modal ─────────────────────────────────────────
export function openMdModal(category, itemId) {
  _mdCategory = category;
  _mdEditId   = itemId || null;
  const item  = itemId ? (appState.masterData[category] || []).find(x => x.id === itemId) : null;
  const title = item ? `แก้ไข: ${item.nameTh}` : 'เพิ่มข้อมูลใหม่';

  document.getElementById('md-modal-title').textContent = title;
  document.getElementById('md-f-code').value      = item?.code      || '';
  document.getElementById('md-f-code').readOnly   = !!item;
  document.getElementById('md-f-sort').value      = item?.sortOrder ?? 0;
  document.getElementById('md-f-name-th').value   = item?.nameTh    || '';
  document.getElementById('md-f-name-en').value   = item?.nameEn    || '';
  document.getElementById('md-f-icon').value      = item?.icon      || '';
  document.getElementById('md-f-color').value     = item?.color     || '#0058be';
  document.getElementById('md-f-color-pk').value  = item?.color     || '#0058be';
  document.getElementById('md-f-desc').value      = item?.description || '';
  const toggle = document.getElementById('md-f-active');
  if (toggle) { toggle.classList.toggle('on', item ? item.isActive : true); }
  _syncIconPreview();
  document.getElementById('md-modal').style.display = 'flex';
  document.getElementById('md-f-name-th').focus();
}

export function closeMdModal() {
  document.getElementById('md-modal').style.display = 'none';
  _mdEditId = null; _mdCategory = '';
}

export async function saveMdItemHandler() {
  const code   = document.getElementById('md-f-code').value.trim().toLowerCase().replace(/\s+/g, '_');
  const nameTh = document.getElementById('md-f-name-th').value.trim();
  if (!code)   { toast('กรุณากรอกรหัส', 'error'); return; }
  if (!nameTh) { toast('กรุณากรอกชื่อ (ภาษาไทย)', 'error'); return; }

  const item = {
    id:          _mdEditId,
    category:    _mdCategory,
    code,
    nameTh,
    nameEn:      document.getElementById('md-f-name-en').value.trim(),
    icon:        document.getElementById('md-f-icon').value.trim(),
    color:       document.getElementById('md-f-color').value.trim(),
    description: document.getElementById('md-f-desc').value.trim(),
    sortOrder:   parseInt(document.getElementById('md-f-sort').value) || 0,
    isActive:    document.getElementById('md-f-active').classList.contains('on'),
  };

  const { data, error } = await saveMdItem(item);
  if (error) { toast(`⚠ ${error}`, 'error'); return; }

  closeMdModal();
  toast(`${_mdEditId ? 'แก้ไข' : 'เพิ่ม'} "${data.nameTh}" แล้ว`, 'success');
  _refreshMasterPanel(_mdCategory || item.category);
  _propagateChanges(item.category);
}

export async function deleteMdItemConfirm(id, category) {
  const item = (appState.masterData[category] || []).find(x => x.id === id);
  if (!item) return;
  if (!confirm(`ลบ "${item.nameTh}" ออกจากระบบ?\n\nการดำเนินการนี้ไม่สามารถย้อนกลับได้`)) return;
  const { error } = await deleteMdItem(id, category);
  if (error) { toast(`⚠ ${error}`, 'error'); return; }
  toast(`ลบ "${item.nameTh}" แล้ว`, 'success');
  _refreshMasterPanel(category);
  _propagateChanges(category);
}

export async function toggleMdItemHandler(id, category, isActive) {
  const { error } = await toggleMdItem(id, category, isActive);
  if (error) { toast(`⚠ ${error}`, 'error'); return; }
  _refreshMasterPanel(category);
  _propagateChanges(category);
}

function _refreshMasterPanel(category) {
  const tbody  = document.getElementById(`md-tbody-${category}`);
  const footer = document.getElementById(`md-footer-${category}`);
  if (tbody)  tbody.innerHTML = _renderMasterRows(category, _mdSearch);
  if (footer) footer.textContent = _mdFooterText(category);
}

function _propagateChanges(category) {
  if (['member_type', 'meter_size'].includes(category)) {
    window.renderMembers?.();
    _populateMemberFormDropdowns();
  }
  if (category === 'maintenance_type') {
    window.renderMaintenance?.();
    _populateMaintenanceTypeSelect();
  }
}

// ─── Villages Panel ────────────────────────────────────────────
export function renderSettingsVillages() {
  const el = document.getElementById('village-list');
  if (!el) return;
  const rows = [..._dbVillages].sort((a, b) => (a.moo_number || 0) - (b.moo_number || 0));
  if (!rows.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:20px">ยังไม่มีหมู่บ้าน</div>';
  } else {
    el.innerHTML = rows.map(v => {
      const count   = appState.members.filter(m => m.village === v.name).length;
      const overdue = appState.members.filter(m => m.village === v.name && m.status === 'overdue').length;
      const active  = v.is_active !== false;
      return `<div class="md-village-row${active ? '' : ' inactive'}">
        <div style="display:flex;align-items:center;gap:10px;flex:1">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--blue-100);color:var(--blue-700);
            display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0">
            ${v.moo_number || '?'}
          </div>
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--blue-900)">${esc(v.name)}</div>
            <div class="text-muted" style="font-size:11px">${count} สมาชิก${overdue ? ` · <span style="color:var(--red-700)">${overdue} ค้างชำระ</span>` : ''}</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <div class="toggle${active ? ' on' : ''}" onclick="window.toggleVillageHandler(${v.id},${!active})"><div class="toggle-thumb"></div></div>
          <button class="btn-icon" onclick="openVillageModal(${v.id})"><i class="ti ti-edit"></i></button>
          <button class="btn-icon" style="color:var(--red-700);border-color:var(--red-100)"
            onclick="window.deleteVillageConfirm(${v.id})"><i class="ti ti-trash"></i></button>
        </div>
      </div>`;
    }).join('');
  }
  const footer = document.getElementById('village-footer');
  if (footer) footer.textContent = `ทั้งหมด ${rows.length} หมู่บ้าน · ใช้งาน ${rows.filter(v => v.is_active !== false).length}`;
}

function _buildVillagesPanel() {
  return `
  <div class="card">
    <div class="card-hd">
      <div class="card-title"><i class="ti ti-home-2" style="color:var(--blue-500)"></i>จัดการหมู่บ้าน</div>
      <button class="btn btn-primary btn-sm" onclick="openVillageModal()"><i class="ti ti-plus"></i>เพิ่มหมู่บ้าน</button>
    </div>
    <div class="card-body" id="village-list" style="display:flex;flex-direction:column;gap:8px"></div>
    <div class="tbl-footer"><span id="village-footer"></span></div>
  </div>`;
}

export function openVillageModal(id) {
  _villageEditId = id || null;
  const v = id ? _dbVillages.find(x => x.id === id) : null;
  document.getElementById('vf-moo').value  = v?.moo_number || '';
  document.getElementById('vf-name').value = v?.name || '';
  document.getElementById('vf-desc').value = v?.description || '';
  document.getElementById('village-modal-title').textContent = v ? `แก้ไข: ${v.name}` : 'เพิ่มหมู่บ้านใหม่';
  document.getElementById('village-modal').style.display = 'flex';
  document.getElementById('vf-name').focus();
}

export function closeVillageModal() {
  document.getElementById('village-modal').style.display = 'none';
  _villageEditId = null;
}

export async function saveVillageHandler() {
  const mooNumber = parseInt(document.getElementById('vf-moo').value);
  const name      = document.getElementById('vf-name').value.trim();
  if (!mooNumber || mooNumber < 1) { toast('กรุณากรอกหมายเลขหมู่บ้าน', 'error'); return; }
  if (!name) { toast('กรุณากรอกชื่อหมู่บ้าน', 'error'); return; }

  const { data, error } = await saveVillage({
    id:          _villageEditId,
    mooNumber,
    name,
    description: document.getElementById('vf-desc').value.trim(),
    isActive:    true,
  });
  if (error) { toast(`⚠ ${error}`, 'error'); return; }
  closeVillageModal();
  toast(`${_villageEditId ? 'แก้ไข' : 'เพิ่ม'} หมู่บ้าน "${name}" แล้ว`, 'success');
  renderSettingsVillages();
  populateVillageDropdowns();
  window.renderMembers?.();
}

export async function deleteVillageConfirm(id) {
  const v = _dbVillages.find(x => x.id === id);
  if (!v) return;
  const count = appState.members.filter(m => m.village === v.name).length;
  if (count > 0) { toast(`ไม่สามารถลบได้ มีสมาชิก ${count} รายในหมู่บ้านนี้`, 'error'); return; }
  if (!confirm(`ลบหมู่บ้าน "${v.name}"?`)) return;
  const { error } = await deleteVillage(id);
  if (error) { toast(`⚠ ${error}`, 'error'); return; }
  toast(`ลบ "${v.name}" แล้ว`, 'success');
  renderSettingsVillages();
  populateVillageDropdowns();
}

export async function toggleVillageHandler(id, isActive) {
  const { error } = await toggleVillage(id, isActive);
  if (error) { toast(`⚠ ${error}`, 'error'); return; }
  renderSettingsVillages();
  populateVillageDropdowns();
}

// ─── Rate Tiers Panel ─────────────────────────────────────────
export function renderSettingsRates() {
  const el = document.getElementById('rate-tiers-list');
  if (!el) return;
  const n = rateConfig.tiers.length;
  if (!n) {
    el.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--gray-400)">ยังไม่มีข้อมูลอัตราค่าน้ำ</td></tr>`;
  } else {
    el.innerHTML = rateConfig.tiers.map((t, i) => {
      const isLast    = i === n - 1;
      const rangeLabel = t.to === Infinity ? `${t.from}+ หน่วย` : `${t.from}–${t.to} หน่วย`;
      return `<tr>
        <td>${i + 1}</td>
        <td style="font-weight:600;color:var(--blue-900)">${rangeLabel}</td>
        <td style="text-align:right;font-weight:700;color:var(--blue-700)">฿${t.rate.toFixed(2)}</td>
        <td>
          <div style="display:flex;gap:4px;justify-content:flex-end">
            <button class="btn-icon" title="แก้ไขอัตรา" onclick="openRateEditModal(${i})">
              <i class="ti ti-edit"></i>
            </button>
            ${isLast && n > 1
              ? `<button class="btn-icon" title="ลบช่วงนี้"
                  style="color:var(--red-700);border-color:var(--red-100)"
                  onclick="window.deleteLastTierConfirm()">
                  <i class="ti ti-trash"></i></button>`
              : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
  }
  // Sync svc + late-fee inputs when visible
  const sSmall = document.getElementById('svc-small-val');
  const sLarge = document.getElementById('svc-large-val');
  const lFee   = document.getElementById('late-fee-val');
  if (sSmall) sSmall.value = rateConfig.svcSmall;
  if (sLarge) sLarge.value = rateConfig.svcLarge;
  if (lFee)   lFee.value   = rateConfig.lateFeePerMonth;
}

function _buildRatesPanel() {
  return `
  <div class="grid-2" style="align-items:start;gap:14px">

    <!-- ─── อัตราค่าน้ำก้าวหน้า ─── -->
    <div class="card">
      <div class="card-hd">
        <div class="card-title">
          <i class="ti ti-coin" style="color:var(--blue-500)"></i>อัตราค่าน้ำ (ก้าวหน้า)
        </div>
        <button class="btn btn-primary btn-sm" onclick="openAddTierModal()">
          <i class="ti ti-plus"></i>เพิ่มช่วง
        </button>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr>
            <th style="width:40px">ที่</th>
            <th>ช่วงการใช้น้ำ</th>
            <th style="text-align:right">อัตรา (บาท/หน่วย)</th>
            <th style="width:80px;text-align:right">จัดการ</th>
          </tr></thead>
          <tbody id="rate-tiers-list"></tbody>
        </table>
      </div>
      <div class="tbl-footer">
        <span class="text-muted" style="font-size:12px">
          <i class="ti ti-info-circle"></i>
          ใช้น้ำในแต่ละช่วง คิดตามอัตราของช่วงนั้น — รวมทุกช่วงเป็นค่าน้ำรวม
        </span>
      </div>
    </div>

    <!-- ─── คอลัมน์ขวา ─── -->
    <div style="display:flex;flex-direction:column;gap:14px">

      <!-- ค่าบริการรายเดือน -->
      <div class="card">
        <div class="card-hd">
          <div class="card-title">
            <i class="ti ti-tool" style="color:var(--blue-500)"></i>ค่าบริการรายเดือน
          </div>
        </div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
          <div class="info-box" style="margin:0 0 4px">
            <i class="ti ti-info-circle"></i>
            คิดตามขนาดมิเตอร์ ไม่ขึ้นกับปริมาณการใช้น้ำ
          </div>
          <div class="syconf-row">
            <label class="form-label">มิเตอร์เล็ก ½" / ¾" (บาท/เดือน)</label>
            <input class="form-input" id="svc-small-val" type="number" step="1" min="0"
              value="${rateConfig.svcSmall}" style="width:110px"/>
          </div>
          <div class="syconf-row">
            <label class="form-label">มิเตอร์ใหญ่ 1" / 1½" (บาท/เดือน)</label>
            <input class="form-input" id="svc-large-val" type="number" step="1" min="0"
              value="${rateConfig.svcLarge}" style="width:110px"/>
          </div>
          <div style="display:flex;justify-content:flex-end">
            <button class="btn btn-primary btn-sm" onclick="window.saveSvcChargesHandler()">
              <i class="ti ti-device-floppy"></i>บันทึก
            </button>
          </div>
        </div>
      </div>

      <!-- ค่าปรับล่าช้า -->
      <div class="card">
        <div class="card-hd">
          <div class="card-title">
            <i class="ti ti-clock-dollar" style="color:var(--blue-500)"></i>ค่าปรับล่าช้า
          </div>
        </div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
          <div class="syconf-row">
            <label class="form-label">ค่าปรับล่าช้าต่อเดือน (บาท)</label>
            <input class="form-input" id="late-fee-val" type="number" step="1" min="0"
              value="${rateConfig.lateFeePerMonth}" style="width:110px"/>
          </div>
          <div style="display:flex;justify-content:flex-end">
            <button class="btn btn-primary btn-sm" onclick="window.saveLateFeeHandler()">
              <i class="ti ti-device-floppy"></i>บันทึก
            </button>
          </div>
        </div>
      </div>

      <!-- ทดสอบคำนวณ -->
      <div class="card">
        <div class="card-hd">
          <div class="card-title">
            <i class="ti ti-calculator" style="color:var(--blue-500)"></i>ทดสอบคำนวณ
          </div>
        </div>
        <div class="card-body">
          <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:flex-end">
            <div>
              <label class="form-label">การใช้น้ำ (หน่วย)</label>
              <input class="form-input" id="rate-test-usage" type="number"
                placeholder="50" min="0" style="width:110px"/>
            </div>
            <div>
              <label class="form-label">ขนาดมิเตอร์</label>
              <select class="form-input" id="rate-test-size" style="width:110px">
                <option value="0.5">½"</option>
                <option value="0.75">¾"</option>
                <option value="1">1"</option>
                <option value="1.5">1½"</option>
              </select>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="window._rateTestCalc()">
              <i class="ti ti-calculator"></i>คำนวณ
            </button>
          </div>
          <div id="rate-test-result" style="font-size:13px;color:var(--gray-500)">
            กรอกปริมาณแล้วกดคำนวณ
          </div>
        </div>
      </div>

    </div>
  </div>`;
}

export function openRateEditModal(idx) {
  const tier = rateConfig.tiers[idx]; if (!tier) return;
  _rateEditIdx = idx;
  const range = tier.to === Infinity ? `${tier.from}+ หน่วย` : `${tier.from}–${tier.to} หน่วย`;
  document.getElementById('rate-range-label').textContent = range;
  document.getElementById('rate-new-value').value         = tier.rate;
  document.getElementById('rate-modal').style.display     = 'flex';
  setTimeout(() => document.getElementById('rate-new-value')?.focus(), 50);
}

export function closeRateModal() {
  document.getElementById('rate-modal').style.display = 'none';
  _rateEditIdx = -1;
}

export async function saveRateTier() {
  if (_rateEditIdx < 0) return;
  const newRate = parseFloat(document.getElementById('rate-new-value').value);
  if (isNaN(newRate) || newRate < 0) { toast('กรุณากรอกอัตราที่ถูกต้อง', 'error'); return; }

  const tier = rateConfig.tiers[_rateEditIdx];
  tier.rate  = newRate;
  saveRateConfig();

  const btn = document.querySelector('#rate-modal .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i>กำลังบันทึก...'; }

  await sbSaveRateTier(tier.from, newRate);

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-check"></i>บันทึก'; }
  closeRateModal();
  renderSettingsRates();
  toast('บันทึกอัตราค่าน้ำแล้ว', 'success');
}

// ─── Add Tier ─────────────────────────────────────────────────
export function openAddTierModal() {
  if (!rateConfig.tiers.length) { toast('ยังไม่มีข้อมูลช่วงอัตรา', 'error'); return; }
  const last = rateConfig.tiers[rateConfig.tiers.length - 1];
  document.getElementById('at-last-range').textContent = `${last.from}+ หน่วย`;
  document.getElementById('at-split-to').value  = last.from + 19;
  document.getElementById('at-new-rate').value  = last.rate;
  document.getElementById('add-tier-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('at-split-to')?.focus(), 50);
}

export function closeAddTierModal() {
  document.getElementById('add-tier-modal').style.display = 'none';
}

export async function saveNewTierHandler() {
  const splitTo = parseInt(document.getElementById('at-split-to').value);
  const newRate = parseFloat(document.getElementById('at-new-rate').value);
  if (!rateConfig.tiers.length) return;
  const last = rateConfig.tiers[rateConfig.tiers.length - 1];

  if (isNaN(splitTo) || splitTo < last.from) {
    toast(`หน่วยแบ่งต้องมากกว่า ${last.from - 1}`, 'error'); return;
  }
  if (isNaN(newRate) || newRate < 0) {
    toast('กรุณากรอกอัตราที่ถูกต้อง', 'error'); return;
  }

  const btn = document.querySelector('#add-tier-modal .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i>กำลังบันทึก...'; }

  const newFrom = splitTo + 1;
  const ok1 = await sbUpdateTierTo(last.from, splitTo);
  if (!ok1) { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-check"></i>บันทึก'; } return; }

  const ok2 = await sbInsertRateTier(newFrom, null, newRate);
  if (!ok2) {
    // Rollback in-memory if DB insert failed
    await sbUpdateTierTo(last.from, null);
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-check"></i>บันทึก'; }
    return;
  }

  last.to = splitTo;
  rateConfig.tiers.push({ from: newFrom, to: Infinity, rate: newRate });
  saveRateConfig();

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-check"></i>บันทึก'; }
  closeAddTierModal();
  renderSettingsRates();
  toast(`เพิ่มช่วง ${newFrom}+ หน่วย (฿${newRate}/หน่วย) แล้ว`, 'success');
}

// ─── Delete Last Tier ─────────────────────────────────────────
export async function deleteLastTierConfirm() {
  const n = rateConfig.tiers.length;
  if (n <= 1) { toast('ต้องมีอย่างน้อย 1 ช่วง', 'error'); return; }
  const last = rateConfig.tiers[n - 1];
  const prev = rateConfig.tiers[n - 2];
  if (!confirm(`ลบช่วง "${last.from}+ หน่วย"?\n\nช่วง ${prev.from}–${last.from - 1} จะกลายเป็นช่วงสุดท้าย (ไม่จำกัด)`)) return;

  const ok1 = await sbDeleteRateTier(last.from);
  if (!ok1) return;
  const ok2 = await sbUpdateTierTo(prev.from, null);
  if (!ok2) return;

  rateConfig.tiers.pop();
  prev.to = Infinity;
  saveRateConfig();
  renderSettingsRates();
  toast(`ลบช่วง "${last.from}+ หน่วย" แล้ว`, 'success');
}

// ─── Save Service Charges ─────────────────────────────────────
export async function saveSvcChargesHandler() {
  const small = parseFloat(document.getElementById('svc-small-val')?.value);
  const large = parseFloat(document.getElementById('svc-large-val')?.value);
  if (isNaN(small) || small < 0 || isNaN(large) || large < 0) {
    toast('กรุณากรอกค่าบริการที่ถูกต้อง', 'error'); return;
  }
  await Promise.all([
    saveSystemConfig('svc_charge_small', String(small)),
    saveSystemConfig('svc_charge_large', String(large)),
  ]);
  rateConfig.svcSmall = small;
  rateConfig.svcLarge = large;
  appState.systemConfig.svc_charge_small = String(small);
  appState.systemConfig.svc_charge_large = String(large);
  saveRateConfig();
  toast('บันทึกค่าบริการรายเดือนแล้ว', 'success');
}

// ─── Save Late Fee ────────────────────────────────────────────
export async function saveLateFeeHandler() {
  const fee = parseFloat(document.getElementById('late-fee-val')?.value);
  if (isNaN(fee) || fee < 0) { toast('กรุณากรอกค่าปรับที่ถูกต้อง', 'error'); return; }
  await saveSystemConfig('late_fee_per_month', String(fee));
  rateConfig.lateFeePerMonth = fee;
  appState.systemConfig.late_fee_per_month = String(fee);
  saveRateConfig();
  toast('บันทึกค่าปรับล่าช้าแล้ว', 'success');
}

export function saveSettings() { saveRateConfig(); renderSettingsRates(); toast('บันทึกแล้ว', 'success'); }

// ─── System Config Panel ───────────────────────────────────────
function _buildSystemConfigPanel() {
  const cfg = appState.systemConfig || {};
  const rows = SYSTEM_CONFIG_FIELDS.map(f => `
    <div class="syconf-row">
      <label class="form-label" style="min-width:200px">${esc(f.label)}</label>
      <input class="form-input" id="scf-${f.key}" type="${f.type || 'text'}"
        value="${esc(String(cfg[f.key] || ''))}" placeholder="${esc(f.placeholder || '')}"/>
    </div>`).join('');

  return `
  <div class="card">
    <div class="card-hd">
      <div class="card-title"><i class="ti ti-settings" style="color:var(--blue-500)"></i>ตั้งค่าทั่วไป</div>
      <button class="btn btn-primary btn-sm" onclick="window.saveSystemConfigHandler()">
        <i class="ti ti-device-floppy"></i>บันทึก
      </button>
    </div>
    <div class="card-body" style="display:flex;flex-direction:column;gap:14px">${rows}</div>
  </div>`;
}

export async function saveSystemConfigHandler() {
  const btn = document.querySelector('.card-hd .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i>กำลังบันทึก...'; }

  const promises = SYSTEM_CONFIG_FIELDS.map(f => {
    const el = document.getElementById(`scf-${f.key}`);
    return el ? saveSystemConfig(f.key, el.value.trim()) : Promise.resolve({ ok: true });
  });
  const results = await Promise.all(promises);
  const err = results.find(r => r.error);

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-device-floppy"></i>บันทึก'; }
  if (err) { toast(`⚠ ${err.error}`, 'error'); return; }

  // Sync rate-config keys that may exist in system_config (org-level settings)
  const scSmall = parseFloat(appState.systemConfig.svc_charge_small);
  const scLarge = parseFloat(appState.systemConfig.svc_charge_large);
  const scFee   = parseFloat(appState.systemConfig.late_fee_per_month);
  if (!isNaN(scSmall)) rateConfig.svcSmall        = scSmall;
  if (!isNaN(scLarge)) rateConfig.svcLarge        = scLarge;
  if (!isNaN(scFee))   rateConfig.lateFeePerMonth = scFee;
  saveRateConfig();
  toast('บันทึกการตั้งค่าแล้ว', 'success');
}

// ─── Audit Log Panel ───────────────────────────────────────────
function _buildAuditPanel() {
  return `
  <div class="card">
    <div class="card-hd">
      <div class="card-title"><i class="ti ti-history" style="color:var(--blue-500)"></i>บันทึกกิจกรรม</div>
      <select class="form-input" id="audit-filter" style="width:180px" onchange="window._loadAuditFilter(this.value)">
        <option value="">ทุกตาราง</option>
        <option value="master_data">Master Data</option>
        <option value="villages">หมู่บ้าน</option>
        <option value="system_config">ตั้งค่าระบบ</option>
        <option value="bills">บิล</option>
        <option value="members">สมาชิก</option>
      </select>
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th style="width:140px">วันเวลา</th>
          <th style="width:110px">ตาราง</th>
          <th style="width:90px">การดำเนินการ</th>
          <th>ข้อมูล</th>
          <th style="width:130px">ผู้ดำเนินการ</th>
        </tr></thead>
        <tbody id="audit-tbody"><tr><td colspan="5" style="text-align:center;padding:24px;color:var(--gray-400)">กำลังโหลด...</td></tr></tbody>
      </table>
    </div>
  </div>`;
}

async function _loadAndRenderAudit(tableFilter = '') {
  const tbody = document.getElementById('audit-tbody');
  if (!tbody) return;
  const logs = await loadAuditLogs(100, tableFilter);
  if (!logs.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--gray-400)">ไม่มีบันทึกกิจกรรม</td></tr>';
    return;
  }
  const actionClsMap = { insert: 'pill-paid', update: 'pill-pending', delete: 'pill-overdue', activate: 'pill-normal', deactivate: 'pill-closed', 'cancel': 'pill-overdue' };
  const actionLabelMap = { insert: 'เพิ่ม', update: 'แก้ไข', delete: 'ลบ', activate: 'เปิดใช้', deactivate: 'ปิดใช้', cancel: 'ยกเลิก' };
  tbody.innerHTML = logs.map(l => {
    const label   = actionLabelMap[l.action] || l.action;
    const cls     = actionClsMap[l.action]   || 'pill-normal';
    const ts      = (l.created_at || '').substring(0, 16).replace('T', ' ');
    const summary = _auditSummary(l);
    return `<tr>
      <td class="mono text-muted" style="font-size:11px">${ts}</td>
      <td><code style="font-size:11px;background:var(--gray-100);padding:1px 6px;border-radius:5px">${esc(l.table_name)}</code></td>
      <td><span class="pill ${cls}" style="font-size:10.5px">${label}</span></td>
      <td style="font-size:12px;color:var(--gray-700)">${summary}</td>
      <td class="text-muted" style="font-size:11.5px">${esc(l.performed_by || '—')}</td>
    </tr>`;
  }).join('');
}

function _auditSummary(log) {
  const d = log.new_data || log.old_data;
  if (!d) return `ID: ${esc(log.record_id || '—')}`;
  if (d.name_th)  return esc(d.name_th);
  if (d.nameTh)   return esc(d.nameTh);
  if (d.name)     return esc(d.name);
  if (d.key)      return `${esc(d.key)} = ${esc(String(d.value || ''))}`;
  return `ID: ${esc(log.record_id || '—')}`;
}

// ─── Dropdown Helpers (for forms in other modules) ─────────────
export function buildSelectOptions(category, selectedCode, includeEmpty = false) {
  const items = getMdItems(category);
  const opts  = includeEmpty ? ['<option value="">— เลือก —</option>'] : [];
  items.forEach(x => {
    opts.push(`<option value="${esc(x.code)}"${x.code === selectedCode ? ' selected' : ''}>${esc(x.nameTh)}</option>`);
  });
  return opts.join('');
}

/** Populate all dropdowns in the member form from master data */
export function _populateMemberFormDropdowns() {
  const memberTypeSel = document.getElementById('f-membertype');
  const meterSizeSel  = document.getElementById('f-metersize');
  if (memberTypeSel) memberTypeSel.innerHTML = buildSelectOptions('member_type', memberTypeSel.value);
  if (meterSizeSel)  meterSizeSel.innerHTML  = buildSelectOptions('meter_size',  meterSizeSel.value);
}

/** Populate maintenance type select */
export function _populateMaintenanceTypeSelect() {
  const sel = document.getElementById('mnt-type');
  if (sel) sel.innerHTML = buildSelectOptions('maintenance_type', sel.value);
}

/**
 * Populate ALL village dropdowns across the whole app from _dbVillages.
 * Targets: member form #f-village, members filter, billing filter, map filter.
 */
export function populateVillageDropdowns() {
  const active   = [..._dbVillages]
    .filter(v => v.is_active !== false)
    .sort((a, b) => (a.moo_number || 0) - (b.moo_number || 0));

  const villageOpts = active.map(v =>
    `<option value="${esc(v.name)}">${esc(v.name)}</option>`
  ).join('');

  // Member form village select
  const fVillage = document.getElementById('f-village');
  if (fVillage) {
    const cur = fVillage.value;
    fVillage.innerHTML = villageOpts;
    if (cur && active.find(v => v.name === cur)) fVillage.value = cur;
  }

  // Members page filter (first .fselect in #page-members .filter-bar)
  const memberVillSel = document.querySelector('#page-members .filter-bar .fselect');
  if (memberVillSel) {
    const cur = memberVillSel.value;
    memberVillSel.innerHTML = `<option value="หมู่บ้านทั้งหมด">หมู่บ้านทั้งหมด</option>${villageOpts}`;
    if (cur) memberVillSel.value = cur;
  }

  // Billing page village filter (first .fselect in #page-billing .filter-bar)
  const billVillSel = document.querySelector('#page-billing .filter-bar .fselect');
  if (billVillSel) {
    const cur = billVillSel.value;
    billVillSel.innerHTML = `<option value="ทุกหมู่บ้าน">ทุกหมู่บ้าน</option>${villageOpts}`;
    if (cur) billVillSel.value = cur;
  }

  // Map page village filter (first fselect in map page-hd-actions)
  const mapVillSel = document.querySelector('#page-map .page-hd-actions .fselect');
  if (mapVillSel) {
    const cur = mapVillSel.value;
    mapVillSel.innerHTML = `<option value="ทุกหมู่บ้าน">ทุกหมู่บ้าน</option>${villageOpts}`;
    if (cur) mapVillSel.value = cur;
  }

  // User form village select — uses v.id (integer FK) not v.name
  const uVillSel = document.getElementById('uform-village');
  if (uVillSel) {
    const cur = uVillSel.value;
    uVillSel.innerHTML = `<option value="">— ทุกหมู่บ้าน —</option>` +
      active.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('');
    if (cur) uVillSel.value = cur;
  }
}

// ─── Internal search handler (exposed to window) ───────────────
window._mdFilter = function(val, category) {
  _mdSearch = val;
  const tbody  = document.getElementById(`md-tbody-${category}`);
  const footer = document.getElementById(`md-footer-${category}`);
  if (tbody)  tbody.innerHTML  = _renderMasterRows(category, val);
  if (footer) footer.textContent = _mdFooterText(category);
};

window._loadAuditFilter = function(val) { _loadAndRenderAudit(val); };

window._rateTestCalc = function() {
  const usage  = parseFloat(document.getElementById('rate-test-usage')?.value) || 0;
  const size   = document.getElementById('rate-test-size')?.value || '0.5';
  const el     = document.getElementById('rate-test-result');
  if (!el || !usage) return;
  const result    = calcWaterCharge(usage, size);
  const breakdown = calcWaterBreakdown(usage);

  const bRows = breakdown.map(b => {
    const label = b.to === Infinity || b.to === null
      ? `${b.from}+ หน่วย`
      : `${b.from}–${b.to} หน่วย`;
    return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid var(--gray-100)">
      <span class="text-muted">${label} × ${b.units} หน่วย @ ฿${b.rate}/หน่วย</span>
      <span style="font-weight:600">฿${Math.round(b.charge).toLocaleString()}</span>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="background:var(--gray-50);border-radius:8px;padding:10px 12px;margin-top:8px;font-size:12.5px">
      ${bRows}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:10px">
      <div style="padding:10px;background:var(--blue-50);border-radius:8px;text-align:center">
        <div class="text-muted" style="font-size:11px">ค่าน้ำ</div>
        <div style="font-size:16px;font-weight:700;color:var(--blue-700)">฿${result.waterCharge.toLocaleString()}</div>
      </div>
      <div style="padding:10px;background:var(--gray-50);border-radius:8px;text-align:center">
        <div class="text-muted" style="font-size:11px">ค่าบริการรายเดือน</div>
        <div style="font-size:16px;font-weight:700">฿${result.serviceCharge.toLocaleString()}</div>
      </div>
      <div style="padding:10px;background:#f0fdf4;border-radius:8px;text-align:center">
        <div class="text-muted" style="font-size:11px">รวมทั้งสิ้น</div>
        <div style="font-size:16px;font-weight:700;color:var(--green-700)">฿${result.total.toLocaleString()}</div>
      </div>
    </div>`;
};

// ─── Icon preview sync ─────────────────────────────────────────
function _syncIconPreview() {
  const icon  = document.getElementById('md-f-icon')?.value  || '';
  const color = document.getElementById('md-f-color')?.value || '#444651';
  const prev  = document.getElementById('md-icon-preview');
  if (prev) prev.innerHTML = icon
    ? `<i class="ti ${esc(icon)}" style="font-size:20px;color:${esc(color)}"></i>`
    : `<i class="ti ti-photo" style="color:var(--gray-300)"></i>`;
}

// Wire icon preview on input (called from inline events in HTML)
window._mdSyncIcon = _syncIconPreview;
window._mdSyncColor = function(val) {
  const inp = document.getElementById('md-f-color');
  if (inp) inp.value = val;
  _syncIconPreview();
};
