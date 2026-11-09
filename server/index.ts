import { drizzle } from "drizzle-orm/node-postgres";
import { databaseConnection } from "./db/ssl.js";

export const db = drizzle({
  connection: databaseConnection(),
});
