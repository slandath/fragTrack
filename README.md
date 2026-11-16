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

- Node 24, pnpm 11, Postgres instance (local or remote)

## Setup

```bash
pnpm install
cp .env.example .env   # fill in DATABASE_URL, GitHub OAuth, etc.
pnpm exec playwright install chromium   # for scraping
pnpm db:push            # create tables
```

## Development

```bash
pnpm dev                # starts server at :3000
# in another terminal
cd client && pnpm dev   # starts Vite at :5173
```

## Scraping

Scraping runs **locally only** — the server never launches a browser. Uses API key auth. API keys are limited to the scrape operations `getUserUrls` and `storePrice`; every other protected procedure requires a browser session and rejects API keys with `FORBIDDEN`:

```bash
pnpm scrape
```

This loads `getUserUrls` via tRPC, scrapes each URL with Playwright, and appends successful observations with `storePrice`. Existing prices remain available when an individual scrape fails.

## Prices and URLs

- Prices are stored as integer minor units (`amountMinor`, e.g. 2499 = $24.99) with a three-letter uppercase currency code. Floating point never touches money.
- The API accepts only exact amounts from 1 to 99,999,999 minor units (max $999,999.99). Zero and negative amounts are rejected, values with more than two decimals are rejected rather than rounded, and currency must match `^[A-Z]{3}$`.
- Ambiguous scraper text — price ranges, multi-decimal values, signs, extra numbers — is rejected instead of concatenated into a plausible amount.
- The dashboard formats with `Intl.NumberFormat` and sorts numerically; no `parseFloat` on text.
- Retailer URLs must use http/https, contain no credentials, and belong to a supported domain. They are stored in canonical form (lowercased host, default ports and fragments removed; path and query preserved) and a duplicate URL for the same fragrance is rejected with a clear error, enforced atomically by a unique constraint (migration `0006`).
- Migration `0005` converts valid legacy decimal amounts to cents and aborts with a row report when a value cannot be safely converted, so ambiguous history is never silently rewritten. All changes roll back on abort. Whole-number legacy values (e.g. `2030`, possibly a collapsed price range) convert but stay quarantined and hidden from displayed prices until an operator verifies them:
  ```sql
  SELECT id, retailer_url_id, amount_minor FROM price WHERE quarantined;
  UPDATE price SET quarantined = false WHERE id = '...'; -- after verification
  ```

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `DATABASE_CA_CERT` | Trusted Postgres CA certificate in PEM format (literal `\\n` separators are supported). Required in production — startup fails without valid CA material. Without it (development only) certificate verification is skipped |
| `DATABASE_TLS_SERVERNAME` | TLS server-name override, required for IP-address database URLs. Ignored for DNS hostnames, which node-postgres always verifies against the connection host — the certificate must carry that DNS name |
| `TEST_DATABASE_URL` | Disposable database for integration tests (never development or production) |
| `BETTER_AUTH_SECRET` | better-auth signing secret |
| `BETTER_AUTH_URL` | Auth base URL (dev: `http://localhost:5173`) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth app credentials |
| `FRONTEND_URL` | CORS/origin for auth |
| `API_URL` | tRPC endpoint for scrape script |
| `API_KEY` | Expiring API key created in Settings and displayed only once. Legacy UUID keys expire seven days after migration. |

## Database

```bash
pnpm db:generate   # generate migration from schema changes
pnpm db:migrate    # apply migrations
pnpm db:push       # push schema directly (dev)
pnpm db:studio     # Drizzle Studio UI
```

## Testing

```bash
pnpm test             # unit tests (no database needed)
pnpm test:unit        # same as above
TEST_DATABASE_URL=postgresql://user:password@host:5432/fragtest pnpm test:integration
# append ?sslmode=disable to TEST_DATABASE_URL when the test server has no TLS
```
