import { describe, expect, it } from "vitest";
import {
  MAX_AMOUNT_MINOR,
  isSupportedCurrency,
  parseAmountToMinor,
} from "./money.js";
import { canonicalizeRetailerUrl } from "./retailer-url.js";

const domains = { "fragrancex.com": {}, "example.com": {} };

describe("parseAmountToMinor", () => {
  it("converts representative valid values", () => {
    expect(parseAmountToMinor("0.01")).toBe(1);
    expect(parseAmountToMinor("24.99")).toBe(2499);
    expect(parseAmountToMinor("1299.99")).toBe(129999);
    expect(parseAmountToMinor(" 24.99 ")).toBe(2499);
    expect(parseAmountToMinor("24")).toBe(2400);
    expect(parseAmountToMinor("24.9")).toBe(2490);
  });

  it("rejects zero, negatives, and out-of-range values", () => {
    expect(parseAmountToMinor("0")).toBeNull();
    expect(parseAmountToMinor("0.00")).toBeNull();
    expect(parseAmountToMinor("-5")).toBeNull();
    expect(parseAmountToMinor("-24.99")).toBeNull();
    expect(parseAmountToMinor("1000000")).toBeNull();
    expect(parseAmountToMinor("999999.99")).toBe(99_999_999);
    expect(parseAmountToMinor("1000000.00")).toBeNull();
  });

  it("rejects malformed and non-numeric values without float artifacts", () => {
    expect(parseAmountToMinor("")).toBeNull();
    expect(parseAmountToMinor("   ")).toBeNull();
    expect(parseAmountToMinor("abc")).toBeNull();
    expect(parseAmountToMinor("24.99.5")).toBeNull();
    expect(parseAmountToMinor("1.234")).toBeNull();
    expect(parseAmountToMinor("1,299.99")).toBeNull();
    expect(parseAmountToMinor("$24.99")).toBeNull();
    expect(parseAmountToMinor("2030.5.1")).toBeNull();
    expect(parseAmountToMinor(null)).toBeNull();
    expect(parseAmountToMinor(undefined)).toBeNull();
    expect(parseAmountToMinor(24.99)).toBeNull();
    expect(parseAmountToMinor(Number.NaN)).toBeNull();
  });

  it("computes cents with string math", () => {
    expect(parseAmountToMinor("0.07")).toBe(7);
    expect(parseAmountToMinor("19.99")).toBe(1999);
    expect(MAX_AMOUNT_MINOR).toBe(99_999_999);
  });
});

describe("isSupportedCurrency", () => {
  it("accepts ISO-style codes and rejects the rest", () => {
    expect(isSupportedCurrency("USD")).toBe(true);
    expect(isSupportedCurrency("EUR")).toBe(true);
    expect(isSupportedCurrency("usd")).toBe(false);
    expect(isSupportedCurrency("US")).toBe(false);
    expect(isSupportedCurrency("USDD")).toBe(false);
    expect(isSupportedCurrency("US1")).toBe(false);
    expect(isSupportedCurrency("")).toBe(false);
    expect(isSupportedCurrency(null)).toBe(false);
  });
});

describe("canonicalizeRetailerUrl", () => {
  it("accepts supported http/https URLs", () => {
    expect(canonicalizeRetailerUrl("https://fragrancex.com/p/123", domains)).toBe(
      "https://fragrancex.com/p/123",
    );
    expect(canonicalizeRetailerUrl("https://www.fragrancex.com/p/123?a=b", domains)).toBe(
      "https://www.fragrancex.com/p/123?a=b",
    );
  });

  it("normalizes default ports, fragments, and host casing", () => {
    expect(canonicalizeRetailerUrl("https://fragrancex.com:443/p#details", domains)).toBe(
      "https://fragrancex.com/p",
    );
    expect(canonicalizeRetailerUrl("HTTPS://FRAGRANCEX.COM/P", domains)).toBe(
      "https://fragrancex.com/P",
    );
  });

  it("rejects unsupported protocols, credentials, domains, and bad input", () => {
    expect(() => canonicalizeRetailerUrl("ftp://fragrancex.com/p", domains)).toThrow(
      /http or https/,
    );
    expect(() => canonicalizeRetailerUrl("https://user:pass@fragrancex.com/p", domains)).toThrow(
      /credentials/,
    );
    expect(() => canonicalizeRetailerUrl("https://evil.com/p", domains)).toThrow(
      /not a supported domain/,
    );
    expect(() => canonicalizeRetailerUrl("https://shop.fragrancex.com/p", domains)).toThrow(
      /not a supported domain/,
    );
    expect(() => canonicalizeRetailerUrl("not a url", domains)).toThrow(/valid URL/);
    expect(() => canonicalizeRetailerUrl("", domains)).toThrow(/empty/);
    expect(() => canonicalizeRetailerUrl("   ", domains)).toThrow(/empty/);
    expect(() => canonicalizeRetailerUrl(null, domains)).toThrow();
    expect(() => canonicalizeRetailerUrl(`https://fragrancex.com/${"p".repeat(2048)}`, domains)).toThrow(
      /at most 2048/,
    );
  });
});
