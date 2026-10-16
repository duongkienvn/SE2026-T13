# Realtime Board Events Backend (F2a)

Implements [Issue #40](https://github.com/duongkienvn/SE2026-T13/issues/40)
on `feat/realtime-board-events`, based on `main` at `0e06fae` (F1/E1/E2 merged).
REST remains the mutation boundary and PostgreSQL the source of truth. No schema,
dependency, frontend, Presence, Comment, Activity or Board CRUD event is added.

## Shared contract and REST integration

`@kanban/shared` exports `RealtimeServerEvent`, `RealtimeServerEvents` and these
four payload interfaces. F1 `RealtimeEvent`, `RealtimeClientEvents` and room
acknowledgements remain unchanged.

```ts
export interface ColumnChangedEvent {
  boardId: string;
  columnId: string;
}
export interface CardChangedEvent {
  boardId: string;
  cardId: string;
  columnId: string;
}
export interface CardMovedEvent {
  boardId: string;
  cardId: string;
  fromColumnId: string;
  toColumnId: string;
}
export interface MemberChangedEvent {
  boardId: string;
  userId: string;
}
```

Each signature in `RealtimeServerEvents` is `(payload: CorrespondingType) => void`.
All paths below are under `/api/boards/:boardId` and require the existing REST
authentication/authorization. The table is also the F2b event/invalidation matrix;
the query descriptions are suggestions, not invented query keys.

| Event                    | Successful REST mutation                                                   | Payload              | Suggested invalidation                                |
| ------------------------ | -------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------- |
| `column:created`         | `POST /columns`                                                            | `ColumnChangedEvent` | Board columns                                         |
| `column:updated`         | `PATCH /columns/:columnId`                                                 | `ColumnChangedEvent` | Board columns                                         |
| `column:moved`           | `PATCH /columns/:columnId/move`                                            | `ColumnChangedEvent` | Board columns/order                                   |
| `column:deleted`         | `DELETE /columns/:columnId`                                                | `ColumnChangedEvent` | Board columns; remove deleted detail                  |
| `card:created`           | `POST /cards`                                                              | `CardChangedEvent`   | Board/column card lists                               |
| `card:updated`           | `PATCH /cards/:cardId`                                                     | `CardChangedEvent`   | Card detail and card lists                            |
| `card:moved`             | `PATCH /cards/:cardId/move`                                                | `CardMovedEvent`     | Source/destination lists, board cards, detail         |
| `card:archived`          | `POST /cards/:cardId/archive`                                              | `CardChangedEvent`   | Active card lists and detail                          |
| `card:assignees-changed` | `POST /cards/:cardId/assignees`, `DELETE /cards/:cardId/assignees/:userId` | `CardChangedEvent`   | Card detail/assignees and relevant lists              |
| `member:added`           | `POST /members`                                                            | `MemberChangedEvent` | Board members and permission UI                       |
| `member:role-changed`    | `PATCH /members/:userId`                                                   | `MemberChangedEvent` | Board members and permission UI                       |
| `member:removed`         | `DELETE /members/:userId`                                                  | `MemberChangedEvent` | Members, card assignments/detail/lists, permission UI |

Payloads contain IDs only. They never contain title, description, deadline, email,
JWT, hashes, relations, ORM objects or transport errors. Board IDs are canonical
lowercase. Card move captures `fromColumnId` from persisted state before changing
the Card; its destination comes from the committed result. Other Card events use
the Card's authoritative current column. Member events identify the target user.

Example `card:moved` payload:

```json
{
  "boardId": "c6ba7134-97ef-4c1b-a342-001a982a7721",
  "cardId": "a6ba7134-97ef-4c1b-a342-001a982a7721",
  "fromColumnId": "d6ba7134-97ef-4c1b-a342-001a982a7721",
  "toColumnId": "e6ba7134-97ef-4c1b-a342-001a982a7721"
}
```

## Dependency graph and delivery ownership

```text
RealtimeAccessModule -> BoardRoomCoordinator (one provider)
RealtimeDeliveryModule -> AuthModule + RealtimeAccessModule
  owns RealtimeAuthService, RealtimeBroadcastService, BoardEventPublisher
RealtimeModule -> RealtimeDeliveryModule + BoardMembersModule + RealtimeAccessModule
  owns gateway, room service and existing rate limiter
ColumnsModule/CardsModule/BoardMembersModule -> RealtimeDeliveryModule
```

Delivery imports no board business module, so there is no circular dependency or
`forwardRef`. Importing the same Nest module reuses its providers. The real
AppModule bootstrap test checks identity of the coordinator in gateway, rooms,
broadcaster and membership service, authentication in gateway/rooms/broadcaster,
and publisher in all three business services. RealtimeModule re-exports delivery
to retain the F1 broadcaster import boundary.

`BoardEventPublisher.publish()` accepts only reviewed business event names and
their shared argument types. It delegates to F1 `emitToBoard()`. The broadcaster
uses the concrete Socket.IO event map without an untyped `Socket` cast. Recipient
selection still requires both the application-owned board grant and an active
JWT, independently of physical adapter room membership. Connection-state recovery
remains disabled. No business command is registered on the inbound gateway.

## Commit, no-op and revocation boundaries

Each service awaits its existing TypeORM transaction before constructing and
publishing the minimal payload, then returns the existing REST DTO/status.
CardsService retains its existing transaction helper and Board row lock protocol;
there is no new transaction wrapper, subscriber or duplicate controller emission.
No delivery happens while DB locks are held. Ordering/rebalance algorithms and
authorization rules remain those of E1/E2.

F2a follows the Issue #40 sequence **commit -> best-effort publish -> REST response**.
The older developer-guide diagram places response before broadcast; this scoped
guide records the explicit F2a contract. Transaction callback completion alone
does not trigger publication: commit must resolve successfully. A rejection at
authorization, validation, persistence or commit skips publication.

No event is emitted for an unchanged Column name, unchanged membership role,
Card PATCH with identical supplied values, or effective no-op Column/Card reorder.
Date equality compares instants, including equivalent timezone representations.
No-op responses remain successful with the same public DTO. Unchanged values are
not saved. Re-archiving already archived Cards retains E2's conflict response.

Membership removal preserves this strict sequence:

```text
coordinator.run(boardId) {
  transaction: assignment cleanup + member delete + COMMIT
  evictUser: revoke every affected tab's board grant before adapter cleanup
}
release coordinator queue
publish member:removed (broadcaster acquires the queue itself)
```

The removal event goes only to remaining authorized sockets. Even if both
`leave()` and `disconnect(true)` throw, F1 grants remain revoked and stale physical
rooms cannot authorize future board emissions. Other board grants survive if the
transport remains connected. Adding a member does not automatically grant a room.
Removal checks and eviction use the matched membership's canonical user ID, so
uppercase UUIDs accepted by PostgreSQL cannot bypass self/creator protection or
leave stale receive grants. PostgreSQL and transport tests cover this case.

Delivery returning false or throwing cannot undo committed state or turn REST
success into HTTP 500. Publisher logs contain fixed messages only. F1 already
catches transport errors; the publisher also guards an unexpectedly rejecting
broadcaster. This is best-effort invalidation, not a client acknowledgement.

## F2b handoff

Shared contracts are available from the first local F2a commit. No frontend code
or remote message/PR is created by this task. MyleCutie45 can mock these exact
contracts immediately after receiving the branch changes through the team.

Typing example for the existing frontend Socket.IO client:

```ts
import type { Socket } from 'socket.io-client';
import {
  RealtimeEvent,
  RealtimeServerEvent,
  type RealtimeClientEvents,
  type RealtimeServerEvents,
} from '@kanban/shared';

declare const socket: Socket<RealtimeServerEvents, RealtimeClientEvents>;
declare const boardId: string;

socket.on(RealtimeServerEvent.CARD_MOVED, (payload) => {
  if (payload.boardId !== boardId) return;
  // Invalidate board cards, both column lists and card detail; refetch via REST.
});
socket.emit(RealtimeEvent.BOARD_JOIN, { boardId }, (ack) => {
  if (ack.success) {
    // Refetch authoritative board/columns/cards/members after every join/rejoin.
  }
});
```

Authenticate with `auth: { accessToken }` on `/socket.io` using the same JWT as
REST. Await the F1 `board:join` acknowledgement before treating a Board as joined.
On navigation emit `board:leave`, remove the exact listeners installed by the
view, and handle `TOO_MANY_REQUESTS` without retry floods. F1 quota remains 60
join/leave requests per authenticated user per 10 seconds and at most 4 pending,
shared across boards, events, tabs and reconnects. REST throttling is unchanged.

Refetch after every reconnect and successful rejoin; there is no missed-event
replay. Treat local REST success plus a matching event idempotently. Filter by
boardId and coalesce invalidations using the frontend's existing query key design.
The removed user deliberately receives no removal event: handle REST 404 and
failed rejoin by clearing inaccessible board state. An owner role change requires
refetching permission-derived UI; JWT carries identity, not board authorization.

Single-instance delivery has no outbox, persistence, replay, exactly-once,
cross-instance delivery or global causal ordering guarantee. A process crash
between commit and emit can lose an event. Emission can partially succeed before
a transport exception; a true broadcast result does not mean clients consumed it.
Event arrival order need not match concurrent transaction order. Use REST state
and reconnect/focus resync rather than permanently applying payloads as state.

## Tests and commands

Shared tests check all twelve names in ESM/CommonJS and compile positive/negative
TypeScript contracts. Service tests cover exact payloads, one publication per
successful mutation, commit rejection, authorization failures, no-ops, assignment
errors and membership queue release. Publisher tests cover true/false/throw.

`board-events.e2e-spec.ts` launches the real AppModule, REST controllers/services,
JWT and Socket.IO server/client against repository doubles. Its seven groups
cover all twelve contracts, Board/tab isolation, unjoined and nonmember sockets,
expired JWT, server-only events, rejected/no-op mutations, revoked sockets despite
double adapter failure, another Board remaining accessible and transport failure.
This suite alone does not establish PostgreSQL transaction correctness.

`test:board-events:database` runs the same transport checks against a random
`kanban_events_verify_*` PostgreSQL database with the real migrations, then runs
seven more focused commit/race groups. It pauses a real QueryRunner immediately
before COMMIT and uses acknowledged socket packets as delivery barriers. Fresh
reads prove invisibility before commit and persistence after delivery. Injected
commit failures exercise real rollback of Card/Column writes and membership plus
assignment cleanup. A separate connection acquires the Board lock with NOWAIT
during delivery, proving the mutation released its lock. Concurrent creates and
updates check persisted state and one event per socket without asserting global
arrival order. The removal race queues a join and a committed Column broadcast
while post-commit eviction is paused, then injects leave+disconnect failure.

The two transport suites use independent application lifetimes, retaining the real
F1 rate limiter. PostgreSQL cleanup drops only the generated database, even on
failure. Existing F1/E1/E2 PostgreSQL scripts retain their original assertions;
their direct service constructors supply an explicit no-op publisher because
those regression phases do not instantiate a transport server. F2a tests above
exercise the actual publisher and broadcaster.

Run from the repository root:

```sh
pnpm lint
pnpm test
pnpm build
pnpm format:check
pnpm --filter @kanban/backend test --runTestsByPath test/board-event-publisher.spec.ts test/columns-events.spec.ts test/cards-events.spec.ts test/board-members.service.spec.ts test/boards-module.spec.ts test/board-events.e2e-spec.ts test/realtime.e2e-spec.ts
pnpm --filter @kanban/backend test:board-events:database
pnpm --filter @kanban/backend test:realtime:database
pnpm --filter @kanban/backend test:columns:database
pnpm --filter @kanban/backend test:cards:database
pnpm --filter @kanban/backend test:board-members:database
git diff main...HEAD --check
```

Local verification on 2026-10-16 (Node 22.17.0, pnpm 10.18.3):

| Check                       | Result                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm lint`                 | PASS                                                                                       |
| `pnpm test`                 | PASS: backend 32 suites / 252 tests, frontend 28 files / 175 tests, shared 5 tests         |
| `pnpm build`                | PASS; existing frontend 664.90 kB chunk warning                                            |
| Targeted tests              | PASS: initial 7 suites / 52 tests; final canonical-ID regression rerun 4 suites / 20 tests |
| F2a PostgreSQL + Socket.IO  | PASS: 8 top-level groups including the 7-group event/security suite                        |
| F1 PostgreSQL + Socket.IO   | PASS: 16 scenarios plus assignment cleanup/isolation                                       |
| E1 PostgreSQL               | PASS: 5 groups                                                                             |
| E2 PostgreSQL               | PASS: 12 groups                                                                            |
| Board membership PostgreSQL | PASS: add/duplicate/roles/cleanup/revocation                                               |
| `pnpm format:check`         | FAIL: 271 unchanged files outside F2a with existing format/CRLF differences                |
| Targeted Prettier           | PASS: all 31 changed F2a files; no overlap with the 271 root failures                      |
| Git whitespace checks       | PASS: worktree diff and `main...HEAD`                                                      |

The initial new-code type/lint and test-harness failures were corrected and their
checks rerun successfully. No PostgreSQL check was blocked or replaced by mocks.
One membership regression invocation overlapped the root shared-package rebuild
and failed with transient missing `shared/dist/cjs`; the sequential rerun passed.
The root suite and workspace build also passed again after the canonical-ID fix.
Expected fixed-message error logs in transport tests come from injected
leave/disconnect/delivery failures. No unrelated formatting or Git configuration
was changed. No remaining implementation blocker is known; review should focus
on module singleton ownership, commit boundaries and revocation ordering.

Final Issue #40 completion still requires separately authorized PR, CI, automated
and human review, and merge. This task stops at the local branch.
