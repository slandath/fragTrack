import { drizzle } from "drizzle-orm/node-postgres";
import "dotenv/config";
import { databaseSsl } from "./db/ssl.js";

export const db = drizzle({
  connection: {
    connectionString: process.env.DATABASE_URL!,
    ssl: databaseSsl(),
  },
});
