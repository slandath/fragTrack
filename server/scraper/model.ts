import { parseAmountToMinor } from "../utils/money.js";

const CURRENCY_WORDS = ["usd", "eur", "gbp", "cad", "aud", "jpy", "chf"];

/** All categories the scrape workflow can report. */
export type ScrapeCategory =
  | "stored"
  | "price_not_found"
  | "ambiguous_price"
  | "navigation_failed"
  | "selector_timeout"
  | "browser_failed"
  | "api_failed"
  | "invalid_response";

/** Categories the browser layer itself can produce (Spec 04 taxonomy). */
export type ScrapeFailureCategory = Exclude<
  ScrapeCategory,
  "stored" | "api_failed" | "invalid_response"
>;

export type ScrapeOutcome =
  | { category: "ok"; amountMinor: number; currency: string }
  | { category: ScrapeFailureCategory; detail?: string };

/**
 * Parse price text to integer minor units, or null when ambiguous.
 * Only US-style thousands grouping is accepted (a leading group of 1-3
 * digits followed by groups of exactly 3); malformed groups and
 * comma-decimal text return null instead of joining fragments.
 */
export function parsePriceToMinor(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let text = raw.trim().toLowerCase();
  if (!text) return null;
  for (const word of CURRENCY_WORDS) text = text.split(word).join(" ");
  text = text
    .replace(/[$€£¥₹]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!/^\d+(\.\d{1,2})?$/.test(text) && !/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(text)) {
    return null;
  }
  return parseAmountToMinor(text.replace(/,/g, ""));
}

/**
 * Pure extraction contract: a present-but-empty price is "not found";
 * present text that fails the validated parser is "ambiguous". Keeping this
 * separate from navigation lets extraction be tested with saved fixtures.
 */
export function resolvePriceOutcome(
  raw: string | null | undefined,
  currency: string,
): ScrapeOutcome {
  if (raw == null || !raw.trim()) return { category: "price_not_found" };
  const amountMinor = parsePriceToMinor(raw);
  if (amountMinor === null) {
    return { category: "ambiguous_price", detail: raw.trim().slice(0, 120) };
  }
  return { category: "ok", amountMinor, currency };
}

// Minimal structural seams so the browser lifecycle can be tested with a
// fake launcher. Playwright's Browser/Context/Page satisfy these shapes.
export interface PriceElementLike {
  textContent(): Promise<string | null>;
}
export interface PageLike {
  goto(url: string, options?: { waitUntil?: "load"; timeout?: number }): Promise<unknown>;
  waitForSelector(
    selector: string,
    options?: { timeout?: number },
  ): Promise<PriceElementLike | null>;
  close(): Promise<void>;
}
export interface ContextLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}
export interface BrowserLike {
  newContext(options?: { userAgent?: string }): Promise<ContextLike>;
  close(): Promise<void>;
}

export interface ScraperOptions {
  navigationTimeoutMs?: number;
  selectorTimeoutMs?: number;
  /** Retries apply only to transient navigation failures. */
  retries?: number;
  retryDelayMs?: number;
  /** Injectable for tests; production uses one Playwright browser per run. */
  launch?: () => Promise<BrowserLike>;
}

export interface Scraper {
  scrape(url: string): Promise<ScrapeOutcome>;
  close(): Promise<void>;
}

export const DEFAULT_NAVIGATION_TIMEOUT_MS = 20_000;
export const DEFAULT_SELECTOR_TIMEOUT_MS = 10_000;
export const DEFAULT_RETRIES = 2;
export const DEFAULT_RETRY_DELAY_MS = 500;

export function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "TimeoutError"
  );
}

/** Shared pacing helper for scrape retries and the scrape operator script. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
