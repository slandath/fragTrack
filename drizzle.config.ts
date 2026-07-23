import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  out: "./server/db/migrations",
  schema: "./server/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false },
  },
});
