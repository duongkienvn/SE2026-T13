# MOB-36 — Native Calendar Week and Month/Week consistency

Status: **CODE COMPLETE — MOB-36 implementation, Mobile automated verification and documentation**.
Native/device verification is **NOT VERIFIED**. No APK, EAS Build, Expo Go, ADB,
production calls, push, PR, merge or deploy were performed.

## Sources, baseline and scope

- [Issue #312](https://github.com/duongkienvn/SE2026-T13/issues/312), including
  all ten acceptance criteria; [MOB-35 #311](https://github.com/duongkienvn/SE2026-T13/issues/311)
  and [merged PR #314](https://github.com/duongkienvn/SE2026-T13/pull/314).
  Public REST API later rate-limited; the complete issue was also read from
  GitHub's embedded IssueViewer payload (no comments).
- [Mobile Roadmap P5](../../mobile/KANVEXA_MOBILE_ROADMAP.md#8-phase-5--my-tasks-search-notifications-calendar-mob-2936),
  [architecture](../../mobile/KANVEXA_MOBILE_ARCHITECTURE.md),
  [Design Spec §4.8](../../mobile/KANVEXA_MOBILE_DESIGN_SPEC.md#48-screen-08--calendar-month--week--filters),
  [MOB-02 components](../../mobile/MOB-02-COMPONENTS.md),
  [MOB-35 implementation record](mob-35-native-calendar-month.md),
  [Web P5 Calendar record](p5-calendar-view.md).
- Directly opened [approved Calendar image](../../mobile/assets/08-calendar.png).
  Read Web CalendarBoard/calendar helpers and backend Card list/response DTOs
  only as contract references; no Web/backend/shared contract changes.
- Starting tree was clean on main. Fetched `origin/main`, equal at `641fce12`
  (PR #314 merge), confirmed `d1fc94ef` was an ancestor. Branch
  `feat/mobile-calendar-week` created from that baseline. Verified merged
  MOB-15/18/19/22 dependencies, not dependent on Push/Quiet Hours or MOB-26/28.
- Read repository AGENTS, workflow and actual `.agents/skills` router. Applied
  `appllama-app-design-skill`, `appllama-usage`, `kanvexa-ui`, `impeccable`,
  `kanvexa-feature`, `ponytail`, and `kanvexa-verification`. Appllama MCP tools
  are unavailable: no claim of external app research. Impeccable context ran
  once; no PRODUCT/DESIGN files exist. The pinned Kanvexa mockup, existing
  native tokens/components and MOB-35 composition remain authoritative; no
  redesign or unrelated design-system artifacts.
- Direct owner instructions narrow issue delivery: **Mobile-only checks and
  local commits**, not the issue's generic root-suite/push/PR instructions.

## One Calendar model, not a second engine

The canonical route remains `/boards/:boardId/calendar`. No Week route, URL
query contract, endpoint, dependency or new authorization/socket provider.
The existing `CalendarMonthScreen` stays the shared parent (name retained to
avoid a gratuitous route/file migration). MonthGrid accepts the internal view
and derives either the established Month cells or seven Week civil dates.

Unchanged MOB-35 primitives:

| Concern          | Reused interface/behavior                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Card transport   | `createKanbanApi.cards`, `decodeKanbanCard`, status=active, limit=100                                                                             |
| Complete dataset | `calendarCardOptions` / `loadCalendarCards`; sequential pages, integrity checks, one bounded drift restart and first-page recheck; no dataset cap |
| Cache            | Same session-generation/Board/filter Card-list key and `complete-calendar` suffix; view/day/week never enter the key                              |
| Grouping         | `cardsByDueDay`, shared `cardDateInZone`/instant parser, ID dedupe, due instant then UUID ascending                                               |
| Filters          | `useBoardViewFilters`, `calendarFilters`, BoardFiltersSheet Apply/Reset, normalized server params and OR label/assignee sets                      |
| Access           | Existing Board probe, ResourceBoundary, receive/response fences, cancellation and private query eviction                                          |
| Realtime         | Existing session socket, coalesced hint invalidation, REST authority and reconnect recovery                                                       |
| Navigation       | Existing canonical authenticated Card route and `useScrollRestore`                                                                                |
| Preferences      | Existing session date-preferences query/decoder and account IANA date helpers                                                                     |
| Agenda           | Exact same CalendarAgendaCard and virtualized FlatList for both views                                                                             |

No changes to the complete pagination/query or grouping engines. A pending or
failed required page means **counts unavailable**, not zero or a partial total.
A pure view switch does not unmount/recreate the Card observer or change its key.
Switching while page two is delayed keeps the same AbortSignal/walk.

## Shared state and navigation

- Initial view Month; selected civil day resolves once from current instant in
  saved account timezone after preferences resolve (disclosed UTC fallback on
  error). Later timezone/week-start changes retain that civil selection.
- Month ↔ Week pins the same day and filters. Visible period is derived from
  selection, not an independent competing cursor. Month's existing clamped
  month-page selection behavior is unchanged.
- The existing private-session BoardViewFilters owner also holds ephemeral
  Calendar restoration: view, selected civil date and Month/Week scroll offsets.
  Keys include user ID, session generation and Board ID. No Card payloads,
  credentials, public storage or module-global Calendar cache.
- Card tap uses the existing checked Card UUID and Board scope, pins selection,
  and pushes the existing Card Detail. Both ordinary Back and simulated full
  Calendar route unmount/remount retain view/day/filters and restore a reasonable
  offset through the existing list restoration hook. Per-view offsets avoid
  restoring Month's tall grid position into Week and vice versa.
- Confirmed Board denial clears selection, filters, view and offsets and hides
  private content. Card-level denial remains a Card boundary, not automatic
  proof of Board denial. Account/session/Board changes remount the scoped entry;
  delayed old pages cannot populate the new protected scope.

## Week math, preferences and Today

`week.ts` only extends existing UTC civil-date arithmetic:

- Monday offset `(getUTCDay() + 6) % 7`; Sunday offset `getUTCDay()`.
- Seven consecutive dates; Previous/Next uses `setUTCDate(day ± 7)` on the civil
  carrier, never elapsed hours on a localized Card instant. Wednesday stays
  Wednesday across DST, leap dates and year boundaries.
- Range captions disambiguate both months/years, e.g.
  `28 Dec 2026 – 3 Jan 2027`; captions wrap rather than ellipsize.
- Existing foreground minute clock updates Today markers and overdue truth,
  resamples on wake and stops on background/unmount. Today button samples
  `Date.now()` itself, not a potentially stale rendered instant.
- Preferences have no realtime event. A bounded 60-second focused/online poll on
  the **existing** account preference query observes remote Web/device changes;
  standard foreground focus refetch also reconciles them. No new global observer.
  Week-start/date-format/theme changes do not refetch all Cards. A zone change
  regroups cached complete Cards; with a server dueStatus predicate the existing
  MOB-35 cancel-before-refetch path also recalculates server membership.
- Saved dateFormat and IANA timezone feed real due labels. UTC Card timestamps
  are never rewritten.

## Due-time agenda and authorized metadata

Only active decoded Cards with a valid dueDate are grouped. Start-only, undated
and archived Cards do not become deadlines. Latest ID dedupe prevents a moved
deadline leaving a ghost. Ordering is **absolute instant ASC, UUID ASC**, including
DST-fold wall-clock ties. Both views use the same selected group object/order.

Rows show actual title, Board/Column, formatted due date/time and derived overdue
state; available authorized labels and assignees use existing metadata queries.
Unknown Column/assignee/label details receive non-identifying fallback copy.
No fabricated identity, all-day entry, priority, start/end meeting time or duration.

One narrow access correction discovered during acceptance applies to the common
parent: reuse `hasExplicitBoardMembership` before enabling the restricted Board
roster. Workspace-visible readers never request it, never render a previously
cached roster, and see unavailable assignee options (inherited IDs can be cleared).
Board/Table filter-sheet callers retain the default behavior. Optional catalog
403/404 does not falsely revoke an otherwise readable Board.

## Visual comparison and deliberate variance

Compared the approved image's header/brand, indigo active segment, Today,
previous/next range caption, seven date choices, selection, bounded markers and
lower agenda with the existing native Month composition/tokens. Reused official
logo, system typography, semantic light/dark/system palettes, spacing/radius,
existing Back icon/buttons, safe-area container, sheet and virtualized agenda.
No mockup image is embedded as UI and no generated/fake screenshot is supplied.

Deliberate differences:

1. **Due-time agenda instead of appointment grid:** backend Card dates describe
   deadline points, not meetings. The hourly lines, all-day lane and illustrated
   10:00–11:30 / 14:00–16:00 blocks are intentionally absent, per locked issue
   decision and Design Spec. Card edits remain in existing Card Detail.
2. Scope is the current Board, not the image's all-Workspace/all-Board planner.
   Filters are the real MOB-35 Board predicates, not invented start-only events.
3. At ordinary widths the seven dates share one strip. At narrow/large-font
   widths the same seven choices reflow to two chronological rows (4 + 3),
   keeping direct access and ≥48dp targets without requiring horizontal swipes.
   This accessibility adaptation follows Design Spec's prohibition on requiring
   horizontal swipe for basic actions. Full weekday/date/count is spoken even
   when compact visible labels use initials. Visual counts cap at 99+, accessible
   totals remain exact.
4. Native semantic tokens, readable wrapping text and real data supersede sample
   shadows, fictional categories and names. No synthetic checkbox completion.

**Actual native visual acceptance NOT VERIFIED:** component trees/style assertions
cannot prove pixels, clipping, overlap, gesture ergonomics or performance. No
running device/simulator screenshots, rotation capture or TalkBack/VoiceOver QA.

## Acceptance evidence (Mobile only)

Final command totals are recorded below. Focused evidence:

| Criterion / owner test group | Automated evidence                                                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functional strip / A         | Monday/Sunday seven-date boundaries; Dec/Jan, cross-month, leap/non-leap; Wednesday ±7; controls and selection                                                                               |
| Today / B                    | Saved zone vs device, gap/fold projection, minute midnight and background/wake clock cleanup, current-instant Today                                                                          |
| Dataset parity / C           | Actual shared parent/FlatList IDs, order and counts with 0/1/20/21/100/101/251/351 Cards; Node pagination also 250                                                                           |
| Filters / D                  | Shared q/Column Apply/Reset, retained draft/applied state and count across switches; normalized server label/assignee CSV OR sets and due filters                                            |
| Pagination / E               | Switch repeatedly with delayed page 2: same signal, no extra GET, no counts before complete                                                                                                  |
| Network / F                  | Repeated pure view changes: **zero additional requests**, including no full-Board walk                                                                                                       |
| Navigation / G               | Real Expo Router Card push/Back retains Week/day/filter; full route remount and list offset 400 restoration; sheet Android Back callback                                                     |
| Access / H                   | Revoke, account/logout/expiry, Board switch during delayed response, confirmed Board 403/404 and private cache payload removal; restricted roster not requested                              |
| Recovery / I                 | Real socket due-date burst coalesces one walk; create/archive hints, real disconnect/new-socket/rejoin, malformed due decoder, partial page failures, 429 retry-after, 503, offline recovery |
| UI / J                       | Component harness 320/390/768dp, 160% font, light/dark/system, long text, selected/focused semantics, bounded visual/exact spoken counts                                                     |

Current backend/shared event contracts do not define `card:deleted` or a Card
hard-delete command; no imaginary socket event was added. Supported archive and
update events reconcile disappearance. Any deletion observed by REST disappears
on existing refresh/focus/reconnect reconciliation. Node tests include missing
pages and malformed/duplicate responses, not invented deletion API coverage.

### Commands and outcomes

Executed from repository root with Node `v24.22.3` / pnpm `10.18.3`:

| Outcome | Command / evidence                                                                                                                                                                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PASS    | `pnpm --filter @kanban/mobile lint`                                                                                                                                                                                                                                                                          |
| PASS    | `pnpm --filter @kanban/mobile typecheck`                                                                                                                                                                                                                                                                     |
| PASS    | `pnpm --filter @kanban/mobile exec node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/*.test.mjs test/**/*.test.ts` — **556 tests**, natural exit 0                                                                                                                  |
| PASS    | `node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test apps/mobile/test/calendar/*.test.ts` — **36 focused tests**                                                                                                                                                           |
| PASS    | `$env:TZ='Pacific/Honolulu'; node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test apps/mobile/test/calendar/dates.test.ts apps/mobile/test/calendar/week.test.ts` — **6 tests** with non-account process/device zone                                                        |
| PASS    | `pnpm --filter @kanban/mobile exec jest --runInBand test/calendar-month.component.test.js test/calendar-states.component.test.js test/calendar-clock.component.test.js --silent` — **41 tests** at that milestone; two later poll/expiry regressions passed in the Calendar harness, which then had 38 tests |
| PASS    | `pnpm --filter @kanban/mobile exec jest --runInBand test/calendar-month.component.test.js -t 'focused preference poll' --silent` — **1 test**, 37 intentionally skipped; verifies actual interval with foreground focus enabled, not just focus refetch                                                      |
| PASS    | `$env:EXPO_NO_DOTENV='1'; $env:EXPO_PUBLIC_API_BASE_URL='https://example.invalid/api'; pnpm --filter @kanban/mobile bundle:android` — 1,678 Metro modules; Hermes `.hbc` and source map; audit **1,625 native sources**, shared ESM and original logo; no Web/backend/Node shims                             |
| PASS    | Changed-document relative links/path check; `git diff --check`                                                                                                                                                                                                                                               |
| PASS    | `pnpm --filter @kanban/mobile exec jest --runInBand --detectOpenHandles --silent` — **48 suites / 578 tests**, natural exit 0                                                                                                                                                                                |
| PASS    | Final changed-file `pnpm exec prettier --check @changed`, Mobile lint/typecheck, full branch `git diff --check origin/main...HEAD`; clean worktree before final evidence update                                                                                                                              |
| PASS    | Final foreground DST clock strengthening: `pnpm --filter @kanban/mobile exec jest --runInBand test/calendar-clock.component.test.js --silent` — **3 tests**, natural exit 0                                                                                                                                  |

No shared build was needed: existing shared ESM prerequisites already resolved.
No root suites or Web/backend tests/lint/build ran. The two stages of the real
Mobile test script were invoked separately for clear evidence; no root test alias
was used.

Focused red/fix history is not hidden: early typechecks caught the existing
non-generic segmented-control signature/required label and RN's new ScrollView
ref type (the final accessible layout no longer uses that ScrollView). New tests
initially exposed harness issues: missing navigation-session adapter, asserting
no query _objects_ instead of no private payload, fake reconnect on an already
retired socket, missing foreground Query focus for interval polling, and a
preference-refetch selection race. Those assertions/setup were corrected and
rerun. A trial `card:deleted` test failed because no such contract exists; it was
removed rather than adding a fake event. The current supported events pass.
The pnpm wrapper printed `Command "jest" not found` after some failed Jest runs;
Jest did execute and reported assertions. Those runs are **FAIL**, not tool
availability passes.

### Native/device cases — NOT VERIFIED

- Real Android hardware Back/gesture navigation, TalkBack, VoiceOver/iOS.
- Pixel rendering/clipping/overlap at 320/390/tablet, font-scale/rotation captures,
  scrolling performance for 20+ rows, native touch/keyboard/focus behavior.
- Device sockets/background behavior and multi-device live Web editing.
- APK/EAS/Expo Go/ADB: intentionally **NOT RUN**, per owner restriction.
- Android Metro/Hermes export is JS/import/asset compatibility only, **not** an
  APK, device E2E, visual acceptance or deployment check.

## Remaining limitations and delivery

MOB-35's server contract uses OFFSET pagination without a snapshot revision.
Integrity checks catch overlap/total/first-page drift and restart once; they cannot
prove an unobservable same-total edit beyond the verified page boundary. Existing
REST focus/reconnect/socket reconciliation remains the authority. No backend
snapshot API was invented for MOB-36.

No native locale preference contract exists; Calendar follows the established
English product baseline. Saved dateFormat/timeZone/weekStartsOn are respected.
Remote preference updates are eventually observed (focused poll ≤60 seconds plus
request time, or foreground refetch), not instant socket delivery.

Local Conventional Commits only; final commit list and verification results are
included in the owner handoff. No push/PR/merge/deploy.

Final Jest summary took time to settle after all assertions. Process inspection
confirmed the original runner; a requested stop found it **already completed
with exit 0**, so no process was killed and no `--forceExit` was used. The final
DST foreground test improvement was rerun separately (3/3 PASS) after the full
suite. No application source changed after the successful Android bundle.

Acceptance checklist was reviewed against issue #312 sections 3–6. All in-scope
implementation and automated Mobile cases are complete; the explicit device,
visual rendering, audible screen-reader and live multi-device limitations above
remain **NOT VERIFIED**, not hidden passes.
