import { Effect, Either, Exit, Scope } from "effect";
import type { ScrapeOutcome, Scraper, ScraperOptions } from "./model.js";
import { BrowserLauncher, BrowserSession, makeLayers, scrapeUrl, settingsFrom } from "./effect.js";

export * from "./model.js";

/**
 * Promise adapter around the Effect-shaped scraper. Effect stays behind this
 * boundary: public signatures keep their existing Promise/plain types, while
 * typed errors, scoped pages/contexts, and services live in `effect.ts`.
 *
 * One browser is acquired per run and closed by `close()` (Spec 04). It is
 * acquired into a real `Scope` — the same scoped-resource path as
 * `withBrowserSession` — so release is guaranteed when that scope closes,
 * including on failure and interruption. The scope stays open across
 * `scrape()` calls because the Promise API must remain stateful.
 */
export async function createScraper(options: ScraperOptions = {}): Promise<Scraper> {
  const settings = settingsFrom(options);
  const layers = makeLayers(options);

  const scope = await Effect.runPromise(Scope.make());
  const browser = await Effect.runPromise(
    Effect.acquireRelease(
      Effect.flatMap(BrowserLauncher, (launcher) => launcher.launch),
      (instance) => Effect.promise(() => instance.close()),
    ).pipe(Effect.provide(layers), Scope.extend(scope)),
  ).catch(async (error: unknown) => {
    // Nothing was acquired, but the scope itself still needs closing.
    await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));
    throw error;
  });

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
      await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));
    },
  };
}
