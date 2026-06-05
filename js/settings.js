let _editRateIdx = -1;

// ─── Render Rate Tiers (dynamic) ───
function renderSettingsRates() {
  const el = document.getElementById('rate-tiers-list');
  if (!el) return;
  el.innerHTML = rateConfig.tiers.map((t, i) => {
    const range = t.to === Infinity ? `${t.from}+ หน่วย` : `${t.from}–${t.to} หน่วย`;
    const svc   = (i < rateConfig.tiers.length - 1) ? rateConfig.svcSmall : rateConfig.svcLarge;
    return `<div class="rate-row">
      <div class="rate-col text-muted">${range}</div>
      <div class="rate-val">฿${t.rate.toFixed(2)} / หน่วย</div>
      <div style="margin-left:auto"><div class="rate-col text-muted" style="font-size:12px">ค่าบริการ ฿${svc}</div></div>
      <button class="btn-icon" style="margin-left:8px" onclick="openRateEditModal(${i})"><i class="ti ti-edit"></i></button>
    </div>`;
  }).join('') +
  `<div class="info-box" style="margin-top:14px"><i class="ti ti-info-circle"></i>คำนวณแบบก้าวหน้าอัตโนมัติเมื่อบันทึกเลขอ่านมิเตอร์</div>`;
}

// ─── Open Rate Edit Modal ───
function openRateEditModal(idx) {
  const tier = rateConfig.tiers[idx];
  if (!tier) return;
  _editRateIdx = idx;
  const range = tier.to === Infinity ? `${tier.from}+ หน่วย` : `${tier.from}–${tier.to} หน่วย`;
  document.getElementById('rate-range-label').textContent = range;
  document.getElementById('rate-new-value').value         = tier.rate;
  const isLast  = idx === rateConfig.tiers.length - 1;
  const svcVal  = isLast ? rateConfig.svcLarge : rateConfig.svcSmall;
  const svcRow  = document.getElementById('rate-svc-row');
  const svcInp  = document.getElementById('rate-svc-value');
  if (svcInp) svcInp.value = svcVal;
  if (svcRow) svcRow.style.display = '';
  document.getElementById('rate-modal').style.display = 'flex';
}

function closeRateModal() {
  document.getElementById('rate-modal').style.display = 'none';
  _editRateIdx = -1;
}

// ─── Save Rate Tier Edit ───
function saveRateTier() {
  if (_editRateIdx < 0) return;
  const newRate = parseFloat(document.getElementById('rate-new-value').value);
  const svcInp  = document.getElementById('rate-svc-value');
  const newSvc  = svcInp ? parseFloat(svcInp.value) : NaN;
  if (isNaN(newRate) || newRate < 0) { toast('กรุณากรอกอัตราที่ถูกต้อง', 'error'); return; }
  rateConfig.tiers[_editRateIdx].rate = newRate;
  const isLast = _editRateIdx === rateConfig.tiers.length - 1;
  if (!isNaN(newSvc) && newSvc >= 0) {
    if (isLast) rateConfig.svcLarge = newSvc;
    else        rateConfig.svcSmall = newSvc;
  }
  saveRateConfig();
  closeRateModal();
  renderSettingsRates();
  toast('บันทึกอัตราค่าน้ำแล้ว', 'success');
}

// ─── Render village list from real member data ───
function renderSettingsVillages() {
  const el = document.getElementById('village-list');
  if (!el) return;
  const villages = [...new Set(members.map(m => m.village))].sort();
  el.innerHTML = villages.map(v => {
    const count   = members.filter(m => m.village === v).length;
    const overdue = members.filter(m => m.village === v && m.status === 'overdue').length;
    return `<div style="padding:12px 14px;border:1px solid var(--gray-200);border-radius:var(--radius-md);display:flex;justify-content:space-between;align-items:center;cursor:pointer;transition:var(--transition)" onmouseenter="this.style.borderColor='var(--blue-300)'" onmouseleave="this.style.borderColor='var(--gray-200)'">
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--blue-900)">${esc(v)}</div>
        <div class="text-muted" style="font-size:11px">${count} สมาชิก${overdue ? ` · <span style="color:var(--red-700)">${overdue} ค้างชำระ</span>` : ''}</div>
      </div>
      <i class="ti ti-chevron-right" style="color:var(--gray-400)"></i>
    </div>`;
  }).join('') +
  `<div style="padding:12px 14px;border:2px dashed var(--gray-200);border-radius:var(--radius-md);display:flex;justify-content:center;align-items:center;gap:8px;cursor:pointer;color:var(--gray-500);font-size:13px;transition:var(--transition)" onclick="toast('ฟีเจอร์เพิ่มหมู่บ้านอยู่ระหว่างพัฒนา','info')" onmouseenter="this.style.borderColor='var(--blue-300)';this.style.color='var(--blue-700)'" onmouseleave="this.style.borderColor='var(--gray-200)';this.style.color='var(--gray-500)'"><i class="ti ti-plus"></i>เพิ่มหมู่บ้านใหม่</div>`;
}

function saveSettings() {
  saveRateConfig();
  renderSettingsRates();
  toast('บันทึกการตั้งค่าแล้ว', 'success');
}
