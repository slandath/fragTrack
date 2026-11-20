# Code Simplification Audit — slandath/fragTrack

> Audit base: `origin/main` at `df405bf` (production). Method: every merged PR mapped to its referenced spec in `docs/specs/`, spec read in full, implementation and test bodies opened on `origin/main`. Findings are labelled **[spec-mandated]** (spec required it — not slop), **[exceeds-spec]** (more than the spec asked), or **[spec-silent]** (spec never mentioned it). LOC saved is an estimate for the _current_ tree unless marked historical.
>
> Coverage note: PR audits for #14 and #18 and all three cross-cutting sweeps completed in the multi-agent pass. PRs #15–17, #19, #20 were completed in the follow-up pass after rate-limit failures. Spec 06's 12 acceptance checkboxes were not individually re-verified (see §7).

## 1. Executive summary

**Headline: the codebase is leaner than its history suggests — PR #20 already deleted the worst complexity. What remains is ~180–220 LOC of removable code, plus 1,142 LOC of stale spec documents that are the single biggest slop pool.**

| Measure                                                             | Value                                                                  |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Source size (`server/` + `client/src/` + `scripts/`, .ts/.tsx/.css) | 4,462 LOC                                                              |
| Spec documents (`docs/specs/`)                                      | 1,142 LOC, all still `Status: Proposed`, 0 checkboxes checked          |
| Est. removable code (deduplicated)                                  | ~180–220 LOC                                                           |
| Est. removable docs (specs + dead README procedures)                | ~1,150 LOC                                                             |
| Largest single code win                                             | Dead Drizzle `*Relations` exports, ~41 LOC (`server/db/schema.ts:179`) |
| Fidelity verdict                                                    | High — most complexity traces to an explicit spec requirement          |

### Top 5 wins

1. **Archive/delete the 7 implemented specs** — 1,142 LOC of documents describing defects that no longer exist, all marked Proposed. (§5)
2. **Delete dead `*Relations` exports** — ~41 LOC, no relational queries exist anywhere. (§3.2)
3. **Collapse env validation to one path** — `server/env.ts` validates, then `server/db/ssl.ts` re-reads `process.env` and re-validates; ~25–50 LOC across both fixes. (§3.3)
4. **Trim duplicated integration-test matrices** — ~65 LOC where the DB suite re-proves what unit tests already prove. (§3.5)
5. **Deduplicate hostname/delay/error helpers** — www-strip ×4, `delay` ×2, error-message extraction ×4; ~25 LOC and one real bug (scrape log hardcodes `$`). (§3.1)

### Overall verdict on spec-vs-code fidelity

The spec-driven PRs (#14, #16–#20) implemented what their specs asked, usually proportionately. Slop concentrated in three places: (a) speculative defensiveness added _beyond_ spec text (IP-literal TLS policy, doubled-backslash handling, speculative scraper knobs), (b) small helpers copied instead of shared, and (c) documentation that was never retired after implementation. There is no architectural rewrite hiding in this codebase — it needs a cleanup pass, not a refactor programme.

## 2. Scorecard

| PR    | Spec        | Fidelity verdict                                                   | LOC in scope  | Est. removable         |
| ----- | ----------- | ------------------------------------------------------------------ | ------------- | ---------------------- |
| #14   | 01 + 02     | Proportionate; small exceeds-spec items in `ssl.ts`                | ~2,036 (diff) | ~95                    |
| #15   | 01 (hotfix) | Corrective — removed prior overreach                               | small         | 0 (already a deletion) |
| #16   | 03          | Proportionate; 2 dead exports in `money.ts`                        | medium        | ~4 + test trims        |
| #17   | 04          | Proportionate at the time; most complexity later deleted by #20    | large         | ~15 remaining          |
| #18   | 05          | Env module exceeds spec (dead fields, hand-rolled validators)      | 1,978 (diff)  | ~60                    |
| #19   | 06          | Proportionate; spec-mandated client complexity                     | medium        | ~11                    |
| #20   | 07          | Exemplary simplification PR; left dead relations + scrape taxonomy | large         | ~55                    |
| #1–#6 | pre-spec    | Out of audit scope (pre-date the spec system)                      | —             | —                      |

## 3. Findings by theme

### 3.1 Duplication

**D1. www-stripped hostname derived in 4 places [med, spec-silent].**
`retailerDomainOf` already exists at `server/utils/retailer-url.ts:15`, yet the same `new URL().hostname.replace(/^www\./,'')` appears at `scripts/scrape.ts:106`, `server/scraper/index.ts:192`, and `client/src/components/UrlRow.tsx:16`; the strip in `AddFragranceForm` is a no-op (domains arrive pre-stripped). The client could simply render the stored `retailerDomain` the API now returns. Est. ~12 LOC. Risk: hostname drift; client/server boundary needs care.

**D2. Identical `delay(ms)` in 2 modules [low].**
`scripts/scrape.ts:114` vs `server/scraper/index.ts:122`, byte-identical. `scrape.ts` already imports from `scraper/index.ts`. Est. 3 LOC.

**D3. Scrape log reimplements price formatting — and gets currency wrong [med].**
`scripts/scrape.ts:181` logs `stored $${(amountMinor/100).toFixed(2)}`, hardcoding `$` and ignoring `outcome.currency`. Non-USD prices are mislabelled in operator logs. Use `formatPrice` from `client/src/lib/price.ts:15` (or move it to a shared money module). Est. 1 LOC plus a correctness fix.

**D4. `formatTimestamp` duplicates `formatObservationTime` [low].**
`client/src/pages/Settings.tsx:11` vs `client/src/lib/price.ts:34` — same parse + `toLocaleString(medium/short)`, differing only in fallback text. Add a fallback parameter. Est. 5 LOC.

**D5. Error-message extraction repeated 4× [low].**
`error instanceof Error ? error.message : …` at `client/src/pages/Home.tsx:25`, Home:142, Settings, and `scripts/scrape.ts:76` (`formatError` already centralises it there). One `errorMessage()` per side. Est. ~6 LOC.

**D6. Failed-count reduce computed twice [low].**
`scripts/scrape.ts:195` and :215 — identical reduce in `main()` and `printSummary()`. Compute once. Est. 4 LOC.

**D7. API-key TTL `90` hardcoded in 3 places [low].**
Zod `.default(90)` twice at `server/trpc/router.ts:102` and :117, plus UI copy, despite `DEFAULT_API_KEY_TTL_DAYS` existing in `server/utils/api-key.ts`. Est. 2 LOC; risk is silent desync on change.

**D8. Actively-banned predicate duplicated [low, spec-mandated at both layers].**
`server/trpc/context.ts:27` vs `server/trpc/router.ts:27` — verbatim `banned && (!banExpires || banExpires > new Date())`. Both layers are spec-required (Spec 01), but one shared `isActivelyBanned()` prevents security-rule drift. Est. 4 LOC.

### 3.2 Dead code

**X1. Six Drizzle `*Relations` exports are dead [med].**
`server/db/schema.ts:179–219` (~41 LOC). Verified: no `db.query.*` call and no `*Relations` importer anywhere on `origin/main`; `server/index.ts` creates `drizzle({connection})` without `schema`, so the relational API is unavailable; better-auth's adapter consumes tables, not relations. Note the asymmetry smell — there is no `fragranceRelations`. Delete (or, if relational queries are intended, wire `drizzle({schema})` and add the missing one — maintainer decision, §7). Est. ~41 LOC.

**X2. `MAX_AMOUNT_LABEL` exported, never referenced [low].** `server/utils/money.ts:6`. Verified zero references. Delete. 1 LOC.

**X3. `isSupportedCurrency` used only by its own test [low].**
`server/utils/money.ts:29`; production validates via `CURRENCY_RE` at `server/trpc/router.ts:259`. Either make the router use the helper (single validator) or delete helper + test. Est. 3 LOC. Two currency validators will drift.

**X4. `AuthType` type and `apiKeyId` field have no readers [low].**
`server/trpc/context.ts:9` and :41 — verified zero importers/readers. Delete both. Est. 2 LOC.

**X5. Unused shadcn surface [low].**
`CardFooter` and re-exported `badgeVariants`/`buttonVariants` have no importers outside their own files (~11 LOC); `shadcn` is declared in client `dependencies` but only used as a CLI/CSS tool — move to `devDependencies`. Convention may justify keeping; maintainer decision.

### 3.3 Over-abstraction / exceeds-spec

**A1. Env validation exists twice; the "single point" is bypassed [med, exceeds-spec].**
Spec 05 asked for one validation point. `server/env.ts` (146 LOC) validates — but `server/db/ssl.ts:52` re-reads `process.env` directly and re-validates the URL protocol (`ssl.ts:56` duplicates `env.ts:75`), and the prod CA requirement is enforced in both (`env.ts:38` vs `ssl.ts:16`). Importing `server/index.ts` opens DB config without `validateEnv` ever running. Pass `env.databaseUrl/databaseCaCert/databaseTlsServername` into `databaseConnection(env)` and delete the re-reads. Est. ~15 LOC, medium effort (ssl tests mutate `process.env` and must be rewired).

**A2. `ServerEnv` carries 5 fields nothing consumes [med, exceeds-spec].**
`databaseCaCert`, `databaseTlsServername`, `apiUrl`, `apiKey`, `testDatabaseUrl` at `server/env.ts:9` — only test assertions read them; scrape/integration code reads `process.env` itself. Drop fields + reads. Est. ~12 LOC.

**A3. Hand-rolled validators despite zod being a dependency [med, exceeds-spec].**
`server/env.ts:57–82` hand-rolls `blank/read/httpUrl/postgresUrl` (~30 LOC); zod 4 is already used at `server/trpc/router.ts:2`. One zod schema with `safeParse` preserves the names-only aggregated errors (zod reports all issues). Est. ~35 LOC, low-medium risk.

**A4. `databaseConnection()` rebuilds what `pg` parses [med, exceeds-spec].**
`server/db/ssl.ts:66–93` manually splits host/port/user/password/database that node-postgres parses from a connection string. Return `{connectionString, ssl}` after extracting only hostname + `sslmode`. Est. ~25 LOC; verify `pg` ssl-over-connectionString precedence once.

**A5. Speculative TLS policies in `ssl.ts` [low, exceeds-spec].**
(a) `isIpLiteral` + throw requiring `DATABASE_TLS_SERVERNAME` for IP hosts (`ssl.ts:3,41`) — Spec 01 lists only malformed URL/CA edge cases; PR #15 already removed this PR's sibling overreach. Est. ~18 LOC incl. test. (b) Doubled-backslash `\\n` collapsing at `ssl.ts:10` — spec documents only literal `\n`. Est. ~6 LOC. (c) `BEGIN CERTIFICATE` pre-check at `ssl.ts:23` duplicates the `X509Certificate` parse below it. Est. 3 LOC.

**A6. Speculative scraper knobs [low].**
`ScraperOptions.navigationTimeoutMs/selectorTimeoutMs/retries/retryDelayMs` at `server/scraper/index.ts:93` — the sole production caller passes no arguments; only tests vary `retries`/`launch`. Inline the defaults; keep the `launch` seam (it earns its keep, §4). Est. ~8 LOC.

**A7. Single-use indirections [low].**
(a) `DbTransaction` type + `findFragrance(tx)` at `server/trpc/router.ts:14,72` exist for exactly one caller — inline. Est. ~12 LOC. (b) `useQueryClientInstance()` 3-line wrapper in `client/src/trpc.tsx`. Est. 3 LOC. (c) `isUniqueViolation` walks an unbounded `cause` chain at `router.ts:58`; Drizzle wraps exactly once. Est. ~4 LOC (keep one level of cause check).

**A8. Unnecessary transaction [low].**
`deleteRetailerUrl` wraps select-then-single-delete in `db.transaction` at `server/trpc/router.ts:278`; `deleteFragrance` does the same check without one. The residual TOCTOU is a no-op delete. Est. 3 LOC.

**A9. Scrape `ApiError` taxonomy [low — overstated, discuss].**
`scripts/scrape.ts:40–79` builds a class + kind taxonomy + cause-recovery for one script's log prefixes. ~15 LOC could become formatted strings, but the network/http/trpc distinction has genuine operator value (it diagnosed this week's incidents). Recommendation: keep, or simplify only the `toApiError` cause-recovery. Listed so the team decides consciously.

### 3.4 Test slop

**T1. Integration suite re-proves the unit denial matrix [med, exceeds-spec].**
`server/trpc/router.integration.test.ts:248` enumerates the same 11 FORBIDDEN procedures that `server/trpc/scope.test.ts:29` proves against a mocked DB (denial-before-DB-access), and UNAUTHORIZED/healthcheck cases duplicate `scope.test.ts:53`. Keep the unit table exhaustive; trim integration to 2–3 representatives (the real `createContext` path still gets exercised). Est. ~26 LOC.

**T2. Integration suite repeats unit validation matrices [med].**
Integration :313–349 and :407–430 re-assert the BAD_REQUEST and URL-rejection lists already covered in `server/utils/validation.test.ts`. The integration-only value is "no partial row stored" + DB CHECK constraints — keep those, drop the repeated matrices. Est. ~40 LOC.

**T3. Integration harness bulk is disproportionate but not removable [info].**
516-line file, ~150 LOC of seed/cleanup/migrate for ~25 tests. Correct today; extract a shared fixture helper _if_ a second integration file appears. Do not cut the isolation tests — they have no unit equivalent.

**T4. Checked and cleared [info].**
No framework-behaviour tests found (ssl/env/api-key tests assert project logic, incl. the secret-sentinel non-leak case). The three `$24.99` assertions in different test files guard three different contracts — not duplication.

### 3.5 Config & generated bulk

**C1. Duplicate npm scripts [low].** `test` and `test:unit` in `package.json` are byte-identical. Delete one. 1 LOC. (Found independently by two audits.)

**C2. `skipLibCheck` silences the client typecheck gate [low, spec-mandated workaround].**
Added in PR #18 because client typecheck failed at baseline. It hides all declaration errors, including future dependency breakage. Fix the offending import instead when touched. 0 LOC; gate honesty.

**C3. Formatter vs Drizzle snapshots churn [low, spec-mandated].**
PR #18 rewrote ~300 LOC of `*_snapshot.json` for `vp fmt`. Spec 05 explicitly allowed excluding generated snapshots via config. Add a formatter ignore for `server/db/migrations/meta/*_snapshot.json` (verify drizzle-kit still reads them). Recurring saving.

**C4. Historical: PR #14 bundled 5 unimplemented spec docs (~858 LOC)** into a PR scoped to Specs 01+02. Process note only — land each spec with its implementing PR (as #16–#20 later did).

## 4. Spec-mandated complexity — keep (do not re-litigate)

- `scrapeProcedure`/`sessionProcedure` split + `denyApiKey` (`router.ts:35–48`) — Spec 01's explicit design, 14 lines.
- Fail-closed malformed `Authorization` handling + `lastUsedAt` only after hash match (`context.ts`) — Spec 01 Reqs 8–9.
- Fail-closed production TLS, literal-`\n` CA support, X509 validation (`ssl.ts:12–30`) — Spec 01 Reqs 1–4. (Only the §A5 extras exceed spec.)
- Scraper browser seams (`BrowserLike`/`PageLike`/…) + retry-only-navigation (`scraper/index.ts:71–106,203`) — Spec 04; the fake-launcher tests prove close-counts without Chromium, and not retrying `storePrice` prevents duplicate observations.
- `addRetailerUrl` and `rotateApiKey` transactions — atomicity is the documented race guard (unique constraint + CONFLICT mapping).
- Run-scoped integration seeding/cleanup — Spec 02's never-wipe-unrelated-data requirement; `beforeAll migrate()` doubles as the migration smoke test.
- Env names-only aggregated errors + secret non-leak test — Spec 05's core safety property.
- Client derived types (`RouterOutputs` Pick/Omit) — replaced drifting hand-copied interfaces; `scrapedAt` required per Spec 07.
- Price freshness/stale, ConfirmDialog, error cards with Retry — Spec 06 user-visible requirements, not decoration.

## 5. Stale specs & docs

**All 7 specs are implemented and all 7 still say `Status: Proposed` with every checkbox unchecked** (129–185 LOC each; 1,142 total). Several assert present-tense defects that are fixed (Spec 02: "no tracked automated tests"; Spec 03: "prices stored in a text column"; Spec 05: "CI runs lint and build only"). Options, in order of preference:

1. Flip each to `Status: Implemented` + check the boxes + date — keeps the design rationale discoverable (~1,142 LOC retained but honest).
2. Move to `docs/specs/archive/` with a one-line index.
3. Delete — maximum saving, loses rationale (some is already in README/commit messages).

Also: README migration procedures for already-applied migrations (0005 abort-retry at `README.md:62–75`) are one-time ops presented as current — move to a migrations runbook, keep only the live quarantined-row review query. Spec cross-references in code comments (`schema.ts:134`, `scraper/index.ts:23`) must be updated whichever option is chosen.

## 6. Sequenced action plan

**Quick wins (<1h each, independently shippable):**

1. Delete X1 relations, X2, X4, C1 duplicate script (~45 LOC, pure deletions).
2. D2 delay, D6 failed-count, D4 timestamp helper, X3 single currency validator (~15 LOC).
3. T1/T2 integration trims (~65 LOC, keep DB-only assertions).
4. Spec status flips (§5 option 1) + README procedure move (~20 LOC moved).

**Medium (half-day):** 5. A1+A2+A4 env/ssl single path (~40 LOC; rewire ssl tests to pass args). 6. D1 hostname single-source incl. client rendering stored `retailerDomain` (~12 LOC + D3 currency bugfix). 7. A3 zod env schema (~35 LOC; preserve names-only errors).

**Discuss first:** 8. A9 scrape error taxonomy (keep vs flatten), X5 shadcn surface, X1 alternative (wire relational queries instead of deleting), C2 `skipLibCheck` root-cause.

## 7. Open questions / unresolved

- **Spec 06 checkboxes**: 12 acceptance items not individually re-verified against every client file — spot-check before archiving that spec.
- **Pre-0005 databases**: whether any deployment still needs the README 0005 abort procedure cannot be determined from the repo (production is migrated; staging unknown).
- **Relational queries**: X1 assumes none are planned. If Drizzle relational queries are on the roadmap, wire `drizzle({schema})` instead of deleting.
- **Railway config**: no Railway config exists in-repo, so Spec 05's "adapt deployment docs to actual Railway configuration" remains unverifiable from code alone.
- PRs #1–#6 (pre-spec) were mapped but not audited; their code is entirely subsumed by the spec-era tree audited above.

---

_Findings were adversarially spot-checked where they matter most: X1/X2/X3/X4 verified by repository-wide grep on `origin/main` (zero readers), D3 read at the call site. Estimates are order-of-magnitude for planning, not commitments._
