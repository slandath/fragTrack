// Price display and freshness rules shared by all client components.

/** Expected scrape cadence is weekly; older observations are stale. */
export const STALE_PRICE_DAYS = 7;
export const STALE_PRICE_THRESHOLD_MS = STALE_PRICE_DAYS * 24 * 60 * 60 * 1000;

export type PriceFreshness = "never" | "unknown" | "stale" | "current";

/**
 * Format integer minor units as a localized currency string.
 * Fraction digits are fixed at two so the display always matches the
 * fixed-hundredths storage contract, even for zero-decimal currencies
 * such as JPY.
 */
export function formatPrice(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

export function getPriceFreshness(
  scrapedAt: string | Date | null | undefined,
  now = Date.now(),
): PriceFreshness {
  if (scrapedAt == null) return "never";
  const time = scrapedAt instanceof Date ? scrapedAt.getTime() : Date.parse(scrapedAt);
  if (!Number.isFinite(time)) return "unknown";
  return now - time > STALE_PRICE_THRESHOLD_MS ? "stale" : "current";
}

export function formatObservationTime(
  scrapedAt: string | Date,
  fallback = "Observation time unknown",
): string {
  const date = scrapedAt instanceof Date ? scrapedAt : new Date(scrapedAt);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
