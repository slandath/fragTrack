// Single validation module for server configuration (Spec 05, Spec 08 Phase 3).
// Effect Schema owns every boundary shape here. Errors list variable *names*
// only — never values — so a bad secret cannot leak into logs or CI output.
// Environment-specific requirements are explicit: production is strict,
// development needs local OAuth settings, and tests only need a database URL.
// The Drizzle CLI uses `validateDatabaseEnv`, which validates the same
// database fields without requiring server-only variables.

import { Schema } from "effect";

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

// Documented optional variables validated by their own owners:
// ADMIN_USER_IDS — comma-separated better-auth admin IDs; default empty.
// PORT — default 3000.
// API_URL / API_KEY — used by scripts/scrape.ts, which validates them.
// TEST_DATABASE_URL — used only by the integration-test runner.

const modeSchema = Schema.Literal("development", "test", "production");
const textSchema = Schema.String.pipe(Schema.filter((value) => value.length > 0));
const httpUrlSchema = Schema.String.pipe(
  Schema.filter((value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }),
);
const postgresUrlSchema = Schema.String.pipe(
  Schema.filter((value) => {
    try {
      return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }),
);
const portSchema = Schema.NumberFromString.pipe(Schema.int(), Schema.between(1, 65535));

interface NamedIssue {
  path: (string | number | symbol)[];
  message: string;
}

/** Messages never contain the invalid value, only which variable failed. */
function messageFor(name: string): string {
  switch (name) {
    case "NODE_ENV":
      return "must be development, test, or production";
    case "DATABASE_URL":
      return "must be a postgres:// or postgresql:// URL";
    case "PORT":
      return "must be an integer between 1 and 65535";
    case "BETTER_AUTH_URL":
    case "FRONTEND_URL":
      return "must be a valid http(s) URL";
    default:
      return "has an invalid value";
  }
}

/** Trim strings and treat blank values as absent, matching the old contract. */
function sanitize(source: NodeJS.ProcessEnv): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(source)) {
    result[name] = typeof value === "string" ? value.trim() || undefined : value;
  }
  return result;
}

function modeOf(source: Record<string, unknown>): NodeEnv {
  const value = source.NODE_ENV;
  return MODES.includes(value as NodeEnv) ? (value as NodeEnv) : "development";
}

function readField<A, I>(
  schema: Schema.Schema<A, I, never>,
  name: string,
  source: Record<string, unknown>,
  problems: NamedIssue[],
): A | undefined {
  const value = source[name];
  if (value == null) return undefined;
  const decoded = Schema.decodeUnknownEither(schema)(value);
  if (decoded._tag === "Right") return decoded.right;
  problems.push({ path: [name], message: messageFor(name) });
  return undefined;
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
  const clean = sanitize(source);
  const mode = modeOf(clean);
  const problems: NamedIssue[] = [];
  for (const name of REQUIRED[mode]) {
    if (name === "DATABASE_URL" && clean[name] == null) {
      problems.push({ path: [name], message: `is required in ${mode}` });
    }
  }

  const nodeEnv = (readField(modeSchema, "NODE_ENV", clean, problems) ?? mode) as NodeEnv;
  const databaseUrl = readField(postgresUrlSchema, "DATABASE_URL", clean, problems);
  const databaseCaCert = readField(textSchema, "DATABASE_CA_CERT", clean, problems);
  const databaseTlsServername = readField(textSchema, "DATABASE_TLS_SERVERNAME", clean, problems);
  if (problems.length > 0) throw invalidConfig(mode, problems);

  return { nodeEnv, databaseUrl: databaseUrl!, databaseCaCert, databaseTlsServername };
}

/** Validate a full server environment and return typed values, or throw. */
export function validateEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const clean = sanitize(source);
  const mode = modeOf(clean);
  const problems: NamedIssue[] = [];
  for (const name of REQUIRED[mode]) {
    if (clean[name] == null) problems.push({ path: [name], message: `is required in ${mode}` });
  }

  const nodeEnv = (readField(modeSchema, "NODE_ENV", clean, problems) ?? mode) as NodeEnv;
  const databaseUrl = readField(postgresUrlSchema, "DATABASE_URL", clean, problems);
  const databaseCaCert = readField(textSchema, "DATABASE_CA_CERT", clean, problems);
  const databaseTlsServername = readField(textSchema, "DATABASE_TLS_SERVERNAME", clean, problems);
  const betterAuthSecret = readField(textSchema, "BETTER_AUTH_SECRET", clean, problems);
  const betterAuthUrl = readField(httpUrlSchema, "BETTER_AUTH_URL", clean, problems);
  const frontendUrl = readField(httpUrlSchema, "FRONTEND_URL", clean, problems);
  const githubClientId = readField(textSchema, "GITHUB_CLIENT_ID", clean, problems);
  const githubClientSecret = readField(textSchema, "GITHUB_CLIENT_SECRET", clean, problems);
  const port = readField(portSchema, "PORT", clean, problems) ?? 3000;
  const adminUserIds =
    (clean.ADMIN_USER_IDS as string | undefined)
      ?.split(",")
      .map((id) => id.trim())
      .filter(Boolean) ?? [];

  if (problems.length > 0) throw invalidConfig(mode, problems);

  return {
    nodeEnv,
    databaseUrl: databaseUrl!,
    databaseCaCert,
    databaseTlsServername,
    betterAuthSecret,
    betterAuthUrl,
    frontendUrl,
    githubClientId,
    githubClientSecret,
    adminUserIds,
    port,
  };
}
