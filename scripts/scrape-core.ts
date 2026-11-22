import { TRPCClientError } from "@trpc/client";
import { Data, Duration, Effect, Either, Schedule, Schema } from "effect";
import type { ScrapeCategory, ScrapeOutcome } from "../server/scraper/index.js";
import { formatPrice } from "../client/src/lib/price.js";

/** Operator-facing pacing between URLs (Spec 04). */
export const PACE_MS = 250;
export const REQUEST_TIMEOUT = Duration.seconds(10);

/** Named, capped retry policy for transient API calls: 3 attempts total. */
export const API_RETRY_ATTEMPTS = 2;
export const API_RETRY_BASE_MS = 500;
export const apiRetrySchedule = (baseMs = API_RETRY_BASE_MS) =>
  Schedule.intersect(
    Schedule.exponential(Duration.millis(baseMs), 2),
    Schedule.recurs(API_RETRY_ATTEMPTS),
  );
export const API_RETRY_SCHEDULE = apiRetrySchedule();

// Typed failures for the scrape CLI. Each carries the operator-facing detail
// the old ApiError kinds carried; `formatFailure` adds the stable prefix.
export class NetworkFailure extends Data.TaggedError("NetworkFailure")<{
  path: string;
  message: string;
}> {}
export class HttpFailure extends Data.TaggedError("HttpFailure")<{
  path: string;
  message: string;
  status?: number;
  code?: string;
}> {}
export class TrpcFailure extends Data.TaggedError("TrpcFailure")<{
  path: string;
  message: string;
  code?: string;
}> {}
export class InvalidResponse extends Data.TaggedError("InvalidResponse")<{
  path: string;
  message: string;
}> {}
export class BrowserLaunchFailure extends Data.TaggedError("BrowserLaunchFailure")<{
  message: string;
}> {}

export type ApiFailure = NetworkFailure | HttpFailure | TrpcFailure | InvalidResponse;

/**
 * Only transport-level failures are transient. Deterministic tRPC and shape
 * errors are not, and neither are known client-side HTTP failures (4xx):
 * retrying a 401/404 cannot change the outcome and only adds load.
 */
export const isTransient = (error: ApiFailure): boolean => {
  if (error._tag === "NetworkFailure") return true;
  if (error._tag !== "HttpFailure") return false;
  const { status } = error;
  return (
    status === undefined || // gateway/transport failure with no HTTP status
    status === 408 || // request timeout
    status === 429 || // rate limited
    status >= 500 // server-side failure
  );
};

const FAILURE_KIND: Record<ApiFailure["_tag"], string> = {
  NetworkFailure: "network",
  HttpFailure: "http",
  TrpcFailure: "trpc",
  InvalidResponse: "invalid_response",
};

export function formatFailure(error: ApiFailure): string {
  return `${FAILURE_KIND[error._tag]}: ${error.path}: ${error.message}`;
}

/**
 * Translate an unknown thrown value into a typed failure without changing the
 * operator-facing text. HTTP status must survive even when tRPC parses an HTML
 * gateway page first — the custom fetch throws HttpFailure before that happens.
 */
export function toApiFailure(error: unknown, path: string): ApiFailure {
  if (error instanceof HttpFailure) {
    return new HttpFailure({
      path,
      message: error.message,
      status: error.status,
      code: error.code,
    });
  }
  if (
    error instanceof NetworkFailure ||
    error instanceof TrpcFailure ||
    error instanceof InvalidResponse
  ) {
    return error;
  }
  if (error instanceof TRPCClientError) {
    if (error.cause instanceof HttpFailure) {
      // tRPC may wrap the gateway failure thrown by the custom fetch. Carry
      // the status/code through so the retry policy can classify it.
      return new HttpFailure({
        path,
        message: error.cause.message,
        status: error.cause.status,
        code: error.cause.code,
      });
    }
    const status = error.data?.httpStatus;
    const data = error.data?.code;
    const code = typeof data === "string" ? data : undefined;
    const suffix = code ? ` (${code})` : "";
    if (typeof status === "number") {
      return new HttpFailure({
        path,
        status,
        code,
        message: `HTTP ${status}${suffix}: ${error.message}`,
      });
    }
    return new TrpcFailure({ path, code, message: `${error.message}${suffix}` });
  }
  return new NetworkFailure({
    path,
    message: error instanceof Error ? error.message : String(error),
  });
}

/** Keep API_URL semantics (HTTPS, loopback HTTP exception) identical to Spec 04. */
export function validateApiUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("API_URL must be a valid URL");
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1" ||
    url.hostname.startsWith("127.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("API_URL must use HTTPS unless it points to a loopback host");
  }
  return value.replace(/\/$/, "");
}

/**
 * Effect Schema owns the scrape CLI's response shape. tRPC's typed client
 * decodes the envelope (Spec 07); this validates the payload the script reads.
 */
export const ScrapeTarget = Schema.Struct({
  retailer_url: Schema.Struct({
    id: Schema.String,
    url: Schema.String,
    retailerDomain: Schema.String,
  }),
  fragrance: Schema.Struct({ brand: Schema.String, name: Schema.String }),
});
export const ScrapeTargets = Schema.Array(ScrapeTarget);
export type ScrapeTarget = typeof ScrapeTarget.Type;

export interface ScraperLike {
  scrape(url: string): Promise<ScrapeOutcome>;
  close(): Promise<void>;
}

/** All boundaries are injectable so tests never open a browser or hit the API. */
export interface ScrapeDeps {
  getUserUrls(): Promise<unknown>;
  storePrice(input: {
    retailerUrlId: string;
    amountMinor: number;
    currency: string;
  }): Promise<void>;
  launchScraper(): Promise<ScraperLike>;
  sleep(ms: number): Promise<void>;
  write(line: string): void;
  writeError(line: string): void;
  /** Test-only override so retry assertions never wait on real backoff. */
  retryBaseMs?: number;
}

const fetchTargets = (deps: ScrapeDeps) =>
  Effect.tryPromise({
    try: () => deps.getUserUrls(),
    catch: (error) => toApiFailure(error, "getUserUrls"),
  }).pipe(
    Effect.timeoutFail({
      duration: REQUEST_TIMEOUT,
      onTimeout: () => new NetworkFailure({ path: "getUserUrls", message: "request timeout" }),
    }),
    Effect.flatMap((raw) =>
      Schema.decodeUnknown(ScrapeTargets)(raw).pipe(
        Effect.mapError(
          () => new InvalidResponse({ path: "getUserUrls", message: "unexpected response shape" }),
        ),
      ),
    ),
    Effect.retry({ schedule: apiRetrySchedule(deps.retryBaseMs), while: isTransient }),
  );

/** No retry: a store after an ambiguous network outcome could double-insert. */
const storeTarget = (deps: ScrapeDeps, input: Parameters<ScrapeDeps["storePrice"]>[0]) =>
  Effect.tryPromise({
    try: () => deps.storePrice(input),
    catch: (error) => toApiFailure(error, "storePrice"),
  }).pipe(
    Effect.timeoutFail({
      duration: REQUEST_TIMEOUT,
      onTimeout: () => new NetworkFailure({ path: "storePrice", message: "request timeout" }),
    }),
  );

export function summaryText(
  counts: Map<ScrapeCategory, number>,
  byDomain: Map<string, { stored: number; failed: number }>,
): { text: string; failed: number } {
  const lines: string[] = ["\nSummary by category:"];
  for (const [category, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${category}: ${count}`);
  }
  lines.push("By retailer domain:");
  for (const [domain, stats] of [...byDomain].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${domain}: ${stats.stored} stored, ${stats.failed} failed`);
  }
  const stored = counts.get("stored") ?? 0;
  const failed = [...counts].reduce(
    (sum, [category, count]) => sum + (category === "stored" ? 0 : count),
    0,
  );
  lines.push(`\nDone: ${stored} observations stored, ${failed} failed.\n`);
  return { text: lines.map((line) => `${line}\n`).join(""), failed };
}

/** The whole CLI program. Never fails: it returns the process exit code. */
export const runScrape = (deps: ScrapeDeps): Effect.Effect<number> =>
  Effect.gen(function* () {
    const targetsResult = yield* Effect.either(fetchTargets(deps));
    if (Either.isLeft(targetsResult)) {
      deps.writeError(
        `api_failed: could not load scrape targets — ${formatFailure(targetsResult.left)}\n`,
      );
      return 1;
    }
    const targets = targetsResult.right;

    deps.write(`\nScraping ${targets.length} URLs...\n`);

    const counts = new Map<ScrapeCategory, number>();
    const byDomain = new Map<string, { stored: number; failed: number }>();
    const record = (category: ScrapeCategory, domain: string) => {
      counts.set(category, (counts.get(category) ?? 0) + 1);
      const stats = byDomain.get(domain) ?? { stored: 0, failed: 0 };
      if (category === "stored") stats.stored++;
      else stats.failed++;
      byDomain.set(domain, stats);
    };

    const run = Effect.scoped(
      Effect.gen(function* () {
        // One browser per run; acquireRelease guarantees close on success,
        // typed failure, timeout, and interruption (Spec 04 / house rules).
        const scraper = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () => deps.launchScraper(),
            catch: (error) =>
              new BrowserLaunchFailure({
                message: error instanceof Error ? error.message : String(error),
              }),
          }),
          (instance) => Effect.promise(() => instance.close()),
        );

        for (let i = 0; i < targets.length; i++) {
          const { retailer_url, fragrance } = targets[i];
          const id = retailer_url.id;
          deps.write(
            `[${i + 1}/${targets.length}] ${fragrance.brand} - ${fragrance.name} [${id}]... `,
          );

          const scraped = yield* Effect.either(
            Effect.tryPromise({
              try: () => scraper.scrape(retailer_url.url),
              catch: (error) =>
                new NetworkFailure({
                  path: "scrape",
                  message: error instanceof Error ? error.message : String(error),
                }),
            }),
          );
          const outcome: ScrapeOutcome = Either.isLeft(scraped)
            ? { category: "browser_failed", detail: scraped.left.message }
            : scraped.right;

          if (outcome.category !== "ok") {
            record(outcome.category, retailer_url.retailerDomain);
            const logged = outcome.detail
              ? `${outcome.category} (${outcome.detail})`
              : outcome.category;
            deps.write(`${logged} [${id}]\n`);
          } else {
            const stored = yield* Effect.either(
              storeTarget(deps, {
                retailerUrlId: id,
                amountMinor: outcome.amountMinor,
                currency: outcome.currency,
              }),
            );
            if (Either.isLeft(stored)) {
              record("api_failed", retailer_url.retailerDomain);
              deps.write(`api_failed: ${formatFailure(stored.left)}\n`);
            } else {
              record("stored", retailer_url.retailerDomain);
              deps.write(`stored ${formatPrice(outcome.amountMinor, outcome.currency)}\n`);
            }
          }

          if (i < targets.length - 1) yield* Effect.promise(() => deps.sleep(PACE_MS));
        }
      }),
    );

    const runResult = yield* Effect.either(run);
    if (Either.isLeft(runResult)) {
      // Only browser launch (or a release failure) can escape the loop.
      deps.writeError(`browser_failed: could not launch browser — ${runResult.left.message}\n`);
      for (const { retailer_url } of targets) record("browser_failed", retailer_url.retailerDomain);
    }

    const summary = summaryText(counts, byDomain);
    deps.write(summary.text);
    return summary.failed > 0 || Either.isLeft(runResult) ? 1 : 0;
  });
