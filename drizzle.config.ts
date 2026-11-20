import { defineConfig } from "drizzle-kit";
import "dotenv/config";
import { databaseConnection } from "./server/db/ssl.js";
import { validateDatabaseEnv } from "./server/env.js";

const isSchemaGeneration = process.argv[2] === "generate";

export default defineConfig({
  out: "./server/db/migrations",
  schema: "./server/db/schema.ts",
  dialect: "postgresql",
  ...(isSchemaGeneration ? {} : { dbCredentials: databaseConnection(validateDatabaseEnv()) }),
});
