# Final Board layout and full Kanban canvas

## Scope and outcome

Implements the supplied final layout brief on the existing Board/Card polish
branch. The normal application header/sidebar remain intact. The Board title
uses the normal page surface with its icon, description and overflow menu;
compact star, role, visibility, authorized presence and connection status sit
beside the identity. The existing horizontal navigation connects directly to
that header and retains scrolling, focus and routing behavior.

The Kanban canvas now spans the application content width and remaining height,
using the selected background once on that surface. Removed the outer rounded
frame, PageContainer gutters and nested translucent panel. Column surfaces keep
text readable; their existing vertical scrolling and the horizontal column
scroller remain. The flex layout uses dynamic viewport units for a small minimum
workspace height rather than fixing the Board to a pixel height.

Empty Boards use a centered, width-limited surface, icon and short copy. Existing
permissions control Add column; Workspace readers and archived owners receive
read-only messaging without a creation action. Members, Activity and Settings
contents are unchanged. The shared header is a normal content container, keeping
the app header as the single banner landmark.

## Changed files and boundaries

- `BoardDetailPage.tsx`: local full-width layout, consolidated identity/metadata,
  semantic canvas region and normal padding for Members/Settings.
- `BoardNavigation.tsx`, `BoardStar.tsx`: compact header presentation; directory
  star defaults and all request/cache behavior stay intact.
- `KanbanBoard.tsx`, `KanbanDndBoard.tsx`, `KanbanColumn.tsx`, `style.css`:
  continuous canvas, scroller containment, readable surfaces and compact empty
  state. Existing filter, drag/drop and mutation logic is unchanged.
- `KanbanBoard.test.tsx`: scope column regions to the named workspace; cover
  empty Workspace-reader and archived-owner authorization presentation.
- DEV-only `qa/board-filter-preview.tsx`: empty and tall scenarios and long
  description coverage using existing API fixtures.

`KanbanCard.tsx` and the approved Card preview are unchanged. No backend,
migrations, dependencies, API contracts, session/access handlers, background
storage/version handling or realtime hooks changed. Previous polish commits are
preserved; this task uses a normal local commit without rewriting history.

## Browser evidence

[31 inspected screenshots, 84 layout measurements and interaction evidence](../../design/screens/implementation/full-kanban-canvas/README.md)
cover both themes at 320, 375, 768, 1280 and 1440px, photo/color, populated/empty,
long text, editable/read-only/archived and tall Boards. The canvas stays flush,
the header has no background image, and no case introduces page-level horizontal
overflow. At 320 × 600 with long text, the main area scrolls 38px vertically to
preserve a usable minimum canvas. Browser interactions cover keyboard drag
cancel, filter restrictions, creation cancellation, shared navigation and
background Cancel/Save.

## Verification

- PASS: focused Board, navigation, detail, deep-link viewport, background and
  star tests: 6 files / 95 tests with `VITEST_MAX_WORKERS=1`.
- PASS: `WorkspaceBoardContext.test.tsx`: 8 tests after correcting the extra
  banner landmark discovered by the first full run.
- PASS: root `pnpm build`, including shared/backend/frontend; final frontend
  build after the landmark correction. Existing Vite NODE_ENV and large-bundle
  warnings remain.
- PASS: `pnpm lint`.
- Root `pnpm test` ran with `VITEST_MAX_WORKERS=1`: shared 17 and backend 912
  tests passed. Its frontend run exposed five Workspace-context failures caused
  by the extra banner; those were fixed without changing the tests.
- A subsequent complete frontend run with two workers passed 1,292 tests but
  hit the untouched invitation sign-in test's immediate URL assertion before
  resume-query cleanup settled. That file passed all 27 tests in isolation.
  The initial focused two-worker run also transiently failed the existing
  navigation room-join assertion; its isolated and serial focused reruns passed.
  No invitation, realtime, test timeout or runner configuration changes were made.
- PASS: final `VITEST_MAX_WORKERS=1 pnpm --filter @kanban/frontend test`:
  122 files / 1,293 tests, including all Workspace-context and invitation cases.
- PASS: task-file Prettier, documentation target checks and `git diff --check`;
  all 31 screenshot links resolve and the measurement file contains 84 cases.
- Full `pnpm format:check` fails on 994 unchanged files due to existing checkout
  CRLF formatting. None of the nine application/QA files changed by this task
  appears among its warnings. Task files are checked separately; no bulk
  formatting or Git line-ending configuration change is included.

Database integration was not rerun: this task changes frontend presentation
only. Browser QA uses isolated fixtures, not a live backend or multi-account
socket session. Nothing was pushed, published, merged or deployed.
