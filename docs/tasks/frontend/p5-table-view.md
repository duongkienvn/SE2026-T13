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
The frontend suite passed 143 files and 1,485 tests with a stable temporary
directory; the backend suite passed 114 suites and 1,261 tests with loopback
access. Workspace build, lint and shared tests passed. Repository-wide
formatting reported pre-existing violations across many files; changed files
passed a targeted check. Chrome captures at 1585×992, 768×1024 and 375×812
in dark and light themes are in the [implementation evidence](../../design/screens/implementation/p5-table-view/).
They use synthetic API and Socket.IO responses, including the bundled lake
background, and show the mobile filter fix after an initial narrow-layout
failure. They do not prove background persistence, real-user permissions,
keyboard operation, screen-reader behavior or all metadata combinations.
