/**
 * Money handling.
 *
 * All monetary values in CampusBuddy are stored and transported as INTEGER PAISE
 * (1 rupee = 100 paise). Floating point rupees are never persisted, because
 * repeated float arithmetic on money produces rounding drift
 * (e.g. 0.1 + 0.2 !== 0.3) which would corrupt reward totals and payment amounts.
 */

/** Smallest reward the platform accepts (₹1). */
export const MIN_REWARD_PAISE = 100;
/** Largest reward the platform accepts (₹5,000) — an anti-abuse ceiling. */
export const MAX_REWARD_PAISE = 500_000;
/** Largest product cost a requester may declare (₹20,000). */
export const MAX_PRODUCT_COST_PAISE = 2_000_000;
/** Largest security deposit for a rental (₹20,000). */
export const MAX_DEPOSIT_PAISE = 2_000_000;

/** Convert whole/decimal rupees to integer paise, rounding to the nearest paisa. */
export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) throw new Error('rupeesToPaise: value must be finite');
  return Math.round(rupees * 100);
}

/** Convert integer paise back to a rupee number. Only use for display/derived math. */
export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/**
 * Format paise as an Indian-locale currency string, e.g. 3050 -> "₹30.50", 3000 -> "₹30".
 * Whole rupees drop the decimals so request cards stay easy to scan.
 */
export function formatINR(paise: number, opts: { alwaysDecimals?: boolean } = {}): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.trunc(abs / 100);
  const fraction = abs % 100;
  const showDecimals = opts.alwaysDecimals || fraction !== 0;
  const wholeText = whole.toLocaleString('en-IN');
  const body = showDecimals ? `${wholeText}.${String(fraction).padStart(2, '0')}` : wholeText;
  return `${negative ? '-' : ''}₹${body}`;
}

/** Total a requester is expected to pay: what the helper spends plus the helper's reward. */
export function totalBudgetPaise(rewardPaise: number, productCostPaise: number): number {
  return rewardPaise + productCostPaise;
}
