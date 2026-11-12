# MOB-06 Native Socket.IO Realtime Foundation

Implementation record for [Issue #245](https://github.com/duongkienvn/SE2026-T13/issues/245), verified locally on 2026-11-12.

## Baseline and scope

Started from clean, freshly fetched `main`, commit
`a0236867584d9225240c8470e29d4c6c0f1ed7f6` (merge of PR #254).
MOB-03 navigation, MOB-05 session and the mandatory MOB-04 REST/Query dependency
were present in source before branching to `feat/mobile-realtime-foundation`.
The complete issue and supplied acceptance criteria were reviewed against backend,
shared and Web source, rather than assuming old roadmap descriptions were current.

Changes are confined to mobile client infrastructure, tests, dependency importer
and documentation. No backend/shared/Web implementation, database, migration,
production configuration, feature screen or auth form changed. No offline queue,
push delivery or persistent background presence is provided.

## Implementation and decisions

See [the integration guide](../../mobile/realtime.md) for exact wire contracts,
feature APIs, lifecycle ownership, event targets and permission rules.

- `infrastructure/realtime/` owns a native Socket.IO 4.8.4 connection, using the
  same resolved version as Web. The validated API URL supplies the backend origin;
  `/socket.io`, default namespace and shared events match the existing server.
  The live auth callback supplies a credential per handshake. Socket.IO's automatic
  reconnection is disabled so one controller owns bounded retries and verification.
- The root adds one provider inside MOB-03/04/05. Existing DataProvider native
  observations forward foreground/network state without a competing global
  listener. Connection gaps trigger real `/users/me` verification before rejoin.
  Explicit UNAUTHORIZED/401 ends only its captured session generation; temporary
  network errors and generic disconnects do not imply invalid credentials.
- Reference-counted Board consumers use authoritative REST capabilities before
  joining and the real join/leave ACKs. Presence can precede join ACK and is buffered
  for that attempt only. Lost/uncertain leave delivery forces connection teardown.
  Workspace membership never manufactures PRIVATE Board access. Hooks release on
  focus loss, session change and unmount; no feature screens were added.
- The existing Query coordinator batches 50 ms hints by affected key and holds
  overlapping mutation keys, including declared invalidation targets. It preserves
  same-key write serialization and releases locks before authoritative refetch.
  Same-user updates from other devices remain valid. Uncorrelated hints arriving
  after a completed refresh may require another read, rather than guessing echoes.
- Resource epochs extend session-generation fences to revocation, role/archive
  changes and REST 403/404. Tagged HTTP is canceled, cached protected data is
  cleared and queued/late optimistic work cannot restore it. Active Query objects
  retain empty error state so existing observers recover after a verified grant;
  inactive entries are removed. UUID query identities are canonicalized.
- Global access hints fence registered work even before cache population. Board
  access hints also fence resources with no remaining room consumer. Workspace
  loss rechecks Boards independently because explicit Board membership can remain.
- Consumers must forward captured identity, exported `resourceKey` and Query signal
  to HTTP, and gate protected values/edits on verified Board read/write state.
  These are stale-work guards; every server request still enforces authorization.

The Socket.IO adapter follows the official
[client options](https://socket.io/docs/v4/client-options/) and
[client Socket instance](https://socket.io/docs/v4/client-socket-instance/)
contracts. Server source remains authoritative for event/ACK payloads.

## Regression evidence

Deterministic tests use real MOB-04/05 owners and native HTTP implementation with
injected fetch, sockets, lifecycle and time. They cover authenticated handshakes,
invalid/expired credentials, reconnect credential acquisition, bounded backoff,
foreground/network transitions, logout/account/generation races, room ACK ordering,
late ACKs, duplicate consumers, presence, disposal, malformed events, scoped event
mapping, notification hints, local echoes, unrelated Boards and actual HTTP counts.
Security cases cover capability downgrade, archival, PRIVATE access loss, Workspace
revocation with independent Board access, REST failures, aborted/delayed HTTP,
queued mutations, uncached work and released room consumers.

The opt-in `test:realtime:local` starts the actual Nest REST/JWT/Socket.IO stack on
an ephemeral loopback port with existing repository doubles. Two native controllers
with the same user converge after a REST edit; presence deduplicates; background
pause/resume verifies the session and recovers an edit missed while disconnected.
It creates no database, runs no migrations and makes no production requests.
Expected TaskNotificationWorker errors from the repository double do not fail it.

## Validation

| Check                                                                                                                                                | Result                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused realtime tests (`node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test apps/mobile/test/realtime/*.test.ts`) | Pass; 27 realtime tests, including actual HTTP-count, lifecycle, room and security regressions.                                                                                                                                                                                                                     |
| `pnpm test:mobile`, followed by final `pnpm --filter @kanban/mobile test`                                                                            | Pass; final run: 126 Node tests and 65 component tests across 12 suites.                                                                                                                                                                                                                                            |
| `pnpm --filter @kanban/mobile typecheck`                                                                                                             | Pass.                                                                                                                                                                                                                                                                                                               |
| `pnpm lint` (includes mobile)                                                                                                                        | Pass.                                                                                                                                                                                                                                                                                                               |
| `pnpm build`                                                                                                                                         | Pass for shared, backend, Web and mobile; existing Vite NODE_ENV/chunk-size warnings.                                                                                                                                                                                                                               |
| `pnpm bundle:mobile`, followed by final `pnpm --filter @kanban/mobile bundle:android`                                                                | Pass; Android Hermes export and native graph verifier: 1,296 native sources, shared ESM, approved logo and no Web/backend/Node-shim imports.                                                                                                                                                                        |
| `pnpm --filter @kanban/mobile test:realtime:local`                                                                                                   | Pass; two-client real REST/Socket.IO smoke with repository doubles and missed-event recovery.                                                                                                                                                                                                                       |
| `pnpm test`                                                                                                                                          | **Fail:** backend 116 suites / 1,283 tests passed, shared 20 passed, mobile 123 Node + 65 component tests passed at that point; Web 155 files passed / 3 failed, 1,674 tests passed / 3 failed. Final mobile-only run includes subsequent added regressions.                                                        |
| Focused Web rerun with `--maxWorkers=1` for all three failing files                                                                                  | **Fail:** RegisterPage and RemoveSampleBoardDialog passed; CalendarBoard checklist HTTP 500 test still hit its existing 5,000 ms timeout (36 passed / 1 failed). A subsequent CalendarBoard-only rerun also timed out (7 passed / 1 failed). Web source/configuration and its dependency resolutions are unchanged. |
| Changed-file Prettier check and `git diff --check`                                                                                                   | Pass. `.env.example` reviewed as plain text; lockfile is ignored by existing Prettier config.                                                                                                                                                                                                                       |
| `pnpm format:check`                                                                                                                                  | **Fail:** 1,425 unchanged files flagged in this checkout, predominantly existing line-ending differences. None is in this task's changed-file set; no unrelated mass formatting performed.                                                                                                                          |
| `pnpm install --frozen-lockfile`                                                                                                                     | Pass; existing ignored @parcel/watcher build-script warning.                                                                                                                                                                                                                                                        |
| `pnpm --filter @kanban/mobile exec expo install --check`                                                                                             | **Fail:** eight unchanged main pins differ from current Expo recommendations; details below.                                                                                                                                                                                                                        |

The first root Web failures were RegisterPage's Google-provider alert winning an
expected registration-message assertion, CalendarBoard's checklist HTTP 500 timeout
and RemoveSampleBoardDialog's 5,000 ms timeout. The focused reruns above
distinguish recoverable timing failures from the remaining repeatable timeout;
none is treated as a successful full root gate. No unrelated Web fixes were made.

## Limits and follow-up

No Android device was attached (`adb devices` returned none); real native
foreground/background scheduling and network-toggle smoke remain unverified.
iOS runtime/device testing is unavailable on this Windows host. Metro export,
injected lifecycle tests and the two-client JS smoke cannot prove OS scheduling.
PostgreSQL suites were not run: no server/persistence behavior changed and the
local integration explicitly uses repository doubles, not a designated database.
No CI, production, release signing or deployment outcome is implied by local checks.

Expo's compatibility checker recommends eight updates to existing main pins
(Expo, Constants, Linking, Router, SecureStore, StatusBar, Jest and jest-expo).
Recommended versions were `expo ~58.0.24` (current 58.0.23), Constants
`~58.0.16` (58.0.15), Linking `~58.0.17` (58.0.16), Router `~58.0.31`
(58.0.30), SecureStore `~58.0.3` (58.0.2), StatusBar `~58.0.5` (58.0.4),
Jest `~30.5.2` (29.7.0) and jest-expo `~58.0.14` (58.0.6).
Those unrelated pins remain unchanged; MOB-06 adds only the existing Socket.IO
version. A separate dependency maintenance task should assess those recommendations.

No push, PR creation, merge or deployment was performed.
