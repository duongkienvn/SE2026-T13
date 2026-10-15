# Issue #20 — Board Management API (D1)

Implemented on `feat/boards`, based on `main` at `aa5539f` (confirmed against
GitHub before implementation). No push, pull request or merge was performed.
There are no entity, migration, dependency or CI changes.

## HTTP contract

All routes use the existing JWT guard and authenticated `userId`. Roles always
come from `BoardMember` in PostgreSQL; creator identity and JWT role claims do
not grant board access.

| Method | Route                          | Success | Permission         |
| ------ | ------------------------------ | ------- | ------------------ |
| POST   | `/api/boards`                  | 201     | Authenticated user |
| GET    | `/api/boards`                  | 200     | Current membership |
| GET    | `/api/boards/:boardId`         | 200     | OWNER or MEMBER    |
| PATCH  | `/api/boards/:boardId`         | 200     | OWNER              |
| POST   | `/api/boards/:boardId/archive` | 200     | OWNER              |

Create accepts `name` (string, trimmed, 1–120 characters) and optional
`description` (string up to 2000 characters, or `null`). Update accepts either
field or both and requires at least one supplied field. Omitting `description`
preserves it; `null` clears it and the empty string is valid. Unknown fields are
rejected by the global validation pipe. UUID path validation uses `ParseUUIDPipe`.
Swagger documents the envelopes, DTO lengths/nullability, PATCH field requirement,
UUID parameters, pagination defaults and bearer security.

`BoardResponseDto` contains only `id`, `name`, `description`, `createdById`,
`isArchived`, `archivedAt`, `createdAt`, `updatedAt`, and `currentUserRole`.
All timestamps are ISO 8601 strings; `archivedAt` is nullable.

Single responses use `{ success, statusCode, message, data }`. List adds
`meta: { page, limit, total, totalPages }`. Messages are `Created`, `OK`,
`Board updated`, and `Board archived`, as appropriate.

List uses `PageQueryDto`: page 1, limit 20, maximum limit 100. It joins only the
current user's membership, excludes archived boards, and uses the existing
pagination helper with `createdAt DESC, id DESC`. Counts come from the same
filtered query. It does not load users or perform a role query per result.
Offset pages are deterministic for unchanged data, not a snapshot across requests
when boards or memberships are concurrently added/removed.

Errors use the existing `{ success: false, statusCode, code, message, timestamp,
path, details?, requestId? }` convention:

| Status | Code                | Cases                                           |
| ------ | ------------------- | ----------------------------------------------- |
| 400    | `VALIDATION_FAILED` | Invalid body/query, empty update, unsafe offset |
| 400    | `BAD_REQUEST`       | Invalid path UUID                               |
| 401    | `UNAUTHORIZED`      | Missing, invalid, expired JWT or missing user   |
| 403    | `FORBIDDEN`         | MEMBER attempting update/archive                |
| 404    | `NOT_FOUND`         | Missing board or caller without membership      |
| 409    | `BOARD_ARCHIVED`    | OWNER attempting to mutate an archived board    |
| 409    | `CONFLICT`          | Existing filter's database constraint mapping   |
| 429    | `TOO_MANY_REQUESTS` | Existing global rate limit                      |
| 500    | `INTERNAL_ERROR`    | Sanitized unexpected persistence errors         |

Members can still read archived board details. An archive updates only the Board:
it preserves BoardMember, Column and Card rows, and its timestamp is unchanged by
rejected subsequent mutations. There is no hard delete or unarchive endpoint.

## Persistence and D2 boundary

Create saves the Board and exactly one creator OWNER membership through the same
TypeORM transaction manager. Either both persist or neither persists.

Update and archive acquire a PostgreSQL `pessimistic_write` lock on the Board in
a transaction, then check membership, role and archive state with transaction
repositories before saving. Concurrent archive calls serialize; an update
waiting behind an archive observes the committed archive state and returns 409.

D1 keeps the membership/OWNER checks in `BoardsService`; it adds no new guard or
role infrastructure. D2 should extract these checks into its reusable board
authorization service. Membership removal/role changes in D2 must coordinate
with Board mutations (for example by locking the same Board row before changing
membership). Checking a role once without this coordination can race with a
concurrent revocation. Future Column/Card mutations must enforce archived-board
rules through that shared boundary; those APIs are outside D1.

## Automated verification — 2026-10-13

| Check                                                | Result                                                |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `pnpm lint`                                          | PASS                                                  |
| `pnpm test`                                          | PASS: backend 108, frontend 75, shared 2 tests        |
| `pnpm build`                                         | PASS; existing frontend chunk-size warning remains    |
| `pnpm format:check`                                  | FAIL: pre-existing formatting errors                  |
| Prettier on every file changed by D1                 | PASS                                                  |
| `pnpm --filter @kanban/backend test:database`        | PASS on an isolated PostgreSQL 17 cluster             |
| `pnpm --filter @kanban/backend test:boards:database` | PASS on an isolated PostgreSQL 17 cluster             |
| Real compiled `AppModule` HTTP bootstrap             | PASS with real PostgreSQL, JWT and all five endpoints |

`pnpm format:check` has not passed because of pre-existing formatting errors.
All files changed for Issue #20 have passed Prettier checks.

The 74 Boards tests in default Jest comprise DTO validation, service behavior,
HTTP contracts/security and a full module-wiring test. HTTP tests use mock
repositories with the real BoardsService, AuthService, JwtAuthGuard and JWT
signatures; they are not database integration tests. Jest 29 cannot directly load
the installed ESM `@nestjs/typeorm`, so unit/HTTP tests mock repository decorators
following the Auth tests' existing pattern. `boards-module.spec.ts` instead runs
Node with the real `AppModule`, `BoardsModule`, `AuthModule` and TypeORM module
imports/exports, replacing only DataSource and checking protected routes. This
test is part of `pnpm test` and requires no database.

The separate PostgreSQL test creates a random `kanban_boards_verify_*` database,
runs only the existing initial migration there, and drops that database in
`finally`. It verifies real Board/OWNER persistence, rollback after a PostgreSQL
membership INSERT failure, membership isolation (including a creator without
membership), stable pagination with duplicate timestamps, update persistence,
archive retaining related rows, concurrent archive and a waiting update's row
lock. It also starts the compiled complete Nest HTTP application on an ephemeral
loopback port, checks readiness and Swagger, and exercises all five endpoints
using a signed JWT. Application connections are closed before database removal.

To reproduce the separate database checks, supply the existing `DATABASE_*`
configuration for a test PostgreSQL server whose account has `CREATEDB`, then run
the two commands above. The configured database is used only for the admin
connection; fixtures and migrations always target the randomly named database.
The default `pnpm test` and CI have no database dependency. This verification used
a separate temporary PostgreSQL 17 cluster at `127.0.0.1:55420`; it did not modify
the existing local PostgreSQL service or development database.

## Documentation discrepancies

`plan.md` does not exist in this checkout; scope and acceptance criteria therefore
follow the explicit Issue #20 request and the architecture/database documents.
README and system architecture still describe portions of the repository as a
skeleton without Authentication/entities/migrations, while these are already
implemented in `main`. D1 follows the actual Auth implementation and the current
Backend Developer Guide without redesigning or rewriting unrelated documents.
