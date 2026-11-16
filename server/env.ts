// Single startup validation point for server configuration (Spec 05).
// Errors list variable *names* only — never values — so a bad secret cannot
// leak into logs or CI output. Environment-specific requirements are explicit:
// production is strict, development needs local OAuth settings, and tests only
// need a database URL.

export type NodeEnv = "development" | "test" | "production";

export interface ServerEnv {
  nodeEnv: NodeEnv;
  databaseUrl: string;
  databaseCaCert?: string;
  databaseTlsServername?: string;
  betterAuthSecret?: string;
  betterAuthUrl?: string;
  frontendUrl?: string;
  githubClientId?: string;
  githubClientSecret?: string;
  adminUserIds: string[];
  port: number;
  apiUrl?: string;
  apiKey?: string;
  testDatabaseUrl?: string;
}

const MODES: readonly NodeEnv[] = ["development", "test", "production"];

const REQUIRED: Record<NodeEnv, readonly string[]> = {
  test: ["DATABASE_URL"],
  development: [
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "FRONTEND_URL",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
  ],
  production: [
    "DATABASE_URL",
    "DATABASE_CA_CERT",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "FRONTEND_URL",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
  ],
};

// Documented optional variables and their defaults:
// DATABASE_TLS_SERVERNAME — required only for IP-based DATABASE_URL values
//   (enforced by databaseSsl), otherwise unset.
// ADMIN_USER_IDS — comma-separated better-auth admin IDs; default empty.
// PORT — default 3000.
// API_URL / API_KEY — used by scripts/scrape.ts, which validates them itself.
// TEST_DATABASE_URL — disposable database used only by integration tests.

function blank(value: string | undefined): boolean {
  return value == null || value.trim().length === 0;
}

function read(source: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = source[name];
  return blank(value) ? undefined : value!.trim();
}

function httpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function postgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "postgres:" || url.protocol === "postgresql:";
  } catch {
    return false;
  }
}

/** Validate a raw environment and return typed values, or throw with names only. */
export function validateEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const rawMode = read(source, "NODE_ENV") ?? "development";
  const mode: NodeEnv = MODES.includes(rawMode as NodeEnv) ? (rawMode as NodeEnv) : "development";
  const problems: string[] = [];

  if (!MODES.includes(rawMode as NodeEnv)) {
    problems.push("NODE_ENV: must be development, test, or production");
  }

  for (const name of REQUIRED[mode]) {
    if (!read(source, name)) problems.push(`${name}: is required in ${mode}`);
  }

  const databaseUrl = read(source, "DATABASE_URL");
  if (databaseUrl && !postgresUrl(databaseUrl)) {
    problems.push("DATABASE_URL: must be a postgres:// or postgresql:// URL");
  }
  for (const name of ["BETTER_AUTH_URL", "FRONTEND_URL", "API_URL"]) {
    const value = read(source, name);
    if (value && !httpUrl(value)) problems.push(`${name}: must be a valid http(s) URL`);
  }
  const testDatabaseUrl = read(source, "TEST_DATABASE_URL");
  if (testDatabaseUrl && !postgresUrl(testDatabaseUrl)) {
    problems.push("TEST_DATABASE_URL: must be a postgres:// or postgresql:// URL");
  }

  const portRaw = read(source, "PORT");
  const port = portRaw ? Number(portRaw) : 3000;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push("PORT: must be an integer between 1 and 65535");
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid environment configuration (${mode}):\n  - ${problems.join("\n  - ")}\n` +
        "No values are shown. See .env.example for the full variable list.",
    );
  }

  return {
    nodeEnv: mode,
    databaseUrl: databaseUrl!,
    databaseCaCert: read(source, "DATABASE_CA_CERT"),
    databaseTlsServername: read(source, "DATABASE_TLS_SERVERNAME"),
    betterAuthSecret: read(source, "BETTER_AUTH_SECRET"),
    betterAuthUrl: read(source, "BETTER_AUTH_URL"),
    frontendUrl: read(source, "FRONTEND_URL"),
    githubClientId: read(source, "GITHUB_CLIENT_ID"),
    githubClientSecret: read(source, "GITHUB_CLIENT_SECRET"),
    adminUserIds: (read(source, "ADMIN_USER_IDS") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
    port,
    apiUrl: read(source, "API_URL"),
    apiKey: read(source, "API_KEY"),
    testDatabaseUrl: read(source, "TEST_DATABASE_URL"),
  };
}

/** Validated at module load so an invalid startup fails before any DB access. */
export const env = validateEnv();
