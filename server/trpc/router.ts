import { initTRPC } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, and, desc, inArray } from "drizzle-orm";
import crypto from "node:crypto";
import type { Context } from "./context.js";
import { user, fragrance, retailer, retailerUrl, price } from "../db/schema.js";
import { db } from "../index.js";
import { domainConfigs } from "../scraper/configs.js";

const t = initTRPC.context<Context>().create();

const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, user: ctx.session.user } });
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

  getUserApiKey: protectedProcedure.query(async ({ ctx }) => {
    const users = await db.select().from(user).where(eq(user.id, ctx.user.id)).limit(1);
    if (!users[0]) throw new TRPCError({ code: "NOT_FOUND" });
    if (!users[0].apiKey) {
      const key = crypto.randomUUID();
      await db.update(user).set({ apiKey: key }).where(eq(user.id, ctx.user.id));
      return { apiKey: key };
    }
    return { apiKey: users[0].apiKey };
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
      .select({
        retailerUrlId: price.retailerUrlId,
        amount: price.amount,
        currency: price.currency,
        scrapedAt: price.scrapedAt,
      })
      .from(price)
      .innerJoin(retailerUrl, eq(price.retailerUrlId, retailerUrl.id))
      .innerJoin(fragrance, eq(retailerUrl.fragranceId, fragrance.id))
      .where(eq(fragrance.userId, ctx.user.id))
      .orderBy(desc(price.scrapedAt));
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

  deleteAllPrices: protectedProcedure.input(z.object({})).mutation(async ({ ctx }) => {
    const userUrls = await db
      .select({ id: retailerUrl.id })
      .from(retailerUrl)
      .innerJoin(fragrance, eq(retailerUrl.fragranceId, fragrance.id))
      .where(eq(fragrance.userId, ctx.user.id));

    const urlIds = userUrls.map((u) => u.id);
    if (urlIds.length === 0) return { deleted: 0 };

    await db.delete(price).where(inArray(price.retailerUrlId, urlIds));
    return { deleted: urlIds.length };
  }),
});

export type AppRouter = typeof appRouter;
