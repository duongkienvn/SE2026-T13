# MOB-04 — Typed native REST and session-safe Query

Implemented for [issue #248](https://github.com/duongkienvn/SE2026-T13/issues/248)
on `feat/mobile-api-query-foundation`, based on clean latest main at task start.
This record is local implementation/verification evidence, not deployment proof.

## Scope and decisions

- Read the complete issue (no comments), mobile roadmap/architecture/design spec,
  existing Web transport/Query conventions and backend controllers, DTOs, success
  interceptor, exception filter, prefix configuration and shared contracts.
- Verified merged MOB-05 (#251) and MOB-03 (#253) source. The issue's original
  independent/mock-only session requirement predates those merges; the user's
  request explicitly requires integrating the real session manager. Its storage
  sequencing, generation semantics and navigation guards are preserved.
- One native HTTP implementation serves session verification/logout and feature
  requests. Validated public config has no implicit production server. Request
  decoders are mandatory. Health is prefix-exempt; exports are raw bytes rather
  than ordinary REST envelopes. Existing `SessionUser` and shared envelopes/meta
  are reused. No speculative resource endpoint wrappers were added.
- Session-bound requests acquire live credentials, cancel on teardown and fence
  both responses and old query closures. Matching 401 is delegated to MOB-05.
  Offline uncertainty remains recoverable and never becomes fabricated auth.
- Query keys include user/generation/resource/filter/page. Session teardown removes
  private queries/mutations synchronously. Verified current-user state seeds Query
  to avoid repeating the bootstrap request. Invalidation batches overlapping keys;
  optimistic rollback respects later writes, session changes and eviction.
- Added TanStack Query 5.90.21 and Expo Network SDK-compatible 58.0.5. Native network
  events are needed for foreground/reconnect behavior; no other dependencies.
- No backend, Web UI, shared contracts, database migration, Socket.IO, feature
  screens, refresh-token flow, production calls, remote writes or deployment.

## Files and handoff

`apps/mobile/src/infrastructure/api/` holds configuration, HTTP/error handling,
bootstrap health and session-bound transport. `infrastructure/query/` holds the
client, keys, lifecycle/provider, pagination, invalidation/eviction/recovery and
optimistic utilities. Existing auth API/bootstrap and root layout use those owners.
Deterministic transport/session/cache tests and the root-provider component test
are under `apps/mobile/test/`. Public environment comments and mobile README were
updated. The session manager and navigation implementation are preserved.

The [network guide](../../mobile/network.md) documents exact interfaces and examples.
MOB-06 uses `getIdentity`, existing `getAccessCredential`, `queryKeys`, `invalidate`,
`evict`, `cancelRequests`, `resetPrivateState` and `recover`. It owns receive grants,
socket connection lifecycle and event-to-resource mapping. It must forward query
signals, capture identity, ignore stale callbacks and evict affected lists/previews
as well as resource detail on access loss. Existing session teardown already owns
private-state reset; do not register a second cache owner.

## Verification — Windows, Node 22.17.0, pnpm 10.18.3

Final command outcomes are recorded below. No external API was called by tests.

| Command / check                                              | Result                                                                                                                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                             | Pass. Existing ignored `@parcel/watcher` build-script warning; no approval/config change.                                                                                                         |
| `pnpm test:mobile`                                           | Pass: 95 Node transport/session/navigation tests and 60 component tests across 10 Jest suites. Includes native root/provider compatibility and existing navigation/design-system regressions.     |
| `pnpm --filter @kanban/mobile typecheck`                     | Pass. Also covered by root build.                                                                                                                                                                 |
| `pnpm exec eslint apps/mobile`                               | Pass.                                                                                                                                                                                             |
| `pnpm lint`                                                  | Pass.                                                                                                                                                                                             |
| `pnpm build`                                                 | Pass: shared ESM/CJS, backend, frontend and mobile types. Existing Web NODE_ENV/chunk-size warnings.                                                                                              |
| `pnpm bundle:mobile`                                         | Pass: Android Metro/Hermes export, shared ESM and genuine logo, no Web/server/Node shim graph.                                                                                                    |
| `pnpm test`                                                  | Failed under unrestricted concurrent regression + emulator load: frontend timeouts and backend board-events child timeout. No Web/backend/shared source changes. Constituent reruns below passed. |
| `pnpm --filter @kanban/frontend test --maxWorkers=2`         | Pass: 158 files, 1,677 tests.                                                                                                                                                                     |
| `pnpm --filter @kanban/backend test`                         | Pass: 116 suites, 1,283 tests, including mocked HTTP/real-socket contracts. No PostgreSQL integration script.                                                                                     |
| Shared tests via `pnpm test` and shared build via root build | Pass.                                                                                                                                                                                             |
| `pnpm format:check`                                          | Failed: 1,409 files reported across the pre-existing Windows checkout (`core.autocrlf=true`), including untouched files. Unrelated files were not reformatted.                                    |
| Prettier check on all changed formattable files              | Pass.                                                                                                                                                                                             |
| `git diff --check`; changed Markdown link/path check         | Pass.                                                                                                                                                                                             |

Coverage includes URL encoding, wrapped/raw JSON, text/downloads/uploads, 204,
malformed/empty/content-type errors, HTTP status mapping, deadline/body cancellation,
offline/network failures, rate-limit policies/retry exhaustion, mutation non-replay,
live credentials, stale 401, logout/security invalidation during requests, account
switching, private cache teardown, deterministic page/cursor keys, pagination,
coalesced invalidation versus actual request counts, rollback/concurrent edits,
resource eviction, initial-network-event races and sensitive logging absence.

## Limitations

- Android device smoke is blocked: both available AVDs were launched headlessly
  (second with software GPU) but stayed ADB-offline. The task's emulator processes
  were stopped. Android export succeeds; a successful native boot/API smoke is
  not claimed. No physical device is attached.
- Native iOS build/device verification is not available on this Windows host.
- PostgreSQL integration, infrastructure deployment checks, production/staging
  smoke and Socket.IO mobile testing are outside this mobile-only change.
- Downloads are buffered in memory. File saving, large streaming transfers,
  attachment UI, feature conflict rules and realtime receive grants remain scoped
  to their owning issues; the transport/cache integration interfaces are complete.
