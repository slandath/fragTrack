# Spec 07: Simplify the Retailer Model and Shared Types

## Status

Proposed

## Priority

P2 — maintainability and simplification

## Context

The retailer model currently stores more structure than the application uses. A retailer row's `name` and `url` are both populated with the URL hostname, while authoritative supported-domain and selector configuration lives in `server/scraper/configs.ts`. The client does not display retailer names or metadata, and most workflows only need the domain associated with a retailer URL.

At the same time, client and scrape-script code manually duplicate server response shapes. `client/src/components/types.ts` defines price and retailer-url types independently of the tRPC router; it already omits `scrapedAt`, even though the API returns it. `scripts/scrape.ts` manually parses tRPC envelopes and redeclares the `getUserUrls` response shape.

This is cleanup work. It should happen after the security, data-integrity, and reliability specs so simplification does not obscure higher-risk behavior changes.

## Goals

1. Remove retailer data that is purely derived from the retailer URL.
2. Keep the simplest retailer representation that supports current product behavior.
3. Replace manually duplicated API response types with tRPC-inferred types.
4. Replace handwritten tRPC envelope handling in the scrape script with a typed or shared client.
5. Remove demonstrably unused dependencies and generated UI surface.
6. Preserve all user-visible behavior unless a separate spec explicitly changes it.

## Non-goals

- Adding retailer logos, display names, affiliate metadata, or retailer settings.
- Introducing a general API SDK.
- Reorganizing every server file into a layered architecture.
- Performing this cleanup in the same change as numeric-price migration or authorization changes.

## Decision: retailer representation

Before implementation, choose one model based on current and planned use.

### Preferred model if no retailer metadata is planned

Store the retailer domain directly on `retailer_url`, for example as `retailer_domain`, and remove the separate `retailer` table.

Under this model:

- derive the domain from the validated URL at creation time;
- keep `domainConfigs` as the authority for supported domains and selectors;
- remove retailer creation and orphan-cleanup logic;
- preserve retailer URLs and price history during migration;
- update supported-domain checks to use the stored domain or derive it consistently.

### Alternative model if retailer metadata is planned soon

Keep the `retailer` table, but stop storing duplicate values:

- rename fields so their meanings are explicit, such as `domain` and optional `display_name`;
- do not populate two columns with the same hostname;
- define which retailer attributes justify the separate table;
- keep atomic retailer creation from Spec 04.

Do not keep the current table merely because it exists. Record the chosen rationale in the implementation pull request.

## Database migration requirements

If removing or changing the retailer table:

1. Add a migration that preserves every retailer URL and price record.
2. Populate the new domain field from the existing retailer relationship before removing the old foreign key or table.
3. Detect inconsistent rows where the URL hostname and retailer domain disagree.
4. Define whether the URL or existing retailer row is authoritative for inconsistent records.
5. Remove obsolete indexes, relations, and cleanup code only after all queries use the new model.
6. Verify counts of fragrances, retailer URLs, and prices before and after migration on fixture data.

## Server simplification

1. Remove `findOrCreateRetailer` and `cleanupOrphanedRetailer` if the retailer table is removed.
2. Remove retailer joins that no longer provide used fields.
3. Return only fields needed by the client and scrape script where doing so does not create an inconsistent API style.
4. Keep ownership checks explicit even if query shapes are simplified.
5. Rename `server/index.ts` or move the database client to a clearer module such as `server/db/client.ts` only if the change can be made mechanically and does not conflict with active work.
6. Consider splitting `server/trpc/router.ts` by feature only if the file remains difficult to navigate after the model cleanup. Do not split it solely to satisfy a file-size rule.

## Shared tRPC types

### Client

1. Use tRPC router inference for procedure outputs instead of manually maintaining response interfaces in `client/src/components/types.ts`.
2. Keep local types for component-only view models when they are clearer than raw API output.
3. Ensure the price view model includes:
   - amount;
   - currency;
   - retailer URL identifier;
   - `scrapedAt`.
4. Remove manual fields that merely repeat API output once inferred types are adopted.
5. Do not expose server-only types or import server implementation code into the client bundle beyond type-only imports already supported by the project setup.

### Scrape script

Choose the smallest reliable approach:

- use `@trpc/client` with the existing `AppRouter` type; or
- extract a narrow, tested HTTP helper if importing the router type creates an undesirable coupling.

The final implementation must:

1. avoid manually interpreting tRPC response envelopes;
2. avoid redeclaring the `getUserUrls` row shape;
3. preserve API URL validation and bearer-key authentication;
4. produce clear errors for HTTP and tRPC failures;
5. keep the script runnable with the repository's existing `tsx` workflow.

## Dependency and generated-code cleanup

Audit and remove only items proven unused by imports, configuration, and build behavior.

Candidates include:

- `@fastify/cors` in the root package if it remains unregistered after Spec 05;
- root `@trpc/client` if the scrape script does not adopt it and no root code imports it;
- unused generated sidebar or chart theme tokens in `client/src/index.css`, coordinated with Spec 06;
- unused UI primitives, only when repository search and build output prove they are not referenced.

Do not remove the `shadcn` package solely because components are generated; verify whether its Tailwind CSS import or tooling still requires it.

Do not remove Playwright dependencies as part of this spec. Scraper technology decisions belong to Spec 04 or a separate architecture decision.

## Documentation

Update README architecture or data-model descriptions if the retailer model changes. Keep documentation brief; do not document internal tables that no longer exist.

## Acceptance criteria

- [ ] The implementation records why the retailer table was removed or retained.
- [ ] If removed, all retailer URLs and prices survive migration with correct domains.
- [ ] Retailer creation and orphan-cleanup code are removed if no longer needed.
- [ ] Client response types are inferred from the tRPC router where practical.
- [ ] The client price type includes `scrapedAt`.
- [ ] The scrape script no longer manually parses tRPC envelopes.
- [ ] The scrape script no longer duplicates the `getUserUrls` response interface.
- [ ] Demonstrably unused candidate dependencies are removed and the lockfile is updated.
- [ ] User-visible fragrance, URL, price, and API-key behavior is unchanged.
- [ ] Existing tests pass, with new or updated tests for migrated retailer data.

## Verification

Run:

```bash
vp check
vp test
pnpm build
pnpm scrape
```

Use a test database or fixture data for migration verification. Do not use a production scrape solely to prove that type cleanup works.

Compare these counts before and after migration on fixture data:

- fragrances;
- retailer URLs;
- prices;
- distinct retailer domains.

## Dependencies

- Complete Spec 03 before changing price-related types or storage.
- Complete Spec 04 before removing retailer transaction or cleanup logic.
- Complete Spec 06 before deciding which price fields the client view model needs.
- Coordinate with Spec 05 when removing dependencies or changing package scripts.

## Risks

- Removing the retailer table is a breaking database migration and should not be combined with unrelated schema changes.
- Type-only imports from the server can accidentally pull server code into the client if configured incorrectly; verify the production bundle.
- Deleting generated UI tokens can affect components that are composed dynamically, so search and build verification are required.
