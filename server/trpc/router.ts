import { initTRPC } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, and, desc, isNull } from "drizzle-orm";
import crypto from "node:crypto";
import type { Context } from "./context.js";
import { apiKey, fragrance, retailer, retailerUrl, price, user } from "../db/schema.js";
import { db } from "../index.js";
import { domainConfigs } from "../scraper/configs.js";
import { generateApiKey } from "../utils/api-key.js";

const t = initTRPC.context<Context>().create();

const isAuthed = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session?.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  const currentUsers = await db.select().from(user).where(eq(user.id, ctx.session.user.id)).limit(1);
  const currentUser = currentUsers[0];
  if (!currentUser) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (currentUser.banned && (!currentUser.banExpires || currentUser.banExpires > new Date())) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Account is banned" });
  }
  return next({ ctx: { ...ctx, user: currentUser } });
});

const protectedProcedure = t.procedure.use(isAuthed);

async function findOrCreateRetailer(url: string) {
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  const existing = await db.select().from(retailer).where(eq(retailer.name, hostname)).limit(1);
  if (existing[0]) return existing[0];
  const id = crypto.randomUUID();
  await db.insert(retailer).values({ id, name: hostname, url: hostname });
  return { id, name: hostname, url: hostname };
}

async function cleanupOrphanedRetailer(retailerId: string) {
  const remaining = await db
    .select({ id: retailerUrl.id })
    .from(retailerUrl)
    .where(eq(retailerUrl.retailerId, retailerId))
    .limit(1);
  if (!remaining[0]) {
    await db.delete(retailer).where(eq(retailer.id, retailerId));
  }
}

async function findFragrance(id: string, userId: string) {
  const results = await db
    .select()
    .from(fragrance)
    .where(and(eq(fragrance.id, id), eq(fragrance.userId, userId)))
    .limit(1);
  if (!results[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Fragrance not found" });
  return results[0];
}

export const appRouter = t.router({
  healthcheck: t.procedure.query(() => ({
    status: "ok",
    timestamp: Date.now(),
  })),

  listApiKeys: protectedProcedure.query(async ({ ctx }) => {
    return await db
      .select({
        id: apiKey.id,
        createdAt: apiKey.createdAt,
        expiresAt: apiKey.expiresAt,
        revokedAt: apiKey.revokedAt,
        lastUsedAt: apiKey.lastUsedAt,
      })
      .from(apiKey)
      .where(eq(apiKey.userId, ctx.user.id))
      .orderBy(desc(apiKey.createdAt));
  }),
  createApiKey: protectedProcedure
    .input(z.object({ expiresInDays: z.number().int().min(1).max(365).default(90) }))
    .mutation(async ({ ctx, input }) => {
      const generated = generateApiKey(input.expiresInDays);
      await db.insert(apiKey).values({
        id: generated.id,
        userId: ctx.user.id,
        secretHash: generated.secretHash,
        expiresAt: generated.expiresAt,
      });
      return { apiKey: generated.key, id: generated.id, expiresAt: generated.expiresAt };
    }),
  rotateApiKey: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        expiresInDays: z.number().int().min(1).max(365).default(90),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const generated = generateApiKey(input.expiresInDays);
      const result = await db.transaction(async (tx) => {
        const revoked = await tx
          .update(apiKey)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(apiKey.id, input.id),
              eq(apiKey.userId, ctx.user.id),
              isNull(apiKey.revokedAt),
            ),
          )
          .returning({ id: apiKey.id });
        if (!revoked[0]) return null;

        await tx.insert(apiKey).values({
          id: generated.id,
          userId: ctx.user.id,
          secretHash: generated.secretHash,
          expiresAt: generated.expiresAt,
        });
        return generated;
      });
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Active API key not found" });
      return { apiKey: result.key, id: result.id, expiresAt: result.expiresAt };
    }),
  revokeApiKey: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const revoked = await db
        .update(apiKey)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(apiKey.id, input.id), eq(apiKey.userId, ctx.user.id), isNull(apiKey.revokedAt)),
        )
        .returning({ id: apiKey.id });
      if (!revoked[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Active API key not found" });
      return { id: revoked[0].id };
    }),

  getFragrances: protectedProcedure.query(async ({ ctx }) => {
    return await db
      .select()
      .from(fragrance)
      .where(eq(fragrance.userId, ctx.user.id))
      .leftJoin(retailerUrl, eq(fragrance.id, retailerUrl.fragranceId));
  }),

  getUserUrls: protectedProcedure.query(async ({ ctx }) => {
    return await db
      .select()
      .from(retailerUrl)
      .innerJoin(fragrance, eq(retailerUrl.fragranceId, fragrance.id))
      .where(eq(fragrance.userId, ctx.user.id));
  }),
  getLatestPrices: protectedProcedure.query(async ({ ctx }) => {
    return await db
      .selectDistinctOn([price.retailerUrlId], {
        retailerUrlId: price.retailerUrlId,
        amount: price.amount,
        currency: price.currency,
        scrapedAt: price.scrapedAt,
      })
      .from(price)
      .innerJoin(retailerUrl, eq(price.retailerUrlId, retailerUrl.id))
      .innerJoin(fragrance, eq(retailerUrl.fragranceId, fragrance.id))
      .where(eq(fragrance.userId, ctx.user.id))
      .orderBy(price.retailerUrlId, desc(price.scrapedAt));
  }),
  getSupportedDomains: protectedProcedure.query(async () => {
    return Object.keys(domainConfigs);
  }),
  addFragrance: protectedProcedure
    .input(z.object({ name: z.string().min(1), brand: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const id = crypto.randomUUID();
      await db
        .insert(fragrance)
        .values({ id, name: input.name, brand: input.brand, userId: ctx.user.id });
      return { id, name: input.name, brand: input.brand, userId: ctx.user.id };
    }),

  addRetailerUrl: protectedProcedure
    .input(z.object({ fragranceId: z.string(), url: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      await findFragrance(input.fragranceId, ctx.user.id);
      const hostname = new URL(input.url).hostname.replace(/^www\./, "");
      if (!domainConfigs[hostname]) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `"${hostname}" is not a supported domain`,
        });
      }
      const r = await findOrCreateRetailer(input.url);

      const id = crypto.randomUUID();
      await db
        .insert(retailerUrl)
        .values({ id, fragranceId: input.fragranceId, retailerId: r.id, url: input.url });

      return { id, fragranceId: input.fragranceId, retailerId: r.id, url: input.url };
    }),
  storePrice: protectedProcedure
    .input(z.object({ retailerUrlId: z.string(), amount: z.string(), currency: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const url = await db
        .select()
        .from(retailerUrl)
        .innerJoin(fragrance, eq(retailerUrl.fragranceId, fragrance.id))
        .where(and(eq(retailerUrl.id, input.retailerUrlId), eq(fragrance.userId, ctx.user.id)))
        .limit(1);
      if (!url[0]) throw new TRPCError({ code: "NOT_FOUND" });

      const id = crypto.randomUUID();
      await db.insert(price).values({ id, ...input });
      return { id, ...input };
    }),
  deleteRetailerUrl: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const urlRows = await db
        .select({ retailerId: retailerUrl.retailerId })
        .from(retailerUrl)
        .innerJoin(fragrance, eq(retailerUrl.fragranceId, fragrance.id))
        .where(and(eq(retailerUrl.id, input.id), eq(fragrance.userId, ctx.user.id)))
        .limit(1);
      if (!urlRows[0]) throw new TRPCError({ code: "NOT_FOUND" });

      const { retailerId } = urlRows[0];
      await db.delete(retailerUrl).where(eq(retailerUrl.id, input.id));
      await cleanupOrphanedRetailer(retailerId);
    }),
  deleteFragrance: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const f = await findFragrance(input.id, ctx.user.id);

      const urls = await db
        .select({ retailerId: retailerUrl.retailerId })
        .from(retailerUrl)
        .where(eq(retailerUrl.fragranceId, f.id));

      const retailerIds = urls.map((u) => u.retailerId);

      await db.delete(fragrance).where(eq(fragrance.id, input.id));

      for (const id of retailerIds) {
        await cleanupOrphanedRetailer(id);
      }
    }),

});

export type AppRouter = typeof appRouter;
