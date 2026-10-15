# Board Members and Permissions API (D2)

Implemented on `feat/board-members` using the existing `BoardMember` domain model.
No new dependency, database entity or migration was required. Board membership
remains the source of truth for authorization. No commit, push or pull request
was created.

## HTTP contract

All routes use the existing JWT guard and the authenticated `userId`. MVP roles
are `OWNER` and `MEMBER`.

| Method | Route                                      | Success | Permission          |
| ------ | ------------------------------------------ | ------- | ------------------- |
| GET    | `/api/boards/:boardId/members`             | 200     | OWNER or MEMBER     |
| POST   | `/api/boards/:boardId/members`             | 201     | OWNER               |
| PATCH  | `/api/boards/:boardId/members/:userId`     | 200     | OWNER               |
| DELETE | `/api/boards/:boardId/members/:userId`     | 204     | OWNER               |

List responses use the existing paginated response shape with `page`, `limit`,
`total` and `totalPages`. Member responses expose only the public user fields
through `UserResponseDto`; password hashes and internal persistence fields are
never returned.

Adding a member accepts a registered email, trims and normalizes it to lowercase,
and assigns `MEMBER` by default. Duplicate membership returns `409`. Role
updates accept only `OWNER` or `MEMBER`.

The global validation pipe rejects unknown fields and invalid UUIDs. Errors use
the existing error envelope. Missing boards and users without membership are
intentionally returned as `404` to avoid exposing board membership information.
Mutations on archived boards return `409 BOARD_ARCHIVED`.

## Authorization and invariants

`BoardAuthorizationService` is shared by board management and member management.
It centralizes member access and OWNER mutation checks while keeping business
logic in services instead of Socket.IO gateways or controllers.

The implementation preserves these invariants:

- A board creator is initially an OWNER through the existing board creation flow.
- An OWNER cannot demote or remove the last OWNER.
- An OWNER cannot remove or demote themself through these routes.
- A member cannot add, update or remove another member.
- Removing a member also removes that user's assignments from every card on the
  board, including archived cards.
- Member removal and assignment cleanup run in one transaction.
- Successful persistence is completed before any future realtime notification is
  added at the transport boundary.

## Architecture

The feature is implemented as a dedicated backend module with controller, DTOs,
authorization service and member service. It uses TypeORM repositories and the
existing PostgreSQL schema. REST remains responsible for commands, queries and
initial data; no Redis, Kafka, CQRS, CRDT or global frontend state library was
introduced.

## Automated verification — 2026-10-14

| Check                                                        | Result                                      |
| ------------------------------------------------------------ | ------------------------------------------- |
| `pnpm lint`                                                  | PASS                                        |
| `pnpm test`                                                  | PASS: backend 117, frontend 75, shared 2   |
| `pnpm --filter @kanban/backend test:board-members:database`  | PASS with real Docker PostgreSQL             |
| Backend build                                                 | PASS                                        |
| `git diff --check`                                           | PASS                                        |
| Docker PostgreSQL healthcheck                               | PASS: healthy on `127.0.0.1:5433`          |
| `pnpm format:check`                                          | Existing unrelated formatting failures     |

The PostgreSQL integration test creates a temporary database, runs migrations,
and verifies member creation, duplicate conflict handling, role transitions,
assignment cleanup across active and archived cards, and access revocation.
The temporary database is removed after the test.

The repository-wide format check still reports pre-existing formatting errors in
unrelated files; this task does not reformat those files.
