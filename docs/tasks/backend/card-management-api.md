# Card Management REST API (E2)

Implements the approved contract from [Issue #34](https://github.com/duongkienvn/SE2026-T13/issues/34)
on `feat/cards`, based on `main` at `4d7886a` (E1 and F1 merged).
No dependency, entity, migration or realtime business event was added.

The historical E2 date contract below is extended by the current
[advanced start/due date contract](card-advanced-dates.md), including atomic range
validation, strict instant parsing and the nullable startDate response field.

## API for E3

All routes require JWT authentication and BoardMember access. OWNER and MEMBER
have the same Card permissions. Existing REST success/error envelopes apply.

| Method | Route under `/api/boards/:boardId`                | Success               |
| ------ | ------------------------------------------------- | --------------------- |
| GET    | `/cards?page=1&limit=20&columnId=<optional UUID>` | 200 + pagination meta |
| GET    | `/cards/:cardId`                                  | 200 + Card            |
| POST   | `/cards`                                          | 201 + Card            |
| PATCH  | `/cards/:cardId`                                  | 200 + Card            |
| POST   | `/cards/:cardId/archive`                          | 200 + Card            |
| PATCH  | `/cards/:cardId/move`                             | 200 + Card            |
| POST   | `/cards/:cardId/assignees`                        | 201 + CardAssignee    |
| DELETE | `/cards/:cardId/assignees/:userId`                | 204, empty body       |

Create accepts `{ columnId, title, description?, dueDate? }`. Title is trimmed and
must contain 1–120 characters. Description is nullable, at most 2000 characters;
empty text is allowed. Due date is nullable and must be ISO 8601 with timezone;
past dates are allowed. Backend sets board, creator, position and archive state.

PATCH accepts only `title`, `description`, `dueDate`. Omission preserves a value;
null clears description/deadline. Null title and an empty patch return 400. Move
requires `{ toColumnId, beforeCardId }`, including `toColumnId` for a same-column
reorder. `beforeCardId: null` appends; otherwise the anchor must be active in the
destination column. Self-anchor is rejected with 400; an effective no-op succeeds.

Lists contain active Cards only. With a column filter, order is `position ASC,
id ASC`; board-wide order is `columnId ASC, position ASC, id ASC`. The UUID column
order is for pagination, **not UI column order**: use E1 column positions to render
the board. Page defaults to 1, limit to 20, maximum 100. Joined assignees do not
multiply the Card count or break pagination. A column filter must belong to the
board even when the caller belongs to both boards.

Public Card fields are `id`, `boardId`, `columnId`, `createdById`, `title`,
`description`, `position` (string), `dueDate`, `isArchived`, `archivedAt`,
`createdAt`, `updatedAt`, `assignees`. Dates are UTC ISO strings or null. Each
assignee is `{ userId, assignedById, createdAt }`, with nullable `assignedById`.
Assignment POST returns that minimal assignee DTO, not a Card or User graph. E3
can map user IDs to its Board Members data. No comments or user secrets are exposed.

All operations are documented in Swagger, including request fields, nullable
properties, pagination, authentication, path UUIDs, envelopes and response statuses.
E3 should re-fetch authoritative state after mutations; E2 emits no socket events.

## Authorization and archive behavior

- Reuse `JwtAuthGuard`, `CurrentUser`, `BoardAuthorizationService`; trust no
  client-supplied identity, archive state, board, position or creator fields.
- Scope all Card/Column/anchor/assignment lookups to the board on the URL.
- Missing and cross-board resources return 404 without exposing another board.
- An archived Board allows list/detail reads but every mutation returns
  `409 BOARD_ARCHIVED`.
- An archived Card allows detail reads but update/move/archive/assign/unassign
  return `409 CARD_ARCHIVED`.
- Archive preserves the row, column, position, comments and assignees. It does not
  free its Column for deletion; E1 still rejects any referenced Column with 409.
- Assignment targets must be current members. Duplicate assignment returns
  `409 CARD_ASSIGNEE_EXISTS`; missing member/assignment returns 404. Unassign only
  removes the exact Card/user pair, never a membership.
- Existing global filter sanitizes database FK/UNIQUE violations as HTTP 409.

## Ordering, transactions and races

`cards-ordering.ts` directly reuses E1's BigInt helpers from
`columns-ordering.ts`; E1's implementation and public behavior remain unchanged.
Midpoints never use JavaScript floating-point. The Card wrapper also detects
append overflow beyond the integer range of `NUMERIC(20,10)`.

Each Column has an independent **active Card** ordering. Create appends after the
last active Card. Move updates only the moving Card when a gap is available; if
not, it rebalances the destination's active Cards in the same transaction. The
relative order of other Cards is preserved; the source Column is not rebalanced.
Archived positions remain unchanged and are excluded from active ordering, so an
archived Card may retain a position later reused by an active Card. There is no
restore flow in E2.

Every Card mutation starts a TypeORM transaction and calls
`requireMember(actor, boardId, { mutable: true }, manager)`. This acquires the same
Board `FOR UPDATE` lock used by E1, Board archiving and membership mutations,
**before** reading Cards, Columns or assignment targets. Operations within one
Board serialize, while other Boards remain independent. No operation locks a
second Board or acquires the realtime coordinator after taking a DB lock.

Assignment checks target membership while retaining that Board lock through the
insert. Membership removal retains its existing Board lock, deletes all matching
active/archived assignments and deletes membership in its own transaction. If
assignment commits first, removal cleans it; if removal commits first, assignment
sees no target member and returns 404. F1's removal queue and post-commit revocation
are unchanged. The protocol also serializes create/move against Column deletion.

Existing tables, FKs, `UNIQUE(card_id, user_id)` and numeric scale suffice. The
cross-board and continuing membership invariants are enforced by scoped service
queries and the shared lock protocol; direct database maintenance must preserve
them too. No schema migration or extra infrastructure is needed.

## Implementation and verification

Main code: `src/api/cards/cards.service.ts`, `cards.controller.ts`, `cards.module.ts`,
`cards-ordering.ts`, and `dto/`. `AppModule` registers CardsModule. Services return
whitelisted DTOs and reuse existing pagination helpers; there is no new envelope.
The small feature keeps assignment operations in CardsService to share its
transaction/authorization boundary.

Verification commands from the repository root:

```sh
pnpm lint
pnpm test
pnpm build
pnpm format:check
pnpm --filter @kanban/backend test --runTestsByPath test/cards/cards.dto.spec.ts test/cards/cards-ordering.spec.ts test/cards/cards.service.spec.ts test/cards/cards.e2e-spec.ts
pnpm --filter @kanban/backend test:cards:database
pnpm --filter @kanban/backend test:columns:database
```

Unit/HTTP tests cover validation, null/omission, serialization, ordering/rebalance,
archived states, OWNER/MEMBER/non-member access, all eight routes, Swagger and
sanitized errors. HTTP tests use real Nest controllers, guards, JWT, authorization
and services with isolated repository doubles. AppModule bootstrap checks actual
module wiring and protects all eight routes.

The PostgreSQL script creates a random `kanban_cards_verify_*` database, runs
existing migrations only there, and drops it in cleanup. It covers 12 groups:
clean schema, cross-board permissions, concurrent create/move, persisted ordering,
rebalance/overflow/rollback, multi-assignee/FK/UNIQUE, archive retention, membership
cleanup, assign-vs-remove in both orders, create-vs-Column-delete in both orders,
real AppModule + REST login + joined pagination, and archived Board behavior.
Race tests hold the Board row and observe PostgreSQL lock waiters before releasing
requests in each order; no mock transaction decides the winner. A test-only
trigger forces a rebalance failure and fresh SQL reads prove full rollback.

On 2026-10-16, Cards PostgreSQL (12 groups), Columns PostgreSQL regression,
targeted tests and the full suite passed (backend 209, frontend 175, shared 3).
Lint passes after correcting a new multiline property-access lint finding in the
DB test helper; the database script was rerun successfully after this correction.
Workspace build passes with the existing frontend chunk-size warning. All 25
files belonging to E2 pass targeted Prettier, and `git diff --check` passes.
Root `pnpm format:check` fails on 264 unchanged files outside E2 with existing
format/CRLF issues (`core.autocrlf=true` in this checkout). No unrelated files or
Git configuration were changed. There is no implementation blocker; CI/review
and merge remain later human-controlled steps.

F2 owns Card/Column socket business events. Presence, comments/activity features,
frontend integration, restore and hard delete remain outside this implementation.
