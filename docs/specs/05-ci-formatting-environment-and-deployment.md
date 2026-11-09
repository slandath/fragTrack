# Spec 05: Repair CI, Formatting, Environment Validation, and Deployment Documentation

## Status

Proposed

## Priority

P1 — developer workflow and deployment safety

## Context

The repository has several inconsistent quality and deployment paths:

- `vp check` currently reports formatting issues in existing files.
- CI runs lint and build, but not the repository's complete `check` script or tests.
- Environment variables are read independently across the server, sometimes with unchecked assertions.
- `DATABASE_CA_CERT` is documented but ignored by the current code, which is addressed directly in Spec 01.
- `ADMIN_USER_IDS` is used but not documented.
- README setup recommends `pnpm db:push`, although committed migrations exist.
- There is no single documented production sequence for install, migration, build, start, and health verification.

## Goals

1. Make local and CI quality gates consistent.
2. Bring the existing tree back to a passing formatting state.
3. Run formatting, lint, type checking, tests, and build in CI.
4. Validate environment configuration once at startup with actionable errors.
5. Document local development and production deployment accurately.
6. Make database migrations the documented production schema path.

## Non-goals

- Choosing a new hosting provider.
- Building a full continuous-deployment platform if the current host does not require it.
- Adding branch-protection settings that cannot be represented in repository files; document them as GitHub settings follow-ups.
- Reformatting unrelated files in feature pull requests after the initial cleanup.

## Formatting requirements

1. Run the project's formatter on the currently failing tracked files in a dedicated cleanup change.
2. Keep the formatting change separate from functional changes where practical.
3. Verify generated migration snapshots and metadata are formatted according to the project's tooling or explicitly excluded by configuration if the tool should not manage them.
4. Do not disable formatting checks globally to make the tree pass.

## CI requirements

Update `.github/workflows/ci.yml` so CI performs the equivalent of:

1. Install with the frozen lockfile.
2. Run the repository formatting check.
3. Run root lint.
4. Run client lint.
5. Run server type checking.
6. Run client type checking.
7. Run automated tests from Spec 02.
8. Build the client and server.
9. Verify migrations apply to a disposable PostgreSQL database, if integration-test infrastructure supports it.

Prefer calling the documented package scripts or Vite+ tasks rather than duplicating individual commands in multiple places.

CI must:

- use Node 24 and the pinned pnpm version;
- keep least-privilege workflow permissions;
- avoid production secrets;
- use a disposable test database for database tests;
- fail when tests are accidentally absent if the project expects tests to exist.

## Environment-validation requirements

Create one server environment module that:

1. Reads and validates required variables at startup.
2. Distinguishes development, test, and production requirements.
3. Fails with names of missing or invalid variables, without printing secret values.
4. Exports typed values to the rest of the server.
5. Replaces unchecked assertions such as forced GitHub credential casts.
6. Documents optional variables and their defaults.

At minimum, classify these variables:

- `DATABASE_URL`;
- `DATABASE_CA_CERT`, if retained by Spec 01;
- `DATABASE_TLS_SERVERNAME`, if restored by Spec 01;
- `BETTER_AUTH_SECRET`;
- `BETTER_AUTH_URL`;
- `GITHUB_CLIENT_ID`;
- `GITHUB_CLIENT_SECRET`;
- `FRONTEND_URL`;
- `ADMIN_USER_IDS`;
- `API_URL` for the scrape script;
- `API_KEY` for the scrape script;
- `PORT`;
- `NODE_ENV`.

The scrape script must validate its own required environment without importing server-only secrets or configuration.

## Documentation requirements

Update `README.md` and `.env.example` so they agree with the code.

### README

Document:

1. Prerequisites and pinned tool versions.
2. Initial environment setup.
3. Database creation using migrations.
4. When `db:push` is acceptable, explicitly limiting it to disposable development databases if retained.
5. Development server and client commands.
6. Local scrape setup, including Playwright browser installation and operating-system dependencies where relevant.
7. Production build and start commands.
8. Production migration sequence.
9. Health-check or smoke-test steps after deployment.
10. Test, lint, type-check, formatting, and build commands.
11. Troubleshooting for missing environment variables and database TLS failures.

### `.env.example`

- Include every supported variable or clearly mark optional variables.
- Do not include real secrets.
- Use placeholder values that cannot be mistaken for working credentials.
- Match variable names and behavior in code exactly.

## Deployment requirements

Document one production sequence, adapted to the actual Railway configuration after inspection. It should cover:

1. Install dependencies.
2. Apply database migrations.
3. Build the application.
4. Start the server.
5. Verify the health endpoint.
6. Verify that the built client is served correctly.
7. Roll back or redeploy the previous release if the smoke check fails.

If migrations are run by the hosting platform rather than manually, document the exact service or release command used.

## GitHub repository settings follow-ups

These cannot be completed solely by editing repository files. Record them in the issue or pull request for operator action:

- Require the CI workflow to pass before merging to `main`.
- Require pull requests if that matches the maintainer's workflow.
- Enable Dependabot or another dependency-update mechanism, if desired.
- Consider CodeQL or dependency review for public exposure.

## Acceptance criteria

- [ ] `vp check` passes on the cleaned tree.
- [ ] The documented local check command and CI run the same substantive gates.
- [ ] CI runs formatting, lint, type checks, tests, and build.
- [ ] Missing required production environment variables produce a clear startup failure.
- [ ] Startup errors do not print secret values.
- [ ] `.env.example` lists all supported variables accurately.
- [ ] README no longer presents `db:push` as the normal production setup path.
- [ ] Production migration, build, start, and smoke-test steps are documented.
- [ ] Database TLS documentation matches Spec 01's implementation.

## Verification

Run locally:

```bash
vp check
vp test
pnpm build
```

Then verify the GitHub Actions workflow on a pull request. Also start the server once with a deliberately missing required variable and confirm that the error is clear and does not disclose secrets.

## Dependencies

- Spec 01 determines final TLS environment variables and behavior.
- Spec 02 supplies the automated test suite wired into CI.
- Specs 03 and 04 supply migrations that must be exercised by the deployment path.

## Risks

- Formatting the entire failing tree can create a large diff; isolate it from functional changes.
- Vite+ may not be installed identically on every developer machine, so package scripts must remain intelligible through pnpm.
- Hosting-platform migration behavior must be confirmed from the actual Railway configuration rather than assumed.
