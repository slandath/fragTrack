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

Scraping runs **locally only** — the server never launches a browser. Uses API key auth:

```bash
pnpm scrape
```

This loads `getUserUrls` via tRPC, scrapes each URL with Playwright, and appends successful observations with `storePrice`. Existing prices remain available when an individual scrape fails.

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `DATABASE_CA_CERT` | Trusted Postgres CA certificate in PEM format (literal `\\n` separators are supported) |
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
