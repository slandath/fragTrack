import { describe, expect, it } from "vitest";
import { formatPrice, getPriceFreshness, STALE_PRICE_THRESHOLD_MS } from "./price.js";

const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);

describe("formatPrice", () => {
  it("formats integer minor units with fixed hundredths", () => {
    expect(formatPrice(2499, "USD")).toBe("$24.99");
    expect(formatPrice(129999, "USD")).toBe("$1,299.99");
    expect(formatPrice(1950, "EUR")).toContain("19.50");
  });
});

describe("getPriceFreshness", () => {
  it("distinguishes never scraped from an unknown timestamp", () => {
    expect(getPriceFreshness(undefined, NOW)).toBe("never");
    expect(getPriceFreshness("not-a-date", NOW)).toBe("unknown");
  });

  it("treats recent observations as current", () => {
    expect(getPriceFreshness(new Date(NOW - 60_000).toISOString(), NOW)).toBe("current");
  });

  it("treats observations older than the shared threshold as stale", () => {
    const stale = new Date(NOW - STALE_PRICE_THRESHOLD_MS - 1).toISOString();
    expect(getPriceFreshness(stale, NOW)).toBe("stale");
  });

  it("uses the boundary consistently", () => {
    const boundary = new Date(NOW - STALE_PRICE_THRESHOLD_MS).toISOString();
    expect(getPriceFreshness(boundary, NOW)).toBe("current");
  });
});
