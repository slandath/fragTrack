import { Effect, Either } from "effect";
import type { ScrapeOutcome, Scraper, ScraperOptions } from "./model.js";
import { BrowserLauncher, BrowserSession, makeLayers, scrapeUrl, settingsFrom } from "./effect.js";

export * from "./model.js";

/**
 * Promise adapter around the Effect-shaped scraper. Effect stays behind this
 * boundary: public signatures keep their existing Promise/plain types, while
 * typed errors, scoped pages/contexts, and services live in `effect.ts`.
 *
 * One browser is acquired per run and closed by `close()` (Spec 04). Per-URL
 * pages/contexts are released by Effect scopes even on failure or timeout.
 */
export async function createScraper(options: ScraperOptions = {}): Promise<Scraper> {
  const settings = settingsFrom(options);
  const layers = makeLayers(options);

  // The browser itself is acquired here so it survives across `scrape` calls;
  // `withBrowserSession` in effect.ts is the scoped equivalent for run-level
  // callers and is covered by forced-failure tests.
  const browser = await Effect.runPromise(
    Effect.flatMap(BrowserLauncher, (launcher) => launcher.launch).pipe(Effect.provide(layers)),
  );

  const runUrl = (url: string) =>
    Effect.provideService(scrapeUrl(url, settings), BrowserSession, { browser }).pipe(
      Effect.provide(layers),
    );

  let closed = false;
  return {
    async scrape(url: string): Promise<ScrapeOutcome> {
      const result = await Effect.runPromise(Effect.either(runUrl(url)));
      if (Either.isRight(result)) return result.right;
      const failure = result.left;
      return {
        category: failure.category,
        detail: "detail" in failure ? failure.detail : failure.message,
      };
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await browser.close();
    },
  };
}
