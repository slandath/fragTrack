import { config } from "dotenv";
import { z } from "zod";
import { createScraper, type ScrapeCategory } from "../server/scraper/index.js";

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

type ApiErrorKind = "network" | "http" | "trpc" | "invalid_response";

class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function formatError(error: unknown): string {
  if (error instanceof ApiError) return `${error.kind}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

const trpcEnvelopeSchema = z.object({
  error: z
    .object({
      message: z.string().optional(),
      data: z.object({ code: z.string().optional() }).optional(),
    })
    .optional(),
  result: z.object({ data: z.unknown() }).optional(),
});

/** Parse and validate a tRPC envelope; distinguish transport, HTTP, and tRPC failures. */
export async function readTrpcResponse(res: Response, path: string): Promise<unknown> {
  let json: unknown;
  let isJson = true;
  try {
    json = await res.json();
  } catch {
    isJson = false;
  }
  if (!isJson) {
    // A non-JSON body on a failed request (e.g. an HTML 502 page) is an
    // HTTP failure; only a malformed body on a 2xx response is an envelope
    // problem. This preserves res.status for operator logs.
    if (!res.ok) throw new ApiError("http", `${path}: HTTP ${res.status}`);
    throw new ApiError("invalid_response", `${path}: response body was not JSON`);
  }

  const parsed = trpcEnvelopeSchema.safeParse(Array.isArray(json) ? json[0] : json);
  if (!parsed.success) {
    throw new ApiError("invalid_response", `${path}: unexpected tRPC envelope`);
  }
  const payload = parsed.data;
  if (payload.error) {
    const code = payload.error.data?.code ? ` (${payload.error.data.code})` : "";
    throw new ApiError("trpc", `${path}: ${payload.error.message ?? "tRPC error"}${code}`);
  }
  if (!res.ok) throw new ApiError("http", `${path}: HTTP ${res.status}`);
  if (!payload.result) throw new ApiError("invalid_response", `${path}: missing result`);
  return payload.result.data;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  try {
    const res = await fetch(`${validatedApiUrl}/trpc/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${API_KEY}`, ...init?.headers },
    });
    return await readTrpcResponse(res, path);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("network", `${path}: ${(error as Error).message}`);
  }
}

function trpcQuery(path: string) {
  return request(path);
}

function trpcMutate(path: string, input: Record<string, unknown>) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

const userUrlsSchema = z.array(
  z.object({
    retailer_url: z.object({ id: z.string().min(1), url: z.string().min(1) }),
    fragrance: z.object({ brand: z.string(), name: z.string() }),
  }),
);
const storePriceResultSchema = z.object({ id: z.string().min(1) });

function domainOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let urls: z.infer<typeof userUrlsSchema>;
  try {
    const parsed = userUrlsSchema.safeParse(await trpcQuery("getUserUrls"));
    if (!parsed.success) {
      throw new ApiError("invalid_response", "getUserUrls: unexpected row shape");
    }
    urls = parsed.data;
  } catch (error) {
    console.error(`api_failed: could not load scrape targets — ${formatError(error)}`);
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
    for (const { retailer_url } of urls) record("browser_failed", domainOf(retailer_url.url));
    printSummary(counts, byDomain);
    process.exitCode = 1;
    return;
  }

  try {
    for (let i = 0; i < urls.length; i++) {
      const { retailer_url, fragrance } = urls[i];
      const domain = domainOf(retailer_url.url);
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
          const result = await trpcMutate("storePrice", {
            retailerUrlId: retailer_url.id,
            amountMinor: outcome.amountMinor,
            currency: outcome.currency,
          });
          if (!storePriceResultSchema.safeParse(result).success) {
            record("invalid_response", domain);
            console.log("invalid_response (storePrice returned an unexpected shape)");
          } else {
            record("stored", domain);
            console.log(`stored $${(outcome.amountMinor / 100).toFixed(2)}`);
          }
        } catch (error) {
          const category =
            error instanceof ApiError && error.kind === "invalid_response"
              ? "invalid_response"
              : "api_failed";
          record(category, domain);
          console.log(`${category}: ${formatError(error)}`);
        }
      }

      if (i < urls.length - 1) await delay(PACE_MS);
    }
  } finally {
    await scraper.close();
  }

  printSummary(counts, byDomain);
  const failed = [...counts].reduce(
    (sum, [category, count]) => sum + (category === "stored" ? 0 : count),
    0,
  );
  if (failed > 0) process.exitCode = 1;
}

function printSummary(
  counts: Map<ScrapeCategory, number>,
  byDomain: Map<string, { stored: number; failed: number }>,
) {
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
