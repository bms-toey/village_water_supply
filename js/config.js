// ─── Lookup Maps ───
const statusMap = {
  normal:    { cls: 'pill-normal',   label: 'ปกติ' },
  overdue:   { cls: 'pill-overdue',  label: 'ค้างชำระ' },
  closed:    { cls: 'pill-closed',   label: 'ปิดมิเตอร์' },
  suspended: { cls: 'pill-inactive', label: 'ระงับชั่วคราว' },
};
const memberTypeMap = {
  residential: { label: 'บ้านอยู่อาศัย', cls: 'mtype-residential' },
  commercial:  { label: 'พาณิชยกรรม',    cls: 'mtype-commercial' },
  agriculture: { label: 'เกษตรกรรม',     cls: 'mtype-agriculture' },
  institution: { label: 'หน่วยงาน',      cls: 'mtype-institution' },
};
const meterSizeMap = { '0.5': '½"', '0.75': '¾"', '1': '1"', '1.5': '1½"' };
const anomalyMap   = { high_usage: 'ใช้สูงผิดปกติ', meter_fault: 'มิเตอร์เสีย', suspected_leak: 'สงสัยรั่ว' };
const methodMap    = { manual: 'Manual', ai_scan: 'AI Scan', remote: 'Remote' };
const channelMap   = {
  promptpay: { label: 'PromptPay',   icon: 'ti-qrcode' },
  bank:      { label: 'โอนธนาคาร', icon: 'ti-building-bank' },
  cash:      { label: 'เงินสด',     icon: 'ti-cash' },
  mobile:    { label: 'Mobile App',  icon: 'ti-device-mobile' },
};

// ─── Progressive Water Rate ───
let rateConfig = {
  tiers: [
    { from: 0,  to: 10,       rate: 5    },
    { from: 11, to: 30,       rate: 8.5  },
    { from: 31, to: 60,       rate: 12   },
    { from: 61, to: Infinity, rate: 15   },
  ],
  svcSmall: 20,
  svcLarge: 30,
  lateFeePerMonth: 50,
};

function calcWaterCharge(usage, meterSize) {
  const svc = (meterSize === '1' || meterSize === '1.5') ? rateConfig.svcLarge : rateConfig.svcSmall;
  let wc = 0, remaining = usage;
  for (const t of rateConfig.tiers) {
    if (remaining <= 0) break;
    const tierQty = (t.to === Infinity) ? remaining : Math.min(remaining, t.to - Math.max(t.from - 1, 0));
    wc += tierQty * t.rate;
    remaining -= tierQty;
  }
  return { waterCharge: Math.round(wc), serviceCharge: svc, total: Math.round(wc + svc) };
}
