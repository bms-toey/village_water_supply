// ─── Water Rate Configuration ──────────────────────────────────
// Progressive water pricing tiers and charge calculation logic.
// rateConfig is mutable — storage.service.js can overwrite its
// properties after loading from Supabase or localStorage.
// ──────────────────────────────────────────────────────────────

export const rateConfig = {
  tiers: [
    { from: 0,  to: 10,       rate: 5    },
    { from: 11, to: 30,       rate: 8.5  },
    { from: 31, to: 60,       rate: 12   },
    { from: 61, to: Infinity, rate: 15   },
  ],
  svcSmall:        20,
  svcLarge:        30,
  lateFeePerMonth: 50,
};

/**
 * Calculate water charge and service charge for a given usage.
 * @param {number} usage     - Units consumed this period
 * @param {string} meterSize - Meter size ('0.5', '0.75', '1', '1.5')
 * @returns {{ waterCharge: number, serviceCharge: number, total: number }}
 */
export function calcWaterCharge(usage, meterSize) {
  const svc = (meterSize === '1' || meterSize === '1.5')
    ? rateConfig.svcLarge
    : rateConfig.svcSmall;

  let wc = 0, remaining = usage;
  for (const t of rateConfig.tiers) {
    if (remaining <= 0) break;
    const capacity = (t.to === Infinity || t.to === null)
      ? remaining
      : Math.min(remaining, t.to - Math.max(t.from - 1, 0));
    // Skip tiers with 0 or negative capacity (misconfigured to_unit)
    if (capacity <= 0) continue;
    wc += capacity * t.rate;
    remaining -= capacity;
  }

  // Overflow safety: if remaining > 0 after all tiers (last tier missing or misconfigured),
  // charge remaining units at the highest defined rate
  if (remaining > 0 && rateConfig.tiers.length > 0) {
    const lastRate = rateConfig.tiers[rateConfig.tiers.length - 1].rate;
    wc += remaining * lastRate;
  }

  return {
    waterCharge:   Math.round(wc),
    serviceCharge: svc,
    total:         Math.round(wc + svc),
  };
}

/**
 * Returns a tier-by-tier breakdown for receipt/display.
 * @returns {{ from:number, to:number|null, rate:number, units:number, charge:number }[]}
 */
export function calcWaterBreakdown(usage) {
  const breakdown = [];
  let remaining = usage;
  for (const t of rateConfig.tiers) {
    if (remaining <= 0) break;
    const capacity = (t.to === Infinity || t.to === null)
      ? remaining
      : Math.min(remaining, t.to - Math.max(t.from - 1, 0));
    if (capacity <= 0) continue;
    breakdown.push({ from: t.from, to: t.to, rate: t.rate, units: capacity, charge: capacity * t.rate });
    remaining -= capacity;
  }
  if (remaining > 0 && rateConfig.tiers.length > 0) {
    const last = rateConfig.tiers[rateConfig.tiers.length - 1];
    breakdown.push({ from: last.from, to: null, rate: last.rate, units: remaining, charge: remaining * last.rate });
  }
  return breakdown;
}
