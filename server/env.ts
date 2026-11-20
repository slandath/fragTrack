// Single validation module for server configuration (Spec 05).
// Errors list variable *names* only — never values — so a bad secret cannot
// leak into logs or CI output. Environment-specific requirements are explicit:
// production is strict, development needs local OAuth settings, and tests only
// need a database URL. The Drizzle CLI uses `validateDatabaseEnv`, which
// validates the same database fields without requiring server-only variables.

import { z } from "zod";

export type NodeEnv = "development" | "test" | "production";

/** The subset the database connection and TLS setup actually consume. */
export interface DatabaseEnv {
  nodeEnv: NodeEnv;
  databaseUrl: string;
  databaseCaCert?: string;
  databaseTlsServername?: string;
}

export interface ServerEnv extends DatabaseEnv {
  betterAuthSecret?: string;
  betterAuthUrl?: string;
  frontendUrl?: string;
  githubClientId?: string;
  githubClientSecret?: string;
  adminUserIds: string[];
  port: number;
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

// Documented optional variables that other layers validate themselves:
// ADMIN_USER_IDS — comma-separated better-auth admin IDs; default empty.
// PORT — default 3000.
// API_URL / API_KEY — used by scripts/scrape.ts, which validates them.
// TEST_DATABASE_URL — used only by the integration-test runner.

const trimmed = (value: unknown): unknown =>
  typeof value === "string" ? value.trim() || undefined : value;

const optionalText = z.preprocess(trimmed, z.string().optional());
const modeField = z
  .string()
  .default("development")
  .refine(
    (value): value is NodeEnv => MODES.includes(value as NodeEnv),
    "must be development, test, or production",
  );
const urlWithProtocols = (protocols: string[], message: string) =>
  z.string().refine((value) => {
    try {
      return protocols.includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, message);
const httpUrl = urlWithProtocols(["http:", "https:"], "must be a valid http(s) URL");
const postgresUrl = urlWithProtocols(
  ["postgres:", "postgresql:"],
  "must be a postgres:// or postgresql:// URL",
);
const httpUrlField = z.preprocess(trimmed, httpUrl.optional());
const postgresUrlField = z.preprocess(trimmed, postgresUrl.optional());

const databaseSchema = z.object({
  NODE_ENV: modeField,
  DATABASE_URL: postgresUrlField,
  DATABASE_CA_CERT: optionalText,
  DATABASE_TLS_SERVERNAME: optionalText,
});

const serverSchema = databaseSchema.extend({
  BETTER_AUTH_SECRET: optionalText,
  BETTER_AUTH_URL: httpUrlField,
  FRONTEND_URL: httpUrlField,
  GITHUB_CLIENT_ID: optionalText,
  GITHUB_CLIENT_SECRET: optionalText,
  ADMIN_USER_IDS: z.preprocess(trimmed, z.string().default("")),
  PORT: z.preprocess(trimmed, z.coerce.number().int().min(1).max(65535).default(3000)),
});

interface NamedIssue {
  path: (string | number | symbol)[];
  message: string;
}

function modeOf(source: NodeJS.ProcessEnv): NodeEnv {
  const value = source.NODE_ENV;
  return MODES.includes(value as NodeEnv) ? (value as NodeEnv) : "development";
}

function issuesOf(error: z.ZodError): NamedIssue[] {
  return error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
}

function invalidConfig(mode: NodeEnv, problems: NamedIssue[]): Error {
  return new Error(
    `Invalid environment configuration (${mode}):\n  - ${problems
      .map((problem) => `${problem.path.join(".")}: ${problem.message}`)
      .join("\n  - ")}\n` + "No values are shown. See .env.example for the full variable list.",
  );
}

/** Validate the database fields shared by the server and the Drizzle CLI. */
export function validateDatabaseEnv(source: NodeJS.ProcessEnv = process.env): DatabaseEnv {
  const mode = modeOf(source);
  const parsed = databaseSchema.safeParse(source);
  const problems: NamedIssue[] = parsed.success ? [] : issuesOf(parsed.error);
  const data = parsed.success ? parsed.data : undefined;
  if (data && !data.DATABASE_URL) {
    problems.push({ path: ["DATABASE_URL"], message: `is required in ${mode}` });
  }
  if (!data || problems.length > 0) throw invalidConfig(mode, problems);

  return {
    nodeEnv: data.NODE_ENV,
    databaseUrl: data.DATABASE_URL!,
    databaseCaCert: data.DATABASE_CA_CERT,
    databaseTlsServername: data.DATABASE_TLS_SERVERNAME,
  };
}

/** Validate a full server environment and return typed values, or throw. */
export function validateEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const mode = modeOf(source);
  const parsed = serverSchema.safeParse(source);
  const problems: NamedIssue[] = parsed.success ? [] : issuesOf(parsed.error);
  const data = parsed.success ? parsed.data : undefined;
  if (data) {
    const values = data as Record<string, unknown>;
    for (const name of REQUIRED[mode]) {
      if (values[name] == null) {
        problems.push({ path: [name], message: `is required in ${mode}` });
      }
    }
  }
  if (!data || problems.length > 0) throw invalidConfig(mode, problems);

  return {
    nodeEnv: data.NODE_ENV,
    databaseUrl: data.DATABASE_URL!,
    databaseCaCert: data.DATABASE_CA_CERT,
    databaseTlsServername: data.DATABASE_TLS_SERVERNAME,
    betterAuthSecret: data.BETTER_AUTH_SECRET,
    betterAuthUrl: data.BETTER_AUTH_URL,
    frontendUrl: data.FRONTEND_URL,
    githubClientId: data.GITHUB_CLIENT_ID,
    githubClientSecret: data.GITHUB_CLIENT_SECRET,
    adminUserIds: data.ADMIN_USER_IDS.split(",")
      .map((id) => id.trim())
      .filter(Boolean),
    port: data.PORT,
  };
}
