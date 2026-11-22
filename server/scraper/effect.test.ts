import { Duration, Effect, Either, Fiber, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  BrowserFailed,
  BrowserLauncher,
  PriceNotFound,
  RetailerConfig,
  ScrapeClock,
  scrapeRun,
  scrapeUrl,
  settingsFrom,
  withBrowserSession,
  type ScrapeSettings,
} from "./effect.js";
import type {
  BrowserLike,
  ContextLike,
  PageLike,
  PriceElementLike,
  ScraperOptions,
} from "./model.js";

const URL = "https://fragrancex.com/p/1";
const SECOND_URL = "https://fragrancex.com/p/2";

const FAST: ScrapeSettings = {
  ...settingsFrom(),
  retries: 0,
  retryDelayMs: 0,
};

const TIMEOUT = Object.assign(new Error("timed out"), { name: "TimeoutError" });

function fakeBrowser(
  opts: {
    gotoError?: Error;
    selectorError?: Error;
    newContextError?: Error;
    text?: string | null;
    missingElement?: boolean;
    hangOnSelector?: boolean;
  } = {},
) {
  const calls = {
    browserClose: 0,
    contexts: 0,
    contextClose: 0,
    pages: 0,
    pageClose: 0,
    gotos: 0,
    sleeps: 0,
  };
  const element: PriceElementLike = { textContent: async () => opts.text ?? "$24.99" };
  const page: PageLike = {
    goto: async () => {
      calls.gotos++;
      if (opts.gotoError) throw opts.gotoError;
    },
    waitForSelector: async () => {
      if (opts.hangOnSelector) return await new Promise<PriceElementLike>(() => {});
      if (opts.selectorError) throw opts.selectorError;
      return opts.missingElement ? null : element;
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
  return { calls, browser };
}

function layersFor(browser: BrowserLike, calls: { sleeps: number }) {
  return Layer.mergeAll(
    Layer.succeed(BrowserLauncher, { launch: Effect.succeed(browser) }),
    Layer.succeed(RetailerConfig, {
      lookup: (url: string) =>
        url.includes("unsupported.example")
          ? Effect.fail(new PriceNotFound({ detail: "unsupported" }))
          : Effect.succeed({ selector: "[data-price]", currency: "USD" }),
    }),
    Layer.succeed(ScrapeClock, {
      sleep: () => Effect.sync(() => void calls.sleeps++),
    }),
  );
}

async function runProgram<A, E>(
  program: Effect.Effect<A, E, BrowserLauncher | RetailerConfig | ScrapeClock>,
  opts: Parameters<typeof fakeBrowser>[0] = {},
): Promise<{ result: Either.Either<A, E>; fake: ReturnType<typeof fakeBrowser> }> {
  const fake = fakeBrowser(opts);
  const result = await Effect.runPromise(
    Effect.either(Effect.provide(program, layersFor(fake.browser, fake.calls))),
  );
  return { result, fake };
}

const oneUrl = (options: ScraperOptions = {}, settings: ScrapeSettings = FAST) =>
  withBrowserSession(scrapeUrl(URL, settings));

describe("typed scraper errors (Spec 04 taxonomy)", () => {
  it("produces NavigationFailed for a transient navigation error", async () => {
    const { result } = await runProgram(oneUrl({}, { ...FAST, retries: 2, retryDelayMs: 0 }), {
      gotoError: new Error("net::ERR_CONNECTION_RESET"),
    });
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("NavigationFailed");
      expect(result.left.category).toBe("navigation_failed");
    }
  });

  it("keeps a navigation timeout in navigation_failed", async () => {
    const { result } = await runProgram(oneUrl(), { gotoError: TIMEOUT });
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("NavigationFailed");
      expect("message" in result.left && result.left.message).toBe("navigation timeout");
    }
  });

  it("keeps a selector-wait timeout in price_not_found", async () => {
    const { result } = await runProgram(oneUrl(), { selectorError: TIMEOUT });
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("PriceNotFound");
      expect(result.left.category).toBe("price_not_found");
    }
  });

  it("uses selector_timeout for non-timeout selector failures", async () => {
    const { result } = await runProgram(oneUrl(), {
      selectorError: new Error("strict mode violation"),
    });
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("SelectorTimeout");
      expect(result.left.category).toBe("selector_timeout");
    }
  });

  it("treats a null selector match as price_not_found (no matching element)", async () => {
    const { result } = await runProgram(oneUrl(), { missingElement: true });
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("PriceNotFound");
      expect(result.left.category).toBe("price_not_found");
    }
  });

  it("produces AmbiguousPrice for ambiguous text and BrowserFailed for launch failures", async () => {
    const ambiguous = await runProgram(oneUrl(), { text: "$20–$30" });
    expect(Either.isLeft(ambiguous.result)).toBe(true);
    if (Either.isLeft(ambiguous.result)) {
      expect(ambiguous.result.left._tag).toBe("AmbiguousPrice");
      expect(ambiguous.result.left.category).toBe("ambiguous_price");
    }

    const contextError = await runProgram(oneUrl(), {
      newContextError: new Error("browser closed"),
    });
    expect(Either.isLeft(contextError.result)).toBe(true);
    if (Either.isLeft(contextError.result)) {
      expect(contextError.result.left._tag).toBe("BrowserFailed");
      expect(contextError.result.left.category).toBe("browser_failed");
    }
  });

  it("retries navigation failures under a named cap but not deterministic ones", async () => {
    const retried = await runProgram(oneUrl({}, { ...FAST, retries: 2, retryDelayMs: 0 }), {
      gotoError: new Error("ERR_TIMED_OUT"),
    });
    expect(retried.fake.calls.gotos).toBe(3);

    const deterministic = await runProgram(oneUrl({}, { ...FAST, retries: 2, retryDelayMs: 0 }), {
      selectorError: TIMEOUT,
    });
    expect(deterministic.fake.calls.gotos).toBe(1);
  });
});

describe("scoped browser resources", () => {
  it("releases the browser, context and page on success", async () => {
    const { result, fake } = await runProgram(oneUrl());
    expect(Either.isRight(result)).toBe(true);
    expect(fake.calls.pageClose).toBe(1);
    expect(fake.calls.contextClose).toBe(1);
    expect(fake.calls.browserClose).toBe(1);
  });

  it("releases the browser on a typed failure", async () => {
    const { result, fake } = await runProgram(oneUrl(), {
      newContextError: new Error("browser closed"),
    });
    expect(Either.isLeft(result)).toBe(true);
    expect(fake.calls.contexts).toBe(1);
    expect(fake.calls.browserClose).toBe(1);
  });

  it("releases the browser and page when a phase times out", async () => {
    const { result, fake } = await runProgram(oneUrl({}, { ...FAST, selectorTimeoutMs: 5 }), {
      hangOnSelector: true,
    });
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left._tag).toBe("PriceNotFound");
    expect(fake.calls.pageClose).toBe(1);
    expect(fake.calls.contextClose).toBe(1);
    expect(fake.calls.browserClose).toBe(1);
  });

  it("releases the browser on interruption", async () => {
    const fake = fakeBrowser({ hangOnSelector: true });
    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(withBrowserSession(scrapeUrl(URL, FAST)));
        yield* Effect.sleep(Duration.millis(10));
        yield* Fiber.interrupt(fiber);
      }).pipe(Effect.provide(layersFor(fake.browser, fake.calls))),
    );
    expect(fake.calls.browserClose).toBe(1);
    expect(fake.calls.pageClose).toBe(1);
    expect(fake.calls.contextClose).toBe(1);
  });

  it("fails with BrowserFailed when the launcher fails", async () => {
    const fake = fakeBrowser();
    const layers = Layer.mergeAll(
      Layer.succeed(BrowserLauncher, {
        launch: Effect.fail(new BrowserFailed({ message: "no chromium" })),
      }),
      Layer.succeed(RetailerConfig, {
        lookup: () => Effect.succeed({ selector: "[data-price]", currency: "USD" }),
      }),
      Layer.succeed(ScrapeClock, { sleep: () => Effect.void }),
    );
    const result = await Effect.runPromise(
      Effect.either(Effect.provide(withBrowserSession(scrapeUrl(URL, FAST)), layers)),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left._tag).toBe("BrowserFailed");
    expect(fake.calls.browserClose).toBe(0);
  });

  it("uses the injected clock for pacing between URLs in a run", async () => {
    const fake = fakeBrowser();
    const program = scrapeRun([URL, SECOND_URL], FAST);
    const result = await Effect.runPromise(
      Effect.either(Effect.provide(program, layersFor(fake.browser, fake.calls))),
    );
    expect(Either.isRight(result)).toBe(true);
    expect(fake.calls.sleeps).toBe(1);
    expect(fake.calls.browserClose).toBe(1);
  });
});
