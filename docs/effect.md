# Effect house rules

fragTrack adopts [Effect](https://effect.website/docs/v3/getting-started) incrementally per
[Spec 08](specs/08-adopt-effect-incrementally.md). These rules keep the adoption bounded and
reviewable; they apply from Phase 1 onward.

## Version

- The root `package.json` pins `effect@^3.22.5` — the stable **v3** line, matching the v3 docs
  referenced by Spec 08. v4 is a separate change with its own spec.
- Add `@effect/platform` / `@effect/platform-node` only in the phase that first imports them.
  Do not install Effect packages speculatively.

## Boundaries

- Effect stays behind module boundaries. Public signatures outside an adopted module keep their
  current `Promise`/plain types; convert at the boundary with `Effect.runPromise` (CLI entry) or a
  small adapter.
- No `Effect.runSync` on a path that can do async work.
- A CLI/script enters the Effect runtime **once**, at the top of the entry point.
- No Effect code ships in the client bundle in Phases 0–3.

## Errors

- Failures callers must handle are typed `Data.TaggedError` classes, one per failure domain. A
  failure's category travels in the error type, not in a string code or a `catch` block.
- Defects (programmer errors) stay defects. Do not reclassify them as typed errors just to satisfy
  the compiler.
- Map typed errors back to the existing tRPC codes / scrape summary categories at the boundary.
  Wire formats, exit codes, and user-visible messages do not change.

## Services, layers, scopes

- Services use `Context.Tag` and are provided through `Layer`. Tests provide fake layers;
  production provides live layers. Only the startup config module reads `process.env` (Phase 3);
  everything else consumes the validated `Config` value.
- Retries use **named, capped** schedules. Never `Schedule.forever` for network or browser work.
  Retry transient failures only; never retry a deterministic failure or a store write whose
  outcome is ambiguous (double-store risk).
- Every `acquireRelease` / scoped resource has a forced-failure test proving release runs on
  success, typed failure, timeout, and interruption.

## Validation ownership

- Zod owns tRPC inputs and the client-facing contract.
- Effect `Schema` owns boundaries that Effect code already owns (scrape CLI response shape,
  scraper config, Phase 3 environment config).
- Never validate the same shape with both libraries. Note the owner in code when a boundary is
  non-obvious.

## Verification

Each phase runs `vp check`, `vp test`, and `pnpm build`. Phase-specific evidence (scrape
summaries, process checks, startup checks) is recorded in that phase's PR.
