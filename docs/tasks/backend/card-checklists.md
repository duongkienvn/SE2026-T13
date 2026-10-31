# Card checklists backend (P3-01 / CD-01)

Implements [Issue #155](https://github.com/duongkienvn/SE2026-T13/issues/155)
against the merged main foundation, including the Phase 2 access/cache work from
#147. Backend only; P3-08/P3-09 own Card Detail/checklist UI and P3-13 owns previews.
The roadmap's historical statement that Card restore and Workspace-visible access
are absent is stale: source already implements both, and this change reuses them.

## Persistence and migration

New domain entities live under `apps/backend/src/api/cards/entities/`:

| Table                  | Columns                                                                                                                            | Integrity                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `card_checklists`      | UUID `id`, UUID `card_id`, `title varchar(120)`, `position numeric(20,10)`, UTC `created_at` / `updated_at`                        | Named PK; Card FK with CASCADE; trimmed, nonblank title; positive position; deferred UNIQUE `(card_id, position)`          |
| `card_checklist_items` | UUID `id`, UUID `checklist_id`, `text varchar(255)`, `is_checked boolean DEFAULT false`, `position numeric(20,10)`, UTC timestamps | Named PK; checklist FK with CASCADE; trimmed, nonblank text; positive position; deferred UNIQUE `(checklist_id, position)` |

All fields are NOT NULL. Parent-position unique B-tree indexes also index each
FK's leading column. UUID defaults use the existing `gen_random_uuid()` extension.
`UNIQUE ... DEFERRABLE INITIALLY DEFERRED` permits intermediate position collisions
during a multi-row rebalance and rejects duplicates at transaction commit. There
is one parent FK per child; no duplicated Board ownership can drift independently.
Titles/text need not be unique. Item timestamps describe item changes; checklist
timestamps describe its own title/position changes. Card fields/timestamps are
not rewritten merely to invalidate nested data.

Forward migration: `1793664000000-CardChecklists.ts`. It creates two empty tables,
without modifying earlier migrations or rewriting Card rows. Existing archived
Cards, comments and assignments remain unchanged. Metadata and migrations retain
`synchronize: false` and `migrationsRun: false`; startup never applies migrations.

Archive is not deletion: Card/Board archive and restore leave all checklist rows,
checked states and positions intact. Checklist deletion cascades owned items.
Maintenance-only Card hard deletion cascades both levels; there is no new Card
hard-delete API. Existing Column/Card FK behavior remains in force.

### Rollout and recovery

Build and verify the migration against a disposable database before an explicitly
authorized rollout. Apply the normal explicit migration command in the designated
environment before starting code that queries checklists. The additive schema is
compatible with older application code. No backfill is needed.

`down` requires a transaction, locks both new tables exclusively, and refuses to
remove populated checklists. Empty down/up is supported. For a populated system,
keep a backup and prefer a forward correction; do not delete user checklists to
make rollback pass. Restoring an application version does not require dropping
these additive tables. No production migration or deployment was performed here.

## REST contracts

All routes require JWT and use base:

```text
/api/boards/:boardId/cards/:cardId/checklists
```

| Method | Suffix                             | JSON request                                              | Result                                                                                 |
| ------ | ---------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| GET    | empty                              | none                                                      | 200 Card detail: ordered `checklists`, ordered nested `items`, Card aggregate progress |
| GET    | `/summary`                         | none                                                      | 200 Card aggregate progress, without hydrating item contents                           |
| POST   | empty                              | `{ "title": "Release" }`                                  | 201 complete new checklist                                                             |
| PATCH  | `/:checklistId`                    | `{ "title": "Verification" }`                             | 200 complete checklist                                                                 |
| PATCH  | `/:checklistId/move`               | `{ "beforeChecklistId": "<uuid>" }` or explicit null      | 200 moved checklist                                                                    |
| DELETE | `/:checklistId`                    | none                                                      | 204, no body; owned items removed                                                      |
| POST   | `/:checklistId/items`              | `{ "text": "Review changes" }`                            | 201 complete parent checklist, including the new unchecked item                        |
| PATCH  | `/:checklistId/items/:itemId`      | `{ "text": "Reviewed", "isChecked": true }` (one or both) | 200 complete parent checklist                                                          |
| PATCH  | `/:checklistId/items/:itemId/move` | `{ "beforeItemId": "<uuid>" }` or explicit null           | 200 complete parent checklist                                                          |
| DELETE | `/:checklistId/items/:itemId`      | none                                                      | 204, no body; refetch progress                                                         |

Non-204 responses retain the existing `{ success, statusCode, message, data }`
envelope. GET responses set `Cache-Control: no-store`. All ten operations and
nested allowlisted response DTOs are documented by Swagger.

Examples (UUIDs/timestamps are illustrative):

```http
POST /api/boards/<boardId>/cards/<cardId>/checklists
Authorization: Bearer <access-token>
Content-Type: application/json

{"title":"  Release  "}
```

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Created",
  "data": {
    "id": "11111111-1111-4111-8111-111111111111",
    "cardId": "22222222-2222-4222-8222-222222222222",
    "title": "Release",
    "position": "100.0000000000",
    "createdAt": "2026-10-31T10:00:00.000Z",
    "updatedAt": "2026-10-31T10:00:00.000Z",
    "items": [],
    "checkedItems": 0,
    "totalItems": 0,
    "completionPercentage": 0
  }
}
```

```http
PATCH /api/boards/<boardId>/cards/<cardId>/checklists/<checklistId>/items/<itemId>
Authorization: Bearer <access-token>
Content-Type: application/json

{"isChecked":true}
```

The PATCH response is the complete parent checklist, with item fields `id`,
`checklistId`, `text`, `isChecked`, string `position`, `createdAt`, `updatedAt`, and
updated progress. Setting a state explicitly makes retries idempotent; there is
no invert/toggle command that could accidentally toggle twice.

Summary example, in `data`:

```json
{
  "cardId": "22222222-2222-4222-8222-222222222222",
  "checkedItems": 2,
  "totalItems": 3,
  "completionPercentage": 66.67
}
```

### Validation and bounds

Titles are trimmed and 1-120 characters; item text is trimmed and 1-255 characters.
Unknown body/query fields, invalid UUIDs, blank/null text, empty item PATCH,
missing move anchors, self anchors, and invalid checked-state values fail 400.
Move DTOs require the anchor field: explicit null appends. Clients cannot set
owner IDs, parent IDs, positions, timestamps, counts or completion. A foreign,
deleted or cross-parent anchor fails 404; resource ownership is always checked
against every parent path component. The standard filter sanitizes SQL failures.

The API admits at most **50 checklists per Card** and **200 items per checklist**;
these caps bound full detail payloads without pagination or item truncation in
normal API-created data. Creating beyond a cap returns 409
`CHECKLIST_LIMIT_REACHED`. Cap checks run under the same Board lock as insertion,
so concurrent requests cannot exceed them. Detail joins avoid N+1 item loading;
detail bounds the parent IDs to 50 in a subquery before joining items (joined
ORM pagination with child ordering would otherwise truncate parents). Database maintenance must
preserve these service-level bounds, as it must preserve the existing lock policy.

The exported `CardChecklistsService.summaries(userId, boardId, cardIds)` supports
at most 100 explicitly supplied Card IDs in one grouped, Board-scoped SQL query.
It counts persisted items without hydrating them, returns zeros for authorized
empty Cards, deduplicates IDs and rejects missing/foreign Cards. No checklist
query was added to existing Board/Card listing paths. The single-Card `/summary`
route uses this aggregate implementation; future previews can reuse the batch
service when their own endpoint is implemented.

## Authorization and transaction ordering

| Actor/state                                                              | Read                 | Mutate                                                 |
| ------------------------------------------------------------------------ | -------------------- | ------------------------------------------------------ |
| Explicit Board OWNER or MEMBER on active Card/Board                      | Yes                  | Yes                                                    |
| Board Guest with explicit Board membership                               | Yes, only that Board | Yes, per existing Board role                           |
| Workspace MEMBER/ADMIN without Board membership, WORKSPACE_VISIBLE Board | Yes                  | No (404, matching existing `requireMember` convention) |
| Workspace ADMIN without membership, PRIVATE Board                        | No (404)             | No (404)                                               |
| Outsider, missing/foreign Board or Card                                  | No (404)             | No (404)                                               |
| Otherwise authorized, archived Card/Board                                | Yes                  | No (409 `CARD_ARCHIVED` / `BOARD_ARCHIVED`)            |
| Missing/invalid/expired/invalidated JWT                                  | No (401)             | No (401)                                               |

`JwtAuthGuard`, `BoardAuthorizationService.requireRead` and
`requireMember(..., { mutable: true }, manager)` remain authoritative. There is
no new Workspace permission or broader Guest access. Generic 403 remains in the
shared error contract; checklist writes require no owner-only operation and use
the established hidden-resource 404 for nonmembers.

Every command starts a transaction and takes the Board `FOR UPDATE` lock before
checking membership or reading Card/checklist/item state. It then validates the
Card-to-Board, checklist-to-Card and item-to-checklist chain. This matches Card
archive/restore/move and Board member removal. No per-process queue replaces the
database lock. After obtaining the lock each PATCH reads current persisted state,
so a text-only PATCH cannot overwrite a concurrent checked-state change.

Ordering reuses `cardInsertionPosition` and Column `rebalancePositions`, which
calculate decimal positions through BigInt units, never JavaScript floats. Rows
sort by position then UUID. Moves operate only within the same parent; all
anchors are checked after acquiring the lock. A consumed gap or NUMERIC overflow
rebalances the complete bounded parent collection in the transaction. Deferred
uniqueness checks run before REST success/event delivery. Trigger/commit failures
roll back all changes. A client may retry the failed command after refetching.

Identical text, explicit checked state, or effective ordering makes no write,
timestamp change or event. Repeated DELETE returns the established missing-resource 404. POST append commands create new rows and do not offer an idempotency-key
protocol: disable duplicate submission and refetch after an ambiguous network
failure before choosing to append again. No automatic retry mechanism can
silently replay a committed append.

## Progress, realtime and activity

Progress is always derived from persisted items. `checkedItems` is the number
with `isChecked=true`; `totalItems` is the number of live rows. Percentage is
`round(checkedItems * 10000 / totalItems) / 100`, or 0 for an empty collection.
It is rounded to two decimals, so 199/200 reports 99.5 rather than an apparently
complete 100. Card totals combine item counts, not the average of checklist
percentages. There is no stored progress counter, Card completion flag or use
of a column name such as Done as task completion.

Every effective command publishes the existing `card:updated` invalidation hint
through `BoardEventPublisher` **after transaction commit**, outside the Board
coordinator queue. Payload is only `{ boardId, cardId, columnId }`, using the
Card's authoritative IDs. Checklist titles/text and checked states never travel
in events. The shared contract comment now documents nested checklist invalidation;
no new event or frontend behavior was needed for this backend issue.

The existing authorized rooms, join ordering, reconnect auth, receive-grant
revocation and member eviction apply unchanged. Delivery false/throw is absorbed
by the publisher and cannot turn a committed REST result into an HTTP failure.
Clients refetch on reconnect or missed delivery.

No checklist-specific activity taxonomy or DB enum is added. Existing CARD_UPDATED
activity describes Card field edits; emitting that record for every checkbox
would be ambiguous activity with no checklist action metadata. Checklist commands
therefore publish Card invalidation without adding activity rows. Existing
Card/Column/Comment/Activity recording is unchanged and regression-tested. No
notifications, mentions or other Phase 4 behavior is introduced.

## Frontend handoff (P3-08 / P3-09 / P3-13)

- Fetch detail on Card open; use summary/batch aggregation for future preview
  endpoints instead of hydrating items on Board listings.
- Keep caches scoped to the authenticated session and authorized Board/Card.
  Invalidate detail and summary on `card:updated`, archive/restore, reconnect and
  authorization changes. Existing frontend caches have no checklist feature yet.
- Use the returned parent checklist after item writes for authoritative progress
  and ordering. After a 204 deletion refetch. Merge by IDs; do not average percent
  values or derive a separate Card done state.
- Send only changed fields and explicit checked states. Preserve unsaved drafts
  when remote invalidation arrives; refetch/reconcile without overwriting edits.
  Roll back optimistic state on failure and stop writes on archive/access loss.
- Treat positions as opaque decimal strings. Send a same-parent UUID anchor or
  explicit null. Refetch on a deleted anchor; never manufacture persisted ranks.
- Duplicate Card is future work: copy checklist/item content and order into new
  rows with new IDs; do not reuse source checklist/item IDs.

## Verification record

Executed locally on 2026-10-31 using Node 22.17.0, pnpm 10.18.3 and an isolated
PostgreSQL 16.15 Docker container bound to loopback port 55455. Only random
`kanban_*` verification databases were migrated; test mail was fake and avatar
storage disabled. No production database, mail or storage was accessed.

All temporary databases were dropped; the dedicated container and its anonymous
volume were removed after verification. The commands below ran from repository
root (direct Node integration commands reused the freshly compiled backend).

| Check                                                                 | Final result                                                                                                                                  |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                           | PASS                                                                                                                                          |
| `pnpm test`                                                           | PASS: backend 75 suites / 766 tests, frontend 106 files / 1,177 tests, shared 7 tests; includes backend unit/HTTP E2E and mocked realtime E2E |
| `pnpm build`                                                          | PASS: all workspace packages                                                                                                                  |
| Focused Jest command below                                            | PASS: 3 suites / 17 tests                                                                                                                     |
| `pnpm --filter @kanban/backend test:checklists:database`              | PASS: 16 PostgreSQL/HTTP/Socket.IO groups                                                                                                     |
| `node apps/backend/test/database/database-foundation.integration.mjs` | PASS: migration/schema/behavior, compiled and TypeScript discovery, explicit down/up and metadata consistency                                 |
| `node apps/backend/test/cards/cards.integration.mjs`                  | PASS: 13 groups, including ordering, archive/restore, assignments and concurrency                                                             |
| `node apps/backend/test/columns/columns.integration.mjs`              | PASS: CRUD, exact rebalance, concurrent create, FK/delete/archive policy                                                                      |
| `node apps/backend/test/comments/comments.integration.mjs`            | PASS: persistence, ownership, soft delete and archive policy                                                                                  |
| `node apps/backend/test/activities/activities.integration.mjs`        | PASS: 15 action integrations, no-ops, atomic rollback, events and HTTP feed                                                                   |
| `node apps/backend/test/workspaces/workspace-api.integration.mjs`     | PASS: Workspace lifecycle/ACL/rollback/races/compatibility                                                                                    |
| `pnpm --filter @kanban/backend test:realtime:database`                | PASS: 16 PostgreSQL/Socket.IO scenarios                                                                                                       |
| `pnpm --filter @kanban/backend test:board-events:database`            | PASS: 10 groups, including existing business events and revocation/failure races                                                              |
| `pnpm format:check`                                                   | FAIL: 873 unchanged files outside this task have existing formatting/line-ending differences                                                  |
| Changed-file `pnpm exec prettier --check`                             | PASS: all 24 task files                                                                                                                       |
| Changed Markdown local links and UTF-8 validation                     | PASS                                                                                                                                          |
| `git diff --check`                                                    | PASS                                                                                                                                          |

Focused command:

```sh
pnpm --filter @kanban/backend test --runTestsByPath test/card-checklists/checklists.service.spec.ts test/card-checklists/checklists.e2e-spec.ts test/card-checklists/checklists-events.spec.ts
```

The PostgreSQL suite requires `CHECKLIST_DATABASE_TESTS=local-only`, a loopback
`DATABASE_HOST`, an explicitly designated test server with CREATE DATABASE rights,
and the usual `DATABASE_PORT/NAME/USER/PASSWORD` variables. It never loads `.env`
credentials, creates a random database, runs explicit migrations and drops only
its own database. Workspace regression also used `WORKSPACE_DATABASE_TESTS=local-only`.
Other legacy regression scripts received the same explicit isolated connection
variables and test-only application configuration. Do not point these scripts at
production or a development database containing user data.

Coverage includes fresh full migration and populated upgrade, schema metadata,
FK/CHECK/unique constraints, safe down refusal, multiple parent/child CRUD,
authoritative empty/fractional/full progress, concurrent caps and maximum-size
detail completeness, exact dense/overflow rebalance, rollback/retry, deleted
anchors, competing reorder/toggle/delete, archive/move and member-removal races,
real JWT/HTTP authorization, commit-gated Socket.IO delivery, silent no-ops,
transport failure, reconnect resync and access/token revocation.

Failing development checks exposed test harness issues, migration-history
assumptions and joined-pagination truncation at maximum collection size; these
were corrected and the final checks above passed. An early overlapping shared
build/test run also caused a transient module-resolution failure; final runs were
serialized. Existing migration-discovery fixtures were updated specifically for
the additive checklist migration, while keeping their historical-schema assertions
and final zero-drift check. No unrelated application code was altered to make
checks pass.

Remaining limitations: repository-wide formatting is not green; the frontend
build still reports its existing `.env` NODE_ENV and large-chunk warnings. TypeORM
schema inspection emits a pg concurrent-query deprecation warning. Injected
transport/eviction failures deliberately log sanitized errors in passing tests.
No dependency or unrelated formatting cleanup was introduced. Frontend UI,
production rollout, CI execution, push/PR/merge and deployment remain outside this
local delivery. POST append retry behavior and collection caps are documented
above; no separate Card completion state, notifications or activity taxonomy was
added.
