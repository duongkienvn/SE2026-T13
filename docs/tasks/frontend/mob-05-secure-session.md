# MOB-05 — Secure native session lifecycle (#249)

## Scope and baseline

Branch `feat/mobile-secure-session` from `main` `c062cf1` (MOB-01 merged).
Requirements: issue #249, [Architecture §6.2](../../mobile/KANVEXA_MOBILE_ARCHITECTURE.md),
roadmap D-01. The contract for other owners is in the
[session guide](../../mobile/session.md).

**Dependency gap:** the issue expects MOB-03 (#244) navigation guards and
MOB-04 (#248) transport/Query to be merged or stable. On 2026-11-10 neither had
a branch. MOB-05 therefore ships the session owner behind small ports
(`SessionApi`, `SecureKeyValueStore`, lifecycle listeners, token-free guard
state) without editing or inventing their modules. Plugging the real MOB-03
guard and MOB-04 client into these ports is the remaining integration step.

## Implementation

- `credential-record.ts`: version-1 record `{ v, accessToken, expiresAt }`.
  Expiry = response time + `expiresIn` (device clock); lifetime over one day,
  non-JWT shape, non-UUID `sub` or missing `exp` is rejected.
- `credential-store.ts` + `secure-store-adapter.ts`: `expo-secure-store@58.0.2`,
  `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`; writes are read back; failed, partial,
  corrupted or unreadable values are deleted; nothing throws or logs.
- `session-api.ts`: `GET /users/me` verification (only 401 = rejected; 403/404,
  429, 5xx, non-JSON, malformed envelope, network and 15 s timeout = unavailable)
  and best-effort `POST /auth/logout`. HTTPS required except loopback/emulator/LAN
  hosts in development builds. Temporary until MOB-04's client can provide it.
- `session-manager.ts`: state machine `restoring → verifying → authenticated |
unauthenticated | expired | offline-uncertain` with a monotonic generation;
  `establishSession`, `logout`, `getAccessCredential`, generation-checked
  `handleUnauthorized`/`handleSecurityInvalidation`, expiry timer, foreground
  and network-restored re-checks, ordered storage queue, synchronous
  `onSessionEnd` teardown before publishing.
- `app-lifecycle.ts`, `guard-state.ts`, `SessionProvider.tsx` (`useGuardSession`,
  `SessionGate` keyed by generation), `native-session.ts`; root layout mounts the
  provider. The public bootstrap screen is unchanged; no protected route exists yet.
- Tests run on Node's built-in runner with TypeScript type stripping
  (`erasableSyntaxOnly`, `allowImportingTsExtensions`); no new test framework.

## Verification (2026-11-10)

| Check                                                      | Result                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| `pnpm --filter @kanban/mobile test`                        | Pass — 44 tests (42 session + 2 existing Metro)               |
| `pnpm --filter @kanban/mobile typecheck`                   | Pass                                                          |
| `pnpm lint` (root)                                         | Pass                                                          |
| `pnpm --filter @kanban/mobile bundle:android`              | Pass; bundle contains SecureStore and the inlined public URL  |
| Prettier (changed files, `--end-of-line auto`), diff check | Pass                                                          |
| Mutation checks                                            | 9/10 caught                                                   |
| Android emulator / iOS device                              | **Not run** — no Android SDK on this machine; iOS needs macOS |
| Real backend smoke                                         | **Not run** — no Login UI yet; DTO shapes checked in source   |

Mutation survivor: removing the generation check inside the queued credential
write. The post-write superseded check deletes the record anyway, so the guard
is redundant defence, not untested behaviour.

## Remaining work / hand-off

- MOB-03: feed `useGuardSession()` into its guard adapter; reset the protected
  stack in `onSessionEnd`.
- MOB-04: swap `createFetchSessionApi` for its client, register cache/request
  teardown, tag requests with `generation`, call `handleNetworkRestored`.
- MOB-06 (#245): connect/disconnect through the lifecycle listener (see guide).
- Manual device checks from the issue (cold start, reload, logout, no flash)
  once an emulator and the Login screen (MOB-08) exist.
