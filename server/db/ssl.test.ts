import { describe, expect, it } from "vitest";
import type { DatabaseEnv } from "../env.js";
import { databaseConnection, databaseSsl } from "./ssl.js";

// Minimal self-signed EC certificate parsed by node's X509Certificate.
// Stored with real newlines; the tests fold it to the one-line literal-\n
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

const oneLineCa = TEST_CA_PEM.replace(/\n/g, "\\n");

function config(overrides: Partial<DatabaseEnv> = {}): DatabaseEnv {
  return {
    nodeEnv: "development",
    databaseUrl: "postgresql://user:pass@localhost:5432/frag",
    ...overrides,
  };
}

describe("databaseSsl", () => {
  it("enables verification with literal-newline CA material", () => {
    const ssl = databaseSsl(
      config({ databaseCaCert: oneLineCa, databaseTlsServername: "db.internal" }),
    ) as unknown as Record<string, unknown>;
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.ca).toBe(TEST_CA_PEM);
    expect(ssl.servername).toBe("db.internal");
  });

  it("relaxes verification only outside production when no CA is configured", () => {
    expect(databaseSsl(config())).toMatchObject({ rejectUnauthorized: false });
  });

  it("fails closed in production without CA material", () => {
    expect(() => databaseSsl(config({ nodeEnv: "production" }))).toThrow(/DATABASE_CA_CERT/);
  });

  it("fails closed in production on whitespace-only CA material", () => {
    expect(() => databaseSsl(config({ nodeEnv: "production", databaseCaCert: "   " }))).toThrow(
      /DATABASE_CA_CERT/,
    );
  });

  it("fails closed in production on malformed CA material", () => {
    expect(() =>
      databaseSsl(config({ nodeEnv: "production", databaseCaCert: "not-a-certificate" })),
    ).toThrow(/DATABASE_CA_CERT/);
  });

  it("rejects a corrupt PEM body during startup", () => {
    expect(() =>
      databaseSsl(
        config({
          databaseCaCert:
            "-----BEGIN CERTIFICATE-----\\nnot-valid-base64!!!\\n-----END CERTIFICATE-----",
        }),
      ),
    ).toThrow(/did not parse/);
  });

  it("collapses doubled backslash separators", () => {
    const ssl = databaseSsl(
      config({ databaseCaCert: TEST_CA_PEM.replace(/\n/g, "\\\\n") }),
    ) as unknown as Record<string, unknown>;
    expect(ssl.ca).toBe(TEST_CA_PEM);
  });

  it("requires an explicit TLS identity for IP-based database hosts", () => {
    const caConfig = config({ databaseCaCert: oneLineCa });
    expect(() => databaseSsl(caConfig, "192.168.1.10")).toThrow(
      /DATABASE_TLS_SERVERNAME is required/,
    );
    expect(() => databaseSsl(caConfig, "::1")).toThrow(/DATABASE_TLS_SERVERNAME is required/);
    expect(
      databaseSsl(
        config({ databaseCaCert: oneLineCa, databaseTlsServername: "db.internal" }),
        "192.168.1.10",
      ),
    ).toMatchObject({ rejectUnauthorized: true, servername: "db.internal" });
  });

  it("leaves servername unset for DNS hosts", () => {
    // node-postgres verifies DNS hosts against the connection hostname, so
    // no default is sent; the certificate must carry that DNS name.
    const ssl = databaseSsl(
      config({ databaseCaCert: oneLineCa }),
      "postgres.railway.internal",
    ) as unknown as Record<string, unknown>;
    expect(ssl.rejectUnauthorized).toBe(true);
    expect("servername" in ssl).toBe(false);
  });
});

describe("databaseConnection", () => {
  it("applies the same TLS behavior as databaseSsl", () => {
    expect(databaseConnection(config()).ssl).toMatchObject({ rejectUnauthorized: false });
  });

  it("honors sslmode=disable for servers without TLS", () => {
    const ssl = databaseConnection(
      config({
        nodeEnv: "production",
        databaseUrl: "postgresql://user:pass@localhost:5432/frag?sslmode=disable",
      }),
    ).ssl;
    expect(ssl).toBe(false);
  });
});
