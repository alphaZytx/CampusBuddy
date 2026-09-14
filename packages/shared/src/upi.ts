/**
 * UPI helpers.
 *
 * A UPI Virtual Payment Address looks like `name@bank`. The pattern is deliberately
 * permissive because handles vary widely between banks and apps.
 */
export const UPI_ID_PATTERN = /^[\w.-]{2,64}@[a-zA-Z]{2,32}$/;

export interface UpiPaymentTarget {
  /** The payee's UPI ID, lower-cased (UPI IDs are case-insensitive). */
  vpa: string;
  /** The display name embedded in the code, when there is one. */
  payeeName: string | null;
}

/**
 * Reads the payee out of a UPI payment link — the text inside every "scan to pay"
 * QR code, e.g. `upi://pay?pa=aman@okaxis&pn=Aman%20Singh`.
 *
 * Returns null for anything that is not a payment link with a valid UPI ID, so a
 * random QR code (a website, a Wi-Fi password) is never mistaken for a payment code.
 */
export function parseUpiUri(text: string): UpiPaymentTarget | null {
  const trimmed = text.trim();
  if (!/^upi:\/\/pay\?/i.test(trimmed)) return null;

  const params = new URLSearchParams(trimmed.slice(trimmed.indexOf('?') + 1));
  const vpa = params.get('pa')?.trim();
  if (!vpa || !UPI_ID_PATTERN.test(vpa)) return null;

  const payeeName = params.get('pn')?.trim();
  return { vpa: vpa.toLowerCase(), payeeName: payeeName ? payeeName : null };
}

export function isSameUpiId(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
