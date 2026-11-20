// Exact money handling for prices (Spec 03). All amounts are integer minor
// units (cents). String math only — floating point never touches money.

export const MIN_AMOUNT_MINOR = 1;
export const MAX_AMOUNT_MINOR = 99_999_999; // 999,999.99

const DECIMAL_RE = /^(\d+)(?:\.(\d{1,2}))?$/;
export const CURRENCY_RE = /^[A-Z]{3}$/;

/**
 * Convert a decimal amount string ("24.99") to integer minor units.
 * Returns null for anything that is not an exact positive amount within
 * range: empty/whitespace text, signs, commas, multi-decimal values,
 * zero, negatives, and values above the maximum. More than two decimals
 * are rejected, never rounded.
 */
export function parseAmountToMinor(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = DECIMAL_RE.exec(value.trim());
  if (!match) return null;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? "00").padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) return null;
  if (minor < MIN_AMOUNT_MINOR || minor > MAX_AMOUNT_MINOR) return null;
  return minor;
}

/** ISO-style three-letter uppercase currency code (USD, EUR, GBP, ...). */
export function isSupportedCurrency(value: unknown): value is string {
  return typeof value === "string" && CURRENCY_RE.test(value);
}
