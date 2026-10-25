# Board archive management (K1)

## Contract

- `GET /api/boards?page=1&limit=20&status=active|archived` lists only boards with a current `BoardMember` row for the caller. `status` defaults to `active`; an invalid value returns `400 VALIDATION_FAILED`. Active boards sort by `createdAt DESC, id DESC`; archived boards by `archivedAt DESC, id DESC`. The existing success envelope and pagination metadata remain unchanged.
- `POST /api/boards/:boardId/archive` keeps its response and OWNER permission, sets `isArchived=true` and `archivedAt`, and records `BOARD_ARCHIVED`.
- `POST /api/boards/:boardId/restore` requires OWNER and returns the existing `BoardResponseDto` with `isArchived=false`, `archivedAt=null`. MEMBER gets 403; absent boards and non-members get 404; an active board gets `409 BOARD_NOT_ARCHIVED`.
- Archive and restore lock the Board row and record one Activity in the same transaction. The Activity uses `entityType=BOARD`, `entityId=boardId`, and `metadata=null`. Columns, Cards (including archived Cards), assignments, comments, membership, and ordering are untouched.
- After commit, `board:archived` or `board:restored` is emitted to the board room with `{ boardId }`. Delivery failure does not fail the REST command. Clients refetch the exact board detail and both list scopes; reconnect/rejoin also refetches lists. REST remains authoritative.

## Rollout and rollback

Run `BoardArchiveActivity1792843200001` before deploying backend code that writes the new Activity actions. It appends `BOARD_ARCHIVED` and `BOARD_RESTORED` to PostgreSQL `activities_action_type_enum`. PostgreSQL cannot safely remove used enum values; the migration intentionally refuses `down`. Roll back application code only after ensuring it tolerates stored action values, or use a planned data migration on a backed-up test copy. Do not rebuild the enum in a populated production database.

The Activity History frontend from issue #61 is part of the updated `main` baseline. K1 adds `archived the board` and `restored the board` to its action renderer; the unknown-action fallback remains in place for future actions.

## QA

1. With two OWNER/MEMBER accounts in two browsers, open the same Board Detail. Archive as OWNER; confirm the other browser becomes read-only without reload. Confirm MEMBER cannot archive or restore.
2. Open Archived on the boards page. Confirm only memberships appear, archive time and role are shown, search/pagination work, and only OWNER has Restore. Restore; confirm the board appears in Active and both open details become writable after refetch.
3. Confirm Card/Column IDs, positions, Card archive state, assignees, comments, and memberships match before/after. Confirm one `BOARD_ARCHIVED` and one `BOARD_RESTORED` Activity and no duplicate from repeat/concurrent restore.
4. Disconnect and reconnect one browser while a transition happens; confirm rejoin refetches the current status. Verify an unrelated board room receives no transition event.

Automated checks: `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm format:check`, `pnpm --filter @kanban/backend migration:show`, and the isolated database/socket integration scripts when PostgreSQL is available. Run migrations only on a disposable backed-up test database, never directly on production for QA.

## Local QA evidence (24 October 2026)

Two isolated Chrome sessions signed in as an OWNER and MEMBER against a disposable PostgreSQL database with the new migration applied. The OWNER archived and restored the shared board twice. The MEMBER's open detail became read-only after archive and active after restore without a reload. Both roles saw the archived list; only OWNER had Restore. Active search survived a tab switch, and desktop (1280×800) and mobile (390×844) layouts were inspected. The confirmation dialog focused Cancel, advanced to its action with Tab, and closed with Escape.

- [OWNER archived list](../design/screens/implementation/board-archive-management/owner-archived-desktop.png)
- [MEMBER archived list on mobile](../design/screens/implementation/board-archive-management/member-archived-mobile.png)
- [MEMBER read-only detail](../design/screens/implementation/board-archive-management/member-detail-archived-desktop.png)
- [Restore confirmation on mobile](../design/screens/implementation/board-archive-management/restore-dialog-mobile.png)

The PostgreSQL Board integration suite checked state, membership, preservation, and concurrent restore; Socket.IO integration checked delivery and room isolation. The browser pass used empty board content, so Card DnD, comments, and assignments were covered by existing automated tests rather than manual interaction. After syncing with the merged Activity History UI, its action-label tests cover both K1 actions.

## Verification after syncing with main (25 October 2026)

- `pnpm lint`: pass. `pnpm build`: pass.
- `pnpm test`: pass with workspace `TEMP`/`TMP` and localhost access for HTTP E2E tests; shared 6/6, frontend 577/577, backend 454/454.
- `pnpm --filter @kanban/backend test:boards:database` and `test:board-events:database`: pass on isolated PostgreSQL test databases, including concurrent restore, persistence, post-commit events, and room isolation.
- `pnpm --filter @kanban/backend migration:show`: pass; the Board archive migration remains pending on the local development database. It was applied only to disposable integration-test databases.
- `git diff --check` and Prettier on the changed K1 files: pass. `pnpm format:check` across the full checkout fails on 176 otherwise clean files checked out with CRLF (`core.autocrlf=true`, while `.editorconfig` requires LF).

The two-browser manual pass above predates the main sync. Activity History labels and K1 interactions passed automated tests after the sync; a fresh two-browser pass was not repeated.
