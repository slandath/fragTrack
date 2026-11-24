# Spec 09: Go Rebuild — Single-User Cologne Buy List

## Status

Proposed. Supersedes the Node/Fastify/tRPC/React + Drizzle/Postgres +
Playwright-cron direction documented in specs 01–08. No implementation
started. Open questions at the bottom are for the owner to answer before
any agent begins the rebuild.

## Priority

P0 — this is the agreed next direction for the app.

## Context

### What the app is for

The owner buys cologne one bottle at a time and does not stockpile.
The real-world flow is:

1. Browse and sniff fragrances in stores over time.
2. Keep a short list of fragrances liked or wanted.
3. When a bottle is emptied and there is capacity for a new one, consult
   the list and pick what fits the season or mood.
4. At that moment only, check five to seven retailer sites for the best
   current deal on that fragrance, then buy.

The app is consulted only at step 3–4. Anything that runs, scrapes, or
costs money between buying moments is waste.

### What was tried and why it is being left behind

- The current stack (Node/Fastify/tRPC/React, Drizzle ORM over hosted
  Postgres, better-auth, Playwright scraping on a schedule) was chosen
  partly as an experiment. It works but is oversized for a list that is
  read a few times a year.
- Drizzle migration friction caused repeated deployment crashes and
  agent round-trips: snapshot/state drift, `db:push` vs `db:generate`
  confusion, and manual production migrations (see
  `docs/migrations-runbook.md`, `docs/railway-config-check.md`).
- Scheduled Playwright scraping is the wrong shape twice over: it burns
  paid compute on Railway for data nobody looks at, and retailer pages
  fight headless browsers.
- Multi-user auth, price history, sniffing notes, and background jobs
  were never part of the actual flow.

### Owner constraints for the rebuild (binding)

- Backend in Go, using Go libraries. The owner is moving away from
  Node/JavaScript backends.
- No hosted Postgres. Storage is a single SQLite file on a Railway
  Volume (see Approach). Single user only. Multi-user support is a
  future enhancement, not this build — but keep the `Store` interface
  seam for it.
- No sniffing notes. A fragrance entry carries basic characteristics
  only, plus retailer links.
- Retailer links may be pasted manually once per fragrance. Link
  freshness must be handled without a paid cron: on-demand re-checks,
  staleness markers, and optionally an agent pass replacing dead links.
  Playwright is allowed only as an optional offline check, never in the
  request path or on a schedule.

## Goals

1. Capture a fragrance in seconds: brand, name, concentration, bottle
   size, season tags, occasion tags, retailer links.
2. Buy mode: filter the list by season or occasion, sort by priority,
   pick one, and compare current prices across its retailer links.
3. Price checks run only on explicit tap, fan out with short timeouts,
   cache briefly (24 h default), and show fetched-at timestamps.
4. Idle cost near zero: one process, no scheduler, no browser fleet, no
   managed database service.
5. Any future agent can rebuild or extend this from the spec alone.

## Non-goals

Sniffing/impression notes, multi-user accounts and auth, price history
charts and alerts, scheduled scraping of any kind, Playwright in the
serving path, ORM-managed migrations, hosted Postgres.

## Approach

### Server

Go with the standard library only: `net/http` for the HTTP server and
routing, `encoding/json` for the JSON API, `database/sql` with a
cgo-free pure-Go SQLite driver for storage. One process serves both
the JSON API and the static frontend files, so there is a single
deployable with no Node build step.

Authoritative references inspected for these decisions:

- https://pkg.go.dev/net/http
- https://pkg.go.dev/encoding/json
- https://github.com/glebarez/sqlite
- https://railway.com/deploy/go
- https://railway.com/guides/preview-deployments-with-pr-environments
- https://docs.railway.com/volumes

### Storage (locked): SQLite file on a Railway Volume

One SQLite file (path from `DATA_PATH`, default `./data/fragtrack.db`
for local runs), accessed through `database/sql` with a cgo-free
pure-Go driver so the Railway Nixpacks build needs no C toolchain.
The file lives on a mounted [Railway Volume](https://docs.railway.com/volumes):
Railway's filesystem is ephemeral, so anything written to plain disk
is lost on redeploy. The mount path must include the app path (e.g.
`/app/data` when the app writes to `./data`).

No migration tool. Schema is ensured at startup with idempotent
`CREATE TABLE IF NOT EXISTS` statements, and a `meta(version)` row
guards forward compatibility: the server refuses to start against a
file with a newer version instead of silently reshaping data. WAL
mode is on, since concurrent price-refresh writes are the main
writer. All persistence sits behind a small `Store` interface so a
future backend can slot in without touching handlers.

Why not the other two options: a plain JSON file needs the same
volume anyway and replaces transactions with whole-file rewrites plus
app-level locking exactly where concurrent refresh writes land. A
managed Postgres needs the same volume for nothing, adds connection
config and a per-preview database copy, and reintroduces migration
machinery — the pain this rebuild escapes. SQLite adds zero
infrastructure over the volume both file options require.

### Data model

```sql
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
-- meta('version') holds the schema version, e.g. '1'.

CREATE TABLE IF NOT EXISTS fragrances (
  id           TEXT PRIMARY KEY,  -- uuid or slug
  brand        TEXT NOT NULL,
  name         TEXT NOT NULL,
  concentration TEXT NOT NULL,    -- EDT | EDP | Parfum | ...
  size_ml      INTEGER NOT NULL,
  seasons      TEXT NOT NULL,      -- comma-separated: spring,summer,fall,winter
  occasions    TEXT NOT NULL,      -- comma-separated: daily,office,evening,formal
  priority     INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL       -- want | owned | finished
);

CREATE TABLE IF NOT EXISTS retailer_links (
  id               TEXT PRIMARY KEY,
  fragrance_id     TEXT NOT NULL REFERENCES fragrances(id) ON DELETE CASCADE,
  retailer         TEXT NOT NULL,
  url              TEXT NOT NULL,  -- pasted once by owner
  last_price       TEXT,           -- NULL until first successful refresh
  last_checked_at  TEXT,           -- RFC 3339, NULL until first refresh
  link_status      TEXT NOT NULL DEFAULT 'unchecked'
                   -- ok | stale | blocked | unchecked
);
CREATE INDEX IF NOT EXISTS idx_links_fragrance ON retailer_links(fragrance_id);
```

Field vocabularies (season/occasion sets, concentration values) are
validated in one place in Go, not in separate tables. Price snapshots
are transient columns on `retailer_links`, not history: each refresh
overwrites `last_price` / `last_checked_at` / `link_status`.

### API sketch (JSON, single user, no auth)

- `GET /api/fragrances?season=winter&occasion=evening&status=want`
- `POST /api/fragrances` — add with characteristics + links
- `PATCH /api/fragrances/{id}` — edit characteristics, links, priority,
  status
- `DELETE /api/fragrances/{id}`
- `POST /api/fragrances/{id}/refresh-prices` — starts an on-demand
  fan-out fetch over that fragrance's links only and returns a
  refresh-job id immediately; honors the cache TTL (a run inside the
  TTL returns the cached snapshot with no fetches)
- `GET /api/refreshes/{jobID}/events` — server-sent events stream for
  one refresh job; emits one event per retailer as its fetch resolves
  (`ok` with price, `stale`, or `blocked`), then a terminal
  `complete` event. Jobs live in memory with a short TTL and die with
  the process.
- `GET /api/fragrances/{id}/prices` — last cached snapshot with
  per-link staleness

### Price fetching and link freshness

- Default path is plain HTTP fetch with a short per-retailer timeout,
  parsing only offer-price metadata. One slow or blocking retailer must
  not fail the whole run; it is recorded as `blocked` or `stale`.
- Retailer handling is config, not code: name, URL template or pasted
  URL, parser selector, all in one file. Adding a retailer never
  requires a handler change.
- Freshness without cron: every snapshot carries `lastCheckedAt`; the UI
  flags anything older than the TTL and any `stale`/`blocked` link. The
  owner or a delegated agent pass replaces dead URLs by editing the
  link entry. No scheduler, no background worker.
- Playwright, if used at all, is a manually invoked offline script for
  re-verifying a batch of pasted links — not a dependency of the server
  and not on any schedule.

### Frontend (locked)

No SPA. Server-rendered HTML from Go `html/template`, two views: list
view for capture and edits, buy view for season/occasion filtering
plus the compare button. Filtering is a query param and a re-render;
add and edit are plain forms. The React client is not carried over.

The one async interaction is the compare run, handled without a
framework: the buy view renders every retailer row immediately in a
pending state, then a small vanilla `EventSource` client (tens of
lines, no dependencies) consumes the refresh-job events endpoint and
swaps each row to its resolved state as events land. Price rows use an
`aria-live` region so streamed updates are announced. Sorting waits
for the terminal `complete` event or is a re-render.

CSS is Bootstrap CSS via CDN stylesheet link only: no JS bundle (the
app has no Bootstrap-JS components), no Tailwind, no custom design
system, no frontend build step. Used components are tables or list
groups for price rows, badges for `ok/stale/blocked` status, spinners
and placeholders for pending rows, alerts for blocked retailers, and
standard form controls.

### Deployment (locked): Railway, one service, one volume

Railway auto-detects the Go project from `go.mod` via Nixpacks — no
Dockerfile. Pin the Go version in `go.mod`, listen on `$PORT`, keep
the module layout flat with `main` at a standard location so the
default build works. No managed database service, no scheduler.

The SQLite file lives on a Railway Volume mounted at the app's data
directory, with the path resolved from `DATA_PATH`. Volumes are not
backups and are not replicated, so the app keeps timestamped copies
of the database file on the volume, and the README documents pulling
a copy off the volume (`railway volume files download`) plus the
restore path. Rollback is restoring a previous copy. Health endpoint
plus backup location documented in the README.

### CI and preview deploys (locked)

GitHub Actions on every PR, four jobs, no network in tests:

- `go build ./...`
- `go vet ./...` (the compiler covers types; vet covers the rest)
- `gofmt -l` must report no files (formatting gate, not a linter
  toolchain — no staticcheck-class linters in this build)
- `go test ./...` — parser fixtures from saved HTML samples plus a
  store round-trip test (schema ensure, write, reload, version-guard
  refusal)

Branch protection requires all four checks green before merge. That
plus `gh` is the agent autonomy loop: open the PR, `gh pr checks
--watch`, fix, merge, no human in the loop.

Broken deploys are caught before merge with [PR
Environments](https://railway.com/guides/preview-deployments-with-pr-environments):
enable both standard PR Environments and Bot PR Environments in
Project Settings → Environments, since agent PRs arrive as bot PRs
and get no preview without the second toggle. Each preview is one
tiny Go service with an empty volume — no database service is
replicated. After CI greens, the agent verifies the preview before
merge: health endpoint plus one API round-trip (add a fragrance,
refresh, delete it) against the preview URL. A preview that fails
to build or serve blocks the merge; production never receives a
build CI has not already proven.

## Steps for the implementing agent

1. Scaffold the Go module: `net/http` server, `html/template`
   pages, JSON API skeleton, `Store` interface with a SQLite
   implementation (`DATA_PATH`, startup DDL ensure, WAL mode,
   version-guard read), plus the GitHub Actions workflow with the
   four CI jobs.
2. Implement fragrance CRUD and list filtering (season, occasion,
   status), with vocabulary validation in one place.
3. Implement the retailer-link config and the on-demand
   `refresh-prices` action: in-memory refresh jobs, per-retailer
   timeouts, TTL cache, `ok/stale/blocked/unchecked` status recording,
   and the SSE events endpoint with a terminal `complete` event.
4. Build the two views in `html/template` with Bootstrap CSS via CDN:
   list view and buy view with compare button, pending-row states,
   `EventSource` live-fill client, `aria-live` price region,
   fetched-at display, and stale-link affordances.
5. Write parser tests against saved HTML fixtures (no network in
   tests) and a store round-trip test (save, reload, version guard).
6. Document operations: volume mount path and `DATA_PATH`, where
   timestamped copies live, off-volume export and restore, how to
   add a retailer, how to refresh links, how rollback works.

## Validation Plan

- `go vet ./...` and `go test ./...` pass.
- Fixture test: each retailer parser extracts the expected price from
  its saved sample; a changed page fails the test instead of silently
  returning garbage.
- Store test: write, reload, and version-mismatch refusal (newer
  `version` value is never overwritten).
- Manual pass: seed three fragrances with links, filter buy view by
  one season, run compare once, confirm a second run inside the TTL
  performs no fetches and shows cached timestamps.
- Manual pass: throttle one retailer, run compare, confirm all rows
  render pending immediately, resolved rows fill in as events land
  with no full-page spinner, and the slow row resolves without
  failing the run.

## Risks

- Retailer bot protection and markup drift are the main risk. The
  mitigation is pasted deep links plus manual price fallback, not a
  bigger browser fleet.
- SQLite covers tens of thousands of entries and concurrent
  refresh writers with ease at this scale. Past genuine multi-user
  concurrency, the upgrade is a server database behind the same
  `Store` interface.
- The volume is persistence, not safety: it is not replicated and is
  not a backup. The timestamped copies plus documented off-volume
  export are the actual safety story.

## Open Questions (for the owner)

1. Exact characteristic fields: is brand, name, concentration, size,
   seasons, occasions, priority, status the full set, or should
   anything be added or cut?
2. The 5–7 retailers: which sites should ship in the default config?
3. Playwright offline link-check script: wanted in this build, or
   defer until links actually go stale?

Frontend is locked (server-rendered `html/template`, SSE live-fill,
Bootstrap CSS via CDN) and is no longer an open question.
