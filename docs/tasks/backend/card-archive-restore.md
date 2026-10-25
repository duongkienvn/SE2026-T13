# P1-02 — Archived Cards Management & Restore

Branch: `feat/archived-cards-restore`, based on `origin/main` at `ef33e9f`.
Scope: backend, shared contracts, frontend and isolated PostgreSQL/browser QA.

## API and permissions

- `GET /api/boards/:boardId/cards?status=active|archived&page=1&limit=20`.
  Omitted status retains active-only behavior and existing column/position order.
  Archived cards use `archivedAt DESC, id DESC`, including when filtering by column.
  Pagination uses the existing success envelope and top-level `meta`.
- `POST /api/boards/:boardId/cards/:cardId/restore` returns `200` with the existing
  full Card response: same ID and column, `isArchived: false`, `archivedAt: null`.
- Both OWNER and MEMBER may read and restore. Missing authentication is `401`;
  missing membership, unknown board/card or foreign card/column is `404`.
  Invalid status, UUID or pagination is `400 VALIDATION_FAILED`.
- An archived board remains readable; mutations fail with `409 BOARD_ARCHIVED`.
  An active card fails with `409 CARD_NOT_ARCHIVED`. An unavailable or cross-board
  original column fails with `409 CARD_COLUMN_UNAVAILABLE`; no relocation occurs.

Restore uses the existing pessimistic Board lock and transaction. It appends after
the original column's active cards with `cardInsertionPosition`, rebalancing with
`rebalancePositions` on numeric overflow. Active relative ordering is preserved.
It retains title, description, due date, creator, original timestamps, assignments
and comments. TypeORM may update `updatedAt`. Existing column deletion already
rejects columns containing archived cards, so no new column-selection flow is needed.

The same transaction writes one `CARD_RESTORED` Activity with entity type `CARD`.
Two competing restores produce one success and one conflict. Only committed
success publishes `card:restored { boardId, cardId, columnId }` through the existing
BoardEventPublisher to authorized board members. Delivery failure leaves committed
state and the successful HTTP result intact. Reconnect/rejoin refetches REST data.

## Migration and rollout

Migration `1792960000000-CardRestoredActivity.ts` adds `CARD_RESTORED` to
`activities_action_type_enum` using `ADD VALUE IF NOT EXISTS`. It neither rewrites
old migrations nor changes existing Activity rows. `synchronize` stays `false`.

Before a production rollout, the operator must take a database backup and confirm
its restore procedure. Build shared/backend/frontend artifacts, apply migrations
with the existing deployment workflow, verify `migration:show`, then deploy the new
backend and frontend. The enum change must commit before the backend writes the
new action. Check restore, Activity History and a second connected browser.
This task runs migrations only against disposable local databases.

Rollback the application if needed while retaining the additive enum value and
history. Migration `down` intentionally leaves the enum unchanged: PostgreSQL has
no safe single-value enum removal. A subsequent `up` is idempotent. Reverting this
migration's ledger entry does not erase the enum or restored-card Activities.
Do not rebuild/drop the enum or remove Activity rows to downgrade the application.
Older frontend formatters fall back to “made a change”; the new formatter renders
“restored a card”. Legacy auth migration fixtures account for the additional step.

## Frontend

Board actions exposes Archived cards to every current board member, including
archived boards. The dialog loads 20 cards per page, with title, original column,
archive timestamp and status. It has loading, retry, error and empty states.
Restore opens a separate confirmation state. Pending disables dismissal/actions;
an immediate ref guard also prevents two clicks arriving before the next render.
Success is announced only after the response, then active/archive/detail queries
are invalidated. Conflict errors never produce a success notice. Permission-loss
responses refresh board authorization and hide cached board content. Archived
boards expose the list without Restore buttons. Archived Card Detail remains
read-only; routes and drag-and-drop behavior are unchanged.

The mobile board action trigger is aligned to the row's right edge so its existing
right-anchored disclosure stays inside the board instead of behind the sidebar.
Dialog focus trapping, Escape, scroll and reduced motion reuse existing primitives.

## Verification and evidence

The implementation is covered by restore unit tests, the Card PostgreSQL suite,
real Socket.IO commit/rollback/concurrency checks, frontend interaction tests,
cache invalidation tests and shared ESM/CommonJS contract tests.

The real Chromium run uses a disposable migrated database, Nest API, Vite and
independent owner/member browser sessions. It verifies 375/768/1280 widths,
confirmation focus and Tab trapping, Escape/focus return, pending double-click,
pagination, second-browser synchronization, foreign-board isolation, reconnect
after an offline restore, read-only boards, loading/error/retry/empty states,
conflicts and membership revoked during confirmation. Failure-state network
injection is limited to list loading and `503` retry; restore/conflict/revocation
use the real API/database. No production or real user data is used.

- [Browser assertions and viewport geometry](../../design/screens/implementation/card-archive-restore/browser-qa.json)
- [375px archive list](../../design/screens/implementation/card-archive-restore/archive-375.png)
- [375px confirmation](../../design/screens/implementation/card-archive-restore/confirm-375.png)
- [768px archive list](../../design/screens/implementation/card-archive-restore/archive-768.png)
- [1280px archive list](../../design/screens/implementation/card-archive-restore/archive-1280.png)
- [Pending restore](../../design/screens/implementation/card-archive-restore/restore-pending.png)
- [Confirmed success](../../design/screens/implementation/card-archive-restore/restore-success.png)
- [Archived board](../../design/screens/implementation/card-archive-restore/archived-board-readonly.png)
- [Access revoked](../../design/screens/implementation/card-archive-restore/access-revoked.png)

Two independent read-only visual review passes returned **PASS**, with no blocking
findings, after directly opening all 18 final captures and checking their PNG
signatures, dimensions, freshness, component implementation and browser assertions.
There is no supplied pixel-exact reference, so no image-diff score is claimed.

Database checks actually executed:

- `node test/cards/cards.integration.mjs`: **13 groups PASS**, including original
  Card behavior and restore ordering, relations, permissions and concurrency.
- `node -r ts-node/register test/realtime/board-events/board-events.integration.mjs`:
  **10 groups PASS**, plus all 18 room-isolated REST-to-Socket.IO contracts.
  Restore commit failure, exactly-once race and failed delivery use real SQL.
- `node test/auth/google-auth.integration.mjs`: **14 checks PASS**.
- `node test/auth/password-security.integration.mjs`: **16 checks PASS**.
- `pnpm --filter @kanban/backend test:email-verification:database`: **16 checks
  PASS**, including the updated database foundation and migration run/down/rerun
  checks. These auth suites use their own disposable Docker PostgreSQL instances.

Workspace results on the final code:

| Check                                           | Result                                          |
| ----------------------------------------------- | ----------------------------------------------- |
| `pnpm lint`                                     | PASS                                            |
| `pnpm test`                                     | PASS: 6 shared, 541 backend, 643 frontend tests |
| `pnpm build`                                    | PASS                                            |
| Prettier check of every added/changed text file | PASS                                            |
| `git diff --check`                              | PASS                                            |
| Real browser and independent visual review      | PASS: 18 captures; both review passes approve   |
| `pnpm format:check` across the whole repository | Blocked by 282 pre-existing, unchanged files    |

The final full test run sets `npm_config_workspace_concurrency=1`, running the
workspaces sequentially. Parallel verification load caused two process-bootstrap
timeouts on the first full run; both pass without changing their timeouts when
workspaces run sequentially. Sandbox cache errors also required running tests
outside the filesystem sandbox. No test or assertion was disabled.

Environment: Node 22.12.0 and pnpm 10.18.3. The repository's existing Node
`>=22.13.0` engine warning and Vite bundle-size warning remain. Production
migrations, CI, remote push, PR creation and deployment were not performed.

## Out of scope

Permalinks (P1-03), bulk restore, hard delete, retention, choosing another column,
new ACL/schema, notifications and production deployment are excluded.
