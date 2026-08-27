import { defineConfig } from "drizzle-kit";
import "dotenv/config";
import { databaseSsl } from "./server/db/ssl.js";

export default defineConfig({
  out: "./server/db/migrations",
  schema: "./server/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    ssl: databaseSsl(),
  },
});
