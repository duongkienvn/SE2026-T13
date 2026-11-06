# P5-05 Table View (DX-02)

The Board table at `/boards/:boardId/table` shares the Board canvas, filter URL
and view selector with Kanban and [P5-04 Calendar](p5-calendar-view.md). Card
titles and Open actions use the existing Card Detail route and return to Table.
The background and access checks remain owned by Board Detail.

The table queries active Cards through the existing Board endpoint and batches
preview summaries for the current page. Column names, Board labels, permitted
member information, date preferences and checklist counts come from their
existing sources. Column name is the workflow status; due-state badges use
the existing date rules. There is no separate Table storage, bulk selection or
inline mutation. Read-only users can open Card Detail without write access.

`sortBy=title|dueDate` and `sortDirection=asc|desc` are optional Card list API
parameters. With a sort selected, the server orders the filtered result before
pagination, uses Card ID as a stable tie-breaker, and puts null due dates last.
Without a sort the existing Kanban order is unchanged. Table requests pages of
at most 100 and keeps sort/page in local view state; Board filters use the
existing URL contract. Search is applied on form submission. Counts come from
the server. Mutations and realtime events reuse the existing query invalidation.

The reference is [issue #222](https://github.com/duongkienvn/SE2026-T13/issues/222).
The Card PostgreSQL integration suite passed 15 groups using a disposable
local PostgreSQL container, including the new sorted multi-page assertions.
`pnpm test` passed with workspace concurrency set to one, a stable temporary
directory and loopback access: shared 20 tests, backend 114 suites/1,261 tests,
and frontend 143 files/1,491 tests. An earlier concurrent `pnpm test` run failed
one Board navigation assertion: two realtime joins were observed where one was
expected; all 16 navigation tests passed when rerun alone. That concurrent-run
failure remains unexplained. Workspace build and lint passed. Repository-wide
formatting reported 1,107 files with style issues; changed files
passed a targeted check. Chrome captures at 1585×992, 768×1024 and 375×812
in dark and light themes are in the [implementation evidence](../../design/screens/implementation/p5-table-view/).
They use synthetic API and Socket.IO responses, including the bundled lake
background and sample labels, assignees, checklist counts and due states. The
checklist uses the same semantic progress treatment as Kanban Card previews.
A later Chrome measurement found that the visually hidden Actions
heading escaped the table's scroll container; the heading now has an accessible
name without positioned content. At all three capture sizes, document and main
scroll widths matched their client widths; the table alone scrolled on narrow
screens. Enter on the focused title-sort button changed `aria-sort` to
descending and requested descending order. This is a targeted keyboard check,
not a complete screen-reader or accessibility audit.

The focused Table suite now covers read-only archived Boards and Workspace
viewers, labels, accessible assignee names, checklist progress, overdue versus
column status, URL/search history, Calendar navigation, the retained photo,
archive invalidation and access revocation. It uses mocks: it does not establish
real-user permission changes or server-side background persistence. PostgreSQL
integration also checks ascending and descending ties across page boundaries.
