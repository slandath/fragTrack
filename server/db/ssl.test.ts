import { afterEach, describe, expect, it } from "vitest";
import { databaseConnection, databaseSsl } from "./ssl.js";

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
});

describe("databaseSsl", () => {
  it("enables verification with literal-newline CA material", () => {
    process.env.DATABASE_CA_CERT = "-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----";
    process.env.DATABASE_TLS_SERVERNAME = "db.internal";
    const ssl = databaseSsl() as unknown as Record<string, unknown>;
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.ca).toBe("-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----");
    expect(ssl.servername).toBe("db.internal");
  });

  it("relaxes verification only outside production when no CA is configured", () => {
    delete process.env.DATABASE_CA_CERT;
    process.env.NODE_ENV = "development";
    expect(databaseSsl()).toMatchObject({ rejectUnauthorized: false });
  });

  it("fails closed in production without CA material", () => {
    delete process.env.DATABASE_CA_CERT;
    process.env.NODE_ENV = "production";
    expect(() => databaseSsl()).toThrow(/DATABASE_CA_CERT/);
  });

  it("fails closed in production on whitespace-only CA material", () => {
    process.env.DATABASE_CA_CERT = "   ";
    process.env.NODE_ENV = "production";
    expect(() => databaseSsl()).toThrow(/DATABASE_CA_CERT/);
  });

  it("fails closed in production on malformed CA material", () => {
    process.env.DATABASE_CA_CERT = "not-a-certificate";
    process.env.NODE_ENV = "production";
    expect(() => databaseSsl()).toThrow(/DATABASE_CA_CERT/);
  });
});

describe("databaseConnection", () => {
  it("requires DATABASE_URL", () => {
    delete process.env.DATABASE_URL;
    expect(() => databaseConnection()).toThrow(/DATABASE_URL is required/);
  });

  it("rejects malformed and non-postgres URLs", () => {
    process.env.DATABASE_URL = "not a url";
    expect(() => databaseConnection()).toThrow(/valid PostgreSQL URL/);
    process.env.DATABASE_URL = "https://example.com/db";
    expect(() => databaseConnection()).toThrow(/postgres/);
  });

  it("applies the same TLS behavior as databaseSsl", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/frag";
    process.env.NODE_ENV = "development";
    delete process.env.DATABASE_CA_CERT;
    expect(databaseConnection().ssl).toMatchObject({ rejectUnauthorized: false });
  });
});
