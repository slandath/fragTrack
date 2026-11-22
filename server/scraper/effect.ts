import { chromium as playwrightChromium } from "playwright";
import { addExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Context, Data, Duration, Effect, Layer, Schedule } from "effect";
import { domainConfigs } from "./configs.js";
import { retailerDomainOf } from "../utils/retailer-url.js";
import {
  DEFAULT_NAVIGATION_TIMEOUT_MS,
  DEFAULT_RETRIES,
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_SELECTOR_TIMEOUT_MS,
  isTimeoutError,
  resolvePriceOutcome,
  type BrowserLike,
  type PriceElementLike,
  type ScrapeOutcome,
  type ScraperOptions,
} from "./model.js";

const chromium = addExtra(playwrightChromium);
chromium.use(StealthPlugin());

/** Operator-facing pacing between URLs (duplicated from the CLI seam for run-level use). */
export const PACE_MS = 250;

/** Typed failures matching the Spec 04 scrape taxonomy. */
export class NavigationFailed extends Data.TaggedError("NavigationFailed")<{ message: string }> {
  get category() {
    return "navigation_failed" as const;
  }
}
export class SelectorTimeout extends Data.TaggedError("SelectorTimeout")<{ detail?: string }> {
  get category() {
    return "selector_timeout" as const;
  }
}
export class PriceNotFound extends Data.TaggedError("PriceNotFound")<{ detail?: string }> {
  get category() {
    return "price_not_found" as const;
  }
}
export class AmbiguousPrice extends Data.TaggedError("AmbiguousPrice")<{ detail?: string }> {
  get category() {
    return "ambiguous_price" as const;
  }
}
export class BrowserFailed extends Data.TaggedError("BrowserFailed")<{ message: string }> {
  get category() {
    return "browser_failed" as const;
  }
}
export type ScrapeFailure =
  | NavigationFailed
  | SelectorTimeout
  | PriceNotFound
  | AmbiguousPrice
  | BrowserFailed;
export type ScrapeSuccess = { category: "ok"; amountMinor: number; currency: string };

export interface ScrapeSettings {
  navigationTimeoutMs: number;
  selectorTimeoutMs: number;
  retries: number;
  retryDelayMs: number;
}
export const settingsFrom = (options: ScraperOptions = {}): ScrapeSettings => ({
  navigationTimeoutMs: options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS,
  selectorTimeoutMs: options.selectorTimeoutMs ?? DEFAULT_SELECTOR_TIMEOUT_MS,
  retries: options.retries ?? DEFAULT_RETRIES,
  retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
});

/** Named, capped retry policy: transient navigation failures only. */
export const NAVIGATION_RETRY_ATTEMPTS = 2;
export const navigationRetrySchedule = (settings: ScrapeSettings) =>
  Schedule.intersect(
    Schedule.exponential(Duration.millis(settings.retryDelayMs), 2),
    Schedule.recurs(settings.retries),
  );

/** Services: production provides live layers, tests provide fakes. */
export interface BrowserLauncher {
  readonly launch: Effect.Effect<BrowserLike, BrowserFailed>;
}
export const BrowserLauncher = Context.GenericTag<BrowserLauncher>("fragTrack/BrowserLauncher");

export interface BrowserSession {
  readonly browser: BrowserLike;
}
export const BrowserSession = Context.GenericTag<BrowserSession>("fragTrack/BrowserSession");

export interface RetailerConfig {
  readonly lookup: (
    url: string,
  ) => Effect.Effect<{ selector: string; currency: string }, NavigationFailed | PriceNotFound>;
}
export const RetailerConfig = Context.GenericTag<RetailerConfig>("fragTrack/RetailerConfig");

export interface ScrapeClock {
  readonly sleep: (ms: number) => Effect.Effect<void>;
}
export const ScrapeClock = Context.GenericTag<ScrapeClock>("fragTrack/ScrapeClock");

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const makeLayers = (options: ScraperOptions = {}) => {
  const launch =
    options.launch ??
    (() =>
      chromium.launch({
        args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
      }) as unknown as Promise<BrowserLike>);

  const launcher = Layer.succeed(BrowserLauncher, {
    launch: Effect.tryPromise({
      try: () => launch(),
      catch: (error) => new BrowserFailed({ message: messageOf(error) }),
    }),
  });

  const retailerConfig = Layer.succeed(RetailerConfig, {
    lookup: (url) =>
      Effect.sync(() => {
        try {
          const hostname = retailerDomainOf(url);
          const found = domainConfigs[hostname];
          if (!found) {
            return {
              tag: "failure",
              failure: new PriceNotFound({ detail: `unsupported domain: ${hostname}` }),
            } as const;
          }
          return {
            tag: "config",
            config: {
              selector: found.selectors.price,
              currency: found.selectors.currency ?? "USD",
            },
          } as const;
        } catch {
          return {
            tag: "failure",
            failure: new NavigationFailed({ message: "invalid URL" }),
          } as const;
        }
      }).pipe(
        Effect.flatMap((result) =>
          result.tag === "failure" ? Effect.fail(result.failure) : Effect.succeed(result.config),
        ),
      ),
  });

  const clock = Layer.succeed(ScrapeClock, {
    sleep: (ms) => Effect.sleep(Duration.millis(ms)),
  });

  return Layer.mergeAll(launcher, retailerConfig, clock);
};

const fromOutcome = (
  outcome: ScrapeOutcome,
): Effect.Effect<ScrapeSuccess, PriceNotFound | AmbiguousPrice> => {
  if (outcome.category === "ok") return Effect.succeed(outcome);
  if (outcome.category === "price_not_found") {
    return Effect.fail(new PriceNotFound({ detail: outcome.detail }));
  }
  if (outcome.category === "ambiguous_price") {
    return Effect.fail(new AmbiguousPrice({ detail: outcome.detail }));
  }
  // resolvePriceOutcome only produces the three categories above.
  return Effect.fail(new PriceNotFound({ detail: outcome.detail }));
};

const attempt = (
  url: string,
  selector: string,
  currency: string,
  settings: ScrapeSettings,
): Effect.Effect<ScrapeSuccess, ScrapeFailure, BrowserSession> =>
  Effect.scoped(
    Effect.gen(function* () {
      const session = yield* BrowserSession;

      // Context and page are scoped per URL: released on success, typed
      // failure, timeout, and interruption (Spec 04).
      const context = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => session.browser.newContext(),
          catch: (error) => new BrowserFailed({ message: messageOf(error) }),
        }),
        (instance) => Effect.promise(() => instance.close().catch(() => {})),
      );
      const page = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => context.newPage(),
          catch: (error) => new BrowserFailed({ message: messageOf(error) }),
        }),
        (instance) => Effect.promise(() => instance.close().catch(() => {})),
      );

      yield* Effect.tryPromise({
        try: () => page.goto(url, { waitUntil: "load", timeout: settings.navigationTimeoutMs }),
        catch: (error) =>
          new NavigationFailed({
            message: isTimeoutError(error) ? "navigation timeout" : messageOf(error),
          }),
      }).pipe(
        Effect.timeoutFail({
          duration: Duration.millis(settings.navigationTimeoutMs),
          onTimeout: () => new NavigationFailed({ message: "navigation timeout" }),
        }),
      );

      const element: PriceElementLike | null = yield* Effect.tryPromise({
        try: () => page.waitForSelector(selector, { timeout: settings.selectorTimeoutMs }),
        catch: (error) =>
          isTimeoutError(error)
            ? new PriceNotFound({ detail: selector })
            : new SelectorTimeout({ detail: messageOf(error) }),
      }).pipe(
        Effect.timeoutFail({
          duration: Duration.millis(settings.selectorTimeoutMs),
          onTimeout: () => new PriceNotFound({ detail: selector }),
        }),
      );
      if (!element) return yield* Effect.fail(new SelectorTimeout({ detail: selector }));

      const text = yield* Effect.tryPromise({
        try: () => element.textContent(),
        catch: (error) => new BrowserFailed({ message: messageOf(error) }),
      });
      return yield* fromOutcome(resolvePriceOutcome(text, currency));
    }),
  );

/** One URL. Navigation failures retry under a named, capped schedule. */
export const scrapeUrl = (
  url: string,
  settings: ScrapeSettings = settingsFrom(),
): Effect.Effect<ScrapeSuccess, ScrapeFailure, BrowserSession | RetailerConfig> =>
  Effect.gen(function* () {
    const config = yield* RetailerConfig;
    const found = yield* config.lookup(url);
    return yield* attempt(url, found.selector, found.currency, settings);
  }).pipe(
    Effect.retry({
      schedule: navigationRetrySchedule(settings),
      while: (error) => error._tag === "NavigationFailed",
    }),
  );

/** Acquire one browser for the whole run; scope guarantees its release. */
export const withBrowserSession = <A, E, R>(
  program: Effect.Effect<A, E, R | BrowserSession>,
): Effect.Effect<A, E | BrowserFailed, R | BrowserLauncher> =>
  Effect.scoped(
    Effect.gen(function* () {
      const launcher = yield* BrowserLauncher;
      const browser = yield* Effect.acquireRelease(launcher.launch, (instance) =>
        Effect.promise(() => instance.close()),
      );
      return yield* Effect.provideService(program, BrowserSession, { browser });
    }),
  );

/** Run-level program: ordered results, paced by the injectable clock. */
export const scrapeRun = (urls: string[], settings: ScrapeSettings = settingsFrom()) =>
  withBrowserSession(
    Effect.gen(function* () {
      const clock = yield* ScrapeClock;
      const results = [];
      for (let i = 0; i < urls.length; i++) {
        results.push(yield* Effect.either(scrapeUrl(urls[i], settings)));
        if (i < urls.length - 1) yield* clock.sleep(PACE_MS);
      }
      return results;
    }),
  );
