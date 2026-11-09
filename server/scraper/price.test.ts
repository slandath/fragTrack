import { describe, expect, it } from "vitest";
import { parsePriceText } from "./index.js";

// Fixture tests for the scraper price-text helper. No network access.
// Ranges and multi-decimal values are intentionally unasserted here: their
// contract is defined by Spec 04, which hardens this parser.
describe("parsePriceText", () => {
  it("parses plain and grouped dollar amounts", () => {
    expect(parsePriceText("$24.99")).toBe("24.99");
    expect(parsePriceText("$1,299.99")).toBe("1299.99");
  });

  it("handles currency-prefixed and currency-suffixed values", () => {
    expect(parsePriceText("USD 24.99")).toBe("24.99");
    expect(parsePriceText("24.99 USD")).toBe("24.99");
  });

  it("rejects empty and alphabetic values", () => {
    expect(parsePriceText("")).toBeNull();
    expect(parsePriceText("   ")).toBeNull();
    expect(parsePriceText(null)).toBeNull();
    expect(parsePriceText(undefined)).toBeNull();
    expect(parsePriceText("out of stock")).toBeNull();
  });
});
