# Socket.IO Realtime Foundation (F1)

Implements [Issue #36](https://github.com/duongkienvn/SE2026-T13/issues/36) on
`feat/realtime-foundation`. F1 supplies authenticated connections, authorized board
rooms, revocation and an injectable broadcast boundary. F2 owns business event
schemas and integration into Column/Card REST services; G1/G2 own presence and
frontend realtime integration. No dependencies or migrations were added.

## Runtime and shared contract

The Nest-managed gateway shares the existing backend HTTP server. The default
namespace uses transport path `/socket.io`, independently of REST prefix `/api`.
`RealtimeIoAdapter` extends Nest's existing Socket.IO adapter. Both polling CORS
and WebSocket handshake admission use the validated `CORS_ORIGINS` allow-list.
Requests without Origin are allowed, consistently with REST, and still require
JWT authentication. Production environment validation rejects wildcard origins.

`packages/shared/src/realtime.ts` exports event names, `BoardRoomRequest`,
`BoardRoomAck`, and the client/server event interfaces. Only `board:join` and
`board:leave` are registered client events. Requests contain exactly one field,
`boardId`, validated as UUID and canonicalized to lowercase. No client-supplied
identity, role or room name is accepted.

```ts
import { io } from 'socket.io-client';
import {
  RealtimeEvent,
  type RealtimeClientEvents,
  type RealtimeServerEvents,
} from '@kanban/shared';

const socket = io<RealtimeServerEvents, RealtimeClientEvents>(BACKEND_URL, {
  path: '/socket.io',
  auth: { accessToken },
});

socket.on('connect', async () => {
  const result = await socket
    .timeout(5000)
    .emitWithAck(RealtimeEvent.BOARD_JOIN, { boardId });
  // Handle result.success / result.code; reload current data through REST.
});
```

Successful join/leave acknowledgements are `{ success: true, boardId }`.
Failures are `{ success: false, code, message }`; codes are `UNAUTHORIZED`,
`NOT_FOUND`, `VALIDATION_FAILED`, `TOO_MANY_REQUESTS`, or `INTERNAL_ERROR`. Non-members and absent
boards receive the same `NOT_FOUND` / `Board not found` response. Unexpected
errors return a generic failure and log only a fixed operational message.
Acknowledgements do not use the REST response envelope.

## Board room request limits

`HttpThrottlerGuard` intentionally skips WebSocket contexts. Join/leave instead
share `BoardRoomRateLimiter`: a fixed window admits up to 60 requests per 10
seconds per authenticated user, across all board IDs, events, tabs and reconnects.
At most four requests per user may be executing or queued, even across window
resets. Admission happens synchronously before payload validation, authorization
queries or the board queue. Rejected requests return `TOO_MANY_REQUESTS` without
adding work to that queue. Invalid payloads consume the same rate budget.

Permits are released in `finally`; window counters reset on the first request at
or after expiration. An unref'ed cleanup interval removes expired idle entries,
retains outstanding reservations and is cleared on application shutdown. This
single-process policy does not affect handshake authentication or REST limits.

## Authentication and expiration

Handshake middleware calls `AuthService.authenticateAccessToken()` and stores
only the verified identity in `socket.data.identity`. The shared auth method
validates signature, algorithm, issuer, audience, subject, expiration and user
existence. It now also requires a finite, safe integer expiration and returns
`expiresAt` in Unix milliseconds with `userId`; this internal context is shared
with REST, with no change to HTTP response schemas. Existing login tokens already
have this expiration. The credential is discarded from server-side handshake
auth after validation and is never included in application logs or errors.

A per-socket timer disconnects at expiration. Large durations are scheduled in
bounded chunks to avoid Node timer overflow. Join checks expiration again after
asynchronous authorization, and broadcast checks it immediately before emitting,
so timer delays cannot extend access. Disconnect/shutdown clear timers; Socket.IO
cleans its rooms and socket references. Every reconnect authenticates again and
starts with no board rooms. Connection-state recovery is disabled.

Handshake failures use `connect_error` with message `Unauthorized` and
`data.code = 'UNAUTHORIZED'`. A server expiration disconnect has Socket.IO's
`io server disconnect` reason. The client must obtain a valid token using the
existing auth flow, replace `socket.auth = { accessToken: validToken }`, call
`socket.connect()`, and join authorized boards again. F1 adds no refresh-token
protocol or production frontend implementation.

## Room authorization and membership revocation

`BoardRoomService` calls `BoardAuthorizationService.requireMember()` before every
join, including duplicate joins. Both OWNER and MEMBER can read archived boards.
Room names are constructed exclusively by the server as `board:{boardId}`.
Socket.IO Set membership makes repeated join/leave idempotent. A socket can join
several boards, and leave affects only the requested room.

`BoardRoomCoordinator` maintains a FIFO queue per canonical board ID. These
operations all use the same queue:

1. Authorization lookup and room join/leave.
2. The complete REST remove-member transaction, followed by eviction after commit.
3. Expiration checks and room broadcast.

Removal retains its existing permission rules, board row lock, assignment cleanup
and database transaction. Only after TypeORM's transaction promise resolves does
it revoke every socket's receive access and attempt to leave that board's room. It releases the board
queue after eviction attempts complete. A failed transaction does not revoke
access. If room eviction fails, disconnect is attempted. If disconnect also
throws, the connection may remain open in a stale adapter room. Both failures are
logged using fixed messages and do not turn the committed removal into a failed
HTTP response.

Receive authorization is held separately in `socket.data.authorizedBoardIds`.
A successful, authorized join adds a grant; leave removes it before adapter work;
disconnect clears it. Removal revokes grants on every affected connection before
the first adapter operation, without depending on the adapter's room maps.
`RealtimeBroadcastService` selects sockets by these grants and current token
validity and emits directly to eligible connections. With recovery disabled,
direct emission does not use adapter rooms for recipient selection. Consequently,
even a socket whose leave and disconnect both fail cannot receive another event
for its revoked board through the broadcast service. Other live, authorized
connections keep receiving events. Physical cleanup failure remains visible in logs;
logical revocation does not depend on cleanup succeeding.

This closes both relevant races: a join already checking membership finishes
before removal and then loses receive access; a join or broadcast queued during
removal cannot run between commit and revocation. Operations on other boards continue.
Queue entries are removed when their last operation finishes, including failures.
There is no presence registry or online-user aggregation.

`RealtimeAccessModule` has no business imports and owns the shared coordinator.
`BoardMembersModule` imports this small module, while `RealtimeModule` imports
AuthModule, BoardMembersModule and RealtimeAccessModule. The dependency graph has
no cycle; business services never inject a gateway.

The guarantee is for this single backend process and membership removals through
`BoardMembersService.remove()`. Direct SQL or another process modifying membership
does not trigger eviction. Future membership-removal paths must use the same
boundary. Broadcasts emitted before removal commits may already be in transit;
those bytes cannot be retracted. No broadcast submitted through this service
after commit can overtake revocation. Do not bypass the service with raw room emits,
enable recovery, or add a distributed adapter without reviewing this invariant.

## Broadcasting from future business services

Import `RealtimeModule` into the consuming business module and inject the exported
`RealtimeBroadcastService`. Its typed API is
`emitToBoard(boardId, event, ...eventArguments): Promise<boolean>`. Call it after
the business transaction has resolved and outside `coordinator.run()`; the queue
is intentionally not reentrant. Business transactions must never await a broadcast
while still holding the board queue.

The production `RealtimeServerEvents` interface is empty until F2/G1 add reviewed
event names and signatures. The API enforces event names and arguments from that
map. Tests extend it with `test:board` in `test/realtime/realtime.fixture.ts`; the backend
build excludes tests and contains no fake business event contract. Executable
usage is in `test/realtime/realtime-broadcast.spec.ts` and `test/realtime/realtime-checks.mjs`.

Emission targets only authorized connections for the selected Board. No subscribers is a successful
no-op. An unavailable server or failed emission returns `false`; emission errors
log a fixed message without event payload, token or exception object. Persistence
is never rolled back by this helper. Delivery remains best effort, with no replay,
outbox or retry; clients must reload authoritative state via REST after reconnect.

## Verification

Run from the repository root:

```sh
pnpm lint
pnpm test
pnpm build
pnpm format:check
pnpm --filter @kanban/backend test:realtime
pnpm --filter @kanban/backend test:realtime:database
```

Default tests include real HTTP, JWT, Nest DI and Socket.IO transports with
isolated repository doubles. The separate database command reads the existing
connection configuration, creates a random `kanban_realtime_verify_*` database,
runs migrations only there, then drops it in cleanup. PostgreSQL credentials need
CREATEDB permission. The configured development database is never migrated or
used for test fixtures. The existing frontend Socket.IO client is reused from the
workspace without adding a backend dependency.

Both Socket.IO runs cover 16 scenario groups: REST login, invalid JWT variants,
origins on both transports, OWNER/MEMBER/archived access, malformed/spoofed room
requests, isolation, multiple rooms, transport reconnect, expiration, delayed
timer protection, failed removal, concurrent removal/broadcast/join, post-removal
reconnect, rejection of client-driven generic broadcasts, and shared join/leave
flood limits across board IDs, tabs and reconnects, plus post-commit leave and
disconnect double failure with HTTP 204 and no subsequent delivery. Unit tests
also check window reset boundaries, bounded pending requests across resets, and
limiter cleanup. The concurrency test
pauses after the real transaction commits but before the remove service resumes,
proving broadcasts/joins wait through the eviction gap. Ordered acknowledgement
barriers check non-delivery without arbitrary sleeps. PostgreSQL additionally
checks active/archived card assignment cleanup and preservation on another board.

Unit tests cover timer cleanup/overflow, authorization ordering and sanitized
errors, FIFO ordering, rollback, all-tab eviction, disconnect fallback and failed
emissions. AppModule bootstrap tests exercise the real module import graph.

Review fixes verified on 2026-10-15: lint, full tests (shared 3, backend 157, frontend 175),
workspace build and both Socket.IO E2E/database runs pass. The frontend build
retains its existing large-chunk warning. All 17 files changed by the review fixes
pass Prettier. Root `format:check` fails on 221 files outside F1: two have
formatting violations in the original `main` content, and 219 have checkout CRLF
line endings from `core.autocrlf=true` while Prettier expects LF. This was checked
against `git show main:<path>` and by checking CRLF-normalized content in memory;
unrelated files and Git configuration were left untouched.

The first review-fix database run overlapped the root test's shared-package
rebuild and failed to resolve its temporarily missing declarations. Rerunning
after that build completed passed all 16 scenarios against a temporary database.

## Technical review fix file inventory

Only the two security findings are addressed by these changes:

- `apps/backend/src/realtime/board-room-rate-limiter.service.ts` (new)
- `apps/backend/src/realtime/board-room.service.ts`
- `apps/backend/src/realtime/board-room-coordinator.service.ts`
- `apps/backend/src/realtime/realtime-broadcast.service.ts`
- `apps/backend/src/realtime/realtime.gateway.ts`
- `apps/backend/src/realtime/realtime.module.ts`
- `apps/backend/src/realtime/realtime.types.ts`
- `packages/shared/src/realtime.ts`
- `apps/backend/test/realtime/board-room-rate-limiter.spec.ts` (new)
- `apps/backend/test/realtime/board-room.spec.ts`
- `apps/backend/test/realtime/board-room-coordinator.spec.ts`
- `apps/backend/test/realtime/realtime-broadcast.spec.ts`
- `apps/backend/test/realtime/realtime-checks.mjs`
- `apps/backend/test/realtime/realtime.bootstrap.mjs`
- `apps/backend/test/realtime/realtime.e2e-spec.ts`
- `apps/backend/test/realtime/realtime.integration.mjs`
- `docs/tasks/realtime-foundation.md`
