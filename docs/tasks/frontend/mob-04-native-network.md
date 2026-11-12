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

## PR #254 CodeRabbit follow-up

Inspected all four unresolved inline threads against the unchanged PR head
`128b3aa` before editing. All four were confirmed; none were rejected. The branch
and PR are retained. No reply, thread resolution, push, merge or deployment is
part of this local fix.

| Finding                                                                                                     | Evidence and correction                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [URI multipart upload — major](https://github.com/duongkienvn/SE2026-T13/pull/254#discussion_r4552339701)   | Installed Expo 58.0.23 `runtime.native.ts` installs Expo fetch by default; `convertFormData.ts` rejects legacy URI-only parts. Added `createNativeMultipartUpload` using `expo-file-system` File readers, preserving filename/MIME overrides, strings and boundaries. The transport rejects unconverted URI factories before fetch. The FileSystem version already in Expo's transitive graph is now an explicit mobile dependency, 58.0.13; no new package version was introduced. |
| [Reconnect verification — major](https://github.com/duongkienvn/SE2026-T13/pull/254#discussion_r4552339728) | The session retry began while the HTTP connectivity predicate still returned offline. Publish online status before invoking `handleNetworkRestored`, retaining the preceding expiry check and disposal guards. Tests use actual HTTP, session API, credential store and session manager adapters for both restoration and new sign-in. One reconnect authenticates with the same generation and exactly one request.                                                                |
| [Mutation lock/refetch — minor](https://github.com/duongkienvn/SE2026-T13/pull/254#discussion_r4552339718)  | Awaiting invalidation held the successful write and same-key queue until active GETs finished. Queue invalidation without awaiting, retain its rejection handler and release the lock when the mutation settles. A deterministic native-transport test observes PATCH, GET, PATCH, GET; the first read is aborted and late data cannot overwrite the next edit. Refetch failures stay on the query and do not reject committed writes.                                              |
| [Environment comment — minor](https://github.com/duongkienvn/SE2026-T13/pull/254#discussion_r4552339646)    | `establishSession` verifies new credentials before storing them. The example now says verification runs on restore and after sign-in.                                                                                                                                                                                                                                                                                                                                               |

`native-upload.component.test.js` runs the actual installed Expo FormData patch and
fetch body normalization/multipart converter. Only native filesystem access is
mocked. It covers file/content URI conversion to exact binary bytes, filenames,
MIME types, repeated string fields, supported Blob fields, raw URI rejection,
read failure, no mutation replay and cancellation during conversion. This proves
the JS conversion contract, not device filesystem permissions or native I/O.

Follow-up validation:

- Focused Node query/cache/lifecycle regressions: **pass**, 16 tests.
- Focused upload/native-converter regressions: **pass**, 4 tests.
- `pnpm test:mobile`: **pass**, 99 Node tests and 64 component tests in 11 suites.
- `pnpm --filter @kanban/mobile typecheck`, `pnpm exec eslint apps/mobile`,
  `pnpm lint`, `pnpm build`: **pass**. Existing Web NODE_ENV/chunk-size warnings.
- `pnpm install --frozen-lockfile`: **pass**, existing ignored watcher-script warning.
- `pnpm bundle:mobile`: **pass** after rerunning sequentially with shared build;
  the first attempt overlapped the root build and raced shared output cleanup.
  Android Metro/Hermes source/asset verification passes.
- Upload-entry native compile: **pass**. Command:

  ```powershell
  pnpm --filter @kanban/mobile exec expo export:embed --platform android --entry-file src/infrastructure/api/native-upload.ts --bundle-output dist/pr254-upload.js --sourcemap-output dist/pr254-upload.map --max-workers 2 --dev false --minify false
  ```

  The 547-source graph includes the upload adapter and Expo File, without
  Web/backend source. A preliminary bare Metro API probe lacked Expo CLI's Babel
  runtime resolution; the supported Expo CLI compilation above succeeds without
  another dependency/config change.

- `pnpm format:check`: **failed**, the same 1,409 untouched checkout files. None
  of its warning paths belong to this fix. Changed-file Prettier, Markdown local
  paths and `git diff --check 128b3aa`: **pass**.
- `pnpm test` with `VITEST_MAX_WORKERS=2`: **pass**. Shared: 20 tests; backend:
  116 suites / 1,283 tests; frontend: 158 files / 1,677 tests; mobile: 99 Node
  tests and 64 component tests. No PostgreSQL integration/migration was run.

MOB-05 generation fencing, expiry and offline uncertainty, MOB-03 root/navigation
providers and MOB-06 invalidation/eviction contracts are preserved. No socket,
attachment UI, backend/shared-contract or deployment changes. Native Android/iOS
filesystem/device smoke remains unverified on this Windows host; tests use injected
fetch and mocked native file reads and make no production API calls.
