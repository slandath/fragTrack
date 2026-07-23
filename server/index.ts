import { drizzle } from "drizzle-orm/node-postgres";
import "dotenv/config";

export const db = drizzle({
    connection: {
        connectionString: process.env.DATABASE_URL!,
        ssl: { rejectUnauthorized: false },
    },
});