# Board Presence Backend (G1)

Implements ephemeral, board-scoped Presence on `feat/board-presence-backend`,
starting at `bbbeb9c` (confirmed equal to freshly fetched `origin/main`). The
initial worktree was clean. After implementation review, the user authorized
seven local commits on this feature branch. Push, PR and merge remain unauthorized.

## Contract

`@kanban/shared` exports a separate constant and typed payload:

```ts
export const RealtimePresenceEvent = { SYNC: 'presence:sync' } as const;
export interface BoardPresenceSnapshot {
  boardId: string;
  userIds: string[];
}
```

`RealtimeServerEvents['presence:sync']` accepts this payload. `boardId` is a
canonical lowercase UUID; `userIds` contains unique authenticated user IDs in
lexical order. A snapshot completely replaces the previous population. No names,
email addresses, avatars, socket IDs, credentials or ORM objects are delivered.
The twelve `RealtimeServerEvent` business events and `BoardRoomAck` are unchanged.
There were no `comment:*` events on the inspected base; G1 introduces none.

## Registry and module ownership

`BoardPresenceService` owns two in-memory indices:

- `boardId -> userId -> Set<socketId>` for multi-tab population.
- `socketId -> Map<boardId, userId>` for bounded disconnect cleanup.

Only string IDs are retained, never socket references. Removal prunes empty sets,
user maps, board maps and reverse entries. Repeated joins/leaves/removals are
idempotent. Snapshots are fresh arrays and cannot mutate the registry. Application
shutdown clears both indices. There is no entity, migration, REST endpoint,
polling, extra heartbeat, Redis or new dependency.

`RealtimeAccessModule` owns exactly one Presence provider and one
`BoardRoomCoordinator`. Coordinator holds the shared registry and server
reference. `RealtimeDeliveryModule` imports access and owns authentication,
broadcast and the business publisher as before. `RealtimeModule` and
`BoardMembersModule` reuse these imports. No cycle, `forwardRef`, global provider
or second runtime registry is introduced. Bootstrap assertions check the same
registry/coordinator identity through rooms, gateway, authentication, broadcaster
and membership orchestration.

## Lifecycle and ordering

### Join

1. Retain F1 identity/JWT expiry checks, shared rate limits and UUID validation.
2. Acquire the canonical board coordinator and query `BoardMember` authorization.
3. Recheck connection/expiry, await the adapter join, then recheck again.
4. Grant `authorizedBoardIds`, register the socket and synchronously deliver a
   snapshot to eligible registered viewers, including the joining socket.
5. Release the coordinator and return the unchanged join ACK.

The initial `presence:sync` is emitted **before** the successful `board:join` ACK.
Successful duplicate joins also resend a full snapshot. Multiple sockets for one
user never duplicate that user. Failed adapter joins revoke any existing grant
and registry entry for that socket/board; partially completed physical membership
cannot authorize delivery. A late join after disconnect cannot recreate Presence.

### Leave

Inside the board coordinator: revoke the receive grant, remove the socket,
synchronously deliver the resulting snapshot, then await adapter leave. A failed
adapter leave retains the existing `INTERNAL_ERROR` ACK; logical access and
Presence are already removed. Another tab retains the user. Repeated leave is
safe, including a board never joined. The leaving socket receives no snapshot.

### Disconnect, expiration and reconnect

Gateway disconnect clears the auth timer and asks coordinator to clean the socket.
Coordinator captures affected board IDs from both indices/grants and revokes all
grants synchronously before queueing per-board removal and snapshot delivery.
Browser/tab close, network/transport disconnect, client logout by disconnect and
server disconnect use this lifecycle; explicit `board:leave` is unnecessary.

JWT expiry uses F1's existing timer. Deactivation also revokes grants and queues
registry cleanup before attempting transport disconnect, so a throwing
`disconnect()` cannot keep the expired user present. This cleanup is deliberately
not awaited by `isActive()`: it can be called while a board queue is held. Timer
cleanup remains idempotent and retains the existing long-duration timer handling.

Reconnect creates a new socket and requires fresh JWT authentication, membership
authorization and board join. There is no state recovery or missed-event replay.
An old socket's late disconnect cannot remove a reconnected socket's entries.
REST logout alone does not invalidate a stateless JWT; the existing client must
disconnect its socket on logout, as in F1.

### Membership removal

The business service retains its transaction and sequencing unchanged:

```text
coordinator.run(boardId):
  authorize -> transaction -> COMMIT resolves
  evictUser:
    remove every target-user socket from this board's Presence
    revoke every target-user receive grant before adapter work
    synchronously deliver Presence to remaining eligible viewers
    await adapter leave; fall back to disconnect on failure
release coordinator
publish member:removed using the existing broadcaster
return HTTP 204
```

Rejected mutations and database rollback never reach eviction. Removed users
receive neither the removal Presence snapshot nor `member:removed`. Canonical
membership user IDs retain the F2a uppercase UUID protection. Other boards remain
available unless transport fallback actually disconnects the whole socket.
Presence emission failures are contained per recipient, so they neither stop
other recipients nor convert a committed REST mutation to HTTP 500.

## Concurrency and security decisions

All Presence mutations/snapshot delivery follow the existing per-board FIFO queue.
Different boards can proceed independently. Disconnect immediately revokes grants,
while its registry mutation waits for the relevant board operation to finish.
Joins check connection validity after every asynchronous authorization/adapter
boundary. Leave/revoke remove logical state before asynchronous adapter cleanup.

`syncPresence()` calls the registry's synchronous scoped delivery primitive; it
never calls `emitToBoard()` or reacquires `coordinator.run()`. Existing business
broadcast authorization/filtering is untouched. No async snapshot is captured for
later emission: snapshot construction and all Socket.IO `emit()` calls finish in
the same coordinator operation, preventing old callback results from overwriting
newer transitions on a transport.

Before snapshot construction, delivery prunes missing/disconnected/expired sockets,
identity mismatches and sockets without the board grant. Recipients must be both
registered viewers and active authorized sockets of that board, independently of
stale physical rooms. Each emit is isolated by a catch with a fixed log message.

Tests use explicit barriers for join/disconnect, duplicate join/disconnect,
join/revoke, leave/disconnect/revoke and SQL COMMIT. ACK barriers flush each client
transport before negative-delivery assertions; arbitrary sleeps are not used.
The synchronous scoped primitive acquires no nested lock. Queue maps and registry
indices are checked after cleanup.

## Verification

Run from repository root. The dedicated PostgreSQL check is an explicit Node
invocation, not an assumed package script. It creates, migrates and drops only a
random `kanban_presence_verify_*` database, requiring the same `CREATEDB` privilege
as existing integration checks.

```sh
pnpm --filter @kanban/shared build
pnpm --filter @kanban/backend test --runTestsByPath test/realtime/board-presence.spec.ts test/realtime/presence-concurrency.spec.ts test/realtime/board-room.spec.ts test/realtime/board-room-coordinator.spec.ts test/realtime/realtime-broadcast.spec.ts test/realtime/realtime-auth.spec.ts test/realtime/presence/presence.e2e-spec.ts test/boards/boards-module.spec.ts
pnpm --filter @kanban/backend exec node -r ts-node/register test/realtime/presence/presence.bootstrap.mjs --database
pnpm --filter @kanban/backend test
pnpm --filter @kanban/backend test:realtime:database
pnpm --filter @kanban/backend test:board-events:database
pnpm --filter @kanban/backend test:board-members:database
pnpm --filter @kanban/backend test:cards:database
pnpm --filter @kanban/backend test:activities:database
pnpm --filter @kanban/backend test:columns:database
pnpm lint
pnpm test
pnpm build
pnpm format:check
git diff main...HEAD --check
git diff --check
```

Local results on 2026-10-22 (Node 22.17.0, pnpm 10.18.3, native PostgreSQL 17):

- Presence Socket.IO: PASS, eight groups with real JWT/REST/services/transport and
  persistence doubles. This suite is not evidence of SQL transaction correctness.
- Presence PostgreSQL + Socket.IO: PASS, ten groups including gated real COMMIT,
  rollback, rejected removal, committed eviction, partial emission failure and
  double adapter/disconnect failure. Database membership is checked with fresh
  reads before commit and after delivery.
- Initial targeted service/concurrency checks: PASS, five suites / 36 tests;
  lifecycle/expiry/DI/transport checks: PASS, four suites / 18 tests. The additional
  duplicate-join/disconnect regression also passed in both full backend runs.
- Final transport rerun after the test-helper cleanup: PASS, one Jest test
  containing eight transport groups; final PostgreSQL rerun: PASS, ten groups.
- Manual QA with two users/two boards/three browser tabs: NOT RUN. G2 UI is out of
  scope and there is no browser Presence consumer in this change. Automated tests
  use multiple real Socket.IO clients and inspect the actual event payloads.

Initial new test failures (a cross-transport counter captured before a join
snapshot arrived and a multiline property-access lint issue) were fixed using
ACK barriers and an explicit request-agent variable.

| Command/check                                               | Final result                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| `pnpm --filter @kanban/shared build`                        | PASS                                                           |
| `pnpm --filter @kanban/backend test`                        | PASS: 41 suites / 296 tests                                    |
| `pnpm lint`                                                 | PASS                                                           |
| `pnpm test`                                                 | PASS: shared 6, backend 296, frontend 347 tests / 47 files     |
| `pnpm build`                                                | PASS; frontend retains its >500 kB chunk warning (821.77 kB)   |
| Presence PostgreSQL explicit Node command above             | PASS: 10 groups                                                |
| `pnpm --filter @kanban/backend test:realtime:database`      | PASS: 16 scenarios plus assignment cleanup/isolation           |
| `pnpm --filter @kanban/backend test:board-events:database`  | PASS: 8 groups, including all 12 business event contracts      |
| `pnpm --filter @kanban/backend test:board-members:database` | PASS: add/conflict/role/cleanup/revocation checks              |
| `pnpm --filter @kanban/backend test:cards:database`         | PASS: 12 groups                                                |
| `pnpm --filter @kanban/backend test:activities:database`    | PASS: 15 actions, rollback, post-commit events and feed checks |
| `pnpm --filter @kanban/backend test:columns:database`       | PASS: 5 groups                                                 |
| `pnpm format:check`                                         | FAIL: 371 unchanged files with CRLF, no changed-file overlap   |
| Prettier on all 24 changed/new files                        | PASS                                                           |
| `git diff main...HEAD --check`, `git diff --check`          | PASS                                                           |

Each of the 371 root format failures passed Prettier after CRLF-to-LF
normalization **in memory**. No baseline files or Git configuration were changed.
All deliberately injected adapter/emit failures log fixed error messages during
passing tests. The final `main...HEAD` diff contains the implementation and is
checked for whitespace, alongside the index/worktree and newly added files.

After local-commit authorization, shared build/tests passed again (6 tests), as
did the targeted service/concurrency/expiry checks (6 suites / 46 tests), lint,
Presence PostgreSQL + Socket.IO (10 groups) and formatting for all 24 G1 files.
Workspace tests passed again (shared 6, backend 296, frontend 347), and workspace
build passed with the same existing frontend chunk warning.
Root `format:check` was rerun and retained the same 371 unrelated CRLF failures.
Content hashes confirmed that selective staging preserved all implementation,
tests and task-index content; only this record changed to reflect authorization
and the actual commit grouping.

## Changed files and local commits

There are 24 task files: 17 modified and 7 added. No frontend code, dependency,
database schema or business-service rules changed. Existing database fixture
constructors now explicitly supply the registry to coordinator; their original
assertions remain intact.

Added:

```text
apps/backend/src/realtime/board-presence.service.ts
apps/backend/test/realtime/board-presence.spec.ts
apps/backend/test/realtime/presence-concurrency.spec.ts
apps/backend/test/realtime/presence/presence-checks.mjs
apps/backend/test/realtime/presence/presence.bootstrap.mjs
apps/backend/test/realtime/presence/presence.e2e-spec.ts
docs/tasks/backend/board-presence.md
```

Modified:

```text
apps/backend/src/realtime/board-room-coordinator.service.ts
apps/backend/src/realtime/board-room.service.ts
apps/backend/src/realtime/realtime-access.module.ts
apps/backend/src/realtime/realtime-auth.service.ts
apps/backend/src/realtime/realtime.gateway.ts
apps/backend/test/activities/activities.integration.mjs
apps/backend/test/board-members/board-members.integration.mjs
apps/backend/test/boards/boards-module.bootstrap.mjs
apps/backend/test/cards/cards.integration.mjs
apps/backend/test/realtime/board-room-coordinator.spec.ts
apps/backend/test/realtime/board-room.spec.ts
apps/backend/test/realtime/realtime-auth.spec.ts
apps/backend/test/realtime/realtime-broadcast.spec.ts
docs/tasks/README.md
packages/shared/src/realtime.ts
packages/shared/test/realtime-contracts.ts
packages/shared/test/realtime.test.mjs
```

The changes are grouped into seven actual local commits under the user's revised
authorization. Coordinator changes were selectively staged through cached patches;
the working implementation was preserved. Constructor fixtures accompany the
constructor change, and gateway/auth cleanup accompanies coordinator disconnect.
No empty commits or history rewriting were used:

1. `0d347a0 feat(shared): add board presence snapshot contract` — shared contract and
   runtime/type contract tests.
2. `1922a81 feat(realtime): add in-memory board presence registry` — Presence service,
   registry unit tests and access-module provider/export.
3. `86b6971 feat(realtime): synchronize presence on board join and leave` — room service,
   coordinator constructor/scoped sync, constructor fixtures and room regressions.
4. `94b835d fix(realtime): clean presence on disconnect and token expiry` — gateway,
   coordinator disconnect, auth deactivation, expiry regression and DI checks.
5. `2b577c3 feat(realtime): evict board presence after member removal` — coordinator
   eviction integration and concurrency/lifecycle/failure regression tests.
6. `1384311 test(realtime): verify presence transport and commit boundaries` —
   shared real Socket.IO/PostgreSQL harness and authorization/transaction checks.
7. `docs(realtime): document presence lifecycle and G2 handoff` — this record and
   task index.

## G2 handoff and limitations

Register `socket.on(RealtimePresenceEvent.SYNC, handler)` **before** emitting
`board:join`. Normalize/filter `boardId` and keep a pending snapshot for the active
join attempt. A Presence event may arrive before or near the ACK. On successful
ACK, apply the latest matching pending snapshot; future snapshots replace it.
Do not clear that pending snapshot merely because ACK success just arrived.

Treat ACK success as the joined-state boundary. A failed ACK discards pending
Presence and clears that board's state. On navigation, discard pending snapshots,
remove the exact listener, leave the old board and use a new view/join generation
so old callbacks cannot update the new view. On disconnect clear the displayed
population; reconnect installs the listener and rejoins before displaying users.
Use the authoritative members REST response to resolve IDs into profile details.
Presence itself carries only IDs, and frontend global state/dependencies need no
change in G1.

If an emit fails, join/REST success still succeeds and no retry is queued. A
successful rejoin resends the latest snapshot. Delivery is best effort, scoped to
one process, with no replay, distributed coordination or exactly-once guarantee.
Snapshots may repeat. Network loss remains detectable only when Socket.IO detects
disconnect using its existing transport timers. A stalled DB/adapter operation
can delay that board's queued cleanup, although revoked grants stop delivery
immediately. There is no cross-board total order. There is no access-revoked event;
retain F1/F2b handling of failed rejoin and REST authorization errors.

The existing overview/architecture prose predates merged F2a/comment/activity
implementation; G1 follows current source and the scoped realtime task records,
without rewriting unrelated architecture or introducing comment events.
