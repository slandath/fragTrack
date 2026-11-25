# Spec 09: Go Rebuild — Single-User Cologne Buy List

## Status

Accepted after a grill session; revised in one batch from the settled
contract recorded here. This direction supersedes the
Node/Fastify/tRPC/React + Drizzle/Postgres + Playwright-cron direction
documented in specs 01–08. No implementation started. One open item
remains at the bottom (optional offline Playwright script); everything
else below is decided and binding on implementing agents.

## Priority

P0 — this is the agreed next direction for the app.

## Context

### What the app is for

The owner buys cologne one bottle at a time and does not stockpile.
The real-world flow is:

1. Browse and sniff fragrances in stores over time.
2. Keep a short list of fragrances liked or wanted.
3. When a bottle is emptied and there is capacity for a new one, consult
   the list and pick the fragrance to buy.
4. At that moment only, check the configured retailer sites for the
   best current deal on that fragrance, then buy.

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
- No ORM and no migration framework, in the primary path or in the
  fallback: `database/sql` with hand-written SQL behind a small `Store`
  interface. GORM is explicitly excluded.
- No hosted Postgres in the primary path. Storage is a single SQLite
  file on a Railway Volume (see Approach). Managed Postgres is the one
  named fallback if SQLite-on-volume cannot be made to persist; it is
  not part of this build. Single user only. Multi-user support is a
  future enhancement, not this build — but keep the `Store` interface
  seam for it.
- Access is gated by one shared secret from the environment, checked
  by middleware on every route except the health endpoint. No accounts,
  no login flow. URL obscurity is not an access control.
- No sniffing notes. A fragrance entry carries brand, name, size,
  a binary owned/not-owned flag, and retailer links. No concentration,
  no priority, no season or occasion attributes.
- The app is a point-in-time lowest-price comparison, not a purchase
  history: it is not intended as a historical record of fragrances
  bought, and it keeps no price history.
- Retailer links may be pasted manually once per fragrance. Link
  freshness is the refresh contract below (every tap fetches fresh;
  per-link outcome is always labeled), with no paid cron and no silent
  stale prices. Playwright is allowed only as an optional offline
  check, never in the request path or on a schedule.

## Goals

1. Capture a fragrance in seconds: brand, name, size, and retailer
   links. That is the whole record, plus a binary owned/not-owned flag.
2. Buy mode: the not-owned list, ordered alphabetically by brand and
   then name. Pick one and compare current prices across its retailer
   links to identify the lowest price at this point in time.
3. Price checks run only on explicit tap and every tap fetches fresh:
   fan out with short timeouts, no TTL on taps, and every per-link
   outcome labeled so a price can never silently be stale (see the
   freshness contract under Price fetching and link freshness).
4. Access is protected by one shared secret; the app stays a single
   deployable with a single data file.
5. Idle cost near zero: one process, no scheduler, no browser fleet, no
   managed database service in the primary path.
6. Any future agent can rebuild or extend this from the spec alone.

## Non-goals

Sniffing/impression notes, multi-user accounts and logins, concentration,
priority, season or occasion attributes, price history charts and alerts,
scheduled scraping of any kind, Playwright in the serving path, any ORM
(GORM included), any migration framework, and hosted databases in the
primary path.

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

No migration tool, permanently: schema is ensured at startup with
idempotent `CREATE TABLE IF NOT EXISTS` statements plus guarded
`ALTER TABLE ADD COLUMN` in the startup script, and a `meta(version)`
row guards forward compatibility. The evolution rule is additive-only:
new tables and new nullable-or-defaulted columns are allowed under the
startup script, keyed to the `version` value. Anything non-additive —
renames, drops, type changes — ships as a named one-off file in the
repo, never as an implicit startup rewrite. The server refuses to
start against a database whose version is newer than the binary's
supported version instead of silently reshaping data. WAL mode is on,
since concurrent price-refresh writes are the main writer. All
persistence sits behind a small `Store` interface so the Postgres
fallback (which must obey the same no-ORM, no-migration-tool rule) or
a future backend can slot in without touching handlers.

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
  id      TEXT PRIMARY KEY,  -- uuid or slug
  brand   TEXT NOT NULL,
  name    TEXT NOT NULL,
  size_ml INTEGER NOT NULL,  -- bottle size in millilitres; display formats it
  owned   INTEGER NOT NULL DEFAULT 0  -- 0 = not owned (buy view), 1 = owned
);

CREATE TABLE IF NOT EXISTS retailer_links (
  id                 TEXT PRIMARY KEY,
  fragrance_id       TEXT NOT NULL REFERENCES fragrances(id) ON DELETE CASCADE,
  retailer           TEXT NOT NULL,  -- one of the eight configured retailers
  url                TEXT NOT NULL,  -- pasted once by owner
  last_price_minor   INTEGER,        -- NULL until first successful refresh
  last_price_currency TEXT,          -- NULL until first successful refresh
  last_success_at    TEXT,           -- RFC 3339, NULL until first successful refresh
  last_attempt_at    TEXT,           -- RFC 3339, NULL until first refresh attempt
  link_status        TEXT NOT NULL DEFAULT 'never-checked'
                     -- ok | failed | blocked | never-checked
);
CREATE INDEX IF NOT EXISTS idx_links_fragrance ON retailer_links(fragrance_id);
```

Prices are stored as integer minor units plus a currency code — never
as text or floats — so the buy view can sort cheapest-first without
parsing. Price snapshots are transient columns on `retailer_links`,
not history: each successful refresh overwrites
`last_price_minor` / `last_price_currency` / `last_success_at` /
`link_status`, and each attempt (success or failure) overwrites
`last_attempt_at` / `link_status`. The fragrance list is ordered
alphabetically by brand, then name; that ordering is the read contract,
not a stored column.

### API sketch (JSON, single user, secret-gated)

All routes except `GET /healthz` return 401 without a correct shared
secret. The buy view reads `GET /api/fragrances?owned=false`,
ordered alphabetically by brand, then name.

- `GET /api/fragrances?owned=false` — list fragrances; `owned` is the
  only query parameter (`true`, `false`, or absent for all)
- `POST /api/fragrances` — add with brand, name, size, and links
- `PATCH /api/fragrances/{id}` — edit brand, name, size, owned flag,
  and links with a partial update
- `DELETE /api/fragrances/{id}`
- `POST /api/fragrances/{id}/refresh-prices` — starts an on-demand
  fan-out fetch over that fragrance's links only and returns a
  refresh-job id immediately. Every call starts a fresh fetch for
  every pasted link; there is no TTL on taps, so the compare button
  can never silently serve a cached price.
- `GET /api/refreshes/{jobID}/events` — server-sent events stream for
  one refresh job; emits one event per retailer as its fetch resolves
  (`ok` with price and currency, `failed`, or `blocked`), then a
  terminal `complete` event. Jobs live in memory with a short
  retention window and die with the process.
- `GET /api/fragrances/{id}/prices` — last snapshot: per-link price
  (minor units + currency), `last_success_at`, `last_attempt_at`, and
  `link_status`

### Price fetching and link freshness (freshness contract, locked)

The owner must always be able to tell, from the row alone, whether a
price is freshly confirmed, unchanged, old because the latest attempt
failed, or never checked. Silent staleness is the failure this contract
exists to prevent.

- Every explicit tap starts fresh fetches for every pasted link, with
  a short per-retailer timeout. There is no TTL on taps. One slow,
  failing, or blocking retailer never fails the whole run; its row
  resolves independently.
- Default path is plain HTTP fetch, parsing only offer-price metadata.
- Per link, maintain `last_success_at` and `last_attempt_at` plus
  `link_status`. A successful fetch always advances `last_success_at`
  — including when the price is unchanged, which remains `ok`. A
  failed attempt advances `last_attempt_at` and sets `failed` or
  `blocked` without touching the stored price.
- Status semantics:
  - `ok` — fetched in the latest run (the price may be new or
    unchanged; the confirmation timestamp distinguishes both from
    every failure case below).
  - `failed` — the latest attempt failed; the displayed price is the
    previous successful value.
  - `blocked` — the latest attempt was blocked or rejected; displayed
    price is the previous successful value.
  - `never-checked` — no attempt yet; no price to show.
- UI wording is fixed by the status, and old and fresh can never look
  identical:
  - `ok` — price plus "confirmed <last_success_at>".
  - `failed` — previous price plus "price from <last_success_at>,
    refresh failed <last_attempt_at>".
  - `blocked` — previous price plus "price from <last_success_at>,
    blocked <last_attempt_at>".
  - `never-checked` — "no check yet".
- Selector knowledge is Go code config, keyed by retailer domain, with
  one saved-HTML fixture test per retailer. The database stores only
  per-fragrance rows (retailer name, pasted URL, snapshot columns).
  Adding a retailer is one config entry plus one fixture — never a
  handler change, never a database edit. The default config ports all
  eight retailers from `server/scraper/configs.ts` (Aura Fragrance,
  Beauty House, CamelCamelCamel, FragFlex, FragranceNet, FragranceX,
  Jomashop, Perfume Box); the refresh loop visits only retailers with
  pasted URLs.
- Link maintenance without cron: the statuses above are the freshness
  signal, and the owner or a delegated agent pass replaces dead URLs
  by editing the link entry. No scheduler, no background worker.
- Playwright, if used at all, is a manually invoked offline script for
  re-verifying a batch of pasted links — not a dependency of the server
  and not on any schedule. Whether it ships in this build is the one
  open item at the bottom.

### Frontend (locked)

No SPA. Server-rendered HTML from Go `html/template`, two views: list
view for capture and edits, buy view showing the not-owned list
ordered alphabetically by brand, then name, plus the compare button.
The only query parameter is `owned`; add and edit are plain forms.
The React client is not carried over.

The one async interaction is the compare run, handled without a
framework: the buy view renders every retailer row immediately in a
pending state, then a small vanilla client POSTs to create the refresh
job and opens `EventSource` on the returned job's events URL,
swapping each row to its resolved state as events land. Row text
follows the freshness contract statuses and wording: `ok` shows
"confirmed <time>", `failed` and `blocked` keep the previous price
with its failure wording, and `never-checked` shows "no check yet".
Price rows use an `aria-live` region so streamed updates are
announced. Cheapest-first order renders after the terminal
`complete` event or as a re-render.

CSS is Bootstrap CSS via CDN stylesheet link only: no JS bundle (the
app has no Bootstrap-JS components), no Tailwind, no custom design
system, no frontend build step. Used components are tables or list
groups for price rows, badges for `ok/failed/blocked/never-checked`
statuses, spinners
and placeholders for pending rows, alerts for blocked retailers, and
standard form controls.

### Deployment (locked): Railway, one service, one volume

Railway auto-detects the Go project from `go.mod` via Nixpacks — no
Dockerfile. Pin the Go version in `go.mod`, listen on `$PORT`, keep
the module layout flat with `main` at a standard location so the
default build works. No managed database service, no scheduler.

The SQLite file lives on a Railway Volume mounted at the app's data
directory, with the path resolved from `DATA_PATH`. Volumes are not
backups and are not replicated. Copies are only trustworthy when
self-contained, so before each timestamped copy the app runs
`PRAGMA wal_checkpoint(TRUNCATE)` and then copies the `.db` file; an
uncheckpointed copy is not a backup. The README documents pulling the
newest copy off the volume (`railway volume files download`) and
restoring it into place. Rollback is restoring a previous copy.
Health endpoint plus backup location documented in the README.

Fallback trigger: if the first deployment attempt does not persist
data to the volume after a verified mount — a write followed by a
redeploy loses the data — the build switches to the managed Postgres
fallback behind the same `Store` interface, under the same no-ORM and
no-migration-tool rules. The fallback is a documented decision, not an
automatic runtime event; it must not silently change storage.

Access control: one shared secret from the environment, checked by
middleware on every route except `GET /healthz`; a missing or wrong
secret returns 401. The app has no account or login surface.

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
   pages, JSON API skeleton, shared-secret middleware (every route
   except `GET /healthz` returns 401 without it), `Store` interface
   with a SQLite implementation (`DATA_PATH`, startup DDL ensure,
   WAL mode, version-guard read), plus the GitHub Actions workflow
   with the four CI jobs.
2. Implement fragrance CRUD and the alphabetical list contract
   (brand, name, size, owned flag, retailer links), with the
   `owned` query parameter as the only filter.
3. Port the eight retailers from `server/scraper/configs.ts` into Go
   code config, keyed by domain, each with one saved-HTML fixture
   test. Implement the on-demand `refresh-prices` action: in-memory
   refresh jobs, per-retailer timeouts, no TTL on taps, two-timestamp
   freshness recording (`ok/failed/blocked/never-checked`), and the
   SSE events endpoint with a terminal `complete` event.
4. Build the two views in `html/template` with Bootstrap CSS via CDN:
   list view and buy view with compare button, pending-row states,
   POST-to-create + `EventSource` live-fill client, `aria-live` price
   region, and status-fixed row wording per the freshness contract.
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
- Store test: write, reload, and version-mismatch refusal (a newer
  `version` value is never overwritten).
- Manual pass: seed three fragrances with links, confirm the listing
  is alphabetical by brand then name, run compare once, then run it
  again immediately and confirm every row fetches fresh — there is
  no TTL and no silently cached result.
- Manual pass: throttle one retailer, run compare, confirm all rows
  render pending immediately, resolved rows fill in as events land
  with no full-page spinner, and the slow row resolves without
  failing the run.
- Manual pass: force one retailer to fail after a successful run and
  confirm its row keeps the previous price labeled as old
  ("price from … , refresh failed …"), while a successful run with
  unchanged prices advances the confirmation timestamps and stays
  labeled "confirmed."
- Auth check: request any route without the secret and confirm 401;
  confirm `GET /healthz` answers without it.

## Risks

- Retailer bot protection and markup drift are the main risk. The
  mitigation is pasted deep links plus manual price fallback, not a
  bigger browser fleet.
- SQLite covers tens of thousands of entries and concurrent
  refresh writers with ease at this scale. Past genuine multi-user
  concurrency, the upgrade is a server database behind the same
  `Store` interface.
- The volume is persistence, not safety: it is not replicated and is
  not a backup. Checkpoint-then-copy plus documented off-volume
  export are the actual safety story; an uncheckpointed copy of a
  WAL-mode file is not a backup.
- The shared secret is a single point of exposure: anyone holding it
  has full read-write access. Accept that trade-off for a one-user
  tool; never widen it into accounts within this build.

## Open Questions (for the owner)

1. Playwright offline link-check script: wanted in this build, or
   deferred until links actually go stale? Standing recommendation is
   defer — the freshness statuses above are the staleness mechanism,
   and the script is only worthwhile once stale links are observed
   in practice.

Everything else is settled by the grill: Go with no ORM, SQLite on a
volume with the Postgres fallback, fields, ordering, price shape,
freshness contract, frontend, CI and preview deploys.
