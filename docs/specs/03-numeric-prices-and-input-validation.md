# Spec 03: Convert Prices to Numeric Storage and Harden Input Validation

## Status

Proposed

## Priority

P0/P1 — data integrity and input validation

## Context

Prices are currently stored in a text column. `storePrice` accepts arbitrary `amount` and `currency` strings, while the scraper creates an amount by removing every character except digits and periods. The client later uses `parseFloat` for sorting and display. This allows malformed, ambiguous, negative, or commercially meaningless values to become price history.

Other user inputs also have minimal constraints. Fragrance names and brands only need one character, and retailer URLs are checked for a supported hostname but not protocol, embedded credentials, canonical form, duplicates, or excessive length.

## Goals

1. Store prices in a numeric representation that preserves exact currency amounts.
2. Reject invalid prices before they reach the database.
3. Validate and canonicalize retailer URLs.
4. Prevent duplicate retailer URLs for the same fragrance.
5. Apply consistent length and whitespace rules to user-provided text.
6. Preserve existing valid price history through a safe migration.

## Non-goals

- Supporting multi-currency conversion.
- Inferring exchange rates.
- Automatically correcting ambiguous retailer prices.
- Building a general product catalog or deduplicating fragrances across users.

## Price representation

Choose one representation and apply it consistently across the database, API, scraper, and client.

Recommended: store integer minor units, such as cents, plus an ISO 4217 currency code.

Alternative: use PostgreSQL `numeric(12, 2)` if the team prefers decimal values end to end.

The implementation must document:

- the storage type;
- the API representation;
- formatting behavior;
- rounding rules;
- supported currencies;
- treatment of zero;
- maximum supported amount.

Do not use floating-point storage for money.

## Database requirements

1. Change the `price` table from a text amount to the selected numeric representation.
2. Add a database-level constraint that prevents invalid amounts, such as negative values if negative prices are not allowed.
3. Constrain currency to a three-letter uppercase ISO-style code, either through a check constraint or a deliberately supported currency list.
4. Keep the existing retailer-url and scrape-time index unless the new design requires an improved index.
5. Write a Drizzle migration; do not rely on `db:push` for this change.
6. Define how existing text values are migrated:
   - valid decimal values convert to the new representation;
   - invalid values must be reported and handled by an explicit policy;
   - migration must not silently turn ambiguous values into plausible prices.
   - numeric-looking legacy values whose correctness cannot be verified (for example a stored `2030` that may have come from a `$20–$30` range) must follow an explicit operator policy: quarantine them for manual review or exclude them from displayed prices rather than preserving them as if they were observed amounts. The database retains no source text, so this decision cannot be reconstructed later.
7. Preserve `scraped_at` history and retailer-url relationships.

## API validation requirements

### `storePrice`

Validate:

- `retailerUrlId` identifies an existing retailer URL owned by the caller;
- amount is present and numeric;
- amount follows the selected domain rule for zero and positivity;
- amount does not exceed the documented maximum;
- currency is supported or matches the documented ISO-code rule;
- no floating-point artifact changes the stored amount.

Return a client error for invalid input rather than inserting a partial or coerced record.

### Fragrance inputs

For `addFragrance`:

- trim leading and trailing whitespace;
- reject whitespace-only names and brands;
- enforce documented maximum lengths;
- preserve internal spacing and capitalization.

### Retailer URL inputs

For `addRetailerUrl`:

- accept only `http:` and `https:` URLs;
- reject URLs containing a username or password;
- enforce a documented maximum URL length;
- require an exact supported hostname from `domainConfigs` after the existing `www.` normalization;
- reject unsupported subdomains unless explicitly added to configuration;
- canonicalize the URL before duplicate comparison and storage;
- define treatment of fragments, default ports, trailing slashes, query parameters, and URL casing;
- reject a duplicate normalized URL for the same fragrance with a clear client error.

Do not remove query parameters blindly if a retailer requires them to identify a product. The canonicalization rule must be conservative and documented.

### Other identifiers

Use consistent non-empty string validation for IDs. Prefer UUID validation where the application generates UUIDs, while preserving compatibility with non-UUID Better Auth identifiers if required.

## Scraper contract

1. The scraper must return a validated numeric amount or `null`.
2. It must not construct an amount by concatenating unrelated numeric fragments.
3. Ambiguous text, including most price ranges, must be rejected unless a retailer-specific rule explicitly defines the correct value.
4. Currency must come from validated retailer configuration or parsed page data.
5. `scripts/scrape.ts` must send the API representation required by the updated `storePrice` contract.

## Client requirements

1. Stop sorting prices with unchecked `parseFloat` on arbitrary text.
2. Format amounts using the currency and locale rules selected for the project, such as `Intl.NumberFormat`.
3. Handle missing and stale prices distinctly.
4. Update manual client price types or replace them with tRPC-inferred types as coordinated with Spec 07.

## Migration plan

1. Inspect existing production-like price values before finalizing conversion rules.
2. Add the new schema and migration.
3. Convert valid legacy values.
4. Produce a count or report of rejected legacy values during migration development.
5. Decide whether rejected values are removed, quarantined, or left to a manual operator step. Do not invent replacement prices.
6. Verify row counts and a sample of converted values after migration.

## Acceptance criteria

- [ ] New prices are stored using the selected exact numeric representation.
- [ ] Invalid amount and currency inputs are rejected by the API.
- [ ] Invalid legacy price values are not silently converted into incorrect amounts.
- [ ] The migration applies cleanly to an empty database.
- [ ] The migration behavior for representative valid and invalid legacy rows is tested.
- [ ] Fragrance names and brands are trimmed and length-limited.
- [ ] Retailer URLs reject unsupported protocols and embedded credentials.
- [ ] Duplicate normalized retailer URLs for one fragrance are rejected.
- [ ] The scraper submits only validated prices.
- [ ] The client formats and sorts numeric prices without unchecked text parsing.

## Verification

Use the tests from Spec 02 and add migration-specific verification. At minimum, test representative values equivalent to:

- `0.01`;
- `24.99`;
- `1299.99`;
- an invalid alphabetic value;
- a value with multiple decimal points;
- a negative value;
- an excessively large value;
- an unsupported currency format.

Run formatting, lint, type checks, tests, build, and migration generation checks required by the repository.

## Dependencies

- Spec 02 supplies validation and migration regression tests.
- Spec 04 updates scraper extraction to satisfy the new price contract.
- Spec 06 updates client display and stale-price behavior.
- Spec 07 may replace manual price types with inferred tRPC types.

## Risks

- Existing production data may contain malformed amounts created by the current text-stripping parser.
- Retailer URLs may rely on query parameters, so aggressive canonicalization could break product identity.
- Changing the API price representation requires coordinated scraper, server, and client updates.
