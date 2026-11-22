import { describe, expect, it } from "vitest";
import {
  createScraper,
  type BrowserLike,
  type ContextLike,
  type PageLike,
  type PriceElementLike,
} from "./index.js";

// Fixture browser: no real Chromium, no network. Tracks resource ownership so
// cleanup can be asserted on success and on each failure path.
function fakeLauncher(
  opts: {
    gotoError?: Error;
    selectorError?: Error;
    newContextError?: Error;
    text?: string;
  } = {},
) {
  const calls = {
    browserClose: 0,
    contexts: 0,
    contextClose: 0,
    pages: 0,
    pageClose: 0,
    gotos: 0,
  };
  const element: PriceElementLike = {
    textContent: async () => opts.text ?? "$24.99",
  };
  const page: PageLike = {
    goto: async () => {
      calls.gotos++;
      if (opts.gotoError) throw opts.gotoError;
    },
    waitForSelector: async () => {
      if (opts.selectorError) throw opts.selectorError;
      return element;
    },
    close: async () => {
      calls.pageClose++;
    },
  };
  const context: ContextLike = {
    newPage: async () => {
      calls.pages++;
      return page;
    },
    close: async () => {
      calls.contextClose++;
    },
  };
  const browser: BrowserLike = {
    newContext: async () => {
      calls.contexts++;
      if (opts.newContextError) throw opts.newContextError;
      return context;
    },
    close: async () => {
      calls.browserClose++;
    },
  };
  return { calls, launch: async () => browser };
}

const URL = "https://fragrancex.com/p/1";

describe("scraper browser lifecycle", () => {
  it("reuses one browser and closes every page and context on success", async () => {
    const fake = fakeLauncher({ text: "$1,299.99" });
    const scraper = await createScraper({ launch: fake.launch });

    expect(await scraper.scrape(URL)).toEqual({
      category: "ok",
      amountMinor: 129999,
      currency: "USD",
    });
    expect(await scraper.scrape(URL)).toEqual({
      category: "ok",
      amountMinor: 129999,
      currency: "USD",
    });
    await scraper.close();

    expect(fake.calls.contexts).toBe(2);
    expect(fake.calls.pages).toBe(2);
    expect(fake.calls.pageClose).toBe(2);
    expect(fake.calls.contextClose).toBe(2);
    expect(fake.calls.browserClose).toBe(1);
  });

  it("closes page and context when navigation fails", async () => {
    const fake = fakeLauncher({ gotoError: new Error("net::ERR_CONNECTION_RESET") });
    const scraper = await createScraper({ launch: fake.launch, retries: 0 });

    expect(await scraper.scrape(URL)).toMatchObject({ category: "navigation_failed" });
    expect(fake.calls.pageClose).toBe(1);
    expect(fake.calls.contextClose).toBe(1);
    expect(fake.calls.browserClose).toBe(0);

    await scraper.close();
    expect(fake.calls.browserClose).toBe(1);
  });

  it("classifies an absent price element as price_not_found", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const fake = fakeLauncher({ selectorError: timeout });
    const scraper = await createScraper({ launch: fake.launch });

    expect(await scraper.scrape(URL)).toEqual({
      category: "price_not_found",
      detail: expect.any(String),
    });
    expect(fake.calls.pageClose).toBe(1);
    expect(fake.calls.contextClose).toBe(1);
    await scraper.close();
  });

  it("keeps selector_timeout for non-timeout selector failures", async () => {
    const fake = fakeLauncher({ selectorError: new Error("strict mode violation") });
    const scraper = await createScraper({ launch: fake.launch });

    expect(await scraper.scrape(URL)).toMatchObject({ category: "selector_timeout" });
    expect(fake.calls.pageClose).toBe(1);
    expect(fake.calls.contextClose).toBe(1);
    await scraper.close();
  });

  it("retries only navigation failures, with a bounded attempt count", async () => {
    const fake = fakeLauncher({ gotoError: new Error("net::ERR_TIMED_OUT") });
    const scraper = await createScraper({ launch: fake.launch, retries: 2, retryDelayMs: 0 });

    expect(await scraper.scrape(URL)).toMatchObject({ category: "navigation_failed" });
    expect(fake.calls.gotos).toBe(3);
    expect(fake.calls.pageClose).toBe(3);
    expect(fake.calls.contextClose).toBe(3);
    await scraper.close();
  });

  it("does not retry a deterministic missing price element", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const fake = fakeLauncher({ selectorError: timeout });
    const scraper = await createScraper({ launch: fake.launch, retries: 2, retryDelayMs: 0 });

    await scraper.scrape(URL);
    expect(fake.calls.gotos).toBe(1);
    await scraper.close();
  });

  it("classifies browser failures without leaking a page", async () => {
    const fake = fakeLauncher({ newContextError: new Error("browser closed") });
    const scraper = await createScraper({ launch: fake.launch, retries: 0 });

    expect(await scraper.scrape(URL)).toMatchObject({ category: "browser_failed" });
    expect(fake.calls.pages).toBe(0);
    await scraper.close();
    expect(fake.calls.browserClose).toBe(1);
  });

  it("surfaces a browser launch failure as a rejection", async () => {
    await expect(
      createScraper({
        launch: async () => {
          throw new Error("no chromium");
        },
      }),
    ).rejects.toThrow("no chromium");
  });

  it("makes close idempotent", async () => {
    const fake = fakeLauncher();
    const scraper = await createScraper({ launch: fake.launch });

    await scraper.close();
    await scraper.close();
    expect(fake.calls.browserClose).toBe(1);
  });

  it("does not open a context for an unsupported domain", async () => {
    const fake = fakeLauncher();
    const scraper = await createScraper({ launch: fake.launch });

    expect(await scraper.scrape("https://unsupported.example/p")).toMatchObject({
      category: "price_not_found",
    });
    expect(fake.calls.contexts).toBe(0);
    await scraper.close();
  });
});
