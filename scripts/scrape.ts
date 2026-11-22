import { config } from "dotenv";
import { createTRPCClient, httpLink } from "@trpc/client";
import { Effect } from "effect";
import { createScraper, delay } from "../server/scraper/index.js";
import type { AppRouter } from "../server/trpc/router.js";
import { HttpFailure, runScrape, validateApiUrl, type ScrapeDeps } from "./scrape-core.js";

config();

const API_URL = process.env.API_URL;
const API_KEY = process.env.API_KEY;

if (!API_URL || !API_KEY) {
  console.error("Missing API_URL or API_KEY in .env");
  process.exit(1);
}

const validatedApiUrl = validateApiUrl(API_URL);

const trpc = createTRPCClient<AppRouter>({
  links: [
    httpLink({
      url: `${validatedApiUrl}/trpc`,
      headers: () => ({ Authorization: `Bearer ${API_KEY}` }),
      // Capture HTTP failures with non-JSON bodies (e.g. an HTML 502 page)
      // before tRPC tries to parse them, so the status reaches the typed error.
      fetch: async (url, init) => {
        const res = await fetch(url, init);
        if (!res.ok && !(res.headers.get("content-type") ?? "").includes("application/json")) {
          // Release the error body so repeated gateway failures cannot pin
          // connections open; the HTTP status below is what matters.
          try {
            await res.body?.cancel();
          } catch {
            // Best-effort: a failed cancel must not replace the HttpFailure.
          }
          throw new HttpFailure({ path: "", message: `HTTP ${res.status}`, status: res.status });
        }
        return res;
      },
    }),
  ],
});

const deps: ScrapeDeps = {
  getUserUrls: () => trpc.getUserUrls.query(),
  storePrice: async (input) => {
    await trpc.storePrice.mutate(input);
  },
  launchScraper: () => createScraper(),
  sleep: delay,
  write: (line) => process.stdout.write(line),
  writeError: (line) => process.stderr.write(line),
};

// Enter the Effect runtime exactly once, at the CLI boundary.
Effect.runPromise(runScrape(deps)).then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
