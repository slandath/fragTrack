export function databaseSsl() {
  const rawCa = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n")?.trim();
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

  // Deployment-specific SNI/hostname for verify-full. Railway's postgres-ssl
  // image historically issued DNS:localhost only; newer images add the
  // private DNS name. Default to localhost so IP-based DATABASE_URL values
  // (no IP SAN) validate against the present cert; set
  // DATABASE_TLS_SERVERNAME to the private DNS name when the cert carries it.
  const servername = process.env.DATABASE_TLS_SERVERNAME?.trim() || "localhost";
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
  if (!url.hostname || !database) {
    throw new Error("DATABASE_URL must include a host and database name");
  }

  return {
    host: url.hostname.replace(/^\[(.*)\]$/, "$1"),
    port: url.port ? Number(url.port) : undefined,
    user: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    database,
    ssl: databaseSsl(),
  };
}
