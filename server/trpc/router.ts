import { initTRPC } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";
import type { Context } from "./context.js";
import { fragrance, retailer, retailerUrl } from "../db/schema.js";
import { scrapePrice } from "../scraper/index.js";
import { db } from "../index.js";

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

  getFragrances: protectedProcedure.query(async ({ ctx }) => {
    return await db
      .select()
      .from(fragrance)
      .where(eq(fragrance.userId, ctx.user.id))
      .leftJoin(retailerUrl, eq(fragrance.id, retailerUrl.fragranceId));
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
      const r = await findOrCreateRetailer(input.url);

      const id = crypto.randomUUID();
      await db
        .insert(retailerUrl)
        .values({ id, fragranceId: input.fragranceId, retailerId: r.id, url: input.url });

      return { id, fragranceId: input.fragranceId, retailerId: r.id, url: input.url };
    }),

  lookupPrice: protectedProcedure
    .input(z.object({ retailerUrlId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const urls = await db
        .select()
        .from(retailerUrl)
        .where(eq(retailerUrl.id, input.retailerUrlId))
        .limit(1);

      if (!urls[0]) throw new TRPCError({ code: "NOT_FOUND", message: "URL not found" });

      // Verify user owns the fragrance this URL is linked to
      await findFragrance(urls[0].fragranceId, ctx.user.id);

      return await scrapePrice(urls[0].url);
    }),
});

export type AppRouter = typeof appRouter;
