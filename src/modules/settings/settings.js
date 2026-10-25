// ─── System Settings Module ────────────────────────────────────
// Full master-data management: CRUD for all lookup tables,
// village management, rate tiers, system config, and audit log.
// ──────────────────────────────────────────────────────────────
import { appState } from '../../state/app.state.js';
import { esc, jsArg, toast, showConfirm } from '../../utils/dom.util.js';
import { _sb } from '../../services/supabase.service.js';
import { hasRole } from '../../services/auth.service.js';
import { rateConfig, calcWaterCharge, calcWaterBreakdown } from '../../config/rate.config.js';
import { saveRateConfig } from '../../services/storage.service.js';
import {
  sbSaveRateTier, sbUpdateTierTo, sbInsertRateTier, sbDeleteRateTier,
} from '../../services/data-loader.service.js';
import { _dbVillages, _vName } from '../../services/db-mapper.service.js';
import {
  getMdItems, saveMdItem, deleteMdItem, toggleMdItem,
  saveVillage, deleteVillage, toggleVillage,
  saveSystemConfig, loadAuditLogs,
} from '../../services/master-data.service.js';
import { buildBackupPanel, canBackup } from './backup.js';
import { buildNotifyPanel } from '../notify/notify.js';
import { PAPERS } from '../documents/print.js';
import { isValidPromptPayId } from '../../utils/promptpay.js';
import { openModal, closeModal, busyButton } from '../../components/modal/modal.js';

// ─── Tab Configuration ─────────────────────────────────────────
const TABS = [
  { id: 'rates',            label: 'อัตราค่าน้ำ',          icon: 'ti-coin',            type: 'custom', group: 'billing', desc: 'อัตราก้าวหน้า ค่าบริการ ค่าปรับ' },
  { id: 'payment_channel',  label: 'ช่องทางชำระ',           icon: 'ti-credit-card',     type: 'master', group: 'billing', desc: 'เงินสด โอน พร้อมเพย์' },
  { id: 'villages',         label: 'หมู่บ้าน',              icon: 'ti-home-2',          type: 'custom', group: 'master',  desc: 'หมู่บ้าน/โซนที่ให้บริการ' },
  { id: 'member_type',      label: 'ประเภทสมาชิก',          icon: 'ti-users',           type: 'master', group: 'master',  desc: 'ครัวเรือน ร้านค้า หน่วยงาน' },
  { id: 'meter_size',       label: 'ขนาดมิเตอร์',           icon: 'ti-gauge',           type: 'master', group: 'master',  desc: 'ขนาดท่อ/มิเตอร์' },
  { id: 'reading_method',   label: 'วิธีจดมิเตอร์',          icon: 'ti-pencil',          type: 'master', group: 'master',  desc: 'วิธีบันทึกเลขมิเตอร์' },
  { id: 'maintenance_type', label: 'ประเภทงานซ่อม',          icon: 'ti-tool',            type: 'master', group: 'ops',     desc: 'หมวดงานซ่อมบำรุง' },
  { id: 'anomaly_type',     label: 'ความผิดปกติ',            icon: 'ti-alert-triangle',  type: 'master', group: 'ops',     desc: 'ความผิดปกติของมิเตอร์' },
  { id: 'system_config',    label: 'ตั้งค่าทั่วไป',          icon: 'ti-settings',        type: 'custom', group: 'system',  desc: 'หน่วยงาน การเรียกเก็บ การพิมพ์' },
  { id: 'notify',           label: 'แจ้งเตือน & LINE',       icon: 'ti-brand-line',      type: 'custom', group: 'system',  desc: 'LINE / SMS การแจ้งเตือน' },
  { id: 'backup',           label: 'สำรองข้อมูล',            icon: 'ti-database-export', type: 'custom', group: 'system',  desc: 'ส่งออก / กู้คืนข้อมูล', visible: canBackup },
  { id: 'audit_log',        label: 'บันทึกกิจกรรม',          icon: 'ti-history',         type: 'custom', group: 'system',  desc: 'ประวัติการใช้งานระบบ' },
  { id: 'pdpa',             label: 'คำขอ PDPA',              icon: 'ti-shield-lock',     type: 'custom', group: 'system',  desc: 'คำขอใช้สิทธิ์ของเจ้าของข้อมูล', visible: () => hasRole('super_admin', 'village_admin') },
];

// กลุ่มเมนูด้านซ้ายของหน้าตั้งค่า (ลำดับตามที่แสดง)
const TAB_GROUPS = [
  { id: 'billing', label: 'การเงินและค่าน้ำ' },
  { id: 'master',  label: 'ข้อมูลพื้นฐาน' },
  { id: 'ops',     label: 'งานซ่อมบำรุง' },
  { id: 'system',  label: 'ระบบ' },
];

const SYSTEM_CONFIG_FIELDS = [
  { section: 'ข้อมูลหน่วยงาน (แสดงบนเอกสาร)' },
  { key: 'org_name',           label: 'ชื่อองค์กร',                    type: 'text',     placeholder: 'กิจการประปาหมู่บ้าน...' },
  { key: 'org_address',        label: 'ที่อยู่',                        type: 'text',     placeholder: 'ที่อยู่...' },
  { key: 'org_phone',          label: 'เบอร์โทรติดต่อ',                 type: 'text',     placeholder: '081-234-5678' },
  { key: 'org_tax_id',         label: 'เลขประจำตัวผู้เสียภาษี (ถ้ามี)',   type: 'text',     placeholder: '13 หลัก' },
  { key: 'org_signer_name',    label: 'ผู้ลงนามในหนังสือแจ้ง',          type: 'text',     placeholder: 'ชื่อ-นามสกุล' },
  { key: 'org_signer_title',   label: 'ตำแหน่งผู้ลงนาม',                type: 'text',     placeholder: 'ประธานคณะกรรมการบริหารกิจการประปาหมู่บ้าน' },
  { section: 'การเรียกเก็บเงิน' },
  { key: 'billing_due_days',   label: 'วันครบกำหนดชำระ (หลังออกบิล)', type: 'number',   placeholder: '15' },
  { key: 'reconnect_fee',      label: 'ค่าธรรมเนียมต่อน้ำใหม่ (บาท)',   type: 'number',   placeholder: '100' },
  { key: 'promptpay_id',       label: 'พร้อมเพย์ไอดี (เบอร์มือถือ/เลขผู้เสียภาษี)', type: 'text', placeholder: '0812345678', validate: 'promptpay' },
  { key: 'promptpay_name',     label: 'ชื่อบัญชีพร้อมเพย์',              type: 'text',     placeholder: 'กองทุนประปาหมู่บ้าน...' },
  { key: 'bank_info',          label: 'ข้อมูลบัญชีธนาคาร (แสดงบนใบแจ้ง)', type: 'textarea', placeholder: 'ธนาคาร... สาขา...\nเลขที่บัญชี ...' },
  { key: 'receipt_footer',     label: 'ข้อความท้ายใบแจ้ง/ใบเสร็จ',       type: 'text',     placeholder: 'ขอบคุณที่ชำระตรงเวลา' },
  { section: 'บัญชีกองทุน (ใช้คำนวณยอดคงเหลือในรายงาน)' },
  { key: 'fund_opening_date',    label: 'วันที่ยกยอดกองทุน',          type: 'date',     placeholder: '' },
  { key: 'fund_opening_balance', label: 'ยอดเงินกองทุนยกมา (บาท)',    type: 'number',   placeholder: '0' },
  { section: 'การพิมพ์' },
  { key: 'print_paper',        label: 'กระดาษเริ่มต้น (แต่ละเครื่องเปลี่ยนเองได้)', type: 'select', options: PAPERS },
  { section: 'อื่นๆ' },
  { note: 'AI อ่านมิเตอร์ใช้ key ที่ตั้งบน server (Edge Function meter-ocr) — ไม่เก็บใน browser' },
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
  const tabs = TABS.filter(t => !t.visible || t.visible());
  bar.innerHTML = TAB_GROUPS.map(g => {
    const items = tabs.filter(t => t.group === g.id);
    if (!items.length) return '';
    return `
    <div class="snav-group">
      <div class="snav-group-label">${esc(g.label)}</div>
      ${items.map(t => {
        const count = t.type === 'master' ? getMdItems(t.id, false).length : null;
        return `
        <button class="snav-item${_activeTab === t.id ? ' active' : ''}" title="${esc(t.desc || '')}"
          onclick="setSettingsTab(${jsArg(t.id)})">
          <i class="ti ${t.icon}"></i>
          <span class="snav-text"><span class="snav-label">${esc(t.label)}</span><span class="snav-desc">${esc(t.desc || '')}</span></span>
          ${count !== null ? `<span class="snav-count">${count}</span>` : ''}
        </button>`;
      }).join('')}
    </div>`;
  }).join('');
  // มือถือ: เมนูเป็นแถบเลื่อนแนวนอน — เลื่อนให้แท็บที่เลือกอยู่ในจอ
  const active = bar.querySelector('.snav-item.active');
  if (active && bar.scrollWidth > bar.clientWidth) {
    bar.scrollLeft = active.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2;
  }
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
  } else if (tabId === 'notify') {
    el.innerHTML = buildNotifyPanel();
  } else if (tabId === 'backup') {
    el.innerHTML = buildBackupPanel();
  } else if (tabId === 'pdpa') {
    el.innerHTML = _buildPdpaPanel();
    _loadAndRenderPdpa();
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
          oninput="window._mdFilter(this.value,${jsArg(tab.id)})"/>
        <button class="btn btn-primary btn-sm" onclick="openMdModal(${jsArg(tab.id)})">
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
          onclick="window.toggleMdItemHandler(${jsArg(x.id)},${jsArg(category)},${!x.isActive})">
          <div class="toggle-thumb"></div>
        </div>
      </td>
      <td>
        <div style="display:flex;gap:4px;justify-content:flex-end">
          <button class="btn-icon" title="แก้ไข" onclick="openMdModal(${jsArg(category)},${jsArg(x.id)})"><i class="ti ti-edit"></i></button>
          <button class="btn-icon" title="ลบ" style="color:var(--red-700);border-color:var(--red-100)"
            onclick="window.deleteMdItemConfirm(${jsArg(x.id)},${jsArg(category)})"><i class="ti ti-trash"></i></button>
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

export function deleteMdItemConfirm(id, category) {
  const item = (appState.masterData[category] || []).find(x => x.id === id);
  if (!item) return;
  showConfirm({
    title:   `ลบ "${item.nameTh}"?`,
    message: 'การดำเนินการนี้ไม่สามารถย้อนกลับได้',
    okText:  'ลบเลย',
    async onOk() {
      const { error } = await deleteMdItem(id, category);
      if (error) { toast(`⚠ ${error}`, 'error'); return; }
      toast(`ลบ "${item.nameTh}" แล้ว`, 'success');
      _refreshMasterPanel(category);
      _propagateChanges(category);
    },
  });
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
  _renderTabsBar();
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
  if (category === 'payment_channel') window.renderPayments?.();
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
      const count   = appState.members.filter(m => m.villageId === v.id).length;
      const overdue = appState.members.filter(m => m.villageId === v.id && m.status === 'overdue').length;
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
  // สมาชิกผูกหมู่บ้านด้วย id — แค่อัปเดตชื่อที่แสดง
  appState.members.forEach(m => { m.village = _vName(m.villageId); });
  renderSettingsVillages();
  populateVillageDropdowns();
  window.renderMembers?.();
}

export function deleteVillageConfirm(id) {
  const v = _dbVillages.find(x => x.id === id);
  if (!v) return;
  const count = appState.members.filter(m => m.villageId === v.id).length;
  if (count > 0) { toast(`ไม่สามารถลบได้ มีสมาชิก ${count} รายในหมู่บ้านนี้`, 'error'); return; }
  showConfirm({
    title:   `ลบหมู่บ้าน "${v.name}"?`,
    message: count === 0 ? 'ไม่มีสมาชิกในหมู่บ้านนี้' : '',
    okText:  'ลบเลย',
    async onOk() {
      const { error } = await deleteVillage(id);
      if (error) { toast(`⚠ ${error}`, 'error'); return; }
      toast(`ลบ "${v.name}" แล้ว`, 'success');
      renderSettingsVillages();
      populateVillageDropdowns();
    },
  });
}

export async function toggleVillageHandler(id, isActive) {
  const { error } = await toggleVillage(id, isActive);
  if (error) { toast(`⚠ ${error}`, 'error'); return; }
  renderSettingsVillages();
  populateVillageDropdowns();
}

// ─── Rate Tiers Panel ─────────────────────────────────────────
const _rangeLabel = t => (t.to === Infinity || t.to === null) ? `${t.from}+ หน่วย` : `${t.from}–${t.to} หน่วย`;
const _baht       = n => `฿${Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;

const FEE_FIELDS = [
  { id: 'svc-small-val', key: 'svc_charge_small',   cfg: 'svcSmall',        icon: 'ti-droplet',      label: 'มิเตอร์เล็ก',    hint: 'ขนาด ½" และ ¾"' },
  { id: 'svc-large-val', key: 'svc_charge_large',   cfg: 'svcLarge',        icon: 'ti-droplet-half', label: 'มิเตอร์ใหญ่',    hint: 'ขนาด 1" ขึ้นไป' },
  { id: 'late-fee-val',  key: 'late_fee_per_month', cfg: 'lateFeePerMonth', icon: 'ti-clock-dollar', label: 'ค่าปรับล่าช้า', hint: 'คิดเพิ่มต่อเดือนที่ค้างชำระ' },
];
const METER_SIZES = [['0.5', '½"'], ['0.75', '¾"'], ['1', '1"'], ['1.5', '1½"']];
let _rtSize = '0.5';

export function renderSettingsRates() {
  const el = document.getElementById('rate-tiers-list');
  if (!el) return;
  const n = rateConfig.tiers.length;
  const count = document.getElementById('rt-tier-count');
  if (count) count.textContent = `${n} ช่วง`;

  if (!n) {
    el.innerHTML = `<tr><td colspan="5" class="rt-empty">ยังไม่มีข้อมูลอัตราค่าน้ำ</td></tr>`;
  } else {
    el.innerHTML = rateConfig.tiers.map((t, i) => `<tr>
      <td class="rt-no">${i + 1}</td>
      <td class="rt-range">${_rangeLabel(t)}</td>
      <td class="rt-bar-cell"><span class="rt-bar"></span></td>
      <td class="rt-rate-cell">
        <label class="rt-money" title="แก้ตัวเลขแล้วกด Enter เพื่อบันทึก · Esc ยกเลิก">
          <span>฿</span>
          <input type="number" step="0.25" min="0" value="${t.rate.toFixed(2)}" data-orig="${t.rate}"
            aria-label="อัตราช่วง ${_rangeLabel(t)}"
            onkeydown="if(event.key==='Enter')this.blur();else if(event.key==='Escape'){this.value=(+this.dataset.orig).toFixed(2);this.blur()}"
            onblur="window._rtSaveTierRate(${i}, this)"/>
          <em>/หน่วย</em>
        </label>
      </td>
      <td class="rt-act">${i === n - 1 && n > 1
        ? `<button class="btn-icon rt-del" title="ลบช่วงสุดท้าย" onclick="window.deleteLastTierConfirm()"><i class="ti ti-trash"></i></button>`
        : ''}</td>
    </tr>`).join('');
    _rtRefreshBars();
  }

  // Sync ช่องค่าบริการ/ค่าปรับ — ไม่ทับค่าที่ผู้ใช้กำลังแก้แต่ยังไม่บันทึก
  if (!document.querySelector('.rt-fees.is-dirty')) {
    FEE_FIELDS.forEach(f => {
      const inp = document.getElementById(f.id);
      if (inp) inp.value = rateConfig[f.cfg];
    });
  }
  window._rateTestCalc();
}

// แถบเทียบอัตรา: ยาวตามสัดส่วนอัตราของช่วง เทียบกับช่วงที่แพงที่สุด
function _rtRefreshBars() {
  const maxRate = Math.max(...rateConfig.tiers.map(t => t.rate), 1);
  document.querySelectorAll('#rate-tiers-list .rt-bar').forEach((bar, i) => {
    const t = rateConfig.tiers[i];
    if (t) bar.style.width = `${Math.max(t.rate / maxRate * 100, 4)}%`;
  });
}

const _feeField = f => `
  <div class="rt-field">
    <i class="ti ${f.icon}"></i>
    <label for="${f.id}"><b>${f.label}</b><small>${f.hint}</small></label>
    <label class="rt-money rt-money-lg">
      <span>฿</span>
      <input id="${f.id}" type="number" step="1" min="0" value="${rateConfig[f.cfg]}"
        oninput="window._rtFeesDirty()" onkeydown="if(event.key==='Enter')window.saveFeesHandler()"/>
      <em>/เดือน</em>
    </label>
  </div>`;

function _buildRatesPanel() {
  return `
  <div class="rt-wrap"><div class="rt-layout">

    <!-- ─── อัตราค่าน้ำก้าวหน้า ─── -->
    <div class="card rt-tiers">
      <div class="card-hd">
        <div class="card-title">
          <i class="ti ti-coin" style="color:var(--blue-500)"></i>อัตราค่าน้ำ (ก้าวหน้า)
          <span class="rt-count" id="rt-tier-count"></span>
        </div>
        <button class="btn btn-primary btn-sm" onclick="openAddTierModal()">
          <i class="ti ti-plus"></i>เพิ่มช่วง
        </button>
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr>
            <th>ที่</th>
            <th>ช่วงการใช้น้ำ</th>
            <th class="rt-bar-cell">เทียบอัตรา</th>
            <th style="text-align:right">อัตรา (บาท/หน่วย)</th>
            <th></th>
          </tr></thead>
          <tbody id="rate-tiers-list"></tbody>
        </table>
      </div>
      <div class="tbl-footer">
        <span class="rt-hint"><i class="ti ti-pencil"></i>คลิกตัวเลขเพื่อแก้ แล้วกด Enter บันทึกทันที</span>
        <span class="rt-hint"><i class="ti ti-stairs-up"></i>คิดแยกตามช่วง แล้วรวมเป็นค่าน้ำ</span>
      </div>
    </div>

    <!-- ─── ค่าบริการ & ค่าปรับ ─── -->
    <div class="card rt-fees">
      <div class="card-hd">
        <div class="card-title">
          <i class="ti ti-receipt-2" style="color:var(--blue-500)"></i>ค่าบริการ & ค่าปรับ
          <span class="rt-dirty">ยังไม่บันทึก</span>
        </div>
        <button class="btn btn-primary btn-sm" id="rt-fees-save" onclick="window.saveFeesHandler()" disabled>
          <i class="ti ti-device-floppy"></i>บันทึก
        </button>
      </div>
      <div class="card-body rt-fees-body">
        <div class="rt-sec">ค่าบริการรายเดือน <span>คิดตามขนาดมิเตอร์ ไม่ขึ้นกับปริมาณน้ำ</span></div>
        ${_feeField(FEE_FIELDS[0])}
        ${_feeField(FEE_FIELDS[1])}
        <div class="rt-sec">ค่าปรับ <span>สำหรับบิลที่เลยกำหนดชำระ</span></div>
        ${_feeField(FEE_FIELDS[2])}
      </div>
    </div>

    <!-- ─── ทดสอบคำนวณ ─── -->
    <div class="card rt-calc">
      <div class="card-hd">
        <div class="card-title">
          <i class="ti ti-calculator" style="color:var(--blue-500)"></i>ทดสอบคำนวณบิล
        </div>
        <span class="rt-hint"><i class="ti ti-bolt"></i>คำนวณทันทีจากอัตราปัจจุบัน</span>
      </div>
      <div class="card-body rt-calc-body">
        <div class="rt-calc-in">
          <label class="form-label" for="rate-test-usage">ปริมาณการใช้น้ำ</label>
          <label class="rt-money rt-money-lg rt-usage">
            <input id="rate-test-usage" type="number" min="0" step="1" value="25"
              oninput="window._rateTestCalc()"/>
            <em>หน่วย</em>
          </label>
          <div class="rt-chips">
            ${[10, 20, 30, 50, 100].map(u =>
              `<button type="button" class="rt-chip" onclick="window._rtSetUsage(${u})">${u}</button>`).join('')}
          </div>
          <span class="form-label">ขนาดมิเตอร์</span>
          <div class="rt-seg" role="group" aria-label="ขนาดมิเตอร์">
            ${METER_SIZES.map(([v, label]) =>
              `<button type="button" class="rt-seg-btn${v === _rtSize ? ' active' : ''}" data-size="${v}"
                onclick="window._rtSetSize(${jsArg(v)})">${label}</button>`).join('')}
          </div>
        </div>
        <div class="rt-result" id="rate-test-result"></div>
      </div>
    </div>

  </div></div>`;
}

window._rtSaveTierRate = async function(idx, input) {
  const tier = rateConfig.tiers[idx];
  if (!tier || !input) return;
  const v = parseFloat(input.value);
  if (isNaN(v) || v < 0) {
    toast('กรุณากรอกอัตราที่ถูกต้อง', 'error');
    input.value = tier.rate.toFixed(2);
    return;
  }
  if (v === tier.rate) { input.value = tier.rate.toFixed(2); return; }

  const box = input.closest('.rt-money');
  box?.classList.add('is-saving');
  const ok = await sbSaveRateTier(tier.from, v);
  box?.classList.remove('is-saving');
  if (!ok) { input.value = tier.rate.toFixed(2); return; }

  tier.rate = v;
  saveRateConfig();
  input.value = v.toFixed(2);
  input.dataset.orig = v;
  box?.classList.add('is-saved');
  setTimeout(() => box?.classList.remove('is-saved'), 1400);
  _rtRefreshBars();
  window._rateTestCalc();
  toast(`บันทึกอัตรา ${_rangeLabel(tier)} = ฿${v.toFixed(2)}/หน่วย แล้ว`, 'success');
};

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
export function deleteLastTierConfirm() {
  const n = rateConfig.tiers.length;
  if (n <= 1) { toast('ต้องมีอย่างน้อย 1 ช่วง', 'error'); return; }
  const last = rateConfig.tiers[n - 1];
  const prev = rateConfig.tiers[n - 2];
  showConfirm({
    title:   `ลบช่วง "${last.from}+ หน่วย"?`,
    message: `ช่วง ${prev.from}–${last.from - 1} จะกลายเป็นช่วงสุดท้าย (ไม่จำกัด)`,
    okText:  'ลบเลย',
    async onOk() {
      const ok1 = await sbDeleteRateTier(last.from);
      if (!ok1) return;
      const ok2 = await sbUpdateTierTo(prev.from, null);
      if (!ok2) return;
      rateConfig.tiers.pop();
      prev.to = Infinity;
      saveRateConfig();
      renderSettingsRates();
      toast(`ลบช่วง "${last.from}+ หน่วย" แล้ว`, 'success');
    },
  });
}

// ─── Save Service Charges / Late Fee ──────────────────────────
// บันทึกเฉพาะช่องที่ค่าเปลี่ยน คืน false ถ้ากรอกไม่ถูกต้องหรือบันทึกไม่สำเร็จ
async function _saveFees(fields) {
  const vals = fields.map(f => parseFloat(document.getElementById(f.id)?.value));
  if (vals.some(v => isNaN(v) || v < 0)) {
    toast('กรุณากรอกจำนวนเงินที่ถูกต้อง', 'error');
    return false;
  }
  const changed = fields.map((f, i) => ({ f, v: vals[i] })).filter(({ f, v }) => v !== rateConfig[f.cfg]);
  const results = await Promise.all(changed.map(({ f, v }) => saveSystemConfig(f.key, String(v))));
  const failed  = results.find(r => r?.error);

  changed.forEach(({ f, v }, i) => {
    if (results[i]?.error) return;
    rateConfig[f.cfg] = v;
    appState.systemConfig[f.key] = String(v);
  });
  saveRateConfig();
  if (failed) { toast(`⚠ ${failed.error}`, 'error'); return false; }
  return true;
}

export async function saveSvcChargesHandler() {
  if (await _saveFees(FEE_FIELDS.slice(0, 2))) toast('บันทึกค่าบริการรายเดือนแล้ว', 'success');
}

export async function saveLateFeeHandler() {
  if (await _saveFees(FEE_FIELDS.slice(2))) toast('บันทึกค่าปรับล่าช้าแล้ว', 'success');
}

export async function saveFeesHandler() {
  const btn = document.getElementById('rt-fees-save');
  if (btn?.disabled) return;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2"></i>กำลังบันทึก...'; }
  const ok = await _saveFees(FEE_FIELDS);
  if (btn) btn.innerHTML = '<i class="ti ti-device-floppy"></i>บันทึก';
  window._rtFeesDirty();
  window._rateTestCalc();
  if (ok) toast('บันทึกค่าบริการและค่าปรับแล้ว', 'success');
}

// เปิดปุ่มบันทึกเมื่อมีช่องใดค่าไม่ตรงกับที่บันทึกไว้
window._rtFeesDirty = function() {
  const dirty = FEE_FIELDS.some(f => {
    const inp = document.getElementById(f.id);
    return inp && parseFloat(inp.value) !== rateConfig[f.cfg];
  });
  document.querySelector('.rt-fees')?.classList.toggle('is-dirty', dirty);
  const btn = document.getElementById('rt-fees-save');
  if (btn) btn.disabled = !dirty;
};

export function saveSettings() { saveRateConfig(); renderSettingsRates(); toast('บันทึกแล้ว', 'success'); }

// ─── System Config Panel ───────────────────────────────────────
function _buildSystemConfigPanel() {
  const cfg = appState.systemConfig || {};
  const input = f => {
    const v = String(cfg[f.key] || '');
    if (f.type === 'select') return `<select class="form-input" id="scf-${f.key}">${Object.entries(f.options)
      .map(([k, label]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
    if (f.type === 'textarea') return `<textarea class="form-input" id="scf-${f.key}" rows="2" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
    return `<input class="form-input" id="scf-${f.key}" type="${f.type || 'text'}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}"/>`;
  };
  const rows = SYSTEM_CONFIG_FIELDS.map(f => f.section
    ? `<div style="font-weight:700;color:var(--blue-900);margin-top:6px;padding-top:10px;border-top:1px solid var(--gray-100)">${esc(f.section)}</div>`
    : f.note
    ? `<div style="font-size:12.5px;color:var(--gray-600)"><i class="ti ti-lock" style="margin-right:4px"></i>${esc(f.note)}</div>`
    : `<div class="syconf-row">
      <label class="form-label" for="scf-${f.key}" style="min-width:200px">${esc(f.label)}</label>
      ${input(f)}
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

  const fields = SYSTEM_CONFIG_FIELDS.filter(f => f.key);
  const bad = fields.find(f => f.validate === 'promptpay' && document.getElementById(`scf-${f.key}`)?.value.trim()
    && !isValidPromptPayId(document.getElementById(`scf-${f.key}`).value));
  if (bad) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-device-floppy"></i>บันทึก'; }
    toast('พร้อมเพย์ไอดีต้องเป็นเบอร์มือถือ 10 หลัก, เลข 13 หลัก หรือ e-Wallet 15 หลัก', 'error');
    return;
  }
  const promises = fields.map(f => {
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
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      ${hasRole('super_admin', 'village_admin') ? `<button class="btn btn-secondary btn-sm" id="audit-verify-btn" onclick="window._verifyAuditChain()"><i class="ti ti-shield-check"></i>ตรวจความถูกต้องของ audit log</button>` : ''}
      <select class="form-input" id="audit-filter" style="width:180px" onchange="window._loadAuditFilter(this.value)">
        <option value="">ทุกตาราง</option>
        <option value="master_data">Master Data</option>
        <option value="villages">หมู่บ้าน</option>
        <option value="system_config">ตั้งค่าระบบ</option>
        <option value="bills">บิล</option>
        <option value="payments">การชำระเงิน</option>
        <option value="bill_adjustments">ใบลดหนี้/เพิ่มหนี้</option>
        <option value="billing_periods">งวดบิล</option>
        <option value="members">สมาชิก</option>
        <option value="meter_readings">การอ่านมิเตอร์</option>
        <option value="privacy_requests">คำขอ PDPA</option>
      </select>
      </div>
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
  const actionLabelMap = { insert: 'เพิ่ม', update: 'แก้ไข', delete: 'ลบ', activate: 'เปิดใช้', deactivate: 'ปิดใช้', cancel: 'ยกเลิก',
    reveal_pii: 'ดูเลขบัตร', anonymise: 'นิรนาม', export: 'ส่งออก' };
  tbody.innerHTML = logs.map(l => {
    const label   = actionLabelMap[l.action] || l.action;
    const cls     = actionClsMap[l.action]   || 'pill-normal';
    const ts      = (l.created_at || '').substring(0, 16).replace('T', ' ');
    const summary = _auditSummary(l);
    return `<tr>
      <td class="mono text-muted" style="font-size:11px">${ts}</td>
      <td><code style="font-size:11px;background:var(--gray-100);padding:1px 6px;border-radius:5px">${esc(l.table_name)}</code></td>
      <td><span class="pill ${cls}" style="font-size:10.5px">${esc(label)}</span></td>
      <td style="font-size:12px;color:var(--gray-700)">${summary}</td>
      <td class="text-muted" style="font-size:11.5px">${esc(l.performed_by || '—')}${l.source === 'client'
        ? ' <span class="pill pill-pending" style="font-size:9.5px;padding:1px 6px" title="บันทึกจากแอป (ไม่ใช่ trigger ของฐานข้อมูล)">แอป</span>' : ''}</td>
    </tr>`;
  }).join('');
}

const _AUDIT_STATUS = { pending: 'รอชำระ', overdue: 'ค้างชำระ', paid: 'ชำระแล้ว', cancelled: 'ยกเลิก',
  approved: 'อนุมัติ', rejected: 'ปฏิเสธ', open: 'เปิดงวด', closed: 'ปิดงวด' };

function _auditSummary(log) {
  const d = log.new_data || log.old_data;
  if (!d) return `ID: ${esc(log.record_id || '—')}`;
  const o = log.old_data || {};
  const baht = v => '฿' + Number(v || 0).toLocaleString();
  if (log.table_name === 'bills') {
    const parts = [`<span class="mono">${esc(d.id || log.record_id || '')}</span> ${esc(d.period_label || '')}`];
    if (o.status && o.status !== d.status) parts.push(`${esc(_AUDIT_STATUS[o.status] || o.status)} → ${esc(_AUDIT_STATUS[d.status] || d.status)}`);
    if (o.total !== undefined && Number(o.total) !== Number(d.total)) parts.push(`${baht(o.total)} → ${baht(d.total)}`);
    else if (!log.old_data) parts.push(baht(d.total));
    if (d.cancel_reason && o.status !== 'cancelled' && d.status === 'cancelled') parts.push(`เหตุผล: ${esc(d.cancel_reason)}`);
    return parts.join(' · ');
  }
  if (log.table_name === 'payments') {
    // UPDATE เก็บเฉพาะคอลัมน์ที่เปลี่ยน — แสดงเท่าที่มี
    return [`<span class="mono">${esc(d.receipt_no || d.id || log.record_id || '')}</span>`,
      d.bill_id !== undefined ? `บิล ${esc(d.bill_id)}` : '',
      d.amount !== undefined ? baht(d.amount) : '',
      d.status !== undefined ? (o.status && o.status !== d.status ? `${esc(_AUDIT_STATUS[o.status] || o.status)} → ` : '') + esc(_AUDIT_STATUS[d.status] || d.status) : '',
    ].filter(Boolean).join(' · ');
  }
  if (log.table_name === 'bill_adjustments') {
    return `<span class="mono">${esc(d.doc_no)}</span> บิล ${esc(d.bill_id)} · ${Number(d.amount) < 0 ? 'ลด' : 'เพิ่ม'} ${baht(Math.abs(d.amount))} · ${esc(d.reason)}`;
  }
  if (log.table_name === 'billing_periods') {
    return `งวด ${esc(d.period_month)}/${esc(d.period_year)} · ${esc(_AUDIT_STATUS[d.status] || d.status)}${d.note ? ' · ' + esc(d.note) : ''}`;
  }
  if (d.name_th)  return esc(d.name_th);
  if (d.nameTh)   return esc(d.nameTh);
  if (d.name)     return esc(d.name);
  if (d.key)      return `${esc(d.key)} = ${esc(String(d.value || ''))}`;
  if (log.action === 'update' && log.old_data && log.new_data) {
    const keys = Object.keys(log.new_data).slice(0, 4);
    return `ID: ${esc(log.record_id || '—')} · ` + keys.map(k => `${esc(k)}: ${esc(String(o[k] ?? '—'))} → ${esc(String(d[k] ?? '—'))}`).join(', ');
  }
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

  // value = village id (ตัวเชื่อมเป็น id เสมอ — ชื่อเปลี่ยนได้)
  const villageOpts = active.map(v =>
    `<option value="${v.id}">${esc(v.name)}</option>`
  ).join('');

  // Member form village select
  const fVillage = document.getElementById('f-village');
  if (fVillage) {
    const cur = fVillage.value;
    fVillage.innerHTML = villageOpts;
    if (cur && active.find(v => String(v.id) === cur)) fVillage.value = cur;
  }

  // Members page filter (first .fselect in #page-members .filter-bar)
  const memberVillSel = document.querySelector('#page-members .filter-bar .fselect');
  if (memberVillSel) {
    const cur = memberVillSel.value;
    memberVillSel.innerHTML = `<option value="">หมู่บ้านทั้งหมด</option>${villageOpts}`;
    if (cur) memberVillSel.value = cur;
  }

  // Billing page village filter (first .fselect in #page-billing .filter-bar)
  const billVillSel = document.querySelector('#page-billing .filter-bar .fselect');
  if (billVillSel) {
    const cur = billVillSel.value;
    billVillSel.innerHTML = `<option value="">ทุกหมู่บ้าน</option>${villageOpts}`;
    if (cur) billVillSel.value = cur;
  }

  // Map page village filter (first fselect in map page-hd-actions)
  const mapVillSel = document.querySelector('#page-map .page-hd-actions .fselect');
  if (mapVillSel) {
    const cur = mapVillSel.value;
    mapVillSel.innerHTML = `<option value="">ทุกหมู่บ้าน</option>${villageOpts}`;
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

window._rtSetUsage = function(units) {
  const inp = document.getElementById('rate-test-usage');
  if (inp) inp.value = units;
  window._rateTestCalc();
};

window._rtSetSize = function(size) {
  _rtSize = size;
  document.querySelectorAll('.rt-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.size === size));
  window._rateTestCalc();
};

window._rateTestCalc = function() {
  const el  = document.getElementById('rate-test-result');
  const raw = document.getElementById('rate-test-usage')?.value;
  if (!el) return;
  const usage = parseFloat(raw);
  if (raw === '' || isNaN(usage) || usage < 0) {
    el.innerHTML = `<div class="rt-calc-empty"><i class="ti ti-droplet"></i>กรอกปริมาณการใช้น้ำเพื่อดูผลคำนวณ</div>`;
    return;
  }
  const result    = calcWaterCharge(usage, _rtSize);
  const breakdown = calcWaterBreakdown(usage);
  const sizeLabel = METER_SIZES.find(([v]) => v === _rtSize)?.[1] || '';

  const rows = breakdown.length
    ? breakdown.map(b => `<div class="rt-break-row">
        <span>${_rangeLabel(b)}</span>
        <span class="text-muted">${b.units.toLocaleString()} × ฿${b.rate.toFixed(2)}</span>
        <b>${_baht(Math.round(b.charge))}</b>
      </div>`).join('')
    : `<div class="rt-break-row"><span class="text-muted">ไม่มีการใช้น้ำ</span><span></span><b>฿0</b></div>`;

  el.innerHTML = `
    <div class="rt-break">
      <div class="rt-break-row rt-break-hd"><span>ช่วงการใช้น้ำ</span><span>หน่วย × อัตรา</span><span>เป็นเงิน</span></div>
      ${rows}
    </div>
    <div class="rt-totals">
      <div><small>ค่าน้ำ (${usage.toLocaleString()} หน่วย)</small><b>${_baht(result.waterCharge)}</b></div>
      <div><small>ค่าบริการ (มิเตอร์ ${sizeLabel})</small><b>${_baht(result.serviceCharge)}</b></div>
      <div class="is-total"><small>รวมทั้งสิ้น</small><b>${_baht(result.total)}</b></div>
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

// ─── Audit chain verify (admin) ────────────────────────────────
window._verifyAuditChain = async function () {
  const btn = document.getElementById('audit-verify-btn');
  if (btn) btn.disabled = true;
  const { data, error } = await _sb.rpc('verify_audit_chain');
  if (btn) btn.disabled = false;
  if (error) { toast(error.message, 'error'); return; }
  if (data?.ok) toast(`audit log ถูกต้อง — ตรวจแล้ว ${Number(data.checked || 0).toLocaleString()} รายการ`, 'success', 5000);
  else toast(`พบ audit log ถูกแก้ไข/ลบ ที่ลำดับ ${data?.broken_at_seq ?? '?'} (${data?.record || ''}) — ตรวจสอบด่วน`, 'error', 10000);
};

// ─── PDPA: คำขอใช้สิทธิ์ของเจ้าของข้อมูล (admin) ────────────────
const _PDPA_KIND = {
  access: 'ขอเข้าถึง/สำเนา', rectify: 'ขอแก้ไข', erase: 'ขอลบ', object: 'คัดค้าน',
  restrict: 'ระงับการใช้', withdraw_consent: 'ถอนความยินยอม', portability: 'ขอโอนย้าย',
};
const _PDPA_STATUS = {
  open:        { label: 'รอดำเนินการ',   cls: 'pill-pending' },
  in_progress: { label: 'กำลังดำเนินการ', cls: 'pill-normal' },
  done:        { label: 'เสร็จสิ้น',      cls: 'pill-paid' },
  rejected:    { label: 'ปฏิเสธ',         cls: 'pill-overdue' },
};
let _pdpaOpenOnly = true;
let _pdpaRows = [];

function _buildPdpaPanel() {
  return `
  <div class="card">
    <div class="card-hd">
      <div class="card-title"><i class="ti ti-shield-lock" style="color:var(--blue-500)"></i>คำขอใช้สิทธิ์ข้อมูลส่วนบุคคล (PDPA)</div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12.5px">
        <input type="checkbox" id="pdpa-open-only"${_pdpaOpenOnly ? ' checked' : ''}/>เฉพาะที่ยังไม่เสร็จ
      </label>
    </div>
    <div class="card-body" style="font-size:12px;color:var(--gray-600);padding-bottom:0">
      ต้องตอบเจ้าของข้อมูลภายใน 30 วัน (พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล ม.30–36) · คำขอลบ: ปิดสมาชิกและเคลียร์บิลค้างก่อน แล้วกด "ทำข้อมูลนิรนาม"
      (บิล/ใบเสร็จยังเก็บไว้ตามกฎหมายบัญชี แต่ไม่มีข้อมูลที่ระบุตัวตน)
    </div>
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th style="width:120px">วันที่ขอ</th>
          <th>สมาชิก</th>
          <th style="width:120px">ประเภท</th>
          <th>รายละเอียด</th>
          <th style="width:110px">ครบกำหนด</th>
          <th style="width:110px">สถานะ</th>
          <th style="width:150px;text-align:right">จัดการ</th>
        </tr></thead>
        <tbody id="pdpa-tbody"><tr><td colspan="7" style="text-align:center;padding:24px;color:var(--gray-400)">กำลังโหลด...</td></tr></tbody>
      </table>
    </div>
  </div>`;
}

async function _loadAndRenderPdpa() {
  const tbody = document.getElementById('pdpa-tbody');
  if (!tbody) return;
  const chk = document.getElementById('pdpa-open-only');
  if (chk && !chk.dataset.wired) {
    chk.dataset.wired = '1';
    chk.addEventListener('change', () => { _pdpaOpenOnly = chk.checked; _loadAndRenderPdpa(); });
  }
  const { data, error } = await _sb.rpc('list_privacy_requests', { p_open_only: _pdpaOpenOnly });
  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--red-700)">${esc(error.message)}</td></tr>`;
    return;
  }
  _pdpaRows = data || [];
  if (!_pdpaRows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--gray-400)">ไม่มีคำขอ</td></tr>';
    return;
  }
  const now = Date.now();
  const fmt = v => v ? new Date(v).toLocaleDateString('th-TH', { dateStyle: 'medium' }) : '—';
  tbody.innerHTML = _pdpaRows.map(q => {
    const st   = _PDPA_STATUS[q.status] || { label: q.status, cls: 'pill-normal' };
    const open = q.status === 'open' || q.status === 'in_progress';
    const left = (new Date(q.due_at).getTime() - now) / 86400000;
    const dueColor = !open ? 'var(--gray-500)' : left < 0 ? 'var(--red-700)' : left < 7 ? 'var(--amber-700)' : 'var(--gray-700)';
    return `<tr>
      <td class="text-muted" style="font-size:11.5px">${esc(fmt(q.created_at))}</td>
      <td><b>${esc(q.member_name || '')}</b><div class="mono text-muted" style="font-size:11px">${esc(q.meter_no || '')} · #${esc(q.member_id)}</div></td>
      <td>${esc(_PDPA_KIND[q.kind] || q.kind)}</td>
      <td style="font-size:12px">${esc(q.detail || '—')}${q.response ? `<div class="text-muted" style="font-size:11px;margin-top:2px">ตอบ: ${esc(q.response)}</div>` : ''}</td>
      <td style="font-size:11.5px;color:${dueColor};font-weight:${open && left < 7 ? 700 : 400}">${esc(fmt(q.due_at))}${open && left < 0 ? '<br>เลยกำหนด' : ''}</td>
      <td><span class="pill ${st.cls}" style="font-size:10.5px">${esc(st.label)}</span></td>
      <td><div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">
        ${open ? `<button class="btn btn-secondary btn-xs" data-pdpa-handle="${esc(q.id)}"><i class="ti ti-edit"></i>ดำเนินการ</button>` : ''}
        ${q.kind === 'erase' && open ? `<button class="btn btn-danger btn-xs" data-pdpa-anon="${esc(q.id)}"><i class="ti ti-user-off"></i>ทำข้อมูลนิรนาม</button>` : ''}
      </div></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-pdpa-handle]').forEach(b => b.addEventListener('click', () => _openPdpaHandle(Number(b.dataset.pdpaHandle))));
  tbody.querySelectorAll('[data-pdpa-anon]').forEach(b => b.addEventListener('click', () => _pdpaAnonymise(Number(b.dataset.pdpaAnon))));
}

function _openPdpaHandle(id) {
  const q = _pdpaRows.find(x => Number(x.id) === id);
  if (!q) return;
  openModal({
    id: 'pdpa-modal', title: `คำขอ #${q.id} — ${_PDPA_KIND[q.kind] || q.kind}`, icon: 'ti-shield-lock', width: 480,
    body: `
      <div style="font-size:13px;margin-bottom:10px"><b>${esc(q.member_name || '')}</b> (${esc(q.meter_no || '')})<br>
        <span class="text-muted">${esc(q.detail || 'ไม่มีรายละเอียด')}</span></div>
      <label class="form-label" for="pdpa-status">สถานะ</label>
      <select class="form-input" id="pdpa-status">
        ${['in_progress', 'done', 'rejected'].map(k => `<option value="${k}"${k === q.status ? ' selected' : ''}>${esc(_PDPA_STATUS[k].label)}</option>`).join('')}
      </select>
      <label class="form-label" for="pdpa-response" style="margin-top:10px">คำตอบถึงเจ้าของข้อมูล (จำเป็นเมื่อเสร็จสิ้น/ปฏิเสธ — ปฏิเสธต้องระบุเหตุผล)</label>
      <textarea class="form-input" id="pdpa-response" rows="3">${esc(q.response || '')}</textarea>`,
    footer: `<button class="btn btn-secondary" data-close>ยกเลิก</button>
      <button class="btn btn-primary" id="pdpa-save"><i class="ti ti-check"></i>บันทึก</button>`,
  });
  document.getElementById('pdpa-save').addEventListener('click', async e => {
    const status   = document.getElementById('pdpa-status').value;
    const response = document.getElementById('pdpa-response').value.trim();
    if ((status === 'done' || status === 'rejected') && !response) { toast('กรุณาระบุคำตอบถึงเจ้าของข้อมูล', 'error'); return; }
    const done = busyButton(e.currentTarget);
    const { error } = await _sb.rpc('update_privacy_request', { p_id: q.id, p_status: status, p_response: response });
    done();
    if (error) { toast(error.message, 'error'); return; }
    closeModal('pdpa-modal');
    toast('บันทึกแล้ว', 'success');
    _loadAndRenderPdpa();
  });
}

function _pdpaAnonymise(id) {
  const q = _pdpaRows.find(x => Number(x.id) === id);
  if (!q) return;
  showConfirm({
    title: `ทำข้อมูลนิรนาม: ${q.member_name || '#' + q.member_id}?`,
    message: 'ชื่อ ที่อยู่ เลขบัตร เบอร์โทร อีเมล LINE พิกัด และหมายเหตุ จะถูกลบถาวร (ย้อนกลับไม่ได้)\nบิลและใบเสร็จยังเก็บไว้ตามกฎหมายบัญชี\n\nต้องปิด (ลบ) สมาชิกและไม่มีบิลค้างชำระก่อน',
    okText: 'ทำข้อมูลนิรนาม',
    onOk: async () => {
      const { error } = await _sb.rpc('anonymise_member', { p_member_id: q.member_id, p_reason: `คำขอ PDPA #${q.id}` });
      if (error) { toast(error.message, 'error', 6000); return; }
      toast('ทำข้อมูลนิรนามแล้ว — อย่าลืมปิดคำขอพร้อมแจ้งผลเจ้าของข้อมูล', 'success', 6000);
      _loadAndRenderPdpa();
    },
  });
}
