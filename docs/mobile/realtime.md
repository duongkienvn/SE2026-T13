# Mobile realtime (MOB-06)

## Verified server contract

MOB-04, MOB-05 and MOB-03 are present on the task's latest main. Realtime uses
the existing mobile data/session owners; it introduces no server or database change.

- Origin: validated `EXPO_PUBLIC_API_BASE_URL` origin, independent of `/api`.
  Default namespace `/`, Engine.IO path `/socket.io`. No cookie or page origin.
- Handshake: `auth: { accessToken }`. `RealtimeAuthService` verifies JWT, current
  account/authVersion, expiry and revoked sessions. Explicit handshake failure
  carries `data.code = 'UNAUTHORIZED'`. Server disconnect alone is ambiguous.
- Client commands: `board:join` / `board:leave`, exactly `{ boardId: UUID }`.
  `BoardRoomAck` is `{ success: true, boardId }` or a shared failure code:
  UNAUTHORIZED, NOT_FOUND, VALIDATION_FAILED, TOO_MANY_REQUESTS, INTERNAL_ERROR.
- Join rechecks `BoardAuthorizationService.requireRead`, including independent
  Board/Workspace grants. Workspace ADMIN does not grant PRIVATE Board access.
  Archived Boards remain readable, with REST capabilities controlling edits.
- `presence:sync` is a full `{ boardId, userIds }` snapshot and can precede join
  ACK. It is ephemeral, not background presence or a permission grant.
- Board events are the `RealtimeServerEvent` constants in `@kanban/shared`:
  Board access/archive/restore; Column create/update/move/delete; Card create,
  update/move/archive/restore/assignees; members; comments; labels. Card updates
  optionally carry changeScope and operationId; comment events optionally carry
  operationId. Payload IDs are validated before choosing queries.
- User channels require no client join: `notifications:changed` carries `{}`;
  `access:changed` has no payload; `workspace:access-revoked` has workspaceId.
  Board access-revoked carries boardId. Membership removal may retain read access;
  REST rechecks it. No Board deletion event exists: use access hints / REST 404.
- Business broadcasts follow commit. Backend receive grants, ordered room changes
  and authVersion checks remain authoritative; adapter membership is not a grant.
  Socket.IO recovery is disabled server-side. Rejoin and REST resync are required.

Sources: `packages/shared/src/realtime.ts`, `notifications.ts`, backend
`realtime.gateway.ts`, `realtime-io.adapter.ts`, `realtime-auth.service.ts`,
`board-room.service.ts`, `board-room-coordinator.service.ts`, broadcast publishers,
and `BoardsController` / `BoardResponseDto`.

## Runtime ownership and lifecycle

`nativeRealtime` is the app-lifetime owner, alongside `nativeSession` and
`nativeData`. The root nests `AuthSessionProvider → DataProvider → RealtimeProvider`
around the existing navigation shell. `DataProvider` forwards its existing
AppState/Expo Network observations; realtime adds no competing native listener.
Unknown startup connectivity does not connect a socket. The existing MOB-05
foreground expiry checks and offline-uncertain recovery remain intact.

Only a verified authenticated session, foreground app and permitted network can
connect. Each attempt gets a separate, non-multiplexed Socket.IO Manager with
automatic reconnection disabled: the controller owns the bounded retry budget.
The auth callback reads the live credential at handshake time. After a connection
loss or background pause, `/users/me` is verified through the existing transport
before creating a socket. Only a matching 401 or explicit UNAUTHORIZED handshake/
room ACK ends the session. A generic disconnect/network/5xx is not proof of bad JWT.

Retries use 500/1,000/2,000/4,000 ms delays, at most four retries per wake episode;
each socket handshake has a ten-second deadline. Once exhausted, call `retry()`
or wait for a real foreground/network transition. Room ACKs have five seconds and
three bounded 250/500/1,000 ms retries. Transient REST access probes also retry
three times. An uncertain leave closes the connection rather than trusting that
server delivery stopped. Stop/disposal removes listeners, aborts verification and
probes, cancels timers and clears ephemeral presence. Session generation and
connection/room attempt epochs reject callbacks from all older attempts.

## Feature integration

Future Board/Card screens use `useBoardRealtime(boardId, active)` inside the
existing protected session tree. Supply actual route focus (for example React
Navigation's `useIsFocused()`); mounted hidden tabs must pass false. The hook owns
one consumer, reference-counts consumers on the same Board, and releases it on
blur, logout, account change and unmount. `useRealtimeStatus()` gives reactive
connection status without adding UI. `useRealtime()` exposes retry controls.

The Board snapshot is token-free: status, canRead/canWrite, workspaceId and current
userIds. It starts without access. Render protected values only when canRead is
true, and enable edits only when canWrite is true. Presence is displayed only in
live status. Before join, `GET /boards/:boardId` verifies read/capability/archive
state. Events and join ACKs do not manufacture write permission. Presence arriving
before a successful join ACK is buffered only for that current attempt.

Use MOB-04's exported keys for all queries and bind HTTP work to that same key:

```ts
const identity = data.getIdentity(); // data = useMobileData()
if (!identity) return;
const key = queryKeys.card(identity, boardId, cardId);
await data.queryClient.fetchQuery({
  queryKey: key,
  queryFn: ({ signal }) =>
    data.api.json(
      `/boards/${encodeURIComponent(boardId)}/cards/${encodeURIComponent(cardId)}`,
      decodeCard, // feature-owned runtime decoder / shared contract projection
      { identity, resourceKey: key, signal },
    ),
});
```

Always forward captured identity, resourceKey and Query's signal. An unscoped
request cannot provide resource-specific cancellation/fencing. Feature writes use
`data.optimistic({ identity, key, update, mutation, reconcile?, invalidate? })`;
include all overlapping list/preview keys in invalidate. Tag the mutation's HTTP
call with resourceKey too. The existing coordinator serializes same-key writes,
rolls back only its unchanged revision and releases the lock before refetch ends.

## Reconciliation and access loss

Fifty-millisecond hint batching unions affected keys. Overlapping optimistic
resource keys defer their hints until settlement; other Board keys proceed. Local
settlement invalidation and buffered echoes share a refresh. Same-user device
events are never discarded by actor identity. Generic events without changed-field
information retain a broader Card-level fallback. Uncorrelated hints arriving
after a refresh may require another authoritative read; never guess that they are
local echoes. No feature automatically scans every page of a Board.

Columns target columns. Card events target Card/list/preview/task/Home/search keys;
attachments and checklists narrow to their child and preview keys. Comments target
comments (and count previews on create/delete); label catalogs refresh associated
Card caches, previews and embedded labels in My Tasks/Home. Membership/Board
changes refresh relevant summaries and access.
Notifications invalidate only the existing notifications prefix. Reconnect recovers
eligible active queries; confirmed Board rejoin refreshes that Board's active keys.

On access hints, scoped REST 403/404, own membership removal or downgrade, relevant
receive state is fenced synchronously. Pending resource HTTP is aborted, protected
data is evicted, writes stop and stale results/queued optimistic edits cannot put
it back. Active Query objects retain only empty error state so observers can
authoritatively recover after a fresh grant; inactive queries are removed. Resource
epochs supplement the existing session generation. They are local stale-work
guards, never replacements for server authorization.

Workspace revocation and ID-free access hints conservatively clear access-bearing
snapshots and recheck active Boards independently. An explicit Board grant can
remain valid after Workspace membership ends. Bursts of access hints share one
probe per affected Board. Archival stays readable but read-only after REST confirms
it. Board deletion has no invented event: the real access hints / REST 404 revoke
it. A caller can explicitly retry an unavailable Board through `retryBoard(id)`;
success still requires REST and the server's room ACK.

Connection loss also drops access-bearing snapshots/presence and fences pending
work. Missed events cannot be assumed delivered. Session end additionally uses
MOB-04's private-state reset before the next identity publishes. Dispose realtime
before data/session when replacing an app runtime; individual screens only release
their subscriptions. Nothing persists sockets, presence or business data offline.

Access reconciliation refreshes the fenced aggregate prefixes (Board Lists,
Workspace lists, Notifications, Home, Tasks and Search) through their authoritative
REST queries after the batched Board checks. Global access checks also recover
eligible Workspace detail observers. Confirmed Board/Workspace loss remains
fenced; aggregate success never grants access to those resource keys. Adjacent
access hints share one check/refetch batch, including screens without a Board
subscription. Confirmed revocation also refreshes safe aggregates so mounted
observers can leave their empty access-change error state.

## Verification commands and limits

Run `pnpm test:mobile`, mobile typecheck, root lint/build/test and
`pnpm bundle:mobile`. `pnpm --filter @kanban/mobile test:realtime:local` is an
explicit local-only smoke: real Nest REST/JWT/Socket.IO, two native controllers,
current-user/Board verification, same-user presence, Card convergence and missed
event recovery. It uses existing backend repository doubles, binds an ephemeral
loopback port, creates no database and makes no production calls. Build shared
first when invoking it outside the root wrapper.

Fake-timer/socket integration tests measure actual HTTP requests and cover
generation changes, malformed events/ACKs, bounded retries, duplicate consumers,
presence order, revocation, queued writes, late results and disposal. Device
background/network toggling and native iOS are separate checks; a JS smoke does
not establish native OS scheduling behavior. No background sockets, push,
FCM/APNs, offline editing, feature UI or new backend contracts are included.
