import { X509Certificate } from "node:crypto";

function isIpLiteral(host: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":");
}

export function databaseSsl(serverHost?: string) {
  // Operators store one-line PEM with literal \n separators; collapse a
  // doubled backslash as well so \\n cannot corrupt the material.
  const rawCa = process.env.DATABASE_CA_CERT?.replace(/\\\\n|\\n/g, "\n")?.trim();
  const ca = rawCa && rawCa.length ? rawCa : undefined;
  if (!ca) {
    // Development-only relaxation: without CA material the server
    // certificate cannot be verified. Production fails closed instead so a
    // missing CA can never silently disable verification.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "DATABASE_CA_CERT is required in production so PostgreSQL TLS verification stays enabled",
      );
    }
    return { rejectUnauthorized: false } as const;
  }
  if (!ca.includes("BEGIN CERTIFICATE")) {
    throw new Error("DATABASE_CA_CERT is malformed: expected PEM certificate material");
  }
  try {
    new X509Certificate(ca);
  } catch {
    throw new Error("DATABASE_CA_CERT is malformed: certificate material did not parse");
  }

  // SNI/hostname for verify-full. node-postgres overwrites servername with
  // the connection hostname for DNS names (see upgradeToSSL in
  // pg/lib/connection.js), so an override only takes effect for IP-based
  // DATABASE_URL values. DNS hosts are always verified against the
  // connection hostname, which means the server certificate must carry that
  // DNS name as a SAN — a localhost-only certificate cannot verify a
  // postgres.railway.internal connection. Regenerate the database
  // certificate with the private DNS SAN instead of overriding here.
  const servername = process.env.DATABASE_TLS_SERVERNAME?.trim() || undefined;
  if (!servername) {
    if (serverHost && isIpLiteral(serverHost)) {
      throw new Error(
        "DATABASE_TLS_SERVERNAME is required when DATABASE_URL uses an IP address: TLS cannot verify the connection without an explicit identity",
      );
    }
    return { ca, rejectUnauthorized: true } as const;
  }
  return { ca, rejectUnauthorized: true, servername } as const;
}

export function databaseConnection() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol");
  }

  const database = decodeURIComponent(url.pathname.slice(1));
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (!host || !database) {
    throw new Error("DATABASE_URL must include a host and database name");
  }

  // Explicit opt-out for servers without TLS (local and disposable test
  // databases). Production defaults are unchanged: TLS applies unless the
  // operator deliberately disables it here.
  if (url.searchParams.get("sslmode") === "disable") {
    return {
      host,
      port: url.port ? Number(url.port) : undefined,
      user: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      database,
      ssl: false as const,
    };
  }

  return {
    host,
    port: url.port ? Number(url.port) : undefined,
    user: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    database,
    ssl: databaseSsl(host),
  };
}
