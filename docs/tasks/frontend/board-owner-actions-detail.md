# Board OWNER visibility and move actions from Board Detail (P2-C07)

Implements [Issue #138](https://github.com/duongkienvn/SE2026-T13/issues/138),
the scoped WS-01 / BD-02 integration from the
[roadmap](../../roadmap/post-mvp.md),
[access matrix](../../design/product-ux-blueprint.md#permission-matrix-proposed-baseline),
[Board UX](../../design/post-mvp/board-card/ux-spec.md) and
[Workspace UX](../../design/post-mvp/workspace/ux-spec.md).
This records local implementation and verification on 2026-10-30, not deployment.

## Implementation and contracts

- Board Detail's existing action menu gains **Change visibility** and
  **Move to workspace**. Existing Edit, Archive, Restore and Archived cards
  actions and the header layout remain in place.
- Both entry points reuse `BoardVisibilityDialog`, `MoveBoardDialog` and their
  `useOwnerCommand` hook. `BoardOwnerActionModel` requires just the Board identity,
  visibility, archive state, explicit Board role, source Workspace ID and effective
  management flag. No new client, mutation endpoint, dependency or backend change.
- Effective visibility authority comes from
  `GET /api/boards/:boardId/policy-capabilities`. Board Detail shows a disabled
  visibility action with a reason while checking policy, on failure or on denial.
  Opening the dialog rechecks policy; pending/error checks disable submission.
  Widening visibility explains read-only Workspace access, and returning to
  Private explains the removal of implicit access.
- Commands reuse `PATCH /api/boards/:boardId/visibility` with `{ visibility }`
  and `POST /api/boards/:boardId/move-workspace` with
  `{ destinationWorkspaceId }`. The existing backend contracts are documented in
  [P2-05](../backend/workspace-policies-board-move.md).
- Move destinations come from the existing membership-only Workspace directory,
  exclude the current Workspace and require `canCreateBoards`. Empty and failed
  directory loads have distinct messages. A selected destination must remain
  eligible at submission, including after a background refresh. Warnings preserve
  the unchanged Board link, explicit Board access and reset to Private.

## Authorization and lifecycle

Board Detail requires an active explicit OWNER and server-provided
`capabilities.canManageBoard === true`, with a known Workspace ID and visibility.
Missing capabilities fail closed for these new actions. Workspace ADMIN status
never creates Board OWNER authority; MEMBER and Workspace-only readers receive
no owner actions. Archived OWNERs retain the existing Restore entry.

A Guest OWNER needs no source Workspace membership. Only the safe Board policy
flags and the user's joined Workspace directory are read. No source Workspace
Overview, name, membership, policy settings or count is fetched for this flow.
Backend authorization remains authoritative for every command and destination.

Pending requests disable submission, cancellation and Escape dismissal. Success
closes the dialog and Board Detail announces confirmation only after REST success.
401 uses existing session invalidation. 403/409 visibly invalidate the operation,
disable resubmission until reopening and refresh authority; 404 purges Board
access. Messages do not display private backend error details. Role/archive
changes and access loss unmount unauthorized dialogs. Session generation,
`boardAccessVersion` and mounted checks suppress stale completion effects after
logout, replacement login, realtime revocation or leaving the dialog.

Settled commands refresh only this Board's detail subtree (including policy),
Board lists and source/destination Workspace resource prefixes (including Boards,
Overview and guests). Moves also refresh the session's joined Workspace directory.
Unrelated Board details and unrelated Workspace resources are not invalidated.
Revoked access tombstones are not revived by late mutation responses.

## Verification

Used `kanvexa-ui`, `kanvexa-verification`, `browser-verify` and `commit` guidance,
with the user's explicit focused-check and single-local-commit instructions.

Pass:

- `pnpm --filter @kanban/shared build` (consumer prerequisite).
- `pnpm --filter @kanban/frontend test src/features/boards/pages/BoardDetailPage.test.tsx src/features/workspaces/boards/WorkspaceBoards.test.tsx src/features/workspaces/settings/WorkspaceSettings.test.tsx --maxWorkers=2`:
  the initial run passed both Workspace suites; three new Board Detail tests
  needed selectors that include accessible disabled-reason text.
- After correcting those selectors,
  `pnpm --filter @kanban/frontend test src/features/boards/pages/BoardDetailPage.test.tsx --maxWorkers=2`:
  38/38 passed.
- Additional focused runs of that file with
  `--testNamePattern='selected destination|policy is revoked|realtime revocation'`
  and `--testNamePattern='lost implicit access|directory failure'`: 3/3 and 2/2
  passed respectively; remaining cases intentionally filtered out.
- `pnpm --filter @kanban/frontend test src/features/workspaces/settings/WorkspaceSettings.test.tsx --testNamePattern='moves only to workspaces' --maxWorkers=2`:
  passed the extended targeted-invalidation assertion.
- These incremental runs cover 116 distinct passing cases across the final three
  focused files (43 Board Detail, 43 Workspace Settings, 30 Workspace Boards).
- Focused `pnpm exec eslint` on the modified TypeScript/TSX files;
  `pnpm exec tsc -b apps/frontend`;
  `pnpm --filter @kanban/frontend build` (TypeScript and Vite).
  Build reported the existing environment's `NODE_ENV=production` warning and
  a bundle-size warning; both were nonfatal.
- Modified-file Prettier checks, task-record relative link/path checks and
  `git diff --check`.

Intentionally skipped: root tests, full frontend suite, backend/PostgreSQL and
infrastructure tests, repository-wide lint/format and unrelated regressions,
per the user's frontend-only execution requirements. No migrations or production
commands were run.

## Browser QA and visual scope

Chrome DevTools rendered the real components through the isolated DEV-only
`apps/frontend/qa/board-owner-actions.html` fixture. Fixtures never contact a
backend and are not imported by the production application. Reproduce with
`pnpm --filter @kanban/frontend dev --host 127.0.0.1` and that path; optional
`theme=dark` and `scenario=member|reader|archived|policy-denied|empty` select states.

Both dialogs and the owner menu fit widths **320, 375, 768, 1280 and 1440** in
Light and Dark at 812px height. Inspected no horizontal page/dialog overflow,
reachable actions, readable warnings, destination exclusion, empty state,
read-only/archived roles, policy denial, accessible dialog labels and radio labels.
Tab/Shift+Tab cycle within the Move dialog; Escape closes and restores focus to
the original menu trigger. Inspected fixture scenarios had no application console
errors/warnings; API requests are intercepted by the fixture.

Evidence:

- [Desktop Light menu](../../design/screens/implementation/board-owner-actions-detail/menu-desktop-light.png)
- [Mobile Dark visibility confirmation](../../design/screens/implementation/board-owner-actions-detail/visibility-mobile-dark.png)
- [Desktop Dark move warning](../../design/screens/implementation/board-owner-actions-detail/move-desktop-dark.png)
- [Width/theme measurements](../../design/screens/implementation/board-owner-actions-detail/qa-results.json)

Visual parity is limited to Issue #138: both new menu entries and shared dialogs
are Available; existing actions remain Available according to Board authority.
No new Coming soon slots or excluded features are introduced. Existing Kanvexa
tokens, shell, Kanban and dialog composition are preserved. Broader Board/Card V2
mockup controls and navigation redesign are outside this issue.

## Limitations and discrepancies

Browser QA uses a Guest OWNER fixture without source Workspace membership, not
a live backend account. Live REST/database authorization, realtime transport,
deployed behavior and a staging Guest OWNER walkthrough were not verified here.
Existing backend behavior is reused, with mocked frontend contract tests.
The frontend architecture document still describes some Workspace management
areas as Soon; directly inspected source already provides these shared dialogs
and APIs. This task does not rewrite that historical document or expand scope.

The target branch already existed, clean and exactly at freshly fetched
`origin/main` on entry. No unmerged feature changes were carried into this work.
All implementation, tests and evidence belong to the single requested local
commit; no push, PR, merge or deployment is included.
