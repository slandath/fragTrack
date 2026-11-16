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
import { CURRENCY_RE, MAX_AMOUNT_MINOR, MIN_AMOUNT_MINOR } from "../utils/money.js";
import { canonicalizeRetailerUrl } from "../utils/retailer-url.js";

/** A Drizzle transaction handle (same query surface as the global db). */
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const t = initTRPC.context<Context>().create();

const isAuthed = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session?.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  const currentUsers = await db
    .select()
    .from(user)
    .where(eq(user.id, ctx.session.user.id))
    .limit(1);
  const currentUser = currentUsers[0];
  if (!currentUser) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (currentUser.banned && (!currentUser.banExpires || currentUser.banExpires > new Date())) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Account is banned" });
  }
  return next({ ctx: { ...ctx, user: currentUser } });
});

// API keys authenticate only the local scrape workflow. They must be
// rejected before any database access on procedures outside that scope.
const denyApiKey = t.middleware(({ ctx, next }) => {
  if (ctx.authType === "api-key") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "API keys are limited to scrape operations",
    });
  }
  return next();
});

// Scrape operations stay available to both browser sessions and API keys.
const scrapeProcedure = t.procedure.use(isAuthed);
// Every other protected procedure requires a browser session.
const sessionProcedure = t.procedure.use(denyApiKey).use(isAuthed);

// Non-empty IDs, trimmed non-empty text with a documented maximum length.
const idSchema = z.string().min(1);

/** True for PostgreSQL unique-violation errors (SQLSTATE 23505). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}
const textSchema = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(max));

/**
 * Atomic upsert: ON CONFLICT DO NOTHING plus a fallback select means two
 * concurrent creators of the same domain both receive the same retailer row
 * instead of one failing with a 23505 unique violation.
 */
async function findOrCreateRetailer(tx: DbTransaction, url: string) {
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  const inserted = await tx
    .insert(retailer)
    .values({ id: crypto.randomUUID(), name: hostname, url: hostname })
    .onConflictDoNothing({ target: retailer.name })
    .returning();
  if (inserted[0]) return inserted[0];

  const existing = await tx.select().from(retailer).where(eq(retailer.name, hostname)).limit(1);
  if (!existing[0]) throw new Error("Failed to resolve retailer after upsert");
  return existing[0];
}

async function cleanupOrphanedRetailer(tx: DbTransaction, retailerId: string) {
  const remaining = await tx
    .select({ id: retailerUrl.id })
    .from(retailerUrl)
    .where(eq(retailerUrl.retailerId, retailerId))
    .limit(1);
  if (!remaining[0]) {
    await tx.delete(retailer).where(eq(retailer.id, retailerId));
  }
}

async function findFragrance(tx: DbTransaction, id: string, userId: string) {
  const results = await tx
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

  listApiKeys: sessionProcedure.query(async ({ ctx }) => {
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
  createApiKey: sessionProcedure
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
  rotateApiKey: sessionProcedure
    .input(
      z.object({
        id: idSchema,
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
            and(eq(apiKey.id, input.id), eq(apiKey.userId, ctx.user.id), isNull(apiKey.revokedAt)),
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
  revokeApiKey: sessionProcedure
    .input(z.object({ id: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const revoked = await db
        .update(apiKey)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(apiKey.id, input.id), eq(apiKey.userId, ctx.user.id), isNull(apiKey.revokedAt)),
        )
        .returning({ id: apiKey.id });
      if (!revoked[0])
        throw new TRPCError({ code: "NOT_FOUND", message: "Active API key not found" });
      return { id: revoked[0].id };
    }),

  getFragrances: sessionProcedure.query(async ({ ctx }) => {
    return await db
      .select()
      .from(fragrance)
      .where(eq(fragrance.userId, ctx.user.id))
      .leftJoin(retailerUrl, eq(fragrance.id, retailerUrl.fragranceId));
  }),

  getUserUrls: scrapeProcedure.query(async ({ ctx }) => {
    return await db
      .select()
      .from(retailerUrl)
      .innerJoin(fragrance, eq(retailerUrl.fragranceId, fragrance.id))
      .where(eq(fragrance.userId, ctx.user.id));
  }),
  getLatestPrices: sessionProcedure.query(async ({ ctx }) => {
    return await db
      .selectDistinctOn([price.retailerUrlId], {
        retailerUrlId: price.retailerUrlId,
        amountMinor: price.amountMinor,
        currency: price.currency,
        scrapedAt: price.scrapedAt,
      })
      .from(price)
      .innerJoin(retailerUrl, eq(price.retailerUrlId, retailerUrl.id))
      .innerJoin(fragrance, eq(retailerUrl.fragranceId, fragrance.id))
      .where(and(eq(price.quarantined, false), eq(fragrance.userId, ctx.user.id)))
      .orderBy(price.retailerUrlId, desc(price.scrapedAt));
  }),
  getSupportedDomains: sessionProcedure.query(async () => {
    return Object.keys(domainConfigs);
  }),
  addFragrance: sessionProcedure
    .input(z.object({ name: textSchema(100), brand: textSchema(100) }))
    .mutation(async ({ ctx, input }) => {
      const id = crypto.randomUUID();
      await db
        .insert(fragrance)
        .values({ id, name: input.name, brand: input.brand, userId: ctx.user.id });
      return { id, name: input.name, brand: input.brand, userId: ctx.user.id };
    }),

  addRetailerUrl: sessionProcedure
    .input(z.object({ fragranceId: idSchema, url: z.string() }))
    .mutation(async ({ ctx, input }) => {
      let canonical: string;
      try {
        canonical = canonicalizeRetailerUrl(input.url, domainConfigs);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message });
      }

      // Ownership check, retailer resolution, and URL insert share one
      // transaction. A failed URL insert rolls back retailer creation, and a
      // concurrent orphan cleanup cannot observe the retailer before the URL
      // exists (it is uncommitted until this transaction commits).
      return await db.transaction(async (tx) => {
        await findFragrance(tx, input.fragranceId, ctx.user.id);

        const duplicate = await tx
          .select({ id: retailerUrl.id })
          .from(retailerUrl)
          .where(
            and(eq(retailerUrl.fragranceId, input.fragranceId), eq(retailerUrl.url, canonical)),
          )
          .limit(1);
        if (duplicate[0]) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This URL is already tracked for this fragrance",
          });
        }

        const r = await findOrCreateRetailer(tx, canonical);
        const id = crypto.randomUUID();
        try {
          await tx
            .insert(retailerUrl)
            .values({ id, fragranceId: input.fragranceId, retailerId: r.id, url: canonical });
        } catch (error) {
          // The unique (fragranceId, url) constraint is the atomic duplicate
          // guard; the SELECT above is only an early, friendlier check.
          if (isUniqueViolation(error)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "This URL is already tracked for this fragrance",
            });
          }
          throw error;
        }

        return { id, fragranceId: input.fragranceId, retailerId: r.id, url: canonical };
      });
    }),
  storePrice: scrapeProcedure
    .input(
      z.object({
        retailerUrlId: idSchema,
        amountMinor: z.number().int().min(MIN_AMOUNT_MINOR).max(MAX_AMOUNT_MINOR),
        currency: z.string().regex(CURRENCY_RE),
      }),
    )
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
  deleteRetailerUrl: sessionProcedure
    .input(z.object({ id: idSchema }))
    .mutation(async ({ ctx, input }) => {
      await db.transaction(async (tx) => {
        const urlRows = await tx
          .select({ retailerId: retailerUrl.retailerId })
          .from(retailerUrl)
          .innerJoin(fragrance, eq(retailerUrl.fragranceId, fragrance.id))
          .where(and(eq(retailerUrl.id, input.id), eq(fragrance.userId, ctx.user.id)))
          .limit(1);
        if (!urlRows[0]) throw new TRPCError({ code: "NOT_FOUND" });

        await tx.delete(retailerUrl).where(eq(retailerUrl.id, input.id));
        await cleanupOrphanedRetailer(tx, urlRows[0].retailerId);
      });
    }),
  deleteFragrance: sessionProcedure
    .input(z.object({ id: idSchema }))
    .mutation(async ({ ctx, input }) => {
      await db.transaction(async (tx) => {
        const f = await findFragrance(tx, input.id, ctx.user.id);

        const urls = await tx
          .select({ retailerId: retailerUrl.retailerId })
          .from(retailerUrl)
          .where(eq(retailerUrl.fragranceId, f.id));

        // A retailer can own several URLs on the same fragrance (different
        // products), so clean it up once.
        const retailerIds = [...new Set(urls.map((u) => u.retailerId))];

        await tx.delete(fragrance).where(eq(fragrance.id, f.id));

        for (const id of retailerIds) {
          await cleanupOrphanedRetailer(tx, id);
        }
      });
    }),
});

export type AppRouter = typeof appRouter;
