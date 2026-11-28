# MOB-45 Bounded productivity rendering and Calendar loading

[Issue #330](https://github.com/duongkienvn/SE2026-T13/issues/330)

Phase P7A measured performance stabilization, mobile client only. No backend,
shared contract, Web or dependency change.

## P02 Calendar: request only the visible window

**Contract check.** `CardsService.findAll` treats `dueFrom` as inclusive
(`card.dueDate >= :dueFrom`) and `dueTo` as exclusive (`card.dueDate < :dueTo`).
Both are ISO instants (`@DateFieldOptional`). `NULL` due dates never match, and
the conditions are ANDed with `q`, labels, assignees, column and `dueStatus`.
`normalizeKanbanFilters` already validates instants and rejects
`dueFrom >= dueTo`. The existing contract can express the window, so no
backend change was needed.

- `calendar/interval.ts`:
  - `monthWindow(month)` returns the first and last grid day the month can show
    for either week start, so adjacent-month days are included.
  - `visibleDueInterval(days, zone)` turns them into exact instants with the
    existing `localDayStart`/`nextDay`, which handle skipped and repeated
    midnights.
  - `intersectDueRange` keeps the narrower of the user's own `dueFrom`/`dueTo`
    and the window. It returns `null` when they cannot overlap. An invalid user
    value is passed on so it is still rejected as before.
- `calendarCardOptions(…, interval)` puts the window into the request and the
  query identity (`…cards(normalized params)`, `'complete-calendar'`,
  `[dueFrom, dueTo]`). An empty overlap resolves `[]` with no request. The
  existing sequential walk, drift restart, page-1 verification, ACL/session
  prefix and cancellation are unchanged.
- The Calendar screen uses the selected month's window in the saved timezone.
  Week view always lies inside it, so switching between Month and Week,
  selecting a day in the month and changing the week start reuse one request,
  as before. Changing month or timezone starts a new walk. The old effect
  that refetched on a timezone change is removed, because the key now changes
  and the existing key-change effect cancels the old walk. The query waits until
  preferences are known, so it never makes a UTC-fallback walk.

### Before/after (deterministic probe, `test/calendar/visible-interval.test.ts`)

| Fixture                                                                    | Before                                      | After                                      |
| -------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------ |
| 10,000 undated Cards, November in Bangkok                                  | 101 reads, 10,000 Cards downloaded, 0 shown | 1 read, 0 Cards                            |
| 10,000 undated + 152 in window (including both edge grid days) + 3 outside | (full walk)                                 | 3 reads (2 pages + check), exactly the 152 |
| User range with no overlap                                                 | full walk                                   | 0 reads                                    |

These are request counts from a fake server that applies the backend rules.
No device frame rate or memory was measured.

## P01 Long productivity lists: real virtualization

- `ui/sections.tsx` `VirtualSections` is a `SectionList` shell. Screen chrome
  (header, chips, notices, skeletons) is the list header. Load more, totals and
  the loading state are the footer. Sticky headers are off.
  `initialNumToRender` is 20 (one page), `maxToRenderPerBatch` is 10 and
  `windowSize` is 7.
- My Tasks (`TaskSections`), Inbox (`InboxSections`) and Search
  (`SearchSections`, all types) now render through it. Each keeps its existing
  data:
  - server order and grouping;
  - "N loaded" headers, true totals and "View all" (now as a section footer);
  - stable keys (task id, notification id, `type:id`);
  - refresh, read actions, filters, pagination and disabled/opening states;
  - the existing `testID`s (`my-tasks-scroll`, `inbox-scroll`, new
    `search-scroll`).
- All loaded pages are kept. Nothing is truncated, and offscreen rows are only
  unmounted.
- Kanban and Table were already virtualized and are untouched.

### Evidence

- `test/virtual-sections.component.test.js`: 1,000 retained rows. At first,
  20 or fewer rows are mounted, in order. After a scroll, row 999 mounts while
  fewer than 100 rows are mounted, and the tail window is contiguous and
  ordered.
- Screen suites now scroll (`test/virtual-list.js`) to reach later rows. My
  Tasks with 101 loaded rows mounts 30 or fewer, and its footer still reports
  `101 loaded · 101 matching`.

## Coordination and limits

- MOB-43 (separate branch) changes Calendar-adjacent Home/My Tasks/Kanban
  clocks, but not Calendar. Calendar's minute `useCalendarClock` boundary refetch
  under a due filter is unchanged. It now walks only the visible window.
- One mutation survived: `keyExtractor` by title instead of id, because fixture
  titles are unique. Ids are used.
- Not measured: Android frame rate, memory and scroll jank (MOB-42 runtime).
  The improvements are structural (mounted rows) and request counts only.
