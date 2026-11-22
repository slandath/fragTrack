# Spec 08: Adopt Effect Incrementally in the Scraper and Server

## Status

In Progress (Phase 0) — implementation began 2026-11-21; the context below describes the
state before implementation.

## Priority

P2 — maintainability, reliability, and typed error handling

## Context

fragTrack already has the shapes Effect is designed to formalize, without a
shared runtime for them:

- `server/scraper/index.ts` defines a hand-rolled failure taxonomy
  (`ScrapeCategory` / `ScrapeOutcome`), browser lifecycle seams
  (`PageLike`, `BrowserLike`-style interfaces), and per-URL outcomes that
  callers must classify manually.
- `scripts/scrape.ts` re-implements transport error handling by hand: an
  `ApiError` class with `network | http | trpc` kinds, a non-JSON gateway-body
  workaround that preserves HTTP status, and ad hoc pacing. Spec 07's typed
  tRPC client now decodes envelopes, so there is no `readTrpcResponse` to
  replace and no `invalid_response` kind on this tree — Phase 1 uses `Schema`
  to validate the `getUserUrls` result shape at the CLI boundary instead.
- `server/trpc/router.ts` and `server/trpc/context.ts` carry domain errors
  through tRPC error codes and thrown exceptions, so callers cannot tell from
  a type which failures a procedure can produce.
- `server/server.ts` wires Fastify, `@fastify/static`, the tRPC Fastify
  adapter, and the better-auth handler with top-level `await` and a manual
  `try/catch` around `fastify.listen`.

[Effect](https://effect.website/docs/v3/getting-started) provides typed
errors, service/layer dependency injection, `Schema` validation, retry and
timeout schedules, structured concurrency, resource (`Scope`) management,
and logging/metrics/tracing in one library. Those primitives map directly
onto the scraper taxonomy, the scrape script's transport errors, and server
startup — the three places the codebase currently re-derives them.

This spec adopts Effect incrementally, behind the existing interfaces. It
does not replace Fastify, tRPC, better-auth, Drizzle, or Zod in one step.

## Goals

1. Model scraper and scrape-script failures as typed Effect errors so the
   failure category travels in the type, not in string codes or catch blocks.
2. Replace hand-rolled retry, timeout, pacing, and browser cleanup in the
   scrape path with Effect schedules, timeouts, and scoped resources.
3. Introduce Effect services/layers for the scraper's external dependencies
   (browser, HTTP API client, config, clock/sleep) so tests substitute fakes
   through layers instead of structural seam interfaces alone.
4. Validate scrape-script and scraper boundary data with Effect `Schema`
   where it replaces equivalent Zod/manual checks, without changing wire
   formats.
5. Prove Effect in production-shaped code (the scrape workflow) before
   touching the request path; only then evaluate it inside tRPC procedures.
6. Keep every user-visible behavior — API shapes, scrape summary output,
   exit codes, auth behavior — unchanged unless a phase explicitly says so.

## Non-goals

- Replacing Fastify with `@effect/platform` `HttpServer`/`HttpApi`.
  Effect's HTTP modules may be evaluated in a later spec; this spec keeps
  `server/server.ts` on Fastify.
- Replacing tRPC, better-auth, Drizzle, or the React client.
- Rewriting the client (`client/`) to Effect. The client keeps tRPC-inferred
  types from Spec 07.
- Migrating all Zod schemas to Effect `Schema` at once. Zod and `Schema`
  coexist during adoption; see the validation decision below.
- Adopting Effect v4 while it is not the stable line used by the v3 docs
  referenced here. Pin the current stable `effect` v3 release; evaluate a
  v4 upgrade as its own change.
- Changing database schema, migrations, price storage, or retailer model.
  Specs 03 and 07 own those.
- Introducing a distributed job queue, scheduler service, or always-on
  scraping daemon. Scraping remains the local `pnpm scrape` workflow from
  Spec 04.

## Decision: adoption shape

Adopt Effect in phases, lowest-risk and highest-payoff first. Each phase is
independently mergeable, independently revertible, and leaves the previous
phase's behavior intact if a later phase is abandoned.

| Phase | Surface                             | What changes                                                                                                           | What does not change                               |
| ----- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 0     | Tooling                             | Add `effect` dependency, TS/LSP setup, test helpers                                                                    | Any runtime behavior                               |
| 1     | Scrape script (`scripts/scrape.ts`) | `ApiError` taxonomy, envelope parsing, retry/pacing become Effect errors + `Schema` + schedules                        | API wire format, CLI output, exit codes            |
| 2     | Scraper (`server/scraper/`)         | `ScrapeOutcome` becomes typed errors; browser lifecycle becomes a scoped resource; concurrency gets an explicit bound  | Retailer configs, extraction rules, stored data    |
| 3     | Server internals                    | Config and DB/scraper dependencies behind layers; startup/shutdown as a scoped Effect program bridged from `server.ts` | Fastify routes, tRPC procedures, auth handler      |
| 4     | tRPC procedures (evaluate)          | Selected procedures return typed domain errors mapped to the existing tRPC codes at the boundary                       | Procedure names, input/output shapes, client types |

Do not skip ahead: Phase 4 is an evaluation gate, not a commitment. If
Phases 1–3 do not reduce error-handling code or test friction measurably,
stop and record the finding in the implementation PR instead of proceeding.

### Current-tree reconciliations

This spec was written against an earlier description of the scrape path. Two details were
corrected before implementation began:

- Spec 07's typed tRPC client removed `readTrpcResponse` and the `invalid_response` kind from
  `scripts/scrape.ts`. Phase 1 does not reintroduce envelope parsing; `Schema` validates the
  `getUserUrls` result shape instead (restoring `invalid_response` as a typed error).
- Spec 04 classifies a selector-wait timeout as `price_not_found` (no matching price element).
  Phase 2 translates that existing behavior into typed errors; it does not reclassify it.

### Why the scrape path first

- It already has an explicit failure taxonomy (`ScrapeCategory` from
  Spec 04), so typed errors are a translation, not a redesign.
- It is a batch/CLI workload, so Effect's runtime entry points
  (`Effect.runPromise` at the boundary) fit without touching HTTP request
  handling.
- Its tests already use fake browser seams (`server/scraper/lifecycle.test.ts`),
  which become layer substitutions with no new test infrastructure concept.

## Phase 0: foundation

1. Add the `effect` package (stable v3) to the root `package.json`
   dependencies. Add `@effect/platform` / `@effect/platform-node` only in
   the phase that first imports them; do not install them speculatively.
2. Confirm `tsconfig` compatibility: Effect v3 requires TypeScript 5.4+;
   the repo is on TypeScript 7, so no compiler change is expected. Record
   the installed Effect version in the PR (Phase 0 uses `effect@3.22.5`,
   the latest v3 release; v4 is on `latest` and is out of scope).
   `scripts/**/*.ts` joins `tsconfig.node.json` so scrape code is typechecked.
3. Optionally enable the Effect LSP / language-service plugin for editor
   diagnostics. This is editor tooling only; CI must not depend on it.
4. Add a short `docs/effect.md` note (or a section in this spec's PR
   description) recording the house rules below so reviewers have one
   reference.

### House rules (apply from Phase 1 onward)

- Effect stays behind module boundaries. Public function signatures outside
  an adopted module keep their current Promise/plain types; convert at the
  boundary with `Effect.runPromise` / `Effect.either` as appropriate.
- No `Effect.runSync` on code paths that can perform async work.
- Errors that callers must handle are typed `Data.TaggedError` (or
  equivalent) classes, one per failure domain. Defects (programmer errors)
  stay defects; do not reclassify them as typed errors to satisfy the
  compiler.
- Services are defined with `Context.Tag` and provided via `Layer`. Tests
  provide test layers; production code provides live layers. No module
  reads `process.env` directly once a `Config`-backed layer exists for it
  (Phase 3).
- Retries use named schedules with explicit caps. No unbounded
  `Schedule.forever` on network or browser work.
- Every `acquireRelease` / scoped resource has a test or a forced-failure
  path proving release runs.

## Phase 1: scrape script (`scripts/scrape.ts`)

1. Replace the `ApiError` class kinds (`network`, `http`, `trpc`,
   `invalid_response`) with typed errors carrying the same information:
   kind, tRPC path, HTTP status when known, and tRPC code when known.
2. Validate the shape of the `getUserUrls` result with an Effect `Schema`
   decode at the CLI boundary, using only the fields the script consumes.
   Spec 07's typed tRPC client already decodes envelopes, so do not add a
   second envelope parser; a decode failure becomes `invalid_response`.
   Preserve the gateway behavior exactly: a non-JSON body on a failed
   response is an HTTP error carrying `res.status`. Add tests for both
   behaviors before changing the implementation — no scrape-script tests
   exist on this tree.
3. Express fetch/store calls as effects with:
   - a per-request timeout;
   - for fetches, retry only transient network/HTTP failures under a named,
     capped schedule (attempts and backoff recorded in the PR);
   - no retry for deterministic tRPC or validation failures;
   - no retry for a store failure whose outcome is ambiguous: a write that
     commits but loses its response would be duplicated. Only retry a store
     failure known to precede the write, or use an idempotency key.
4. Keep `validateApiUrl` semantics (HTTPS, loopback-HTTP exception) —
   either unchanged as a plain function called before the Effect program
   starts, or as a `Schema`/`Config` validation with identical messages.
5. Keep the summary output format, per-category counts, pacing intent, and
   exit-code behavior from Spec 04. The operator-facing output is a
   compatibility surface; snapshot it in tests before and after.
6. Keep the script runnable via the existing `pnpm scrape` / `tsx`
   workflow. The Effect runtime is entered once, at the top of the script.

Implementation note (Phase 1): the Effect program and its typed errors live in
`scripts/scrape-core.ts`; `scripts/scrape.ts` is the thin CLI entry that creates the
tRPC client, supplies the gateway-body fetch, and calls `Effect.runPromise` once.
Boundaries are injectable as `ScrapeDeps` so tests never open a browser or hit the
API. `apiRetrySchedule` (2 retries, exponential 500 ms base) is the named capped
schedule; `storePrice` is deliberately not retried.

## Phase 2: scraper (`server/scraper/`)

1. Translate `ScrapeOutcome` / `ScrapeCategory` into typed errors:
   `PriceNotFound`, `AmbiguousPrice`, `NavigationFailed`,
   `SelectorTimeout`, `BrowserFailed`, plus the API-side errors from
   Phase 1 where the scraper (not the script) produces them. The `stored`
   success case remains a success value, not an error.
2. Keep the pure extraction contract (`resolvePriceOutcome`,
   `parsePriceToMinor`) pure and synchronously testable. Only the
   navigation/browser shell becomes effectful; do not bury the parser
   inside effects.
3. Model the browser as a scoped resource: one browser per run, pages /
   contexts acquired and released per URL, release guaranteed on success,
   typed failure, timeout, and interruption. This replaces manual
   `finally` bookkeeping; the Spec 04 lifecycle requirements (one browser
   per run, isolation between retailers, no leaked Chromium processes)
   still apply verbatim.
4. Put the browser launcher, per-retailer config lookup, and sleep/clock
   behind services so `lifecycle.test.ts`-style fakes are provided as
   layers. Existing structural seams (`PageLike` etc.) may remain as the
   service interface shapes.
5. If concurrency is introduced, it must be bounded and named in code
   (Effect concurrency option or a semaphore), with deterministic summary
   ordering. Default remains sequential pacing unless the PR justifies a
   limit with measurements.
6. Timeouts are per-phase (navigation, selector wait, whole-URL) and map
   to the existing categories without changing behavior: a navigation
   timeout is `navigation_failed`; a selector-wait timeout means no price
   element matched and stays `price_not_found` (Spec 04); other selector
   failures stay `selector_timeout`. Do not reclassify an existing timeout
   as a different category during the Effect translation.

Implementation note (Phase 2): pure extraction and the Promise-facing types live
in `server/scraper/model.ts`; `server/scraper/effect.ts` holds the typed errors,
services (`BrowserLauncher`, `BrowserSession`, `RetailerConfig`, `ScrapeClock`),
the named capped navigation retry, and scoped contexts/pages/browser. The existing
`createScraper()` Promise API is a thin adapter in `index.ts`, so the CLI and the
unchanged lifecycle tests keep their contracts. `effect.test.ts` proves release on
success, typed failure, timeout, and interruption with fake layers; no Chromium
binaries are needed for those checks.

## Phase 3: server internals

1. Introduce a `Config` layer for server environment (`PORT`,
   `DATABASE_URL` and TLS inputs, auth secrets, `FRONTEND_URL`) that
   validates once at startup and fails with an actionable message.
   `.env.example` remains the documented contract; do not rename variables.
2. Provide the Drizzle DB client and other process-wide dependencies as
   layers consumed by server internals. tRPC context creation
   (`server/trpc/context.ts`) may read from these layers at the boundary;
   procedure bodies do not change in this phase.
3. Express startup/shutdown as a scoped Effect program bridged from
   `server/server.ts`: Fastify listen, static-file registration in
   production, and graceful close become acquire/release steps. Fastify,
   `@fastify/static`, the tRPC Fastify adapter, and the `/api/auth/*`
   better-auth bridge remain the HTTP implementation.
4. Add Effect logging at the scrape/server boundary only where it replaces
   existing ad hoc logging. Do not introduce a second log format for the
   Fastify request path in this phase.

Implementation note (Phase 3): `server/env.ts` now uses Effect `Schema` as the
single validation owner (Zod remains the tRPC input owner). `env-startup.ts`
calls it once at import; `server/layers.ts` exposes that validated value as a
`Config` layer and the Drizzle client as a `Database` layer. `server/startup.ts`
makes Fastify listen/close an `acquireRelease` resource; `server/server.ts` keeps
one scope open for the process lifetime and closes it on SIGINT/SIGTERM, so
routes, status codes, and static serving are unchanged. `server/startup.test.ts`
covers release on scope close and no close after a failed listen.

## Phase 4: tRPC procedures (evaluation only)

Proceed only if Phases 1–3 land and the PR records a concrete benefit
(measured in removed error-handling code, new test coverage of failure
paths, or an incident the typed errors would have caught).

If proceeding:

1. Pick one procedure with real failure modes (e.g. `storePrice` or
   `addRetailerUrl`) and model its domain failures as typed errors
   internally.
2. Map typed errors to the existing tRPC error codes at the procedure
   boundary. Clients must observe identical codes, messages where they are
   user-visible, and payload shapes.
3. Keep Zod input validation at the tRPC boundary unless the PR migrates
   that procedure's inputs to `Schema` with byte-identical accept/reject
   behavior proven by the existing validation tests
   (`server/utils/validation.test.ts`, `server/trpc/router.integration.test.ts`).
4. Expand beyond one procedure only in follow-up PRs, one procedure (or one
   cohesive group) at a time.

## Validation decision: Zod vs Effect Schema

- Zod remains the validation library for tRPC inputs and the client-facing
  contract by default.
- Effect `Schema` is introduced first where Effect code already owns the
  boundary (the `getUserUrls` result shape in `scripts/scrape.ts`, scraper config,
  Phase 3 environment config).
- Do not maintain the same shape in both libraries. Each shape has one
  owner; note the owner in code when a boundary is non-obvious.
- `Schema` decoders must preserve existing error _behavior_ (which inputs
  are accepted/rejected). Error message text may change only where no test
  or user surface depends on it, and the PR must say so.

## Compatibility requirements

- No tRPC procedure name, input, output, or error-code changes in
  Phases 0–3.
- No HTTP route, status-code, or static-serving changes in any phase.
- No database schema or migration changes.
- Scrape CLI: same environment inputs (`API_URL`, `API_KEY`), same summary
  categories, same exit-code contract.
- Client bundle: no Effect code ships to the client in Phases 0–3. If a
  later phase proposes it, the PR must report bundle-size impact.

## Testing requirements

1. Port before you port the code: existing tests covering a surface move
   to the Effect-shaped seams without weakening assertions. In particular:
   - scrape-script envelope/gateway tests (Phase 1);
   - `server/scraper/lifecycle.test.ts` and `price.test.ts` (Phase 2);
   - `server/trpc/router.integration.test.ts` unchanged through Phase 3.
2. New tests per phase must cover, at minimum:
   - each typed error is produced by its intended failure (not just that
     "an error" occurs);
   - retry schedules retry transient failures and do not retry
     deterministic ones, with the attempt cap asserted;
   - browser/resource release on success, typed failure, timeout, and
     interruption (forced-failure paths, as in Spec 04);
   - timeout classification matches the Spec 04 taxonomy.
3. Prefer test layers / fake services over mocking Effect internals. Where
   the repo's Vitest setup needs Effect-aware helpers, add them in one
   shared test utility rather than per-file boilerplate.
4. All pre-existing test suites must pass unmodified in Phases 0–3 except
   for seam changes described above.

## Acceptance criteria

- [x] Phase 0: `effect` (stable v3, `3.22.5`) is a dependency; no runtime behavior
      changed; `vp check` and `vp test` pass.
- [x] Phase 1: `scripts/scrape.ts` has no hand-rolled `ApiError` class or
      manual tRPC envelope parsing; gateway non-JSON behavior and exit
      codes are preserved and tested.
- [x] Phase 2: scraper failures are typed errors matching the Spec 04
      taxonomy; browser release is proven on success, failure, timeout,
      and interruption (fake-layer close assertions; no Chromium binaries
      in the test environment).
- [x] Phase 3: server config validates at startup via an Effect `Config`
      layer with actionable, name-only failures; Fastify/tRPC/better-auth
      behavior is unchanged; integration tests pass unmodified.
- [ ] Retry and timeout policies are named, capped, and asserted in tests;
      no unbounded retries exist in adopted code.
- [ ] No shape is validated by both Zod and `Schema`; each boundary has
      one validation owner.
- [ ] No Effect code ships in the client bundle; API and CLI compatibility
      requirements above hold.
- [ ] Phase 4, if attempted, maps typed errors to identical tRPC codes
      for the pilot procedure and records the go/no-go evidence.

## Verification

Run, per the repo's `AGENTS.md` checklist:

```bash
vp check
vp test
pnpm build
pnpm scrape   # against a local/test API, never production-only proof
```

Phase-specific evidence to include in each PR:

- before/after scrape summary output for the same fixture URL set,
  including at least one forced navigation failure and one selector
  timeout;
- process check after a scrape run showing no orphaned Chromium processes;
- for Phase 3, a startup run with a deliberately invalid environment
  variable showing the new actionable failure, and a normal startup run
  showing unchanged routes;
- for Phase 4, the integration-test diff (expected: none in assertions)
  for the pilot procedure.

## Dependencies

- Spec 04 (scraper reliability, failure taxonomy, lifecycle) — the taxonomy
  and lifecycle requirements this spec translates into Effect terms.
- Spec 05 (CI, formatting, environment, deployment) — CI must run the new
  tests; coordinate any script changes there.
- Spec 06 (client auth/errors) — error surfaces the client depends on must
  not change.
- Spec 07 (shared tRPC types) — the scrape script's typed client work
  lands before, or is reconciled with, Phase 1 envelope handling. Do not
  do the same cleanup twice.

## Risks

- **Runtime/boundary leaks.** Effect types creeping into public signatures
  would force repo-wide adoption prematurely. Mitigated by the house rule
  keeping Effect behind module boundaries.
- **Two validation libraries forever.** Zod + `Schema` coexistence can
  become permanent duplication. Mitigated by the one-owner rule and by
  Phase 4's explicit gate.
- **Retry regressions.** Effect schedules make retries easy to add and
  easy to over-apply (e.g. retrying deterministic selector failures, or
  double-storing a price after an ambiguous network outcome — see
  Spec 04). Mitigated by named caps and attempt-count assertions.
- **Resource-lifecycle regressions.** Moving browser cleanup from explicit
  `finally` blocks to scopes can leak processes if release is not proven.
  Mitigated by forced-failure tests and the post-run process check.
- **Version churn.** Effect evolves quickly and v4 exists alongside the
  v3 docs. Mitigated by pinning stable v3 and treating any major upgrade
  as its own spec/PR.
- **Team learning curve.** Effect idioms (`Layer`, `Scope`, schedules) are
  unfamiliar on first contact. Mitigated by phasing, the house-rules note,
  and keeping the HTTP/framework layer untouched.
- **Scope creep toward a framework rewrite.** The existence of
  `@effect/platform` HTTP modules invites replacing Fastify/tRPC.
  Explicitly out of scope here; that decision needs its own spec with
  benchmark and ecosystem evidence (auth bridging, static serving, tRPC
  adapter story).

## Rollback

Each phase is one PR (or a small stack) touching only its surface.
Rolling back a phase is a revert of that PR: Phases 1–2 do not change wire
formats or stored data, Phase 3 does not change routes or env contracts,
and no phase in this spec adds a migration. If adoption is abandoned after
Phase 1 or 2, remove the now-unused `effect` dependency in the revert and
record the reason in the tracking issue.

## References

- Effect documentation — Getting Started (v3):
  https://effect.website/docs/v3/getting-started
- Effect documentation — Installation (v3):
  https://effect.website/docs/v3/getting-started/installation
- Effect Platform introduction (HTTP server/API modules, maturity notes):
  https://effect.website/docs/v3/platform/introduction
- Spec 04: scraper reliability and failure taxonomy
  (`docs/specs/04-scraper-reliability-and-data-operations.md`)
- Spec 07: shared tRPC types and scrape-script client
  (`docs/specs/07-simplify-retailer-model-and-shared-types.md`)
