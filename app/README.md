# fragTrack Go app

Single-user cologne buy list. One Go process serves the JSON API, the
server-rendered pages, and the SQLite database file.

## Run

```sh
APP_SECRET=change-me DATA_PATH=./data/fragtrack.db go run .
```

Visit `http://localhost:3000/?key=change-me` once; the secret is set
as a cookie. Every route except `GET /healthz` returns 401 without it.

## Environment

| Variable     | Required | What it does                                      |
| ------------ | -------- | ------------------------------------------------- |
| `PORT`       | No       | Port to listen on (default `3000`).               |
| `DATA_PATH`  | No       | SQLite file path (default `./data/fragtrack.db`). On Railway, point this at the volume mount (e.g. `/app/data/fragtrack.db`). |
| `APP_SECRET` | Yes      | Shared secret gating every non-health route.      |
| `BACKUP_DIR` | No       | Where timestamped checkpointed copies go (default `<data dir>/backups`). Empty disables. |

## Data and backups

The database is one SQLite file in WAL mode. Before each timestamped
copy, the app runs `PRAGMA wal_checkpoint` so the copy is
self-contained; a copy taken without a checkpoint is not a backup.
To restore: stop the process, copy a backup file back to `DATA_PATH`,
start again. To pull a copy off a Railway volume:
`railway volume files download /backups ./backups`.

Schema version is stored in `meta(version)`. Startup only creates
tables and adds nullable/defaulted columns (additive-only); a database
with a newer version refuses to start.

## Retailers

The eight retailer selector configs live in `retailers.go`, one per
retailer with a fixture under `fixtures/` and a test asserting its
price. Adding a retailer is one config entry plus one fixture — never
a handler change. Links themselves are pasted per fragrance in the UI
and stored in the database.

## Deploy (Railway)

Nixpacks detects `go.mod` and builds the app; no Dockerfile. Set the
build/start commands to the package root (`app/`) if the service is
created from the repo root, and mount the volume at the app's data
directory. PR Environments and Bot PR Environments provide per-PR
previews; verify health plus one API round-trip (add, refresh, delete)
on the preview before merging.
