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
  page-owned `useBoardOwnerActions` hook. `BoardOwnerActionModel` requires just the Board identity,
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
explicit Board grant versions, route identity and parent-mounted checks suppress
stale completion effects after logout, replacement login, realtime revocation or
leaving the page. General access resynchronization preserves the pending command
but hides protected dialogs until their Board authority is verified again.

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
The initial implementation, tests and evidence belong to its single requested local
commit. The PR repair below adds one further local commit; neither operation
includes a push, PR creation, merge or deployment.

## PR #143 P2 repair — access notification before REST completion

The [Codex review finding](https://github.com/duongkienvn/SE2026-T13/pull/143#discussion_r4422128496)
is valid. Visibility/Move notify the acting owner through `access:changed` before
returning REST success. Its handler clears protected snapshots and advances the
general access version. Previously this unmounted the dialog-owned mutation;
mounted/version guards discarded its completion, while retained dialog selection
could reopen the dialog with a new, idle mutation.

`useBoardOwnerActions` now owns selection and the shared mutation in
`BoardDetailPage` / `WorkspaceBoardsContent`, above the conditional dialogs and
Board cards. Clearing snapshots still hides protected content immediately.
The mutation and pending state survive that temporary unmount, including when
a moved Board disappears from its source Workspace list. Confirmation clears the
same parent selection before refreshed dialogs can reopen. The dialogs remain
shared forms; no endpoints, backend authorization or styling changed.

`boardGrantVersion` exposes the existing per-Board grant counter separately from
the general resync counter. Existing `boardAccessVersion` consumers and realtime
snapshot clearing retain their original strict behavior. Completion still rejects
explicit revocation/role transitions and old sessions. If a general resync occurred
or the current Board snapshot is absent, a fresh authenticated `GET /boards/:id`
must confirm active OWNER management authority before completion. Another resync
during that read requires another fresh check. A denied read purges Board access;
late mutation DTOs never repopulate protected caches. Route/selection identity and
parent lifetime checks prevent an old request from closing another Board's dialog.
Relevant source/destination invalidations still run after accepted completion.

Focused regression coverage uses the actual `RealtimeProvider` event handler:

- Visibility and Move through both entry points, with `access:changed` before REST
  and with the Board/list reload finishing either before or after the REST response.
- Pending state and duplicate-submit prevention across modal/card remounts; a
  moved Board disappearing from the source list; completion and query invalidation.
- Genuine Board revocation, role change, denied revalidation, session loss,
  repeated resync during authority verification and navigation to another Board.
- Existing account-switch, archived/role transitions and stale-response tests;
  general snapshot clearing advances access versions without changing grant versions.

Repair verification (2026-10-30):

- Pass: `pnpm --filter @kanban/frontend test src/features/boards/pages/BoardDetailPage.test.tsx src/features/workspaces/settings/WorkspaceSettings.test.tsx src/features/workspaces/boards/WorkspaceBoards.test.tsx src/features/boards/access-version.test.tsx src/features/realtime/access-revocation.test.ts --maxWorkers=2`
  — **139/139** tests across five relevant files.
- Pass after the final route/grant refinements:
  `pnpm --filter @kanban/frontend test src/features/boards/pages/BoardDetailPage.test.tsx src/features/workspaces/settings/WorkspaceSettings.test.tsx src/features/realtime/access-revocation.test.ts --testNamePattern='access:changed|different Board route|clears stale protected caches' --maxWorkers=2`
  — **20/20** selected tests, 88 intentionally filtered out. These incremental
  runs cover 141 distinct passing cases; 17 are newly added race/lifecycle cases.
- Pass: scoped ESLint for changed TS/TSX, `pnpm exec tsc -b apps/frontend`,
  frontend TypeScript/Vite build, modified-file Prettier and `git diff --check`.
  Build retains the previously reported nonfatal environment and size warnings.
- Chrome DevTools: the existing isolated QA entry now accepts
  `scenario=resync-race`, invoking the real snapshot-refresh function before
  delaying mutation responses by 500ms. Inspected pending preservation, no early
  success, eventual completion/closed dialog and unchanged Board link on mobile
  Dark (375×812); desktop Light (1280×800) confirmed visibility completion and no
  horizontal overflow. No application console errors/warnings. Existing layout
  evidence above remains applicable; no additional layout screenshots needed.
- Not run: full frontend/monorepo, backend/database or unrelated suites; live
  backend/transport QA and deployment. All repair fixtures remain DEV-only.
