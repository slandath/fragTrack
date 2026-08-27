export function databaseSsl() {
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
  if (!ca) {
    throw new Error("DATABASE_CA_CERT must contain the trusted Postgres CA certificate");
  }

  return { ca, rejectUnauthorized: true } as const;
}
