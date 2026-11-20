import { config } from "dotenv";
import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import { createScraper, delay, type ScrapeCategory } from "../server/scraper/index.js";
import type { AppRouter, RouterOutputs } from "../server/trpc/router.js";
import { formatPrice } from "../client/src/lib/price.js";

config();

const API_URL = process.env.API_URL;
const API_KEY = process.env.API_KEY;

const PACE_MS = 250;

if (!API_URL || !API_KEY) {
  console.error("Missing API_URL or API_KEY in .env");
  process.exit(1);
}

function validateApiUrl(value: string) {
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

const validatedApiUrl = validateApiUrl(API_URL);

type ApiErrorKind = "network" | "http" | "trpc";

class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// The typed client decodes tRPC envelopes for us. We only translate its
// errors into operator-facing messages that distinguish HTTP, tRPC, and
// transport failures.
function toApiError(error: unknown, path: string): ApiError {
  if (error instanceof TRPCClientError) {
    // tRPC parses the body before checking the response status, so a gateway
    // HTML error page never reaches `data.httpStatus`. The custom fetch below
    // throws an ApiError with the status first; recover it from the cause.
    if (error.cause instanceof ApiError) {
      return new ApiError(error.cause.kind, `${path}: ${error.cause.message}`);
    }
    const status = error.data?.httpStatus;
    const code = error.data?.code ? ` (${error.data.code})` : "";
    if (typeof status === "number") {
      return new ApiError("http", `${path}: HTTP ${status}${code}: ${error.message}`);
    }
    return new ApiError("trpc", `${path}: ${error.message}${code}`);
  }
  return new ApiError(
    "network",
    `${path}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

function formatError(error: unknown): string {
  if (error instanceof ApiError) return `${error.kind}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

const trpc = createTRPCClient<AppRouter>({
  links: [
    httpLink({
      url: `${validatedApiUrl}/trpc`,
      headers: () => ({ Authorization: `Bearer ${API_KEY}` }),
      // Capture HTTP failures with non-JSON bodies (e.g. an HTML 502 page)
      // before tRPC tries to parse them, so the status reaches toApiError.
      fetch: async (url, init) => {
        const res = await fetch(url, init);
        if (!res.ok && !(res.headers.get("content-type") ?? "").includes("application/json")) {
          // Release the error body so repeated gateway failures cannot pin
          // connections open; the HTTP status below is what matters.
          try {
            await res.body?.cancel();
          } catch {
            // Best-effort: a failed cancel must not replace the ApiError.
          }
          throw new ApiError("http", `HTTP ${res.status}`);
        }
        return res;
      },
    }),
  ],
});

async function main() {
  let urls: RouterOutputs["getUserUrls"];
  try {
    urls = await trpc.getUserUrls.query();
  } catch (error) {
    console.error(
      `api_failed: could not load scrape targets — ${formatError(toApiError(error, "getUserUrls"))}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nScraping ${urls.length} URLs...\n`);

  const counts = new Map<ScrapeCategory, number>();
  const byDomain = new Map<string, { stored: number; failed: number }>();
  function record(category: ScrapeCategory, domain: string) {
    counts.set(category, (counts.get(category) ?? 0) + 1);
    const stats = byDomain.get(domain) ?? { stored: 0, failed: 0 };
    if (category === "stored") stats.stored++;
    else stats.failed++;
    byDomain.set(domain, stats);
  }

  let scraper;
  try {
    scraper = await createScraper();
  } catch (error) {
    // Browser launch is a global failure: no per-URL work can proceed.
    console.error(`browser_failed: could not launch browser — ${formatError(error)}`);
    for (const { retailer_url } of urls) record("browser_failed", retailer_url.retailerDomain);
    printSummary(counts, byDomain);
    process.exitCode = 1;
    return;
  }

  try {
    for (let i = 0; i < urls.length; i++) {
      const { retailer_url, fragrance } = urls[i];
      const domain = retailer_url.retailerDomain;
      // The bracketed id identifies the target when several URLs share a
      // fragrance and retailer; failure lines repeat it (Spec 04).
      process.stdout.write(
        `[${i + 1}/${urls.length}] ${fragrance.brand} - ${fragrance.name} [${retailer_url.id}]... `,
      );

      const outcome = await scraper.scrape(retailer_url.url);
      if (outcome.category !== "ok") {
        record(outcome.category, domain);
        const logged = outcome.detail
          ? `${outcome.category} (${outcome.detail})`
          : outcome.category;
        console.log(`${logged} [${retailer_url.id}]`);
      } else {
        try {
          // storePrice is intentionally not retried: a retry after an
          // ambiguous network outcome could insert a duplicate observation.
          await trpc.storePrice.mutate({
            retailerUrlId: retailer_url.id,
            amountMinor: outcome.amountMinor,
            currency: outcome.currency,
          });
          record("stored", domain);
          console.log(`stored ${formatPrice(outcome.amountMinor, outcome.currency)}`);
        } catch (error) {
          record("api_failed", domain);
          console.log(`api_failed: ${formatError(toApiError(error, "storePrice"))}`);
        }
      }

      if (i < urls.length - 1) await delay(PACE_MS);
    }
  } finally {
    await scraper.close();
  }

  const failed = printSummary(counts, byDomain);
  if (failed > 0) process.exitCode = 1;
}

function printSummary(
  counts: Map<ScrapeCategory, number>,
  byDomain: Map<string, { stored: number; failed: number }>,
): number {
  console.log("\nSummary by category:");
  for (const [category, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${category}: ${count}`);
  }
  console.log("By retailer domain:");
  for (const [domain, stats] of [...byDomain].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${domain}: ${stats.stored} stored, ${stats.failed} failed`);
  }
  const stored = counts.get("stored") ?? 0;
  const failed = [...counts].reduce(
    (sum, [category, count]) => sum + (category === "stored" ? 0 : count),
    0,
  );
  console.log(`\nDone: ${stored} observations stored, ${failed} failed.\n`);
  return failed;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
