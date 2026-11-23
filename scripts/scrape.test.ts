import { TRPCClientError } from "@trpc/client";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  HttpFailure,
  NetworkFailure,
  TrpcFailure,
  formatFailure,
  isTransient,
  runScrape,
  summaryText,
  toApiFailure,
  validateApiUrl,
  type ScrapeDeps,
  type ScraperLike,
} from "./scrape-core.js";

const target = {
  retailer_url: {
    id: "url-1",
    url: "https://fragrancex.com/p/1",
    retailerDomain: "fragrancex.com",
  },
  fragrance: { brand: "Brand", name: "Name" },
};

function trpcError(message: string, data: Record<string, unknown>) {
  return new TRPCClientError(message, {
    result: { error: { code: -32603, message, data } } as never,
  });
}

function harness(overrides: Partial<ScrapeDeps> = {}) {
  const calls = {
    getUserUrls: 0,
    storePrice: 0,
    launches: 0,
    closes: 0,
    scrapes: 0,
    sleeps: 0,
  };
  let out = "";
  let err = "";
  const scraper: ScraperLike = {
    scrape: async () => {
      calls.scrapes++;
      return { category: "ok", amountMinor: 2499, currency: "USD" };
    },
    close: async () => {
      calls.closes++;
    },
  };
  const deps: ScrapeDeps = {
    getUserUrls: async () => {
      calls.getUserUrls++;
      return [target];
    },
    storePrice: async () => {
      calls.storePrice++;
    },
    launchScraper: async () => {
      calls.launches++;
      return scraper;
    },
    sleep: async () => {
      calls.sleeps++;
    },
    write: (line) => {
      out += line;
    },
    writeError: (line) => {
      err += line;
    },
    retryBaseMs: 0,
    ...overrides,
  };
  return {
    deps,
    calls,
    scraper,
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

describe("typed scrape CLI failures", () => {
  it("classifies network, HTTP, tRPC and gateway failures with stable text", () => {
    expect(formatFailure(toApiFailure(new Error("connect ECONNREFUSED"), "getUserUrls"))).toBe(
      "network: getUserUrls: connect ECONNREFUSED",
    );

    const http = toApiFailure(
      trpcError("boom", { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 }),
      "getUserUrls",
    );
    expect(http).toBeInstanceOf(HttpFailure);
    expect(formatFailure(http)).toBe("http: getUserUrls: HTTP 500 (INTERNAL_SERVER_ERROR): boom");

    const deterministic = toApiFailure(trpcError("nope", { code: "NOT_FOUND" }), "storePrice");
    expect(deterministic).toBeInstanceOf(TrpcFailure);
    expect(formatFailure(deterministic)).toBe("trpc: storePrice: nope (NOT_FOUND)");

    const gateway = new HttpFailure({ path: "", message: "HTTP 502", status: 502 });
    const wrapped = toApiFailure(
      new TRPCClientError("Unexpected token", { cause: gateway }),
      "getUserUrls",
    );
    expect(formatFailure(wrapped)).toBe("http: getUserUrls: HTTP 502");
    // A tRPC-wrapped gateway failure must keep its status so retry classification works.
    expect(wrapped).toMatchObject({ status: 502 });
    expect(isTransient(wrapped)).toBe(true);
  });

  it("classifies a rejected fetch without HTTP response data as retryable network failure", () => {
    const fetchRejection = new TRPCClientError("fetch failed", {
      cause: new TypeError("fetch failed"),
    });
    const classified = toApiFailure(fetchRejection, "getUserUrls");

    expect(classified).toBeInstanceOf(NetworkFailure);
    expect(formatFailure(classified)).toBe("network: getUserUrls: fetch failed");
    expect(isTransient(classified)).toBe(true);
  });

  it("classifies only transport and transient HTTP failures as retryable", () => {
    expect(isTransient(new HttpFailure({ path: "p", message: "HTTP 401", status: 401 }))).toBe(
      false,
    );
    expect(isTransient(new HttpFailure({ path: "p", message: "HTTP 404", status: 404 }))).toBe(
      false,
    );
    expect(isTransient(new HttpFailure({ path: "p", message: "HTTP 503", status: 503 }))).toBe(
      true,
    );
    expect(isTransient(new HttpFailure({ path: "p", message: "HTTP 429", status: 429 }))).toBe(
      true,
    );
    expect(isTransient(new HttpFailure({ path: "p", message: "gateway" }))).toBe(true);
  });

  it("keeps API_URL validation semantics", () => {
    expect(validateApiUrl("https://Example.com/")).toBe("https://Example.com");
    expect(validateApiUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(() => validateApiUrl("http://example.com")).toThrow(/HTTPS/);
    expect(() => validateApiUrl("not a url")).toThrow(/valid URL/);
  });
});

describe("scrape CLI effect program", () => {
  it("retries transient fetch failures up to the named cap, then succeeds", async () => {
    let attempts = 0;
    const h = harness({
      getUserUrls: async () => {
        attempts++;
        if (attempts < 3) throw new Error("ECONNRESET");
        return [target];
      },
    });

    expect(await Effect.runPromise(runScrape(h.deps))).toBe(0);
    expect(attempts).toBe(3);
    expect(h.calls.scrapes).toBe(1);
    expect(h.out).toContain("stored $24.99");
    expect(h.out).toContain("Done: 1 observations stored, 0 failed.");
    expect(h.calls.closes).toBe(1);
  });

  it("retries a rejected fetch up to the named cap", async () => {
    let attempts = 0;
    const h = harness({
      getUserUrls: async () => {
        attempts++;
        if (attempts < 3) {
          throw new TRPCClientError("fetch failed", { cause: new TypeError("fetch failed") });
        }
        return [target];
      },
    });

    expect(await Effect.runPromise(runScrape(h.deps))).toBe(0);
    expect(attempts).toBe(3);
  });

  it("does not retry deterministic HTTP 4xx failures", async () => {
    let attempts = 0;
    const h = harness({
      getUserUrls: async () => {
        attempts++;
        throw new HttpFailure({ path: "", message: "HTTP 401", status: 401 });
      },
    });

    expect(await Effect.runPromise(runScrape(h.deps))).toBe(1);
    expect(attempts).toBe(1);
    expect(h.err).toContain(
      "api_failed: could not load scrape targets — http: getUserUrls: HTTP 401",
    );
  });

  it("retries transient HTTP 5xx failures up to the named cap", async () => {
    let attempts = 0;
    const h = harness({
      getUserUrls: async () => {
        attempts++;
        if (attempts < 3) throw new HttpFailure({ path: "", message: "HTTP 503", status: 503 });
        return [target];
      },
    });

    expect(await Effect.runPromise(runScrape(h.deps))).toBe(0);
    expect(attempts).toBe(3);
  });

  it("does not retry deterministic tRPC failures", async () => {
    let attempts = 0;
    const h = harness({
      getUserUrls: async () => {
        attempts++;
        throw trpcError("nope", { code: "NOT_FOUND" });
      },
    });

    expect(await Effect.runPromise(runScrape(h.deps))).toBe(1);
    expect(attempts).toBe(1);
    expect(h.err).toContain(
      "api_failed: could not load scrape targets — trpc: getUserUrls: nope (NOT_FOUND)",
    );
    expect(h.calls.launches).toBe(0);
  });

  it("reports an invalid response shape as invalid_response without retrying", async () => {
    let attempts = 0;
    const h = harness({
      getUserUrls: async () => {
        attempts++;
        return { unexpected: true };
      },
    });

    expect(await Effect.runPromise(runScrape(h.deps))).toBe(1);
    expect(attempts).toBe(1);
    expect(h.err).toContain("invalid_response: getUserUrls: unexpected response shape");
  });

  it("never retries a store failure", async () => {
    const h = harness({
      storePrice: async () => {
        h.calls.storePrice++;
        throw new Error("network down");
      },
    });

    expect(await Effect.runPromise(runScrape(h.deps))).toBe(1);
    expect(h.calls.storePrice).toBe(1);
    expect(h.out).toContain("api_failed: network: storePrice: network down");
    expect(h.out).toContain("Done: 0 observations stored, 1 failed.");
  });

  it("records a browser launch failure per URL and still prints the summary", async () => {
    const h = harness({
      launchScraper: async () => {
        throw new Error("no chromium");
      },
    });

    expect(await Effect.runPromise(runScrape(h.deps))).toBe(1);
    expect(h.err).toContain("browser_failed: could not launch browser — no chromium");
    expect(h.out).toContain("  browser_failed: 1");
    expect(h.out).toContain("fragrancex.com: 0 stored, 1 failed");
    expect(h.calls.closes).toBe(0);
  });

  it("releases the scoped browser on a forced scrape failure", async () => {
    const h = harness();
    h.scraper.scrape = async () => {
      throw new Error("page crashed");
    };

    expect(await Effect.runPromise(runScrape(h.deps))).toBe(1);
    expect(h.calls.closes).toBe(1);
    expect(h.out).toContain("browser_failed (page crashed)");
  });

  it("paces between URLs but not after the last one", async () => {
    const two = [target, { ...target, retailer_url: { ...target.retailer_url, id: "url-2" } }];
    const h = harness({ getUserUrls: async () => two });

    expect(await Effect.runPromise(runScrape(h.deps))).toBe(0);
    expect(h.calls.sleeps).toBe(1);
  });
});

describe("operator summary", () => {
  it("keeps the Spec 04 summary format", () => {
    const counts = new Map<"stored" | "api_failed", number>([
      ["stored", 2],
      ["api_failed", 1],
    ]);
    const byDomain = new Map([
      ["b.com", { stored: 0, failed: 1 }],
      ["a.com", { stored: 2, failed: 0 }],
    ]);

    expect(summaryText(counts, byDomain)).toEqual({
      text: "\nSummary by category:\n  api_failed: 1\n  stored: 2\nBy retailer domain:\n  a.com: 2 stored, 0 failed\n  b.com: 0 stored, 1 failed\n\nDone: 2 observations stored, 1 failed.\n\n",
      failed: 1,
    });
  });
});
