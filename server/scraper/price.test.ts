import { describe, expect, it } from "vitest";
import { parsePriceToMinor } from "./index.js";

// Fixture tests for the scraper price-text helper. No network access.
// Anything ambiguous (ranges, extra numbers, multi-decimal values) is
// rejected rather than concatenated into a plausible amount.
describe("parsePriceToMinor", () => {
  it("parses plain and grouped dollar amounts to cents", () => {
    expect(parsePriceToMinor("$24.99")).toBe(2499);
    expect(parsePriceToMinor("$1,299.99")).toBe(129999);
    expect(parsePriceToMinor("$12,345")).toBe(1234500);
    expect(parsePriceToMinor("24.99")).toBe(2499);
  });

  it("rejects malformed comma groups and comma decimals", () => {
    expect(parsePriceToMinor("20,30")).toBeNull();
    expect(parsePriceToMinor("12,34")).toBeNull();
    expect(parsePriceToMinor("1,29,999")).toBeNull();
    expect(parsePriceToMinor("24,99")).toBeNull();
    expect(parsePriceToMinor("$2,499.999")).toBeNull();
  });

  it("handles currency-prefixed and currency-suffixed values", () => {
    expect(parsePriceToMinor("USD 24.99")).toBe(2499);
    expect(parsePriceToMinor("24.99 USD")).toBe(2499);
    expect(parsePriceToMinor("€19.50")).toBe(1950);
  });

  it("rejects empty and alphabetic values", () => {
    expect(parsePriceToMinor("")).toBeNull();
    expect(parsePriceToMinor("   ")).toBeNull();
    expect(parsePriceToMinor(null)).toBeNull();
    expect(parsePriceToMinor(undefined)).toBeNull();
    expect(parsePriceToMinor("out of stock")).toBeNull();
  });

  it("rejects ranges instead of concatenating fragments", () => {
    expect(parsePriceToMinor("$20–$30")).toBeNull();
    expect(parsePriceToMinor("$20-$30")).toBeNull();
    expect(parsePriceToMinor("20 to 30")).toBeNull();
    expect(parsePriceToMinor("$24.99 $29.99")).toBeNull();
  });

  it("rejects multi-decimal, signed, and out-of-range values", () => {
    expect(parsePriceToMinor("24.99.5")).toBeNull();
    expect(parsePriceToMinor("1.234")).toBeNull();
    expect(parsePriceToMinor("-24.99")).toBeNull();
    expect(parsePriceToMinor("0")).toBeNull();
    expect(parsePriceToMinor("0.00")).toBeNull();
    expect(parsePriceToMinor("1000000.00")).toBeNull();
  });
});
