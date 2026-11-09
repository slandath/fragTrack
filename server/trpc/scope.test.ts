import { describe, expect, it, vi } from "vitest";
import type { Context } from "./context.js";
import { appRouter } from "./router.js";

// These tests assert authorization denials that must happen before any
// database access. Mock the database module so they never read database
// configuration and cannot touch a database under any environment.
vi.mock("../index.js", () => ({ db: {} }));

// Authorization scope (Spec 01): API keys may call only the scrape workflow
// procedures. These tests use a caller with no working database handle, so a
// denial must happen before any database access; anything that reaches the
// database fails loudly instead of passing.
function stubContext(authType: Context["authType"]): Context {
  if (authType === "none") {
    return { db: {} as Context["db"], session: null, authType } as Context;
  }
  return {
    db: {} as Context["db"],
    session: { user: { id: "user-a" }, session: null },
    authType,
  } as unknown as Context;
}

const apiKeyCaller = appRouter.createCaller(stubContext("api-key"));
const anonCaller = appRouter.createCaller(stubContext("none"));

// Every protected procedure except the two scrape operations.
const sessionOnlyCalls: [string, () => Promise<unknown>][] = [
  ["listApiKeys", () => apiKeyCaller.listApiKeys()],
  ["createApiKey", () => apiKeyCaller.createApiKey({})],
  ["rotateApiKey", () => apiKeyCaller.rotateApiKey({ id: "key-1" })],
  ["revokeApiKey", () => apiKeyCaller.revokeApiKey({ id: "key-1" })],
  ["getFragrances", () => apiKeyCaller.getFragrances()],
  ["getLatestPrices", () => apiKeyCaller.getLatestPrices()],
  ["getSupportedDomains", () => apiKeyCaller.getSupportedDomains()],
  ["addFragrance", () => apiKeyCaller.addFragrance({ name: "Noir", brand: "Test" })],
  [
    "addRetailerUrl",
    () => apiKeyCaller.addRetailerUrl({ fragranceId: "frag-1", url: "https://fragrancex.com/p" }),
  ],
  ["deleteRetailerUrl", () => apiKeyCaller.deleteRetailerUrl({ id: "url-1" })],
  ["deleteFragrance", () => apiKeyCaller.deleteFragrance({ id: "frag-1" })],
];

describe("API-key authorization scope", () => {
  for (const [name, call] of sessionOnlyCalls) {
    it(`denies an API key on ${name}`, async () => {
      await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  }

  it("denies unauthenticated access to protected procedures", async () => {
    await expect(anonCaller.getUserUrls()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCaller.storePrice({ retailerUrlId: "url-1", amount: "10.00", currency: "USD" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("keeps healthcheck public", async () => {
    await expect(anonCaller.healthcheck()).resolves.toMatchObject({ status: "ok" });
  });
});
