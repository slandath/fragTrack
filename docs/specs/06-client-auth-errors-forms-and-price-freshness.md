# Spec 06: Fix Client Authentication, Errors, Forms, Sign-Out, and Price Freshness

## Status

Proposed

## Priority

P1/P2 — user-visible correctness, accessibility, and usability

## Context

The client has several behavior gaps:

- `Settings` does not verify authentication before rendering protected content.
- `Home` calls `navigate()` during rendering and starts protected queries before the session is resolved.
- Mutation errors are logged to the console but not shown to the user.
- Add-fragrance and add-URL controls use placeholders and click handlers rather than semantic forms and labels.
- The header shows the user's name but no sign-out action.
- Destructive actions use `window.confirm`.
- The latest-price API returns `scrapedAt`, but the client type omits it, so users cannot tell whether a displayed price is fresh.

## Goals

1. Protect authenticated routes consistently.
2. Avoid navigation side effects during React rendering.
3. Show actionable loading, empty, success, and error states.
4. Make forms keyboard- and screen-reader-friendly.
5. Provide sign-out.
6. Replace browser-native confirmation prompts with an accessible in-app pattern.
7. Display when each price was last observed and identify stale prices.

## Non-goals

- Redesigning the visual identity of the application.
- Adding a component library beyond the existing shadcn/Base UI setup.
- Adding price alerts, charts, or historical-price views.
- Changing authentication providers.

## Route protection

1. Create a shared protected-route or page-guard pattern for `Home` and `Settings`.
2. While the session is loading, render an accessible loading state.
3. When there is no session, redirect to `/login` without calling protected queries.
4. Use React Router navigation primitives or an effect; do not call `navigate()` during render.
5. Preserve the existing behavior where an authenticated visitor to `/login` is redirected home.
6. Gate protected tRPC queries with the resolved session state so unauthenticated requests are not sent unnecessarily.

## Error and status handling

1. Display user-visible errors for failed:
   - fragrance creation;
   - retailer-URL creation;
   - retailer-URL deletion;
   - fragrance deletion;
   - API-key creation;
   - API-key rotation;
   - API-key revocation;
   - initial fragrance, domain, price, and API-key loading.
2. Do not report an empty state when a query actually failed.
3. Keep form input after a failed submission so the user can correct and retry it.
4. Clear or reset form input only after success.
5. Disable duplicate submission while a mutation is pending.
6. Use an accessible live region, inline alert, or toast system consistent with existing UI components.
7. Continue logging technical details where useful, but do not make the console the only feedback channel.

## Forms and accessibility

For the add-fragrance and add-URL forms:

1. Use a semantic `<form>` with `onSubmit`.
2. Associate visible labels or accessible names with every input.
3. Use appropriate `required`, `maxLength`, `inputMode`, and `autoComplete` attributes where applicable.
4. Allow normal Enter-key submission.
5. Show field-level validation errors near the relevant input.
6. Keep submit buttons disabled only when submission is genuinely unavailable or pending.
7. Ensure focus is moved predictably after opening, cancelling, or successfully submitting the add-URL form.

Apply the same principles to Settings actions where practical.

## Sign-out

1. Add a sign-out control to the authenticated header or Settings page.
2. Use the existing Better Auth client sign-out method.
3. After successful sign-out, navigate to `/login`.
4. Show an error if sign-out fails.
5. Ensure protected cached query data is cleared or isolated across session changes so it cannot be displayed to a different user after sign-out.
   - Test an account switch across two tabs and confirm the second user cannot see the first user's cached data.

## Destructive actions

Replace `window.confirm` for fragrance and URL deletion with an accessible confirmation dialog using existing UI primitives where available.

The confirmation must:

- identify the item being deleted;
- explain that associated retailer URLs or price history will also be removed where applicable;
- provide explicit cancel and delete actions;
- disable the delete action while pending;
- show an error if deletion fails;
- return focus predictably after closing.

API-key revoke and rotate actions should require an appropriate confirmation or clearly communicate their immediate effect.

## API-key Settings behavior

1. Apply the shared route guard to Settings.
2. Show loading and error states for the key list.
3. Handle clipboard failures and tell the user when copying succeeds or fails.
4. Keep the one-time revealed-key warning.
5. Do not leave a revealed key unnecessarily available after navigation or sign-out.
6. Show expiry and last-used information using unambiguous formatting.

## Price freshness

1. Include `scrapedAt` in the client price model, preferably through the inferred types coordinated with Spec 07.
2. Display the latest observation time for each retailer URL.
3. Define a stale threshold in one shared location. The threshold should reflect the expected scrape cadence rather than an arbitrary per-component value.
4. Visually distinguish stale prices without relying on color alone.
5. Distinguish these states:
   - current price;
   - stale price;
   - never scraped;
   - latest scrape failed, if the backend later exposes that state.
6. Format currency using the numeric model from Spec 03 and `Intl.NumberFormat` where practical.

## Responsive and interaction behavior

- Preserve the current mobile-friendly single-column layout.
- Ensure long retailer hostnames, fragrance names, errors, and timestamps do not overflow their containers.
- Keep icon-only buttons accessible with labels and tooltips where the meaning is not obvious.

## Acceptance criteria

- [ ] Visiting `/settings` while signed out redirects to `/login`.
- [ ] Visiting `/` while signed out redirects without rendering protected content.
- [ ] No `navigate()` call occurs during React rendering.
- [ ] Protected queries are not intentionally enabled before a session exists.
- [ ] Failed creates, deletes, and API-key actions show user-visible errors.
- [ ] A failed query is not displayed as an empty data state.
- [ ] Add-fragrance and add-URL forms submit with Enter and expose accessible labels.
- [ ] Failed form submissions retain user input.
- [ ] A signed-in user can sign out and is returned to `/login`.
- [ ] Delete actions use an accessible in-app confirmation.
- [ ] Each displayed price includes its observation time.
- [ ] Stale prices are identified by text or icon as well as visual styling.

## Verification

- Manually test signed-in and signed-out visits to `/`, `/login`, and `/settings`.
- Simulate or force failed mutations and queries and verify the visible error states.
- Test forms using keyboard only.
- Test sign-out and confirm protected data is no longer displayed.
- Test representative current, stale, and missing prices.
- Run client lint, client type checking, formatting checks, tests, and build.

## Dependencies

- Spec 02 may add component or route tests.
- Spec 03 defines numeric currency formatting.
- Spec 05 ensures the checks run in CI.
- Spec 07 can provide tRPC-inferred types, including `scrapedAt`.

## Risks

- Adding a toast or dialog system can expand scope. Prefer existing UI primitives and the smallest accessible implementation.
- Query-cache clearing on sign-out must not interfere with the login page's normal session detection.
