import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import crypto from "node:crypto";
import { apiKey, fragrance, price, retailer, retailerUrl, user } from "../db/schema.js";
import { generateApiKey } from "../utils/api-key.js";
import type { Context } from "./context.js";

// Two-user authorization isolation plus API-key lifecycle (Specs 01 + 02).
//
// Requires a disposable database — never development or production:
//   TEST_DATABASE_URL=postgresql://user:password@host:5432/fragtest pnpm test:integration
//
// Setup applies every committed migration (the migration smoke test) and
// seeds uniquely-named rows so runs are repeatable; teardown removes them.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL is required for integration tests (see vitest.integration.config.ts)",
  );
}
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.NODE_ENV = "test";

const { db } = await import("../index.js");
const { createContext } = await import("./context.js");
const { appRouter } = await import("./router.js");

type CallerOptions = Parameters<typeof createContext>[0];

function authReq(key: string): CallerOptions {
  return { req: { headers: { authorization: `Bearer ${key}` } } } as unknown as CallerOptions;
}

async function keyCaller(key: string) {
  return appRouter.createCaller(await createContext(authReq(key)));
}

function sessionCaller(userId: string) {
  return appRouter.createCaller({
    db,
    session: { user: { id: userId }, session: null },
    authType: "session",
  } as unknown as Context);
}

const anonCaller = appRouter.createCaller({
  db,
  session: null,
  authType: "none",
} as unknown as Context);

const runId = crypto.randomUUID().slice(0, 8);
const ids = {
  userA: `user-a-${runId}`,
  userB: `user-b-${runId}`,
  banned: `user-banned-${runId}`,
  fragA: `frag-a-${runId}`,
  fragB: `frag-b-${runId}`,
  retailer: `test-retailer-${runId}.com`,
  retailerId: `ret-${runId}`,
  urlA: `url-a-${runId}`,
  urlB: `url-b-${runId}`,
};

const keys = {
  valid: generateApiKey(),
  expired: generateApiKey(),
  revoked: generateApiKey(),
  bannedUser: generateApiKey(),
  otherUser: generateApiKey(),
};
const wrongSecretKey = `ft_${keys.valid.id}_${generateApiKey().key.split("_")[2]}`;

async function seed() {
  await db.insert(user).values([
    { id: ids.userA, name: "User A", email: `a-${runId}@example.com` },
    { id: ids.userB, name: "User B", email: `b-${runId}@example.com` },
    { id: ids.banned, name: "Banned", email: `banned-${runId}@example.com`, banned: true },
  ]);
  await db.insert(fragrance).values([
    { id: ids.fragA, name: "Noir", brand: "House A", userId: ids.userA },
    { id: ids.fragB, name: "Blanc", brand: "House B", userId: ids.userB },
  ]);
  await db.insert(retailer).values({ id: ids.retailerId, name: ids.retailer, url: ids.retailer });
  await db.insert(retailerUrl).values([
    {
      id: ids.urlA,
      fragranceId: ids.fragA,
      retailerId: ids.retailerId,
      url: "https://fragrancex.com/a",
    },
    {
      id: ids.urlB,
      fragranceId: ids.fragB,
      retailerId: ids.retailerId,
      url: "https://fragrancex.com/b",
    },
  ]);
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db.insert(apiKey).values([
    {
      id: keys.valid.id,
      userId: ids.userA,
      secretHash: keys.valid.secretHash,
      expiresAt: keys.valid.expiresAt,
    },
    {
      id: keys.expired.id,
      userId: ids.userA,
      secretHash: keys.expired.secretHash,
      expiresAt: past,
    },
    {
      id: keys.revoked.id,
      userId: ids.userA,
      secretHash: keys.revoked.secretHash,
      expiresAt: keys.revoked.expiresAt,
      revokedAt: new Date(),
    },
    {
      id: keys.bannedUser.id,
      userId: ids.banned,
      secretHash: keys.bannedUser.secretHash,
      expiresAt: keys.bannedUser.expiresAt,
    },
    {
      id: keys.otherUser.id,
      userId: ids.userB,
      secretHash: keys.otherUser.secretHash,
      expiresAt: keys.otherUser.expiresAt,
    },
  ]);
}

// Cleanup is restricted to rows created by this run so a misconfigured
// TEST_DATABASE_URL can never wipe unrelated data. Prices stored during the
// run reference the seeded retailer URLs, so filtering by those covers them.
async function cleanup() {
  const keyIds = [keys.valid, keys.expired, keys.revoked, keys.bannedUser, keys.otherUser].map(
    (k) => k.id,
  );
  await db.delete(price).where(inArray(price.retailerUrlId, [ids.urlA, ids.urlB]));
  await db.delete(retailerUrl).where(inArray(retailerUrl.id, [ids.urlA, ids.urlB]));
  await db.delete(fragrance).where(inArray(fragrance.id, [ids.fragA, ids.fragB]));
  await db.delete(apiKey).where(inArray(apiKey.id, keyIds));
  await db.delete(user).where(inArray(user.id, [ids.userA, ids.userB, ids.banned]));
  await db.delete(retailer).where(eq(retailer.id, ids.retailerId));
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "server/db/migrations" });
  await seed();
}, 60_000);

afterAll(async () => {
  await cleanup();
});

describe("unauthenticated requests", () => {
  it("rejects protected procedures", async () => {
    await expect(anonCaller.getUserUrls()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonCaller.getFragrances()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonCaller.getLatestPrices()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonCaller.listApiKeys()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("keeps healthcheck public", async () => {
    await expect(anonCaller.healthcheck()).resolves.toMatchObject({ status: "ok" });
  });
});

describe("session user isolation", () => {
  it("lets a user read their own data", async () => {
    const caller = sessionCaller(ids.userA);
    const frags = await caller.getFragrances();
    expect(frags.map((f) => f.fragrance.id)).toContain(ids.fragA);
    expect(frags.map((f) => f.fragrance.id)).not.toContain(ids.fragB);
    const urls = await caller.getUserUrls();
    expect(urls.map((u) => u.retailer_url.id)).toContain(ids.urlA);
    expect(urls.map((u) => u.retailer_url.id)).not.toContain(ids.urlB);
    const stored = await caller.storePrice({
      retailerUrlId: ids.urlA,
      amountMinor: 2499,
      currency: "USD",
    });
    expect(stored.retailerUrlId).toBe(ids.urlA);
    expect(stored.amountMinor).toBe(2499);
  });

  it("blocks cross-user reads, writes, and deletes", async () => {
    const caller = sessionCaller(ids.userA);
    await expect(
      caller.addRetailerUrl({ fragranceId: ids.fragB, url: "https://fragrancex.com/evil" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.storePrice({ retailerUrlId: ids.urlB, amountMinor: 1000, currency: "USD" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.deleteFragrance({ id: ids.fragB })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller.deleteRetailerUrl({ id: ids.urlB })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller.rotateApiKey({ id: keys.otherUser.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller.revokeApiKey({ id: keys.otherUser.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects banned sessions", async () => {
    const caller = sessionCaller(ids.banned);
    await expect(caller.getFragrances()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("isolates latest prices and API-key metadata per user", async () => {
    const callerA = sessionCaller(ids.userA);
    const callerB = sessionCaller(ids.userB);
    await callerA.storePrice({ retailerUrlId: ids.urlA, amountMinor: 1111, currency: "USD" });
    await callerB.storePrice({ retailerUrlId: ids.urlB, amountMinor: 2222, currency: "USD" });

    const latestA = await callerA.getLatestPrices();
    const latestUrlIds = latestA.map((p) => p.retailerUrlId);
    expect(latestUrlIds).toContain(ids.urlA);
    expect(latestUrlIds).not.toContain(ids.urlB);

    const keysA = await callerA.listApiKeys();
    const keyIds = keysA.map((k) => k.id);
    expect(keyIds).toContain(keys.valid.id);
    expect(keyIds).not.toContain(keys.otherUser.id);
  });
});

describe("API-key scope and lifecycle", () => {
  it("allows the scrape workflow for owned resources", async () => {
    const caller = await keyCaller(keys.valid.key);
    const urls = await caller.getUserUrls();
    expect(urls.map((u) => u.retailer_url.id)).toContain(ids.urlA);
    expect(urls.map((u) => u.retailer_url.id)).not.toContain(ids.urlB);
    const stored = await caller.storePrice({
      retailerUrlId: ids.urlA,
      amountMinor: 9950,
      currency: "USD",
    });
    expect(stored.retailerUrlId).toBe(ids.urlA);
  });

  it("denies key management and account procedures", async () => {
    const caller = await keyCaller(keys.valid.key);
    await expect(caller.listApiKeys()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.createApiKey({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.rotateApiKey({ id: keys.valid.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.revokeApiKey({ id: keys.valid.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.getFragrances()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.getLatestPrices()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.getSupportedDomains()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.addFragrance({ name: "X", brand: "Y" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller.addRetailerUrl({ fragranceId: ids.fragA, url: "https://fragrancex.com/z" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.deleteRetailerUrl({ id: ids.urlA })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.deleteFragrance({ id: ids.fragA })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects cross-user prices even for otherwise valid keys", async () => {
    const caller = await keyCaller(keys.valid.key);
    await expect(
      caller.storePrice({ retailerUrlId: ids.urlB, amountMinor: 1000, currency: "USD" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects expired, revoked, banned-user, bad-secret, legacy, and malformed keys", async () => {
    for (const key of [
      keys.expired.key,
      keys.revoked.key,
      keys.bannedUser.key,
      wrongSecretKey,
      "123e4567-e89b-42d3-a456-426614174000",
      "not-a-key",
    ]) {
      const caller = await keyCaller(key);
      await expect(caller.getUserUrls()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    // A present-but-unparseable header fails closed without falling through
    // to cookie sessions.
    const bearerOnly = appRouter.createCaller(
      await createContext({
        req: { headers: { authorization: "Bearer" } },
      } as unknown as CallerOptions),
    );
    await expect(bearerOnly.getUserUrls()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("price writes (numeric contract)", () => {
  it("rejects missing retailer URLs", async () => {
    const caller = sessionCaller(ids.userA);
    await expect(
      caller.storePrice({ retailerUrlId: "does-not-exist", amountMinor: 1000, currency: "USD" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects invalid amounts and currencies before any write", async () => {
    const caller = sessionCaller(ids.userA);
    for (const input of [
      { retailerUrlId: ids.urlA, amountMinor: 0, currency: "USD" },
      { retailerUrlId: ids.urlA, amountMinor: -500, currency: "USD" },
      { retailerUrlId: ids.urlA, amountMinor: 100_000_000, currency: "USD" },
      { retailerUrlId: ids.urlA, amountMinor: 24.99, currency: "USD" },
      { retailerUrlId: ids.urlA, amountMinor: 1000, currency: "usd" },
      { retailerUrlId: ids.urlA, amountMinor: 1000, currency: "USDD" },
      { retailerUrlId: ids.urlA, amountMinor: 1000, currency: "" },
      { retailerUrlId: "", amountMinor: 1000, currency: "USD" },
    ]) {
      await expect(caller.storePrice(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    // No partial row may have been stored for the rejected inputs.
    const latest = await caller.getLatestPrices();
    expect(latest.map((p) => p.amountMinor).every((m) => Number.isInteger(m) && m > 0)).toBe(true);
  });

  it("enforces the numeric guards at the database level", async () => {
    await expect(
      db.insert(price).values({
        id: `price-bad-${runId}`,
        retailerUrlId: ids.urlA,
        amountMinor: 0,
        currency: "USD",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(price).values({
        id: `price-bad2-${runId}`,
        retailerUrlId: ids.urlA,
        amountMinor: 1000,
        currency: "usd",
      }),
    ).rejects.toThrow();
  });

  it("excludes quarantined legacy prices from display", async () => {
    const caller = sessionCaller(ids.userA);
    await caller.storePrice({ retailerUrlId: ids.urlA, amountMinor: 7777, currency: "USD" });
    await db.insert(price).values({
      id: `price-quarantined-${runId}`,
      retailerUrlId: ids.urlA,
      amountMinor: 203000,
      currency: "USD",
      quarantined: true,
    });
    const latest = await caller.getLatestPrices();
    const forUrl = latest.filter((p) => p.retailerUrlId === ids.urlA);
    expect(forUrl.length).toBe(1);
    expect(forUrl[0].amountMinor).toBe(7777);
  });

  it("rejects duplicate retailer URLs at the database level", async () => {
    const dupeUrl = "https://fragrancex.com/db-dupe-check";
    await db.insert(retailerUrl).values({
      id: `ru-dupe1-${runId}`,
      fragranceId: ids.fragA,
      retailerId: ids.retailerId,
      url: dupeUrl,
    });
    try {
      await expect(
        db.insert(retailerUrl).values({
          id: `ru-dupe2-${runId}`,
          fragranceId: ids.fragA,
          retailerId: ids.retailerId,
          url: dupeUrl,
        }),
      ).rejects.toThrow();
    } finally {
      await db
        .delete(retailerUrl)
        .where(inArray(retailerUrl.id, [`ru-dupe1-${runId}`, `ru-dupe2-${runId}`]));
    }
  });
});

describe("fragrance and retailer-URL validation", () => {
  it("trims names and rejects blank or overlong text", async () => {
    const caller = sessionCaller(ids.userA);
    const created = await caller.addFragrance({ name: "  Noir  ", brand: " House " });
    expect(created.name).toBe("Noir");
    expect(created.brand).toBe("House");
    await expect(caller.addFragrance({ name: "   ", brand: "House" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      caller.addFragrance({ name: "n".repeat(101), brand: "House" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await db.delete(fragrance).where(eq(fragrance.id, created.id));
  });

  it("rejects bad retailer URLs and duplicate canonical URLs", async () => {
    const caller = sessionCaller(ids.userA);
    for (const url of [
      "ftp://fragrancex.com/p",
      "https://user:pass@fragrancex.com/p",
      "https://evil.com/p",
      "not a url",
    ]) {
      await expect(caller.addRetailerUrl({ fragranceId: ids.fragA, url })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    const first = await caller.addRetailerUrl({
      fragranceId: ids.fragA,
      url: "https://fragrancex.com/unique-dupe-check",
    });
    await expect(
      caller.addRetailerUrl({
        fragranceId: ids.fragA,
        url: "https://fragrancex.com:443/unique-dupe-check#frag",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await caller.deleteRetailerUrl({ id: first.id });
  });
});

describe("atomic retailer operations", () => {
  it("resolves one retailer for concurrent adds to the same domain", async () => {
    const caller = sessionCaller(ids.userA);
    const urls = [
      `https://fragrancex.com/concurrent-${runId}-a`,
      `https://fragrancex.com/concurrent-${runId}-b`,
    ];
    try {
      const created = await Promise.all(
        urls.map((url) => caller.addRetailerUrl({ fragranceId: ids.fragA, url })),
      );
      expect(created[0].retailerId).toBe(created[1].retailerId);
      const rows = await db.select().from(retailer).where(eq(retailer.name, "fragrancex.com"));
      expect(rows).toHaveLength(1);
    } finally {
      await db.delete(retailerUrl).where(inArray(retailerUrl.url, urls));
      await db.delete(retailer).where(eq(retailer.name, "fragrancex.com"));
    }
  });

  it("rolls back retailer creation when a concurrent duplicate URL insert fails", async () => {
    const caller = sessionCaller(ids.userA);
    const url = `https://fragrancex.com/rollback-${runId}`;
    try {
      const results = await Promise.allSettled([
        caller.addRetailerUrl({ fragranceId: ids.fragA, url }),
        caller.addRetailerUrl({ fragranceId: ids.fragA, url }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      const rows = await db.select().from(retailerUrl).where(eq(retailerUrl.url, url));
      expect(rows).toHaveLength(1);
      const retailers = await db.select().from(retailer).where(eq(retailer.name, "fragrancex.com"));
      expect(retailers).toHaveLength(1);
    } finally {
      await db.delete(retailerUrl).where(eq(retailerUrl.url, url));
      await db.delete(retailer).where(eq(retailer.name, "fragrancex.com"));
    }
  });

  it("cleans up a shared retailer once when deleting a fragrance", async () => {
    const caller = sessionCaller(ids.userA);
    const created = await caller.addFragrance({ name: `Shared ${runId}`, brand: "X" });
    const urls = [
      `https://fragrancex.com/shared-${runId}-1`,
      `https://fragrancex.com/shared-${runId}-2`,
    ];
    const first = await caller.addRetailerUrl({ fragranceId: created.id, url: urls[0] });
    const second = await caller.addRetailerUrl({ fragranceId: created.id, url: urls[1] });
    expect(first.retailerId).toBe(second.retailerId);

    await caller.deleteFragrance({ id: created.id });
    const rows = await db.select().from(retailer).where(eq(retailer.id, first.retailerId));
    expect(rows).toHaveLength(0);
  });
});
