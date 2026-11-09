import { afterEach, describe, expect, it } from "vitest";
import { databaseConnection, databaseSsl } from "./ssl.js";

const savedEnv = { ...process.env };

// Minimal self-signed EC certificate parsed by node's X509Certificate.
// Stored with real newlines; setTestCa folds it to the one-line literal-\n
// form operators put in environment files.
const TEST_CA_PEM = [
  "-----BEGIN CERTIFICATE-----",
  "MIIBejCCASGgAwIBAgIUcAG74CEvRI88POYApE+OaS/xer0wCgYIKoZIzj0EAwIw",
  "EzERMA8GA1UEAwwIZnJhZ3Rlc3QwHhcNMjYxMTA5MTcxNTQyWhcNMjYxMTExMTcx",
  "NTQyWjATMREwDwYDVQQDDAhmcmFndGVzdDBZMBMGByqGSM49AgEGCCqGSM49AwEH",
  "A0IABJKe39kxFxWDpxHLtASMWXFT+Ym/MWEQq7YFIlCO6HUKBGZyEBkrD+gyi4r0",
  "6auu36WIHoshLhjIn1KATzYCeJajUzBRMB0GA1UdDgQWBBQjXAU6OH/j00R8/B/j",
  "B+OvDOszZzAfBgNVHSMEGDAWgBQjXAU6OH/j00R8/B/jB+OvDOszZzAPBgNVHRMB",
  "Af8EBTADAQH/MAoGCCqGSM49BAMCA0cAMEQCIEsy3Ls2DY4OvFbuMmiavu/SL9d7",
  "yVP28w4fINZacItBAiB3EppCi2NOcO89uwUrCo/LNjPQ40CT8pVRuyP1ibHxpg==",
  "-----END CERTIFICATE-----",
].join("\n");

function setTestCa() {
  process.env.DATABASE_CA_CERT = TEST_CA_PEM.replace(/\n/g, "\\n");
}

afterEach(() => {
  process.env = { ...savedEnv };
});

describe("databaseSsl", () => {
  it("enables verification with literal-newline CA material", () => {
    setTestCa();
    process.env.DATABASE_TLS_SERVERNAME = "db.internal";
    const ssl = databaseSsl() as unknown as Record<string, unknown>;
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.ca).toBe(TEST_CA_PEM);
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

  it("rejects a corrupt PEM body during startup", () => {
    process.env.DATABASE_CA_CERT =
      "-----BEGIN CERTIFICATE-----\\nnot-valid-base64!!!\\n-----END CERTIFICATE-----";
    process.env.NODE_ENV = "development";
    expect(() => databaseSsl()).toThrow(/did not parse/);
  });

  it("collapses doubled backslash separators", () => {
    process.env.DATABASE_CA_CERT = TEST_CA_PEM.replace(/\n/g, "\\\\n");
    const ssl = databaseSsl() as unknown as Record<string, unknown>;
    expect(ssl.ca).toBe(TEST_CA_PEM);
  });

  it("requires an explicit TLS identity for IP-based database hosts", () => {
    setTestCa();
    delete process.env.DATABASE_TLS_SERVERNAME;
    expect(() => databaseSsl("192.168.1.10")).toThrow(/DATABASE_TLS_SERVERNAME is required/);
    expect(() => databaseSsl("::1")).toThrow(/DATABASE_TLS_SERVERNAME is required/);
    process.env.DATABASE_TLS_SERVERNAME = "db.internal";
    expect(databaseSsl("192.168.1.10")).toMatchObject({
      rejectUnauthorized: true,
      servername: "db.internal",
    });
  });

  it("leaves servername unset for DNS hosts", () => {
    // node-postgres verifies DNS hosts against the connection hostname, so
    // no default is sent; the certificate must carry that DNS name.
    setTestCa();
    delete process.env.DATABASE_TLS_SERVERNAME;
    const ssl = databaseSsl("postgres.railway.internal") as unknown as Record<string, unknown>;
    expect(ssl.rejectUnauthorized).toBe(true);
    expect("servername" in ssl).toBe(false);
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

  it("honors sslmode=disable for servers without TLS", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/frag?sslmode=disable";
    process.env.NODE_ENV = "production";
    expect(databaseConnection().ssl).toBe(false);
  });
});
