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
