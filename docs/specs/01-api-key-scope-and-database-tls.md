# Spec 01: Scope API Keys and Restore Database TLS Verification

## Status

Proposed

## Priority

P0 — security

## Context

API keys are intended to authenticate the local scrape script. Before this spec, a valid API key was converted into a full user session in `server/trpc/context.ts`. Because every protected tRPC procedure accepted that session, an API key could also create, rotate, and revoke keys; modify fragrances; and delete account data through procedures in `server/trpc/router.ts`. This spec limits API keys to `getUserUrls` and `storePrice`.

Separately, before this spec `server/db/ssl.ts` always disabled PostgreSQL TLS certificate verification with `rejectUnauthorized: false`. The README and `.env.example` described `DATABASE_CA_CERT` as a trusted CA input, but the code ignored it. This spec enables verification when CA material is configured and fails closed in production.

## Goals

1. Limit API keys to the operations required by the local scrape workflow.
2. Prevent an API key from managing account credentials or unrelated account data.
3. Verify the PostgreSQL server certificate whenever TLS CA material is configured.
4. Fail closed for production database TLS configuration.
5. Keep browser-session authentication behavior unchanged except where necessary for authorization separation.

## Non-goals

- Replacing Better Auth.
- Adding OAuth scopes or a general-purpose permission system.
- Changing the local scrape workflow's user-visible behavior.
- Rotating credentials already issued, except for documenting any required operator action.

## Current behavior to change

- `server/trpc/context.ts` returns `{ session: { user: row.user, session: null } }` for a valid API key.
- `server/trpc/router.ts` defines one `protectedProcedure` used by both browser sessions and API keys.
- `server/db/ssl.ts` exports `databaseSsl()` returning `rejectUnauthorized: false` unconditionally.
- `README.md` and `.env.example` still describe CA-based TLS behavior that is not implemented.

## Requirements

### API-key authorization

1. Represent the authentication principal explicitly in the tRPC context. The context must distinguish at least:
   - browser session principal;
   - API-key principal;
   - unauthenticated principal.
2. API-key principals may call only:
   - `getUserUrls`;
   - `storePrice`.
3. API-key principals must receive an authorization error for every other protected procedure, including but not limited to:
   - `listApiKeys`;
   - `createApiKey`;
   - `rotateApiKey`;
   - `revokeApiKey`;
   - `getFragrances`;
   - `getLatestPrices`;
   - `getSupportedDomains`;
   - `addFragrance`;
   - `addRetailerUrl`;
   - `deleteRetailerUrl`;
   - `deleteFragrance`.
4. The public `healthcheck` procedure must remain public.
5. Browser-session principals must retain access to all currently available protected procedures.
6. Existing user-ownership checks must remain in force for both allowed API-key procedures.
7. Existing API-key expiry, revocation, hash comparison, and banned-user checks must remain in force.
8. Do not weaken authentication when an `Authorization` header is malformed. Current fail-closed behavior must be preserved.
9. Updating `lastUsedAt` must not grant additional privileges and must not occur for a key whose hash does not match.

### Database TLS

1. When `DATABASE_CA_CERT` is provided, use it as the PostgreSQL CA and enable certificate verification.
2. Support the documented literal `\\n` representation in `DATABASE_CA_CERT`.
3. When production requires a CA and it is absent or invalid, fail startup with a clear configuration error rather than silently disabling verification.
4. Define explicit development behavior separately. Any development-only relaxation must be visible in code and documentation, not the unconditional default.
5. Preserve any required TLS server-name override if the deployment certificate needs it. If an override such as `DATABASE_TLS_SERVERNAME` is restored, document it in `.env.example` and `README.md`.
6. Apply the same TLS behavior to runtime database connections and Drizzle commands that use `databaseConnection()`.

## Implementation guidance

- Prefer separate procedure builders, such as a session-protected procedure and a scrape-protected procedure, over checking procedure names inside shared middleware.
- Keep the principal model small and local to the tRPC layer. Do not introduce a general RBAC framework for this change.
- Keep API-key parsing and hashing behavior in `server/utils/api-key.ts` unless a change is required for authorization separation.
- Put TLS parsing in `server/db/ssl.ts` and reuse it from `server/index.ts` and `drizzle.config.ts`.
- Update `.env.example` and `README.md` so the documented behavior matches the code exactly.

## Edge cases

- Expired API key.
- Revoked API key.
- API key belonging to a banned user.
- Valid API-key ID with an invalid secret.
- Legacy API key during its supported migration period.
- Malformed `DATABASE_URL`.
- Empty, malformed, or whitespace-only `DATABASE_CA_CERT`.
- CA material supplied with literal `\\n` separators.
- Production startup without required TLS material.

## Acceptance criteria

- [ ] A valid API key succeeds on `getUserUrls` and `storePrice` for resources owned by its user.
- [ ] A valid API key cannot call any other protected procedure.
- [ ] A valid API key cannot access another user's URLs or store prices for another user's retailer URL.
- [ ] A browser session retains all current protected functionality.
- [ ] Expired, revoked, banned-user, and incorrect-secret API keys are rejected.
- [ ] PostgreSQL TLS verification is enabled when CA material is configured.
- [ ] Invalid or missing required production TLS configuration fails clearly at startup.
- [ ] `.env.example` and `README.md` accurately describe the implemented TLS behavior.
- [ ] Existing scrape behavior succeeds with a valid API key.

## Verification

Add or update automated tests where test infrastructure is available. At minimum, manually or automatically verify:

1. Session-authenticated request to a normal protected procedure succeeds.
2. API-key request to `getUserUrls` succeeds.
3. API-key request to `storePrice` succeeds for an owned retailer URL.
4. API-key requests to key-management and fragrance-management procedures fail.
5. Cross-user API-key requests fail.
6. Database connection configuration enables verification when CA material is present.

## Dependencies

- Spec 02 provides the durable automated test foundation for these authorization cases.
- Spec 05 covers broader environment validation and deployment documentation.

## Risks

- Railway's PostgreSQL certificate or private-network hostname may require a TLS server-name override.
- Existing deployed API keys should continue to work for scraping, but any undocumented use of API keys as full account tokens will intentionally stop working.
