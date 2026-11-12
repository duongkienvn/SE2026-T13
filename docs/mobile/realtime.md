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
