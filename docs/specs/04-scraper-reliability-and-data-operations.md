# Spec 04: Fix Scraper Reliability, Transactions, Indexes, and Duplicate Handling

## Status

Proposed

## Priority

P1 — reliability, correctness, and operational safety

## Context

The scraper launches a new Chromium browser for every URL. If navigation or extraction throws, the catch block returns without closing the browser. Selector failures are swallowed, price text is converted by stripping characters, and results are reported only as success, no price, or a generic error.

On the server side, retailer creation, URL creation, URL deletion, fragrance deletion, and orphan-retailer cleanup are multi-step operations without transactions. `retailer_url` also lacks indexes for its main foreign-key access patterns and lacks duplicate protection.

## Goals

1. Ensure every browser, context, and page is closed on success and failure.
2. Reuse browser resources safely across a scrape run.
3. Add explicit timeout, retry, and failure classification behavior.
4. Make retailer-related database operations atomic.
5. Add indexes supporting retailer-url access patterns.
6. Prevent or consistently handle duplicate retailer URLs.
7. Produce actionable per-URL and per-retailer scrape summaries.

## Non-goals

- Replacing Playwright for every retailer.
- Guaranteeing extraction when a retailer blocks automation or changes its site.
- Running the browser on the application server; scraping remains a local workflow unless a separate decision changes that architecture.
- Building a distributed job queue for a personal local scrape process.

## Scraper lifecycle requirements

1. Launch at most one browser per scrape run unless a documented retailer-specific exception requires isolation.
2. Create pages or contexts with explicit ownership and close them in `finally` blocks.
3. Close the browser in a `finally` block at the end of the run.
4. A failure for one URL must not leak resources or abort unrelated URLs unless the failure is global, such as browser launch failure.
5. Add explicit limits for:
   - navigation timeout;
   - selector wait timeout;
   - total per-URL timeout, if needed;
   - retry count and delay.
6. Do not swallow selector timeouts silently. Record the retailer, URL identifier, and failure category.
7. Avoid unbounded concurrency. If concurrency is introduced, use a small documented limit and preserve deterministic reporting.
8. Keep retailer requests paced to reduce avoidable throttling.

## Extraction requirements

1. Separate navigation from price extraction so extraction can be tested with fixtures.
2. Replace character stripping with the validated parser contract from Spec 03.
3. A page with no matching price element must be classified as `price_not_found`, not confused with a network or browser failure.
4. A page with ambiguous price text must be rejected and reported.
5. Retailer configuration should make the intended price explicit. Where a page contains sale, list, subscription, or variant prices, document which value is authoritative.
6. Do not silently use a hidden or unrelated price when multiple candidates conflict.
7. Use current browser and user-agent settings supported by the installed Playwright version. Avoid maintaining an obsolete hard-coded user-agent string unless required and documented.

## Failure taxonomy

Report at least these categories:

- `stored`;
- `price_not_found`;
- `ambiguous_price`;
- `navigation_failed`;
- `selector_timeout`;
- `browser_failed`;
- `api_failed`;
- `invalid_response`.

The scrape script should print a concise summary by category and retailer domain. It may retain the existing non-zero exit behavior when any URL fails, but the output must let the operator identify what failed without enabling verbose browser logs.

## Retry policy

1. Retry only transient navigation or network failures.
2. Use a small fixed retry limit with backoff.
3. Do not repeatedly retry a deterministic missing selector or invalid price without a delay and limit.
4. Do not store duplicate observations solely because a store request was retried after an ambiguous network outcome. If the API later supports an idempotency key or scrape-run identifier, use it.

## Database transaction requirements

### Retailer creation

- Replace separate select-then-insert logic with an atomic upsert or a transaction that safely handles concurrent creation.
- A concurrent duplicate retailer creation must return the same retailer rather than failing one request.

### Add retailer URL

- Verify fragrance ownership, validate and canonicalize the URL, resolve the retailer, and insert the retailer URL without leaving avoidable partial state.
- Coordinate duplicate behavior with Spec 03.
- If retailer creation succeeds but URL insertion fails, the transaction or cleanup behavior must be deterministic.
- Coordinate add and orphan-cleanup across one transaction or a recovery path: if cleanup commits after an add resolves a retailer but before it inserts the URL, the insert must not fail its foreign-key check. Test this interleaving rather than relying on separate transactions.

### Delete retailer URL

- Verify ownership, delete the URL, and clean up an orphaned retailer atomically or within one transaction.

### Delete fragrance

- Capture affected retailer IDs, delete the fragrance and cascaded data, and clean up orphaned retailers atomically or within one transaction.
- Duplicate retailer IDs must be processed once.

## Index and constraint requirements

Add a migration for:

1. An index supporting lookup by `retailer_url.fragrance_id`.
2. An index supporting lookup and cleanup by `retailer_url.retailer_id`.
3. The duplicate constraint or unique index required by Spec 03, using the final normalized URL representation.
4. Any additional index proven necessary by query plans for latest-price or user-URL listing.

Do not remove the existing price index on `(retailer_url_id, scraped_at desc)` unless replacing it with an equivalent or better index.

Before adding a unique constraint to existing data, detect duplicates and define a cleanup procedure that preserves price history according to an explicit operator decision.

## API interaction requirements

1. `scripts/scrape.ts` must validate that API responses have the expected shape before treating them as URL records.
2. Network, HTTP, and tRPC errors must be distinguishable in logs.
3. A failed `storePrice` request must count as failed and must not be reported as a successful scrape.
4. Keep API URL HTTPS validation from the current script.
5. Consider replacing handwritten tRPC envelope parsing with the typed client or a shared tested helper, coordinated with Spec 07.

## Acceptance criteria

- [ ] Repeated scrape runs do not accumulate Chromium processes after navigation or extraction failures.
- [ ] One browser is reused for a normal scrape run.
- [ ] Per-URL failures use the defined failure taxonomy.
- [ ] Selector timeouts and missing prices are visible in the summary.
- [ ] Retry behavior is bounded and documented.
- [ ] Concurrent retailer creation does not produce a uniqueness failure for one request.
- [ ] Add/delete retailer-url operations do not leave inconsistent retailer state after an injected failure.
- [ ] Migration adds the required retailer-url indexes.
- [ ] Duplicate retailer URLs are handled according to Spec 03.
- [ ] The scrape summary reports stored and failed counts by category.

## Verification

- Use saved HTML fixtures for extraction tests; do not depend on live retailer pages in CI.
- Force navigation and selector failures in tests or local verification to confirm browser cleanup.
- Run concurrent add-URL requests against a test database to verify retailer creation behavior.
- Run the migration against a database containing duplicate retailer URLs only after defining and testing the cleanup path.
- Verify process cleanup after a local scrape run on the development platform.

## Dependencies

- Spec 02 provides fixture, parser, and integration tests.
- Spec 03 defines numeric prices, URL canonicalization, and duplicate semantics.
- Spec 05 ensures migrations and reliability tests are exercised in CI.
- Spec 07 may simplify the scrape script's API client and shared types.

## Risks

- Retailer sites can change selectors or block automation without notice.
- Reusing one browser can leak state between retailers if contexts and cookies are not isolated correctly.
- Existing duplicate data may block a new unique constraint until cleaned up.
