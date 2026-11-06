# Phase 5 — Board views and global UI polish

## Scope and references

Focused frontend refinement on `fix/p5-board-views-ui-polish`. The starting
checkout matched local and remote `main` when inspected. The user's eight-item
polish brief governs scope, with the approved Calendar and Table images supplied
in the conversation and embedded in [#221](https://github.com/duongkienvn/SE2026-T13/issues/221)
and [#222](https://github.com/duongkienvn/SE2026-T13/issues/222). Historical issue
delivery instructions do not expand this task.

## Changes and visual parity

| Requirement | Result / availability                                                                                                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-01       | Removed upper Calendar/Table links. Kanban identifies the Board section; the shared lower switcher retains all three view routes, query parameters and history.                                                                                                                                                 |
| UI-02       | Read-only inspector with icon actions, creation/update timestamps, canonical filled labels, description, assignee avatar/name chips, local dates and due badges. Existing checklist API loads real lists/items on selection, with counts, progress, checked/incomplete indicators and retry/access-loss states. |
| UI-03       | Calendar layout no longer flex-shrinks the translucent panel below the intrinsic grid height. Only adjacent-month date text is subdued. Final-row/right-edge borders are removed at actual grid boundaries; mobile uses its existing single-column day strategy.                                                |
| UI-04       | Compact translucent table, aligned columns, filled label badges, existing avatars, due icons, checklist progress, real column/due status badges, icon-only Open Card and compact pagination.                                                                                                                    |
| UI-05       | One shared Board/Calendar/Table control with existing-style SVG icons, distinct bordered buttons, purple active fill and visible focus.                                                                                                                                                                         |
| UI-06       | Integrated submit-search icon at the right, compact filter count/chips, individually removable chips and Clear all. The existing URL-backed filters and submit semantics remain authoritative.                                                                                                                  |
| UI-07       | Sidebar account dropdown opts into gear/logout icons, a divider and restrained red logout/hover styling. Mobile drawer presentation and account behavior retain their defaults.                                                                                                                                 |
| UI-08       | Header bell SVG is 22px and centered within the existing 40px button. Header/search/avatar geometry and unread behavior are unchanged.                                                                                                                                                                          |

All rendered actions are available existing actions. No new Coming soon slots.
Checkbox/bulk-selection controls are intentionally omitted because no useful
selection action exists. Row actions open the existing Card Detail; no unsupported
ellipsis menu was added. Real column names and computed due states can wrap and
increase row heights, unlike the illustrative single-status mockup. Existing
saved timezone/date-format semantics retain full date/time values. Inspector
timestamps are exact formatted dates rather than introducing a relative-time
formatter. Avatar initials remain the supported fallback when no avatar URL is
available. Inspector labels use equal-height single-line badges; long names
retain their full text in the existing title tooltip.

## Layout diagnosis

The prior desktop Calendar row used `flex-1`/`min-h-0`, letting the panel shrink
while its minimum-height cells continued below the translucent surface. The
new row uses intrinsic height; the outer view owns vertical scrolling. The grid
has one continuous surface with boundary borders based on the actual 35/42-cell
count. Inspector scrolling remains bounded on short or narrow screens. Its
positioned container also prevents absolutely positioned screen-reader text
inside clipped checklist content from enlarging the outer app scroller.

Presentation is isolated in `board-views.css`, with navigation shared across all
three views. Compact filter/account options are opt-in; unrelated consumers,
Kanban columns/previews, Card Detail, board backgrounds and backend contracts
are untouched. Checklist queries reuse existing authorized hooks/query keys,
so existing realtime invalidation reaches the preview.

## Changed files

Paths below are relative to `apps/frontend/`:

- `src/features/boards/components/BoardNavigation.tsx`, `BoardViews.tsx`.
- `src/features/boards/components/CalendarBoard.tsx`, new
  `CalendarCardInspector.tsx`, new `ChecklistProgress.tsx`.
- `src/features/boards/components/TableBoard.tsx`, new `board-views.css`.
- `src/features/cards/board-filter.tsx`.
- `src/features/auth/components/AccountLinks.tsx`, `UserMenu.tsx`.
- `src/components/icons.tsx`, `src/app/layout/AppHeader.tsx`,
  `src/features/notifications/NotificationBell.tsx`.
- `src/features/boards/components/CalendarBoard.test.tsx`, `TableBoard.test.tsx`,
  `src/features/boards/pages/BoardNavigation.test.tsx`.
- `qa/board-filter-preview.tsx` extends the existing DEV-only isolated fixture
  with Calendar/Table routes and checklist/date data. No fixture data enters
  the production application.

Documentation: this record and `docs/tasks/README.md`.

## Verification

- PASS: `pnpm --filter @kanban/shared build` (existing consumer prerequisite).
- PASS: targeted frontend Vitest run covering Calendar, Table, Board navigation,
  calendar arithmetic, filter UI/URL/parsing, UserMenu, AuthenticatedLayout and
  NotificationBell: 10 files / 73 tests at the initial checkpoint. After adding
  checklist error cases, Calendar was rerun: 8/8 pass. After strengthening
  integrated search/chip removal coverage, Table was rerun: 10/10 pass. The
  final tested set contains 75 distinct passing tests.
- PASS: `pnpm exec eslint apps/frontend`.
- PASS: `pnpm --filter @kanban/frontend build` (TypeScript + production Vite).
  Existing environment warning about `NODE_ENV=production` in `.env` and the
  bundle-size advisory remain; no environment/config changes were made.
- PASS: Prettier check of all 19 changed/new files; `git diff --check`.
- FAIL (pre-existing checkout state): `pnpm format:check` reports 1,212 files.
  Unchanged samples `.prettierrc.json`, `AGENTS.md` and `calendar.ts` contain CRLF
  working-tree lines and match `HEAD` exactly after line-ending normalization;
  Prettier defaults to LF. This task's files pass formatting. No repository-wide
  formatting or Git line-ending configuration was changed.
- Backend, database, migration and infrastructure suites intentionally not run:
  frontend-only scope, as requested. No live backend/deployment verification.

The first lint/build attempt caught an unused sort-icon import; replacing the
old text arrows with that SVG resolved it. The first new HTTP 500 test timed out
before the existing two automatic retries completed; its wait now covers that
behavior and the test passes without changing production retry policy.

## Browser QA

Chrome DevTools used the actual React app through the isolated existing fixture
at `/qa/board-filter-preview.html?view=calendar|table&theme=dark|light&background=lake`.
Every API request is intercepted in the DEV-only fixture; no production data,
resources or database were used. Screenshot comparison used five captures total:
desktop dark Calendar/inspector, desktop dark Table, tablet light Table,
mobile light Calendar/inspector, and desktop dark Table/account dropdown.

- 1586×992 desktop: compared composition to the supplied mockups; continuous
  Calendar surface and distinct inspector, compact table/toolbars, actual status
  semantics, account menu and unchanged header proportions.
- 768×1024 tablet: light Table, filter/search alignment and internal horizontal
  table scrolling. No document-level horizontal overflow.
- 375×812 phone: light Calendar, wrapped month controls, readable day list,
  bounded inspector and reachable Open/Close. Escape restored focus to its
  selected pill. A second outer scrollbar discovered in this capture was fixed
  by positioning the inspector; subsequent DOM measurements show main
  `clientHeight === scrollHeight` (756px) with no document overflow.
- DOM checks covered 35-cell November/December 2026 and February 2027, plus
  42-cell January 2027. Every last cell remained inside its panel; final-row
  border widths were zero on desktop, with correct single-column borders on
  mobile. Empty-month explanatory text remains below the grid.
- Account Escape/focus restoration and outside-click dismissal passed. Bell
  measured 22×22px centered in 40×40px. No browser console warnings/errors in
  the inspected final fixture; network listing contained no live API requests.

Visual QA demonstrates local rendering with fixture data, not live backend or
deployment readiness. Existing component tests cover permission/read-only,
realtime access revocation, archive updates, pagination, search/history and
Card Detail return navigation. No additional functional limitations introduced.

## Follow-up: separate statuses and balance the inspector

The user's follow-up requests three additional refinements:

- Table now has distinct **Column** and **Status** columns. Column displays only
  the existing Kanban column name. Status displays only the existing computed
  due-date badge, with an em dash for cards without a due date. The table's
  minimum width accommodates the extra column inside its existing scroller.
- Inspector label styles target badge wrappers, not every nested span. Chips
  share a 24px height, 16px line-height, 8px horizontal padding, 6px radius and
  centered alignment. Canonical colors/text and the full-name tooltip remain.
- Desktop inspector stretches to the Calendar panel's height. CSS size
  containment lets the Calendar determine the row height, while long inspector
  content scrolls internally. Below 1200px the stacked layout disables size
  containment and retains its 40dvh inspector height limit.

Follow-up verification: 21/21 Calendar/Table tests pass, including new assertions
for Upcoming, Overdue and unscheduled cards in separate Column/Status cells.
Focused ESLint and frontend TypeScript/Vite build pass; the existing build
advisories remain. Changed-file Prettier and `git diff --check` pass.

Two additional desktop screenshots verified the inspector and separated table
columns. Browser measurements confirmed equal panel heights of 608px (November),
660px (empty December with explanatory text), and 764px (six-week January).
DOM stress checks with additional short/long label text kept every badge at
24px and retained their full titles. Long inspector text expanded its scrollable
content to 1952px without changing the 608px panel height. At 375×812 the stacked
inspector remained bounded to 324.8px, with no outer page overflow. Final browser
console had no warnings/errors. These checks used the same isolated QA fixture;
backend and unrelated suites were not run.
