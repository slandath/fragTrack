# fragTrack Go app

Single-user cologne buy list — one Go process, SQLite file.

## Run

```sh
APP_SECRET=change-me DATA_PATH=./data/fragtrack.db go run .
```

Visit `http://localhost:3000/?key=change-me` once (secret becomes a cookie). All routes except `GET /healthz` return 401 without it.

- `APP_SECRET` — required. Gates every non-health route.
- `PORT` — default `3000`.
- `DATA_PATH` — default `./data/fragtrack.db`. On Railway, mount the volume here (e.g. `/app/data/fragtrack.db`).
- `BACKUP_DIR` — timestamped copies go here (default `<data dir>/backups`); empty disables.

## Data

One SQLite file (WAL). Each backup checkpoints (`PRAGMA wal_checkpoint`) first, so the copy is self-contained — an uncheckpointed copy is not a backup. Restore: stop, copy back to `DATA_PATH`, start. Pull off Railway: `railway volume files download /backups ./backups`.

Schema version lives in `meta(version)`. Startup only creates tables and adds nullable/defaulted columns (additive-only); a newer-version DB refuses to start.

## Retailers

Configs live in `retailers.go` — one entry + one `fixtures/` file + one price test per retailer. Links are pasted per fragrance in the UI.

Fetch is plain HTTP, no browser in the request path. Blocked retailers (403/401/429, e.g. CamelCamelCamel, FragranceNet, FragranceX) stay `blocked` with the reason in the freshness cell and `last_failure`; the fallback is the row's `Open` link.

## Deploy (Railway)

Build from `app/Dockerfile` (repo root also holds the legacy Node app, so set the service Dockerfile path explicitly). Mount the volume at the data dir, export `APP_SECRET`. PR Environments give per-PR previews — check health + one add/refresh/delete round-trip before merging.
