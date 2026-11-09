import { describe, expect, it } from "vitest";
import { apiKeyHashMatches, generateApiKey, parseApiKey } from "./api-key.js";

describe("generateApiKey / parseApiKey", () => {
  it("round-trips a generated key", () => {
    const generated = generateApiKey();
    const parsed = parseApiKey(generated.key);
    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe(generated.id);
    expect(parsed?.secretHash).toBe(generated.secretHash);
  });

  it("rejects malformed keys", () => {
    expect(parseApiKey("")).toBeNull();
    expect(parseApiKey("ft_short")).toBeNull();
    expect(parseApiKey(" Bearer ft_abc")).toBeNull();
    expect(parseApiKey(`ft_${"a".repeat(16)}_${"b".repeat(42)}`)).toBeNull();
  });

  it("parses legacy UUID keys without granting them a real key id", () => {
    const legacy = "123e4567-e89b-42d3-a456-426614174000";
    const parsed = parseApiKey(legacy);
    expect(parsed).not.toBeNull();
    // Legacy ids are synthetic; they match no issued key row, so context
    // lookups fail closed. See README for the migration grace period.
    expect(parsed?.id.startsWith("legacy_")).toBe(true);
  });
});

describe("apiKeyHashMatches", () => {
  it("matches equal hashes and rejects mismatches safely", () => {
    const generated = generateApiKey();
    expect(apiKeyHashMatches(generated.secretHash, generated.secretHash)).toBe(true);
    const other = generateApiKey();
    expect(apiKeyHashMatches(other.secretHash, generated.secretHash)).toBe(false);
  });

  it("rejects different-length hashes without throwing", () => {
    const generated = generateApiKey();
    expect(apiKeyHashMatches("abcd", generated.secretHash)).toBe(false);
    expect(apiKeyHashMatches("not-hex!!", generated.secretHash)).toBe(false);
  });
});
