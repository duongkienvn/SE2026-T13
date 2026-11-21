# MOB-35 — Native Board Calendar Month

Status: **CODE COMPLETE — Mobile implementation and automated verification**.
Device verification is **NOT VERIFIED**. No APK/EAS/Expo Go/ADB, backend/Web checks, production calls,
push, PR, merge or deploy are authorized for this task.

## Source and scope

- [Issue #311](https://github.com/duongkienvn/SE2026-T13/issues/311), fully read
  from GitHub's embedded issue payload (public API was rate-limited; no comments).
- [Roadmap P5](../../mobile/KANVEXA_MOBILE_ROADMAP.md#mob-35--board-calendar-month-view-filters-and-date-semantics),
  [Design Spec §4.8](../../mobile/KANVEXA_MOBILE_DESIGN_SPEC.md),
  [architecture](../../mobile/KANVEXA_MOBILE_ARCHITECTURE.md),
  [network](../../mobile/network.md), [realtime](../../mobile/realtime.md),
  [MOB-02 components](../../mobile/MOB-02-COMPONENTS.md).
- Opened [mockup 08](../../mobile/assets/08-calendar.png) directly before coding.
  Read Web CalendarBoard, calendar helpers and
  [P5 Calendar record](p5-calendar-view.md), without changing Web.
- Clean starting checkout on main; fetched origin/main, equal at `3d618f5a`.
  Verified merge commits for PRs #275 (`8465c5ff`), #282 (`0f7eeb79`),
  #283 (`4464baa7`), #284 (`4757e670`) and inspected actual Board/Card/date/filter
  implementations. Branch: `feat/mobile-calendar-month`.
- Skills loaded/applied: appllama-app-design-skill, appllama-usage, kanvexa-ui,
  impeccable, kanvexa-feature, kanvexa-verification, ponytail. Appllama MCP is not
  available in this session; no external app-research claims. Impeccable context
  ran once; no PRODUCT/DESIGN files exist, so the pinned existing Kanvexa visual
  world/mockup is authoritative. No redesign or new design-system artifacts.

## Verified REST contracts

`GET /api/boards/:boardId/cards?status=active&page=N&limit=100` uses standard page
metadata. Native `createKanbanApi.cards` / `decodeKanbanCard` remain the adapter
and trust boundary. Backend `ListCardsDto` accepts q, columnId, labelIds,
assigneeIds, dueStatus, dueFrom/dueTo, sorting/status. Labels and assignees use
`EXISTS ... IN` (OR in each set; AND across different filter groups). Due range
is inclusive-from/exclusive-to ISO instants. Backend rechecks Board read access
before and after the query; archived Boards may remain readable. Card data has
start/due instants, not events/durations/priority.

The Calendar filter sheet reuses Board models/catalog adapters and Apply/Reset;
adds existing server column filtering. It omits archived mutation/filter controls,
start-only toggles and date-only due ranges (safe IANA-boundary conversion is not
introduced). Compatible existing ISO range filters remain in the shared model;
when inherited from Board they are visible/editable/removable in the sheet, not
hidden predicates. Calendar ignores Board sorting (daily instant/UUID order is
fixed), and does not count sort as an active Calendar predicate. Applying Calendar
filters updates compatible Board context; merely opening it does not erase the
Board's archived/sort state.

## Date and selected-day model

- Only active Cards with dueDate; no start-only, undated or spanning entries.
- Projection uses shared `cardDateInZone` and validated instant parsing; account
  `GET /users/me/preferences` supplies IANA timeZone, dateFormat, weekStartsOn and
  theme. Missing fields default UTC / YYYY-MM-DD / monday / system. Device zone is
  never the grouping authority. Failed preferences explicitly disclose fallback.
- Grid arithmetic uses civil YYYY-MM-DD in a UTC carrier, `setUTCDate`/month
  arithmetic, never elapsed 24-hour addition to a Card instant. Grid has 35/42
  cells with adjacent dates. Native Monday default intentionally differs from
  current Web Sunday-first grid; due membership/order does not.
- Selected defaults to account-zone Today. Month shifts preserve day-of-month,
  clamped to destination month's final day. Today jumps to current zone day.
  Selecting an adjacent date selects its month. Zone updates regroup without
  altering persisted instants; explicit selection remains a civil date.
- Due instant ascending (numeric timestamp), UUID ascending; latest ID duplicate
  wins before projection. One foreground minute clock resamples on AppState wake.

## Complete dataset and security

`loadCalendarCards` walks sequential pages until verified end, without a Card
cap. It checks page/limit/total/totalPages consistency, expected lengths, unique
ID count and stable totals. Multi-page walks re-read page one to detect boundary
reordering/data changes. Detectable drift restarts once; repeated drift throws
CALENDAR_INCOMPLETE. Page errors reject the whole dataset. No partial daily count
or title list is published while loading/refetching/error.

**Server limitation:** OFFSET REST has no snapshot revision. A same-total change
outside the verification boundary cannot be proved absent by any finite client
walk. The implementation detects observable drift and uses authoritative
realtime/focus refresh; it does not claim transactional snapshot isolation.

Query key is existing session/Board/filter Card-list prefix plus
`complete-calendar` suffix (array vs InfiniteData cache isolation). Existing
realtime mutation/access eviction prefixes cover it. No new socket/auth owner.
Filter/Board/session change and screen blur cancel/fence page walks; resource
probes and verified REST Board detail are prerequisites. Revoke/account/logout
purge protected data. Catalog failures don't grant or infer private identities.

## Mockup comparison

Preserve Kanvexa K asset, indigo semantic tokens, brand/header/Back/Board context,
Month/Week context, Today/month caption/arrows, seven-column grid, selected purple
day, subtle deadline markers and agenda underneath. Use real Card rows and native
FlatList, sheet, safe area and existing Card-date/label components.

Required deviations: Week is explicitly unavailable (MOB-36), Board-scoped rather
than Workspace aggregate filters, no start-date toggle, no completion checkbox,
no meetings/time blocks, system typography from MOB-02 rather than a new font.
Large fonts use shorter weekday visual labels with accessible names. Counts above
99 visually bound to 99+ while accessibility exposes exact count.

Native screenshot/physical layout, TalkBack/VoiceOver, motion, device safe-area and
Android/iOS device E2E remain **NOT VERIFIED**; component tests are not device QA.

## Automated verification — final

Focused command:

```powershell
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test apps/mobile/test/calendar/*.test.ts
```

Latest: **28 PASS** — grid lengths/year boundaries, due-only grouping, zone/DST,
all-page sizes 0/1/20/21/100/101/250/351, overlap/drift/errors/cancellation,
query/CSV params, account/logout/revoke fences, 401/403/404/429 and actual existing
socket hint coalescing. Twenty due-update hints on a 101-Card dataset caused one
three-request REST walk (two pages + first-page verification).

Focused Calendar/component/filter harness: **16 PASS** (13 Calendar route,
2 agenda theme/long-text, 1 shared-filter session test). Combined Board regression
run **58 PASS**, after replacing six obsolete coming-soon assertions with real
canonical Calendar navigation assertions. Existing real Expo Router/auth integration
also **PASS** with Board → Calendar → existing Card Detail → Back, selected date
and filter retention. Saved timezone/dueStatus changes refetch server membership;
the focused regression passed and explicit selected day remained unchanged.

`pnpm --filter @kanban/shared build`, `pnpm --filter @kanban/mobile lint` and
`pnpm --filter @kanban/mobile typecheck`: **PASS**. Android bundle command:

```powershell
$env:EXPO_NO_DOTENV='1'
$env:EXPO_PUBLIC_API_BASE_URL='https://example.invalid/api'
$env:EXPO_PUBLIC_SOCKET_URL='https://example.invalid'
pnpm --filter @kanban/mobile bundle:android
```

**PASS**: Hermes `.hbc`, 1,677 modules, 1,624 native source-map entries; shared ESM
and original K logo verified, no Web/server/Node shim imports. This is not APK
verification. Final rerun after the timezone fix also passed (Hermes hash `d1dac53293f8c5adf28ed24866f7e90a`).

Full `pnpm --filter @kanban/mobile test`: Node stage **548 PASS**, Jest **46 suites /
545 tests PASS**, but its process retained handles after the summary and was
terminated (so this command's exit is **INTERRUPTED**, not a clean pass). The final
`pnpm --filter @kanban/mobile exec jest --runInBand --detectOpenHandles --silent`
reported **46 suites / 547 tests PASS**, including both final regressions, and
**exited naturally with code 0** after retained timers drained. No forceExit or
production infrastructure fix was used. The Calendar-only harness uses test-only
gcTime Infinity and exits promptly. Existing Router fixture-route warnings and
unrelated act warnings are not treated as device evidence.

Additional final checks:

- Same date tests with `$env:TZ='Pacific/Honolulu'`: **3 PASS**, proving projection
  does not depend on the process/device zone.
- `pnpm exec prettier --check` with explicit changed-file paths/patterns: **PASS**.
- Task-record relative repository links (9 targets): **PASS**.
- `git diff --check`, full source/diff review, final `git status --short`: **PASS**.
- Backend/Web/root suites, device/APK/Expo Go/ADB, native iOS: **NOT RUN** as
  explicitly excluded. No screenshots fabricated or UI device-verification claim.

## MOB-36 handoff (no Week implementation)

- `features/calendar/due-groups.ts`: `cardsByDueDay`, `calendarToday` use shared
  IANA projection/validated instants; reuse unchanged.
- `features/calendar/queries.ts`: `calendarCardOptions`, `loadCalendarCards`,
  `calendarFilters`, `IncompleteCalendarError`; same authorized complete dataset.
- `features/calendar/month-grid.ts`: civil carrier and WeekStart type; Month owns
  35/42 cells, Week must not invent meeting durations.
- BoardViewFiltersProvider owns ephemeral per-Board compatible filter state,
  scoped to private navigation session. BoardFiltersSheet calendar variant uses
  the same Apply/Reset/query model.
- Calendar selected day is a civil date; lift/share it with Week when MOB-36 lands,
  preserving explicit date and Today rules. Existing canonical Card push remains
  `/boards/:boardId/cards/:cardId` with native Back to originating Calendar.
- Keep query prefix and dataset shape suffix; never create a competing Card model
  or socket provider. Existing reconciliation coalesces Board-targeted hints.

## Acceptance evidence map

| Matrix | Evidence                                                                                            |
| ------ | --------------------------------------------------------------------------------------------------- |
| A      | `test/calendar/dates.test.ts`: 28/29/30/31, Mon/Sun, 35/42, leap/Jan/Dec                            |
| B      | Explicit clock and IANA boundaries, DST gap/fold; component foreground resampling                   |
| C      | Due-only, active-only, duplicate/latest-ID, absolute instant then UUID                              |
| D      | 0/1/20/21/100/101/250/351; failing first/middle/last, overlap/drift/cancel                          |
| E      | Actual HTTP params/CSV OR; shared Apply/Reset/Column; stale replacement and zone change             |
| F      | Actual Expo Router Board/Calendar/Card/Back plus scroll/focus remount harness                       |
| G      | Real session generation/revoke/logout transport fences; 401/403/404/429; offline UI                 |
| H      | Existing realtime client burst measured against HTTP, remote due regroup, unrelated Board isolation |
| I      | Loading/incomplete/error/empty, theme tokens, 320dp/160% harness, long title, accessible states     |

No new dependencies, backend/database/Web source changes or production access.
Final manual source/diff review includes all untracked additions. Changed-file
Prettier check and `git diff --check` passed; no root suites were run. The first
PowerShell array-based Prettier command passed bundle then failed argument
expansion; the explicit-pattern rerun checked all intended files successfully.

## Local delivery

Branch `feat/mobile-calendar-month` contains meaningful local Conventional Commits
for date primitives, account preferences, complete pagination, compatible shared
filters, Month/agenda UI, navigation/security/realtime tests, timezone reconciliation,
and task documentation. No push, PR, merge or deploy was performed. Final evidence
is committed separately rather than claiming an interrupted test command passed.

Remaining risks are native rendering/accessibility/motion/device E2E and the
server's non-snapshot OFFSET contract described above. These do not become
VERIFIED through Metro export or component tests. MOB-36 remains unimplemented.
