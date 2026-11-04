# P4-06 — My Tasks UI

Implements the frontend portion of [issue #195](https://github.com/duongkienvn/SE2026-T13/issues/195),
[CX-02](../../roadmap/post-mvp.md), the [approved My Tasks spec](../../design/post-mvp/home-tasks/ux-spec.md), and the [P4-01 API handoff](../backend/p4-my-tasks-home-api.md).

## Behavior and scope

- `/my-tasks` is protected by the existing authenticated layout. Only the My Tasks navigation slot becomes available; the existing shell and mobile drawer remain in place.
- The page reads the complete `GET /users/me/tasks` envelope, including the sibling `groupCounts`, and uses server-provided groups, counts, page metadata and Card permalinks. It never infers completion or aggregates a client-side cross-Board Card scan.
- Group, sort, page, Workspace, Board, Board-local match-any labels and calendar date filters are reflected in the URL. Changing filters and invalidating an active task page reset paging; invalid parameters are normalized, and incompatible Board or label selections are cleared after authorized discovery.
- Date inputs represent calendar dates in the user's saved IANA timezone. The API receives an inclusive start and exclusive next-day boundary. Dates are displayed using saved preferences. A skipped-day range with no instants is rejected in the UI.
- Task and Board-option queries are scoped to the user and session generation, consume abort signals, hide snapshots while rechecking, and discard data on access changes. Existing realtime invalidations, access signals, focus, reconnect and remount cause REST rechecks; no protected task data is persisted in browser storage.
- Workspace choices use membership discovery; Board choices use the server's readable Board discovery, including explicit Board grants. Labels are read only from the selected Board's catalog.

### Realtime boundary

The user explicitly accepted this limitation during implementation: while My Tasks stays open, changes from a Board whose room is not already watched are not pushed to this page. Existing Card events are Board-room scoped; joining every accessible Board would also publish presence in those Boards and is subject to the server's room-request limits. No mass room joins, polling, backend change, or new socket mutation was introduced. Existing access-change signals, reconnect, focus and remount revalidate through REST. A complete cross-Board live stream would require a separately scoped server invalidation mechanism.

Existing files were changed only for integration: `app/routes.tsx` registers the protected route and `app/layout/navigation.ts` activates its slot; their existing tests assert the new destination. `lib/api-client.ts` exports the existing validated envelope reader so the scoped API can retain the sibling counts. Board/Workspace revocation and realtime access, event invalidation and reconnect files clear or revalidate this aggregate on their existing signals. These changes do not alter shared shell markup, styles or tokens.

## Visual reference and differences

The new surface follows the grouped sections, tabs, compact rows, typography hierarchy and due-color cues in panels 2 and 6 of the [approved reference](../../design/post-mvp/home-tasks/approved-visual-reference-v1.png). The checkbox and avatars are omitted because the approved text and actual API do not authorize completion semantics or per-Card avatar data. Mobile uses the existing drawer rather than the pictured bottom navigation. Filters, sorting, pagination and long-content handling extend the reference to support the issue's real controls and accessibility. Existing shell dimensions, global tokens and unrelated screens were not redesigned.

HTTP-fixture captures are stored in [implementation evidence](../../design/screens/implementation/p4-my-tasks-ui/): `light-*` and `dark-*` show the task page; `filters-*` shows its expanded controls. `main-*` and `current-*` pairs show Boards, Settings Profile and Card Detail at 1280, 768 and 375 pixels, in light and dark. These are local fixture captures, not production data or deployment evidence. The inspected Boards and Settings content outside the sidebar matched pixel-for-pixel in all six pairs. Card Detail matched in five pairs; the dark 768 pair differed in 167 pixels across the dialog body, with no material layout difference on visual inspection. The intended visible shell difference is activation of My Tasks.

An independent visual review requested denser rows and evidence of the expanded filters; both were addressed and the reviewer approved the recaptured composition. Group-specific red, amber and blue tones are scoped to this page, as the existing global tokens do not provide all four group surfaces and this issue prohibits changing shared tokens.

## Verification

Local verification on November 4, 2026:

| Check                                                      | Result                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused productivity, realtime, nav and drawer tests       | PASS: 9 files, 75 tests, including HTTP envelopes, URL/back-forward, stale URL responses, multi-label filters, timezone/DST, 401/403/404, offline, access loss and account switch. The final run used an accessible workspace temporary directory after sandbox temporary-file errors. |
| `pnpm --filter @kanban/frontend test --maxWorkers=1`       | FAIL: 126 files / 1,318 tests passed; one existing Workspace invitation timing assertion failed. That file passed separately: 27/27. The full run preceded the final focused test additions and a small task-page error-state refinement.                                              |
| `pnpm test`                                                | FAIL under sandbox: the parallel frontend run had 53 failures, including timing-sensitive existing tests and a test changed during the run; backend HTTP tests encountered localhost `EACCES`.                                                                                         |
| `pnpm --filter @kanban/backend test` with localhost access | PASS: 104 suites, 1,088 tests. Injected transport-failure scenarios logged expected sanitized errors.                                                                                                                                                                                  |
| `pnpm lint`                                                | PASS.                                                                                                                                                                                                                                                                                  |
| `pnpm build`                                               | PASS; Vite reported its existing large-chunk warning.                                                                                                                                                                                                                                  |
| Prettier on changed source and task documents              | PASS.                                                                                                                                                                                                                                                                                  |
| `pnpm format:check`                                        | FAIL: 979 checkout files flagged; all changed source and task documents pass separately. Unchanged README and Board service samples have CRLF checkout line endings, consistent with the historical P4-01 report. No unrelated formatting was changed.                                 |
| `git diff --check` and task links                          | PASS for the complete change and referenced task/design paths.                                                                                                                                                                                                                         |

No migrations, deployment, production connections, push, PR or merge were run.

## My Tasks V2 UI polish

The frontend-only polish uses the user-supplied November 4, 2026 reference as
composition guidance. The existing Sidebar, Topbar, navigation, branding, shared
components, tokens and unrelated routes are unchanged.

- `MyTasksPage.tsx` now provides a compact icon/title header, scrollable icon tabs
  with an underline, the existing result states and pagination.
- `TaskFilters.tsx` presents Workspace and Board selectors in a horizontal toolbar,
  a Labels disclosure, sorting and an active-filter count. Filters expands the
  existing board-scoped multi-label and date controls. Tablet/mobile tuck the
  less important selectors behind this disclosure, preserving keyboard order.
- `TaskSections.tsx` and `task-groups.tsx` render tinted group headers, whole-row
  Card links, Board/Workspace metadata, compact colored labels and due badges.
  Long content wraps, overdue dates also have an accessible text cue, and focus
  indicators remain visible within clipped group/tab boundaries.
- `my-tasks.css` scopes every rule to this surface. Red/indigo/neutral treatments
  derive from existing tokens; the local amber pair covers the existing upcoming
  status. Text contrast is maintained on tinted surfaces in both themes.
- `MyTasksPage.test.tsx` updates the disclosure interactions and adds coverage for
  opening/closing filters, active-filter indication, label disclosure and reset
  without losing URL state.

### Reference inventory and deliberate differences

| Reference element                                | State and implementation                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Header, group tabs/counts                        | Available; compact header and horizontally scrollable tabs above the toolbar.      |
| Workspace, Board, Labels, Sort                   | Available; toolbar with an inline advanced panel for multi-label and date filters. |
| Group headers, task metadata, labels, due badges | Available; red, amber, indigo and neutral groups with whole-row permalink links.   |
| Completion checkboxes and action menus           | Excluded by the user's explicit scope; no unsupported controls rendered.           |
| Assignee selector and alternate-layout toggle    | Excluded; assignment remains current-user scoped and no new view is introduced.    |
| Sidebar, Topbar and app decoration               | Frozen; preserved incumbent shell rather than copying the reference shell.         |

The existing query hooks, REST clients, URL parsing/normalization, session/cache
boundaries and revocation effects remain in place. Sorting, pagination/reset,
match-any labels, timezone/DST handling and error/offline recovery retain their
existing behavior. Disclosure and date-validation presentation state moved
into the page-specific filter component; task rows wait for preferences before
formatting dates, avoiding a non-null assertion during preference reloading. The cross-Board realtime limitation
recorded above remains unchanged.

### Verification of this polish

Local checks on November 4, 2026:

| Command/check                                                                  | Result                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @kanban/frontend test src/features/productivity --maxWorkers=1` | PASS: 5 files, 27 tests.                                                                                                                                                                                                                                                                                          |
| `pnpm --filter @kanban/frontend test --maxWorkers=1`                           | PASS: all 127 files and 1,325 tests before the final preference-loading guard. The focused suite was repeated after that guard.                                                                                                                                                                                   |
| `pnpm lint`                                                                    | PASS.                                                                                                                                                                                                                                                                                                             |
| `pnpm --filter @kanban/frontend exec tsc -b`                                   | PASS.                                                                                                                                                                                                                                                                                                             |
| `pnpm build`                                                                   | PASS for the workspace.                                                                                                                                                                                                                                                                                           |
| `pnpm --filter @kanban/frontend build` after the final CSS/loading adjustment  | PASS. Existing Vite environment/chunk-size warnings remain.                                                                                                                                                                                                                                                       |
| `pnpm test`                                                                    | FAIL in the default parallel run: 7 frontend files / 10 tests failed, 120 files / 1,315 tests passed. Failures were in unchanged Workspace/Card tests; the full serial frontend rerun above passed. Shared tests passed 20/20; the root failure interrupted the backend run, so no backend suite pass is claimed. |
| `pnpm format:check`                                                            | FAIL across unchanged checkout files; no repository-wide formatting cleanup is included. The seven changed source/task files pass Prettier separately.                                                                                                                                                            |
| `git diff --check` and affected documentation links                            | PASS.                                                                                                                                                                                                                                                                                                             |
| Browser visual and interaction checks                                          | PASS with isolated HTTP fixtures at 1440×1000, 1280×800, 768×1024 and 375×812. Both themes were inspected; System followed an emulated OS theme change.                                                                                                                                                           |
| PostgreSQL/infrastructure/deployment checks                                    | Not run: no backend, database, infrastructure or deployment changes.                                                                                                                                                                                                                                              |

Browser checks covered collapsed and expanded responsive filters, keyboard
Tab/Enter and focus, group selection, long unbroken task/Board/Workspace/label
text, loading, empty and error/retry presentation. Layout inspection found no
horizontal overflow outside the intentionally scrolling tabs. Screenshots were
inspected inline; the browser tool refused file saves because its configured
workspace roots did not recognize this checkout, so no stored captures are
included. Temporary fixture entry points were removed before delivery. These
checks use local fixtures, not production data or deployment evidence.
