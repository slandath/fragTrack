import { drizzle } from "drizzle-orm/node-postgres";
import { databaseConnection } from "./db/ssl.js";
import { env } from "./env-startup.js";

export const db = drizzle({
  connection: databaseConnection(env),
});
