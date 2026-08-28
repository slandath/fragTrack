export function databaseSsl() {
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
  if (!ca) {
    throw new Error("DATABASE_CA_CERT must contain the trusted Postgres CA certificate");
  }

  return { ca, rejectUnauthorized: true } as const;
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
