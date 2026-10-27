# Cross-tab authentication — Issue #101

## Approved storage and lifecycle

The Product Owner selected `localStorage` plus native `storage` events for the
same origin/browser profile. `kanban.session` retains `{accessToken, expiresAt}`.
The backend currently issues one-hour access JWTs (`expiresIn: 3600`); there is no
refresh flow. Closing/reopening the browser or refreshing retains the stored
credentials only until that fixed expiry. Every tab verifies discovered tokens
with `GET /users/me` before rendering protected content.

Legacy `sessionStorage` credentials are removed, never imported. Existing users
may need to sign in once after upgrading; an old per-tab token cannot restore a
session after logout.

Storage's latest value wins; queued events are wakeups, not authoritative token
messages. Receivers do not write valid received sessions back. Each change ends
the previous generation, clears protected query/mutation caches and disposes the
existing realtime context. Old authorized callbacks/responses also check the
observed storage value, including before a queued event has run. Expiry and
401/logout must not remove a newer session written by another tab.

## Threat model and limits

Storage data is untrusted: malformed/expired entries are rejected, and possession
of a token is not proof of authentication. Account changes must not reuse another
user's caches, in-flight responses, theme or preferences. Settings' boot cache
remains associated with the token subject; runtime theme falls back to the OS
while a different session is being verified.

Any script running on the origin can read a localStorage bearer token. This
retains the existing XSS threat and increases persistence beyond a tab's lifetime;
it is an explicitly accepted trade-off, not XSS protection. Never place JWTs in
URLs or logs. The server remains authoritative for signature, expiry, permissions
and auth-version checks. No cookie auth, refresh tokens, BroadcastChannel,
cross-device logout or stronger server-side/socket revocation is introduced.

When browser storage throws, same-tab in-memory authentication remains available;
persistence and cross-tab propagation cannot be guaranteed. Network errors during
verification retain the existing retry state. Tabs resume by reconciling storage
and checking expiry; the sender need not remain open.

## Verification

- Targeted storage, generation, GET/PATCH/401 races, cache isolation, theme and
  Card-route/socket disposal tests are included. Test fixtures/assertions now use
  localStorage; legacy sessionStorage is used only for cleanup/isolation tests.
- Browser QA used native storage events in independent same-origin Chrome tabs,
  with synthetic credentials and mocked REST: existing/new-tab login, permitted
  Card permalink, refresh, logout, account switch, sender closure and a two-second
  synthetic expiry passed. A separate browser context remained signed out.
- Backend Jest: 54 suites / 541 tests passed; shared tests: 6 passed.
- Root `pnpm test` hit the existing intermittent five-second Preferences test
  timeout under parallel load. `pnpm --filter @kanban/frontend test --maxWorkers=2`
  passed 88 files / 784 tests. A final focused auth/expiry/password run passed
  50 tests after preserving manual logout for an expired current session.
- `pnpm lint`, `pnpm build` and `git diff --check` passed. Build retains existing
  warnings about local `NODE_ENV` configuration and the main bundle size.
- Repository `pnpm format:check` reported 609 existing file warnings; no unrelated
  formatting was changed. Changed files are checked with `--end-of-line auto`.
- No real backend/browser socket integration, PostgreSQL integration, CI or
  deployment was run. Frontend tests verify disposal using the existing fake socket;
  browser REST mocks do not prove server authentication or live socket revocation.
