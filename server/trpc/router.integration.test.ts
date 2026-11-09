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
  throw new Error("TEST_DATABASE_URL is required for integration tests (see vitest.integration.config.ts)");
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

const anonCaller = appRouter.createCaller({ db, session: null, authType: "none" } as unknown as Context);

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
  await db
    .insert(retailerUrl)
    .values([
      { id: ids.urlA, fragranceId: ids.fragA, retailerId: ids.retailerId, url: "https://fragrancex.com/a" },
      { id: ids.urlB, fragranceId: ids.fragB, retailerId: ids.retailerId, url: "https://fragrancex.com/b" },
    ]);
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db.insert(apiKey).values([
    { id: keys.valid.id, userId: ids.userA, secretHash: keys.valid.secretHash, expiresAt: keys.valid.expiresAt },
    { id: keys.expired.id, userId: ids.userA, secretHash: keys.expired.secretHash, expiresAt: past },
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
      amount: "24.99",
      currency: "USD",
    });
    expect(stored.retailerUrlId).toBe(ids.urlA);
  });

  it("blocks cross-user reads, writes, and deletes", async () => {
    const caller = sessionCaller(ids.userA);
    await expect(
      caller.addRetailerUrl({ fragranceId: ids.fragB, url: "https://fragrancex.com/evil" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.storePrice({ retailerUrlId: ids.urlB, amount: "10.00", currency: "USD" }),
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
});

describe("API-key scope and lifecycle", () => {
  it("allows the scrape workflow for owned resources", async () => {
    const caller = await keyCaller(keys.valid.key);
    const urls = await caller.getUserUrls();
    expect(urls.map((u) => u.retailer_url.id)).toContain(ids.urlA);
    expect(urls.map((u) => u.retailer_url.id)).not.toContain(ids.urlB);
    const stored = await caller.storePrice({
      retailerUrlId: ids.urlA,
      amount: "99.50",
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
      caller.storePrice({ retailerUrlId: ids.urlB, amount: "10.00", currency: "USD" }),
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
      await createContext({ req: { headers: { authorization: "Bearer" } } } as unknown as CallerOptions),
    );
    await expect(bearerOnly.getUserUrls()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("price writes (current contract)", () => {
  it("rejects missing retailer URLs", async () => {
    const caller = sessionCaller(ids.userA);
    await expect(
      caller.storePrice({ retailerUrlId: "does-not-exist", amount: "10.00", currency: "USD" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
