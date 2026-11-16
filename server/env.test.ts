import { describe, expect, it } from "vitest";
import { validateEnv } from "./env.js";

const SECRET_SENTINEL = "do-not-leak-this-secret-value";

const production = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:pass@db.example.com:5432/frag",
  DATABASE_CA_CERT: "-----BEGIN CERTIFICATE-----\\n...\\n-----END CERTIFICATE-----",
  BETTER_AUTH_SECRET: SECRET_SENTINEL,
  BETTER_AUTH_URL: "https://app.example.com",
  FRONTEND_URL: "https://app.example.com",
  GITHUB_CLIENT_ID: "github-client",
  GITHUB_CLIENT_SECRET: SECRET_SENTINEL,
};

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Expected validation to throw");
}

describe("validateEnv", () => {
  it("accepts a complete production environment and returns typed values", () => {
    const env = validateEnv({ ...production, PORT: "8080", ADMIN_USER_IDS: " a , b ,, c " });
    expect(env.nodeEnv).toBe("production");
    expect(env.port).toBe(8080);
    expect(env.adminUserIds).toEqual(["a", "b", "c"]);
    expect(env.databaseCaCert).toContain("BEGIN CERTIFICATE");
  });

  it("defaults PORT and admin IDs", () => {
    const env = validateEnv(production);
    expect(env.port).toBe(3000);
    expect(env.adminUserIds).toEqual([]);
  });

  it("reports every missing production variable by name, never by value", () => {
    const message = messageOf(() =>
      validateEnv({ NODE_ENV: "production", DATABASE_URL: production.DATABASE_URL }),
    );
    for (const name of [
      "DATABASE_CA_CERT",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "FRONTEND_URL",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
    ]) {
      expect(message).toContain(name);
    }
    expect(message).not.toContain(SECRET_SENTINEL);
  });

  it("does not print the value of an invalid URL", () => {
    const message = messageOf(() =>
      validateEnv({
        ...production,
        FRONTEND_URL: `not-a-url-${SECRET_SENTINEL}`,
      }),
    );
    expect(message).toContain("FRONTEND_URL");
    expect(message).not.toContain(SECRET_SENTINEL);
  });

  it("requires local OAuth settings in development but not a CA certificate", () => {
    expect(validateEnv({ ...production, NODE_ENV: "development" }).nodeEnv).toBe("development");
    const message = messageOf(() =>
      validateEnv({ NODE_ENV: "development", DATABASE_URL: production.DATABASE_URL }),
    );
    expect(message).toContain("GITHUB_CLIENT_ID");
    expect(message).not.toContain("DATABASE_CA_CERT");
  });

  it("only requires a database URL in test mode", () => {
    const env = validateEnv({ NODE_ENV: "test", DATABASE_URL: production.DATABASE_URL });
    expect(env.nodeEnv).toBe("test");
    expect(env.githubClientId).toBeUndefined();
    expect(env.betterAuthSecret).toBeUndefined();
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(messageOf(() => validateEnv({ ...production, NODE_ENV: "staging" }))).toContain(
      "NODE_ENV",
    );
  });

  it("rejects invalid ports and non-postgres database URLs", () => {
    expect(messageOf(() => validateEnv({ ...production, PORT: "70000" }))).toContain("PORT");
    expect(
      messageOf(() => validateEnv({ ...production, DATABASE_URL: "https://example.com/db" })),
    ).toContain("DATABASE_URL");
  });

  it("validates the optional scrape and test-database URLs when provided", () => {
    expect(messageOf(() => validateEnv({ ...production, API_URL: "not a url" }))).toContain(
      "API_URL",
    );
    expect(
      messageOf(() => validateEnv({ ...production, TEST_DATABASE_URL: "https://example.com" })),
    ).toContain("TEST_DATABASE_URL");
  });
});
