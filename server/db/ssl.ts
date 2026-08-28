export function databaseSsl() {
  const rawCa = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n")?.trim();
  const ca = rawCa && rawCa.length ? rawCa : undefined;
  if (!ca) return { rejectUnauthorized: false } as const;

  // Deployment-specific SNI/hostname for verify-ca. Railway's postgres-ssl
  // image historically issued DNS:localhost only (see init-ssl.sh SAN); newer
  // images add DNS:${RAILWAY_PRIVATE_DOMAIN}. Default to localhost so the
  // current postgres.railway.internal volume and any IP-based DATABASE_URL
  // (no IP SAN) validate against the present cert; set DATABASE_TLS_SERVERNAME
  // to the private DNS name after REGENERATE_CERTS=true to verify the new SAN.
  const raw = process.env.DATABASE_TLS_SERVERNAME?.trim();
  const servername = raw ? raw : "localhost";
  return {
    ca,
    rejectUnauthorized: true,
    servername,
    checkServerIdentity: () => undefined,
  } as const;
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
