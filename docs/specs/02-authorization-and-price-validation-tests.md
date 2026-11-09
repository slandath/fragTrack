# Spec 02: Add Authorization, API-Key, and Price-Validation Tests

## Status

Proposed

## Priority

P0 — regression prevention

## Context

Before this spec the repository had no tracked automated tests: `vp test` reported that no test files exist, and CI only ran lint and build. This spec adds the foundation — unit tests for API-key scope, TLS configuration, key utilities, and scraper price-text fixtures, plus disposable-database integration tests for user isolation and API-key lifecycle. The remaining work is the final price-validation and parser coverage defined by Specs 03 and 04, and CI wiring defined by Spec 05. The highest-risk behavior—a user isolation boundary, API-key authentication, banned-user handling, and price writes—can therefore no longer change without an automated failure.

This spec establishes the smallest useful automated test foundation for the project. It is not a mandate for exhaustive coverage.

## Goals

1. Add a test runner and scripts that work with the existing Vite+/pnpm workspace.
2. Prove that users cannot access or mutate another user's data.
3. Prove that API keys obey expiry, revocation, hash, ban, and scope rules.
4. Prove that invalid prices cannot be stored.
5. Prove that scraper price parsing accepts valid prices and rejects ambiguous values.
6. Make the relevant tests runnable locally and in CI.

## Non-goals

- Achieving a fixed percentage-coverage target.
- Replacing all manual QA.
- Adding browser end-to-end tests for every page.
- Testing third-party retailer availability or live retailer markup.

## Test layers

### Unit tests

Add fast tests for pure or nearly pure modules, including:

- `server/utils/api-key.ts`:
  - generated keys parse successfully;
  - generated hashes match;
  - malformed keys are rejected;
  - legacy keys follow the documented compatibility behavior;
  - hash comparison rejects different-length and different-value hashes safely.
- Environment-independent URL and price validation helpers introduced by Spec 03.
- Scraper price-text parsing introduced by Spec 04:
  - `$24.99` parses as the expected amount;
  - `$1,299.99` parses correctly;
  - currency-prefixed and currency-suffixed values behave as documented;
  - price ranges are rejected or handled according to the final parser contract;
  - empty, alphabetic, and multi-decimal values are rejected.

### API and authorization integration tests

Use the real tRPC router and context-building logic with a disposable test database or a carefully controlled database fake. Prefer a disposable PostgreSQL database because authorization and uniqueness behavior depends on SQL joins and constraints.

Create at least two users and data owned by each user. Cover:

1. Unauthenticated requests to protected procedures fail.
2. User A can read User A's fragrances, retailer URLs, latest prices, and API-key metadata.
3. User A cannot:
   - read User B's data through list procedures;
   - add a retailer URL to User B's fragrance;
   - store a price for User B's retailer URL;
   - delete User B's fragrance;
   - delete User B's retailer URL;
   - rotate or revoke User B's API key.
4. A valid API key can perform only the scrape operations allowed by Spec 01.
5. A valid API key cannot perform key-management or unrelated account operations.
6. Expired API keys fail.
7. Revoked API keys fail.
8. API keys belonging to actively banned users fail.
9. Incorrect API-key secrets fail.
10. Malformed authorization headers fail closed.
11. Session-authenticated users retain normal access.

### Price-validation tests

Cover the final validation contract from Spec 03, including:

- valid decimal prices;
- zero and negative prices, according to the chosen domain rule;
- excessively large prices;
- non-numeric amounts;
- amounts with multiple decimal points;
- unsupported or malformed currency codes;
- missing retailer URL;
- retailer URL owned by another user.

### Migration smoke test

Provide a repeatable way to verify that a fresh database can apply all committed migrations. This may be a CI service database or a documented test setup, but it must not use the developer's production database.

## Test infrastructure requirements

1. Add the test runner already aligned with the project toolchain, preferably Vitest through Vite+.
2. Add root scripts or Vite+ tasks so a developer can run:
   - all tests;
   - unit tests only, if the suite grows;
   - integration tests when a test database is configured.
3. Tests must not read the developer's real `.env` file or connect to production.
4. Use a distinct variable such as `TEST_DATABASE_URL` for integration tests.
5. Test setup must create isolated data and clean it up deterministically.
6. Tests must be safe to run repeatedly.
7. Do not mock away Drizzle/PostgreSQL for authorization tests if doing so would stop testing the actual ownership joins.
8. Keep retailer network calls out of automated tests. Use fixtures and local stubs.

## Suggested file organization

Use the conventions supported by the selected runner. A suitable starting structure is:

```text
server/utils/api-key.test.ts
server/trpc/router.test.ts
server/trpc/context.test.ts
server/scraper/price-parsing.test.ts
```

Adjust locations to match the final implementation, but keep tests close to the code they verify unless integration setup requires a shared test directory.

## Acceptance criteria

- [ ] `vp test` or the documented `pnpm test` command discovers and runs tests successfully.
- [ ] No-test discovery no longer occurs.
- [ ] Two-user authorization-isolation tests pass.
- [ ] API-key expiry, revocation, ban, bad-secret, and scope tests pass.
- [ ] Invalid price inputs are rejected by tests.
- [ ] Scraper price-parser fixture tests pass without network access.
- [ ] Tests do not require production credentials or the developer's `.env` file.
- [ ] Repeated test runs produce the same result.
- [ ] CI runs the test suite, as completed by Spec 05.

## Verification

Run:

```bash
vp test
vp check
pnpm build
```

If integration tests require PostgreSQL, document the exact local and CI setup and verify a fresh database can run all migrations before the tests.

## Dependencies

- Spec 01 defines the final API-key authorization behavior.
- Spec 03 defines the final numeric price and validation contract.
- Spec 04 defines the final scraper parser behavior.
- Spec 05 wires the completed suite into CI.

## Risks

- Router code currently imports a global database instance. Minimal test seams may be needed, but this spec does not require a broad dependency-injection refactor.
- Integration tests can become flaky if they share mutable data. Use unique users and records per test or reset the test schema deterministically.
