# Frag Tracker

A personal fragrance price tracker. Add fragrance URLs, scrape current prices locally via Playwright, and view them in a web dashboard.

## Features

- Track fragrances with multiple retailer URLs per fragrance
- Price scraping via Playwright + stealth plugin
- GitHub OAuth login
- API key auth for the local scrape script
- Dark mode UI (shadcn/Base UI + Tailwind CSS v4)

## Tech Stack

- **Backend:** Fastify, tRPC, Drizzle ORM 0.45, Postgres, better-auth
- **Frontend:** React 19, Vite 8, Tailwind CSS v4, shadcn/Base UI, TanStack Query, React Router
- **Scraper:** Playwright + playwright-extra + puppeteer-extra-plugin-stealth (local only)
- **Language:** TypeScript 7

## Prerequisites

- Node 24 and pnpm 11.1.3 (both pinned in `package.json`)
- A PostgreSQL instance (local or remote)
- Chromium for local scraping: `pnpm exec playwright install chromium` (add `--with-deps` on Linux hosts missing browser libraries)

## Setup

```bash
pnpm install
cp .env.example .env          # fill in the variables required for your NODE_ENV
createdb fragtrack             # or create the database with your provider
pnpm db:migrate               # apply committed migrations to DATABASE_URL
pnpm exec playwright install chromium
```

`pnpm db:push` is acceptable **only** for disposable development databases when iterating on the schema. Production schema changes go through committed migrations (`pnpm db:generate` then `pnpm db:migrate`).

## Development

```bash
pnpm dev                      # API server at http://localhost:3000
# in another terminal
cd client && pnpm dev         # Vite dev server at http://localhost:5173
```

## Scraping

Scraping runs **locally only** — the server never launches a browser. Uses API key auth. API keys are limited to the scrape operations `getUserUrls` and `storePrice`; every other protected procedure requires a browser session and rejects API keys with `FORBIDDEN`:

```bash
pnpm scrape
```

This loads `getUserUrls` via tRPC, reuses one Chromium browser for the run, and appends successful observations with `storePrice`. The script prints a summary by failure category and retailer domain, and exits non-zero when anything failed. Individual failures do not discard successful observations.

## Prices and URLs

- Prices are stored as integer minor units (`amountMinor`, e.g. 2499 = $24.99) with a three-letter uppercase currency code. Floating point never touches money.
- The API accepts only exact amounts from 1 to 99,999,999 minor units (max $999,999.99). Zero and negative amounts are rejected, values with more than two decimals are rejected rather than rounded, and currency must match `^[A-Z]{3}$`.
- Ambiguous scraper text — price ranges, multi-decimal values, signs, extra numbers — is rejected instead of concatenated into a plausible amount.
- The dashboard formats with `Intl.NumberFormat` and sorts numerically; no `parseFloat` on text.
- Retailer URLs must use http/https, contain no credentials, and belong to a supported domain. They are stored in canonical form (lowercased host, default ports and fragments removed; path and query preserved) and a duplicate URL for the same fragrance is rejected with a clear error, enforced atomically by a unique constraint (migration `0006`). Migration `0006` does not canonicalize rows stored before it: a legacy URL with a fragment and its canonical form can coexist and bypass duplicate detection. Normalize such history per the duplicate-cleanup procedure before relying on the constraint for old data.
- Migration `0005` converts valid legacy decimal amounts to cents and aborts with a row report when a value cannot be safely converted, so ambiguous history is never silently rewritten. All changes roll back on abort. Whole-number legacy values (e.g. `2030`, possibly a collapsed price range) convert but stay quarantined and hidden from displayed prices until an operator verifies them:
  ```sql
  SELECT id, retailer_url_id, amount_minor FROM price WHERE quarantined;
  UPDATE price SET quarantined = false WHERE id = '...'; -- after verification
  ```
  A legacy amount of `0.00` converts to zero and passes the row report (it is convertible), but the later positive-amount check aborts the migration. The abort rolls back `amount_minor`, so find the rows through the legacy text column, correct or delete them, then retry:
  ```sql
  SELECT id, retailer_url_id, amount FROM price WHERE amount ~ '^0+(\.0+)?$';
  ```

### Data model: retailer domain

The `retailer` table was removed in migration `0008`. Its `name` and `url` columns both held the URL hostname, duplicating `domainConfigs` in `server/scraper/configs.ts`, and no user-visible feature displays retailer metadata. The `www.`-stripped hostname is now stored directly as `retailer_url.retailer_domain`, derived from the validated canonical URL at creation time; `domainConfigs` remains the authority for supported domains and selectors. Removing the table also removes the retailer upsert, per-retailer advisory locking, and orphan-cleanup logic that existed only to maintain the duplicate row. The migration backfills domains from the old relationship, reports rows where the URL hostname disagrees with the retailer, and treats the **URL as authoritative** for those rows. Fragrance ownership, URLs, prices, and price-to-URL links are unchanged.

## Environment Variables

Configuration is validated once at server startup. Missing or invalid variables are reported **by name only**, never with their values. See `.env.example` for placeholders.

| Variable                                    | Required          | Description                                                                                                                            |
| ------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                  | No                | `development` (default), `test`, or `production`. Controls which other variables are required.                                         |
| `DATABASE_URL`                              | Yes               | Postgres connection string (`postgres://` or `postgresql://`).                                                                         |
| `DATABASE_CA_CERT`                          | Production only   | Trusted Postgres CA in PEM form; literal `\\n` separators are supported. Startup fails without valid CA material in production.        |
| `DATABASE_TLS_SERVERNAME`                   | IP hosts only     | TLS identity override for IP-address `DATABASE_URL` values. For DNS hosts the certificate must carry the connection hostname as a SAN. |
| `BETTER_AUTH_SECRET`                        | Dev + production  | better-auth signing secret.                                                                                                            |
| `BETTER_AUTH_URL`                           | Dev + production  | Auth base URL (dev: `http://localhost:5173`). Must be an http(s) URL.                                                                  |
| `FRONTEND_URL`                              | Dev + production  | Trusted origin for auth (dev: `http://localhost:5173`).                                                                                |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Dev + production  | GitHub OAuth app credentials. Omit both in `test` to disable the provider.                                                             |
| `ADMIN_USER_IDS`                            | No                | Comma-separated better-auth admin user IDs; default empty.                                                                             |
| `PORT`                                      | No                | Server port; default `3000`.                                                                                                           |
| `API_URL`                                   | Scrape only       | tRPC endpoint used by `scripts/scrape.ts` (HTTPS unless loopback).                                                                     |
| `API_KEY`                                   | Scrape only       | Expiring API key created in Settings, shown only once.                                                                                 |
| `TEST_DATABASE_URL`                         | Integration tests | Disposable database for `pnpm test:integration`; never development or production. Append `?sslmode=disable` for servers without TLS.   |

## Quality gates

```bash
pnpm format               # format all tracked files
pnpm format:check         # fail on unformatted files
pnpm lint                 # root lint
pnpm --filter client lint # client lint
pnpm typecheck            # server type check
pnpm --filter client typecheck
pnpm test                 # unit tests (no database needed)
pnpm test:integration     # needs TEST_DATABASE_URL
pnpm build                # client + server build
pnpm check                # format check, both lints, both type checks, unit tests
```

CI runs `pnpm check`, `pnpm build`, applies all migrations to a disposable PostgreSQL service, and runs the integration suite there. Local `pnpm check` and CI therefore run the same substantive gates.

## Production

1. `pnpm install --frozen-lockfile`
2. Set production environment variables, including `DATABASE_CA_CERT` and `BETTER_AUTH_SECRET`.
3. `pnpm db:migrate` — the only supported production schema path.
4. `pnpm build`
5. `pnpm start` (`NODE_ENV=production` enables serving `client/dist`)
6. Smoke test (the server defaults to port 3000 when `PORT` is unset; substitute your configured port if it differs):
   ```bash
   curl -fsS http://localhost:${PORT:-3000}/trpc/healthcheck   # {"result":...}
   curl -fsSI http://localhost:${PORT:-3000}/                  # built index.html
   ```
7. If the smoke test fails, redeploy the previous release. Migrations must stay compatible with a running or rollback release — keep them additive (no table/column removal or rename) until older releases are retired.

## Troubleshooting

- **`Invalid environment configuration (…)`**: the error lists the exact variable names that are missing or malformed. Set them in `.env` (local) or the platform's environment settings (production). Secret values are never printed.
- **Database TLS failures**: `DATABASE_CA_CERT` is mandatory in production and must be valid PEM. IP-based database hosts additionally need `DATABASE_TLS_SERVERNAME`; DNS hosts must have their hostname in the certificate's SAN. Local/disposable servers without TLS can use `?sslmode=disable`.
- **Integration tests cannot connect**: set `TEST_DATABASE_URL` to a disposable database and append `?sslmode=disable` when it has no TLS. Never point it at development or production.

## Repository settings follow-ups

These are GitHub settings rather than repository files: require CI to pass before merging to `main`, require pull requests, enable Dependabot or another dependency-update mechanism, and consider CodeQL or dependency review for public exposure.
