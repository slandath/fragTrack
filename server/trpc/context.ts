import { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import { db } from "../index.js";
import { auth } from "../utils/auth.js";
import { user } from "../db/schema.js";

export const createContext = async ({ req }: CreateFastifyContextOptions) => {
  const apiKey = req.headers.authorization?.replace("Bearer ", "");
  if (apiKey) {
    const users = await db.select().from(user).where(eq(user.apiKey, apiKey)).limit(1);
    if (users[0]) return { db, session: { user: users[0], session: null } };
  }

  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  return { db, session };
};

export type Context = Awaited<ReturnType<typeof createContext>>;
