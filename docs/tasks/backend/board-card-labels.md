# Board-scoped labels backend (P3-02 / CD-02)

Implements [Issue #156](https://github.com/duongkienvn/SE2026-T13/issues/156).
Labels V1 belong to a Board. This delivery provides persistence, REST, batch
reads and realtime contracts for P3-07/08/09/13; it adds no frontend, Workspace
label library, independent Priority field, filtering or notifications.

## Schema and migration

`1793750400000-BoardCardLabels.ts` is additive. Existing Cards, archived state,
comments, assignments and checklist contents remain unchanged. Startup retains
`synchronize: false` and `migrationsRun: false`.

| Table          | Fields and integrity                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `board_labels` | UUID PK, `board_id` FK to Board with CASCADE, trimmed nonblank `name varchar(120)`, canonical `color varchar(7)`, UTC creation/update timestamps                             |
| `card_labels`  | Composite PK `(card_id,label_id)`, `board_id`, creation timestamp; composite FKs `(card_id,board_id)` and `(label_id,board_id)` to their corresponding parents, both CASCADE |

`UQ_board_labels_board_name` is a unique B-tree expression index on
`(board_id, lower(name))`. The database defines case normalization and sorting
using its collation: `Bug` and `bug` conflict within one Board, while another
Board can use either. Display case is preserved. There is no accent removal,
internal-space collapse or Unicode normalization beyond PostgreSQL `lower`.
Colors may be shared by different names. The color CHECK permits only
`^#[0-9A-F]{6}$`; the API trims and uppercases valid six-digit hex input.

Composite parent keys `UQ_cards_id_board_id` and
`UQ_board_labels_id_board_id` make same-Board association a database invariant,
including deliberate direct SQL insertion or parent updates. The existing Card
UUID PK already guarantees the new Card key can be added without data cleanup.
The association PK prevents duplicate assignment. Parent/name and label/Board
indexes support catalog reads and cascade cleanup; the association PK starts
with Card ID for Card-scoped reads.

The migration creates empty label tables without backfill. Adding the Card
composite unique constraint builds an extra index and locks the existing Cards
table; size and schedule that explicit migration appropriately during a future
authorized rollout. No previously applied migration was edited. Entity metadata
and the complete migrated schema have zero ORM drift; the expression index is
explicitly migration-owned with `synchronize: false` index metadata.

`down` requires a transaction, locks the label tables and refuses populated
catalogs. Empty down/up is supported. Keep a backup and prefer a forward fix once
users have labels; do not remove user data just to make rollback pass. The schema
is compatible with older application code. No production migration was run.

## REST and stable DTOs

All endpoints require JWT and use existing envelopes/errors and response
allowlists. GETs set `Cache-Control: no-store`. Swagger documents all seven
operations and nested label responses.

| Method | `/api/boards/:boardId` suffix    | Request                                 | Result                                                         |
| ------ | -------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| GET    | `/labels?page=1&limit=20`        | Page defaults 1/20; limit at most 100   | 200 paginated catalog, ordered by SQL `lower(name)`, then UUID |
| POST   | `/labels`                        | `{ "name": "Bug", "color": "#aabbcc" }` | 201 label DTO                                                  |
| PATCH  | `/labels/:labelId`               | One or both of `name`, `color`          | 200 label DTO                                                  |
| DELETE | `/labels/:labelId`               | None                                    | 204; label and all its Card links deleted atomically           |
| GET    | `/cards/:cardId/labels`          | No query parameters                     | 200 `{ cardId, labels: LabelDto[] }`                           |
| POST   | `/cards/:cardId/labels`          | `{ "labelId": "<uuid>" }`               | 201 complete current `{ cardId, labels }`                      |
| DELETE | `/cards/:cardId/labels/:labelId` | None                                    | 204; catalog label remains                                     |

Example create request:

```json
{ "name": " Bug ", "color": " #aabbcc " }
```

Example response:

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Created",
  "data": {
    "id": "11111111-1111-4111-8111-111111111111",
    "boardId": "22222222-2222-4222-8222-222222222222",
    "name": "Bug",
    "color": "#AABBCC",
    "createdAt": "2026-10-31T10:00:00.000Z",
    "updatedAt": "2026-10-31T10:00:00.000Z"
  }
}
```

Card responses contain that same allowlisted label shape inside `labels`.
Unassigned Cards return an empty array. A catalog rename/color change is read
through the association join immediately for every associated Card; no copied
name/color or Card-row update can become stale.

Names trim to 1-120 characters. Color/name nulls are rejected; omission preserves
an existing value. Empty PATCH, malformed UUID/color/pagination, unsupported
fields or queries, and client ownership/position overrides return 400
`VALIDATION_FAILED` (UUID pipes use the existing standard 400). A normalized
no-op returns 200 without writing, changing timestamps or emitting an event.

| Condition                                                  | Status/code                    |
| ---------------------------------------------------------- | ------------------------------ |
| Case-insensitive create/rename collision                   | 409 `LABEL_NAME_EXISTS`        |
| Board catalog already has 200 labels                       | 409 `LABEL_LIMIT_REACHED`      |
| Same label already assigned to Card                        | 409 `CARD_LABEL_EXISTS`        |
| Missing or foreign label                                   | 404 `LABEL_NOT_FOUND`          |
| Missing or foreign Card                                    | 404 `CARD_NOT_FOUND`           |
| Unassign a valid but unassigned label                      | 404 `CARD_LABEL_NOT_FOUND`     |
| Archived Card association command                          | 409 `CARD_ARCHIVED`            |
| Archived Board mutation                                    | 409 `BOARD_ARCHIVED`           |
| Missing/inaccessible Board or missing explicit write grant | Existing indistinguishable 404 |
| Invalid/expired/invalidated JWT                            | 401                            |

Repeated POST assignment is an explicit conflict; repeat unassign/delete is 404.
Catalog POST creates a new UUID, but its normalized unique name prevents duplicate
rows on a retry. On an ambiguous network outcome, refetch before deciding to
retry. Native FK/unique violations use the existing sanitized 409 filter; no SQL,
private entity fields or stack traces are exposed.

## Access, archive and concurrency

Explicit Board OWNER/MEMBER, including Board-only Guests, may edit an active
Board catalog and active Card associations. Workspace-only readers of a
WORKSPACE_VISIBLE Board may read but cannot edit. Workspace ADMIN never inherits
PRIVATE Board access, and a Board Guest gains no Workspace roster access.

Authorized archived Board/Card reads remain available. Archived Board blocks
all five mutation operations. Archived Card blocks association commands; it does
not freeze the Board catalog. On an active Board, authorized catalog rename,
recolor or explicit deletion therefore also affects archived Cards. Archive and
restore preserve association IDs; catalogs are current shared Board metadata,
not snapshots of names/colors at archive time.

Every write acquires the existing Board `FOR UPDATE` lock via
`BoardAuthorizationService.requireMember(..., { mutable: true }, manager)`
before inspecting related state. Card/Label ownership and membership are checked
inside that transaction. This serializes requests with Card archive/move,
catalog deletion and permission revocation. Disjoint PATCHes read the latest row
under the lock and preserve omitted fields. Database constraints independently
reject cross-Board links and duplicates. Cascade failures roll back the label
and all associations; a retry starts from persisted state. No queue substitutes
for database integrity and no business logic was placed in a gateway.

Hard-deleting a Card removes its links, retaining catalog rows and other Cards.
Board deletion cascades its catalog/links without affecting another Board.
These are persistence policies, not new Card or Board hard-delete APIs.

## Bounded reads and future integration

Catalog creation is capped at 200 labels per Board under the mutation lock;
catalog paging is bounded at 100 per page. A Card can therefore have at most 200
labels. Service-level bounds must also be respected by direct maintenance.
Existing Card listing/detail DTOs were not expanded and perform no new label
queries.

Exported `LabelsService.forCards(userId, boardId, cardIds)` accepts up to 100
explicit IDs, checks all Cards belong to the authorized Board, and returns
`{ cardId, labels }` for each, including empty Cards. It performs two data
queries independent of Card count: scoped Card validation and one joined
association/catalog query bounded by `200 * cardCount`. Authorization has its
normal separate queries. No per-Card or per-label database fetch is used.

- P3-07 filtering should join/EXISTS `card_labels` using both Card ID and Board
  ID after applying the authoritative readable-Board policy. Validate selected
  label IDs against that same Board; never search an unscoped catalog first.
- P3-08 same-Board duplication copies associations using existing label IDs into
  new Card links under the Board lock. It must not copy catalog rows or reuse the
  source Card ID. Cross-Board moves/copies need a separately approved mapping.
- P3-09 uses these REST responses, sends only supported fields, handles 409
  name/duplicate/cap errors, and derives contrast/styling on the frontend.
- P3-13 can call the exported batch service for an authorized Card page instead
  of making one database lookup per preview.

## Realtime and activity

Catalog create/update/delete publishes one shared typed `labels:changed` event
with `{ boardId, labelId }`. Consumers invalidate the Board catalog and all
Board-scoped Card label metadata. There is no per-Card fanout, full catalog
payload, name or color in events. Assign/unassign publishes existing
`card:updated` with `{ boardId, cardId, columnId }`; future clients invalidate
that Card's labels/detail/preview.

Both routes publish through `BoardEventPublisher` after transaction commit and
outside the delivery coordinator queue. No-ops and failed/denied transactions
emit nothing. False/throwing delivery preserves committed REST success. Existing
Socket.IO authentication, receive grants, revocation/eviction and reconnect
checks remain unchanged. Reconnect must rejoin and refetch catalog/Card metadata;
cache keys and late responses must remain scoped to the authenticated session
and authorized Board. Never replace an unsaved client draft merely because an
invalidation arrived.

No label-specific activity taxonomy or notifications are introduced. Existing
Card/Board activities remain untouched. The legacy business-event regression
fixture continues testing its 18 content/member events; the new label event is
covered separately by shared type/export tests and actual PostgreSQL/Socket.IO
contract tests.

## Local verification

Verification used Node 22.17.0, pnpm 10.18.3 and a dedicated PostgreSQL 16.15
container bound to loopback port 55456. Test credentials only, fake mail and
disabled avatar storage were supplied explicitly. The new suite requires
`LABEL_DATABASE_TESTS=local-only`, rejects non-loopback/production settings,
loads no `.env` credentials, and creates/drops a random isolated database.
The new npm script `test:labels:database` builds backend and runs the same suite.

All verification databases were dropped; the dedicated container and its
anonymous volume were removed. Commands ran from repository root. Direct Node
suites reused the freshly built backend and explicitly designated local test
connection; no production database, mail or storage was accessed.

| Check                                                                 | Final result                                                                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @kanban/shared build`                                  | PASS                                                                                                       |
| `pnpm --filter @kanban/backend build`                                 | PASS                                                                                                       |
| `pnpm exec eslint apps/backend packages/shared`                       | PASS                                                                                                       |
| Focused labels Jest command below                                     | PASS: 3 suites, 11 tests                                                                                   |
| Targeted backend regression command below                             | PASS: 36 suites, 315 unit/HTTP/realtime tests                                                              |
| `pnpm --filter @kanban/shared test`                                   | PASS: 7 tests, including ESM/CJS export parity and strict payload type checks                              |
| `node apps/backend/test/labels/labels.integration.mjs`                | PASS: 15 PostgreSQL/HTTP/Socket.IO groups                                                                  |
| `node apps/backend/test/database/database-foundation.integration.mjs` | PASS: migrations, compiled/source discovery, metadata, constraints, historical schema and explicit down/up |
| `node apps/backend/test/cards/cards.integration.mjs`                  | PASS: 13 Card/ordering/archive/assignment/concurrency groups                                               |
| `node apps/backend/test/card-checklists/checklists.integration.mjs`   | PASS: 16 groups including archive/reorder/progress/rollback/revocation                                     |
| `node apps/backend/test/board-members/board-members.integration.mjs`  | PASS: membership, Board ACL/lifecycle, cleanup and revocation                                              |
| `node apps/backend/test/workspaces/workspace-api.integration.mjs`     | PASS: Workspace/Board lifecycle, ACL, rollback and concurrency                                             |
| `pnpm --filter @kanban/backend test:realtime:database`                | PASS: 16 scenarios                                                                                         |
| `pnpm --filter @kanban/backend test:board-events:database`            | PASS: 10 groups                                                                                            |
| Changed-file `pnpm exec prettier --check`                             | PASS                                                                                                       |
| Changed documentation UTF-8 and local links                           | PASS                                                                                                       |
| `git diff --check`                                                    | PASS                                                                                                       |

```sh
pnpm --filter @kanban/backend test --runTestsByPath test/labels/labels.service.spec.ts test/labels/labels.e2e-spec.ts test/labels/labels-events.spec.ts
pnpm --filter @kanban/backend test '--testPathPattern=(labels|cards|card-checklists|boards|board-members|columns|realtime)'
```

The new integration groups exercise populated migration preservation (including
archived Cards and existing checklists), fresh migrations and zero ORM drift,
SQL FK/CHECK/index/uniqueness enforcement, every REST operation, the full access
matrix, maximum-size paging/association reads, one joined batch query, concurrent
case collisions and assignment/delete/archive/revocation races, cascade rollback
and retry, post-commit delivery, failed broadcast, reconnect and receive-grant
revocation. Test-only failures intentionally produce sanitized transport logs.
Existing schema inspection emits a pg concurrent-query deprecation warning.

Initial typing/test-fixture/schema checks failed during implementation and were
corrected; the final checks above pass. Historical migration rehearsal fixtures
were extended for the additive migration, retaining their original boundary
checks and final complete-schema zero-drift assertion. No unrelated application
behavior or baseline formatting was changed to obtain passing checks.

Full monorepo/frontend tests, frontend builds, repository-wide formatting and
infrastructure/deployment checks were not run, following the requested targeted
backend scope. No CI or production verification is claimed. Remaining rollout
considerations are the Card index build/lock, documented collection bounds,
PostgreSQL collation-dependent case normalization and populated rollback refusal.
Frontend cache subscriptions and UI remain P3-09/P3-13 integration work.
