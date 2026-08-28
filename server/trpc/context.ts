import { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { fromNodeHeaders } from "better-auth/node";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../index.js";
import { auth } from "../utils/auth.js";
import { apiKey, user } from "../db/schema.js";
import { apiKeyHashMatches, parseApiKey } from "../utils/api-key.js";

export const createContext = async ({ req }: CreateFastifyContextOptions) => {
  const authorization = req.headers.authorization;
  if (authorization) {
    const bearer = /^Bearer ([^\s]+)$/.exec(authorization);
    const parsed = bearer ? parseApiKey(bearer[1]) : null;

    if (parsed) {
      const rows = await db
        .select({ key: apiKey, user })
        .from(apiKey)
        .innerJoin(user, eq(apiKey.userId, user.id))
        .where(
          and(
            eq(apiKey.id, parsed.id),
            isNull(apiKey.revokedAt),
            gt(apiKey.expiresAt, new Date()),
          ),
        )
        .limit(1);
      const row = rows[0];
      const activelyBanned =
        row?.user.banned && (!row.user.banExpires || row.user.banExpires > new Date());

      if (row && !activelyBanned && apiKeyHashMatches(parsed.secretHash, row.key.secretHash)) {
        await db.update(apiKey).set({ lastUsedAt: new Date() }).where(eq(apiKey.id, row.key.id));
        return { db, session: { user: row.user, session: null } };
      }
    }

    return { db, session: null };
  }

  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  return { db, session };
};

export type Context = Awaited<ReturnType<typeof createContext>>;
