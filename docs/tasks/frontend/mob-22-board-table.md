# MOB-22 — Native Board Table View

Implements [#279](https://github.com/duongkienvn/SE2026-T13/issues/279) on
`feat/mobile-board-table`. Scope is the existing native Board Detail alternate
view, shared server filters/sorting, metadata, Card navigation and existing Card
actions. No backend/Web changes, new endpoint, dependency or Card Detail route.

## Baseline and authority

The checkout was clean on `main`. Fetch verified HEAD and `origin/main` at
`4464baa`, including MOB-15 #275, MOB-16 #276, MOB-17 #277, MOB-18 #282 and the
merged MOB-19 #283. These are verification facts for this task, not reusable
instructions or proof of a deployment. MOB-14 lifecycle work is not a prerequisite
for Table; existing Board archive/capability handling remains authoritative.

Read the issue, repository instructions/workflow, Mobile Roadmap §6/§11–13,
Mobile Design Spec §§4.3–4.4/5–7/9, native architecture/network/realtime guides,
MOB-02 tokens, MOB-19 handoff, backend DTO/list service and Web Table/BoardViews.
Directly viewed the [approved Board composition](../../mobile/assets/03-board-detail-and-filters.png).

Applied skills:

- `appllama-app-design-skill`: native push/back semantics, safe areas, readable
  scalable text, semantic themes, one virtualized scroll, native sheet reuse and
  device verification; no new visual system or decorative animation.
- `appllama-usage`: checked the available research tools. Appllama MCP was not
  connected, so no competitor-screen or credit/tool research is claimed. Used
  the owner's approved Board reference and existing Kanvexa components.
- `kanvexa-ui`: classified Board/Table as Available, Calendar as Coming soon,
  and unsupported business controls as Excluded; preserved the official logo,
  brand tokens and current shell. Metadata integrates real typed exports.
- `impeccable`: ran its context launcher once for BoardDetailScreen, applied
  Operate guidance and craft floor against the incumbent design. Context reports
  no PRODUCT.md/DESIGN.md; this scoped extension uses existing source/assets.
- `ponytail`: reused the existing query/pagination/preview/access/action layers
  and scroll restoration hook instead of creating competing owners.
- `kanvexa-verification`: mobile-only checks and changed-file formatting, as
  explicitly requested. Root/Web/backend suites were not run.

CodeGraph's directory exists but its CLI was unavailable and no CodeGraph MCP
was exposed. Source inspection used direct reads and `rg` after that failed probe.

## Implementation and source contracts

`BoardDetailScreen` remains the sole Board entry. Its verified session/resource
gate owns the selected Board/Table view, filters, Kanban offsets and Table offset.
`table/BoardTable.tsx` renders native row cards with one FlatList; the shared
header and pagination/error footer are inside that list so short landscape
screens and large text can reach every control. Kanban keeps its existing
horizontal/vertical lists and separate offsets.

| Source                                      | Consumed contract                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `boards/kanban-api.ts`, `kanban-queries.ts` | Existing GET Board/Columns/Cards, runtime decoding, normalized filters, session keys and preview batching            |
| Backend `ListCardsDto`, `CardsService.list` | `q`, `columnId`, label/assignee CSV sets, due status/range, archive status, title/due sorting; max 100/page          |
| Backend `CardResponseDto`                   | Card ID, real Column ID/title, assignment IDs and nullable UTC date instants; no embedded labels or checklist counts |
| `cards/metadata/queries.ts`                 | MOB-19 `resolveAssignees`, date-preference options and bulk Board catalogs                                           |
| `cards/metadata/presentation.tsx`           | MOB-19 label chip, scalable assignee avatar and exact preferred-zone/date-format value with due state                |
| `kanban-model.ts`                           | Existing ordered page collection, overlap/count-drift detection and stable page-local preview batches                |
| `useCardLifecycle`, `CardActionsSheet`      | MOB-17 actions, mutation adapters, validation, permissions and reconciliation                                        |
| Canonical Card route                        | `/boards/:boardId/cards/:cardId`; real Expo Router push/Back, no second editor                                       |

Table shows title, matching Column name, labels, assignees, due date and checklist
progress from authoritative previews. A missing Column is explicitly unavailable
and subsequent Column pages load only when needed to resolve current Table rows.
Unknown label IDs remain “unresolved”; a missing preview is unavailable, not
“No labels” or `0/0`. An authoritative empty checklist says “No checklist items”.
Optional roster denial retains Board reading and exposes assignment counts,
without inventing member identities. Date preference failure falls back to the
original UTC instant with an explicit explanation. One Table clock updates due
states at deadlines/minute boundaries, pauses in background and refreshes active
due-status predicates through the existing Card query; it does not refetch Board
context for each row.

## Filters, sort and pagination

Both views consume the same `useBoardKanban` observer and `BoardFiltersSheet`.
Apply/Reset/Cancel, Mine, labels, due chips, search and clear actions preserve the
same predicate semantics. Sort is intentionally shared with Kanban: switching
views does not drop any compatible state or issue a second Card-list request.

- `normalizeKanbanFilters` trims literal search (max 200), lowercases/deduplicates
  UUID sets (max 50), serializes CSV and converts offset ranges to UTC. `dueFrom`
  is inclusive; `dueTo` is exclusive. The backend ORs values inside each ID set
  and ANDs the different predicates.
- Sort choices are exactly title ascending/descending and due date
  ascending/descending. No Column/label/assignee/checklist sorting. Before an
  explicit selection, the default order is the backend's Column ID, position and
  Card ID sequence, not the visual Column catalog order. Archived status uses
  the backend archive ordering. Server sorting is authoritative: due nulls are
  last in either direction; backend appends Card ID ascending for ties. The
  native client does not re-sort returned Table rows.
- Changing filters/sort cancels the old exact query, resets the destination query
  to page one and clears obsolete scroll offsets. Equivalent normalized filters
  do not reset/refetch. A view switch alone retains loaded pages and offsets.
- Load more requests the next server page with `limit=100`; totals come from
  `meta.total`. There is no global 250-Card limit or eager all-Board fetch.
  Preview reads contain at most 100 IDs per page batch; no per-row Card-detail
  calls. List virtualization bounds mounted rows.
- Existing drift detection notices changed totals, overlapping page IDs and a
  contracted last page. It withholds a false complete count and performs one
  bounded authoritative repair per drift episode. Explicit Retry remains
  available if loading fails or changes continue. Offset paging cannot promise a
  cross-request database snapshot under continuous writes; visible rows are
  deduplicated, inconsistent collections remain marked partial and repairable.
- Back from Card Detail retains the selected view, filter/sort, loaded pagination
  and mutable scroll offsets across the Board's authoritative focus recheck.
  When content shrinks, the existing restore hook clamps to the final extent.

## Security and realtime

Board REST capabilities, archive state, resource epochs and session generation
remain the only authorization inputs. The existing Board event/query prefixes
include Table's shared queries automatically. No new session manager, API client,
Socket.IO subscription or Workspace-based grant was added.

Only writable active rows expose MOB-17 Card actions. Archived/read-only Boards
remain readable; optional member-catalog 403/404 is not full Board revocation.
Logout/account switch/401/revoke fence rows, catalogs and summaries, including
late responses. Socket hints trigger the existing authoritative reconciliation;
three adjacent Card hints produce one Card-list refresh without a Board-context
refetch in the focused integration test. Remote move updates the actual Column;
archive removes the active row; confirmed revoke removes the entire Table.

## Visual comparison and scope matrix

| Reference element                                                            | State and implementation                                                                                              |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Official K/wordmark, Board title/Workspace context, star/overflow            | Available; existing header and artwork retained                                                                       |
| Board/Table selector                                                         | Available; labelled 48dp tabs with selected indicator and focus/press feedback                                        |
| Calendar slot                                                                | Static disabled “coming soon” semantics; no callback, route, API or fake screen                                       |
| Filters and sheet                                                            | Available; same shared chips, draft/Apply/Reset/Cancel and server catalogs                                            |
| Card surfaces, label tints, typography and spacing                           | MOB-02 semantic tokens and MOB-19 metadata components; native vertical row cards instead of a compressed desktop grid |
| Card title and Open card                                                     | Available; canonical Card route; metadata remains separately accessible                                               |
| Card row actions                                                             | Available only through existing lifecycle permissions; separate from Card-open target                                 |
| Priority, inline metadata edits, checklist CRUD, attachments/comments/export | Excluded from MOB-22; no fake business values or controls                                                             |

Rows grow with content and font scaling, have no title line cap and no horizontal
scroll dependency. The whole Table, including header/footer, scrolls vertically;
there is no nested vertical list or scroll trap. Existing SafeAreaView and native stack navigation remain the screen boundary;
the app's four root tabs are unchanged. Counts use tabular numerals. Exact dates,
selected/disabled tabs, actionable labels and status live regions are accessible.

## Verification

The test environment uses DTO fixtures and the real Mobile HTTP/session/query/
resource/realtime/navigation layers. It does not prove PostgreSQL behavior or a
live Web/Mobile backend deployment. Backend/Web code was read only.

| Check                                                                            | Result                                                                                                                                                                            |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @kanban/mobile lint`                                              | PASS                                                                                                                                                                              |
| `pnpm --filter @kanban/mobile typecheck`                                         | PASS                                                                                                                                                                              |
| `pnpm --filter @kanban/mobile test`                                              | PASS: 264 Node tests and 270 Jest tests (24 component/navigation suites) on the final acceptance run                                                                              |
| Node `test/workspaces/kanban.test.ts`                                            | PASS: 10 tests including four exact all-filter/sort multi-page contracts with 251 rows, server order preserved and null deadlines retained                                        |
| Jest `test/board-kanban.component.test.js`                                       | PASS: 45 tests including logout/account/401 fencing; Board/Table coverage: 0/1/20/100/101/251 rows, sort/page reset, cross-view state, metadata, Retry/drift and revoke           |
| Jest `test/board-table.component.test.js` + `test/card-detail.component.test.js` | PASS: 38 tests at the navigation checkpoint, including actual canonical Card stack/Back, native metadata fallbacks, 320dp/160% text component assertions, scrolling and due clock |
| Jest Card Detail `-t MOB-22`                                                     | PASS: 2 tests, real Expo Router Back and realtime-owner move/archive/revoke reconciliation                                                                                        |
| Android `bundle:android`                                                         | PASS: Metro/Hermes, 1,398 native sources, shared ESM and approved-logo verification                                                                                               |
| Changed-file Prettier / `git diff --check`                                       | PASS: changed files formatted; `git diff --check` clean                                                                                                                           |
| Root/Web/backend suites                                                          | NOT RUN, explicitly excluded by the task                                                                                                                                          |

The initial full Jest run exposed the preset's React Native subpath mapper
bypassing `unstable-internals-do-not-use`'s package export. A precise
`require.resolve` mapping restores the actual exported file. Jest also ignores
the local `apk/` artifact/staging directory to prevent duplicate Haste package
names. No application dependency changed. Initial Hermes invocation failed under
the sandbox Temp path; the same Mobile bundle command passed outside the sandbox.

## Issue #279 acceptance mapping

| Criterion                                                             | Evidence and status                                                                                                                |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Authorized Board/Table switch; disabled Calendar; canonical Card Back | PASS Mobile component and actual Expo Router tests; PASS physical Android fixture                                                  |
| Same compatible authorized server Card set and actual total           | PASS shared observer/query keys, exact filter contract and 0–251 Card tests                                                        |
| Four server sort choices, null dates and page reset                   | PASS normalized requests on all three pages and preserved server order; PostgreSQL ordering read from service source, not executed |
| Real Columns, MOB-19 metadata and honest unknown values               | PASS metadata tests including restricted roster, unresolved IDs, missing/empty previews and preferred-zone exact date              |
| Guest/read-only/archive/revoke/session fences                         | PASS inherited Board permission tests, Table revoke plus late summary after logout/account/401; PASS physical Android fixture      |
| MOB-17 actions and preserved view/page/scroll context                 | PASS action handler reuse, dedicated scroll restore and real Card navigation tests                                                 |
| 320dp, 160% text, themes, landscape and accessibility                 | PASS component assertions; PASS physical Android capture/flow; iOS unavailable                                                     |
| No N+1, arbitrary cap, source duplication or new server contract      | PASS query/request-count tests and diff inspection; 251 records with max 100-ID previews                                           |

## APK and device evidence

EAS Android `preview` build:
[`a4f96bf3-c38c-441d-bd29-d66d4294d074`](https://expo.dev/accounts/nanromiis-team/projects/kanvexa-mobile/builds/a4f96bf3-c38c-441d-bd29-d66d4294d074).
The owner explicitly approved source upload to the existing EAS project and
ADB installation/launch/capture/logcat QA. Isolated staging contains current
Mobile/shared sources, public localhost certificate and QA-only network config;
no `.env` or private keys are uploaded. Its API URL is HTTPS localhost, forwarded
over USB to a local in-memory DTO/Socket.IO fixture with 251 Cards. No production
requests, backend suites, database, store submission or deploy.

The first preview downloaded as `apps/mobile/apk/kanvexa-mob22-preview.apk`
(93,372,504 bytes, SHA-256
`8F37103F84BC94AD35655C004D59CD4E1DA26E9B8BF4E1618ECD758677D3DA9D`).
ZIP, Android manifest, DEX, Hermes bundle/native library and native picker checks
passed. All 149 Mobile source files matched the build staging by bytes. ADB
installed the APK successfully. Initial device verification passed canonical Card
navigation/hardware Back, Board/Table switching, disabled Calendar, 48dp view
controls and the existing writable Card action sheet.

The first device review found the text action repeated the full Card title. The
correction uses the same concise overflow icon as the Board shell, preserving the
full accessibility action label and MOB-17 handler. Related 49 component tests,
Mobile lint and Android Metro/Hermes passed after that change. The correction
preview is
[`575ae1cb-25d4-468b-b0c8-7ba12a0d85b5`](https://expo.dev/accounts/nanromiis-team/projects/kanvexa-mobile/builds/575ae1cb-25d4-468b-b0c8-7ba12a0d85b5).
The acceptance APK downloaded as
`apps/mobile/apk/kanvexa-mob22-acceptance-preview.apk` (93,372,592 bytes), SHA-256
`FBA1EF9DB9C32665E2ACBA3703B7CD5FCCEFB5A6939B96A068212D5E7443EF4B`.
The same archive/manifest/DEX/Hermes/native-picker checks passed, and all 149
Mobile source files match the acceptance staging. ADB installed the acceptance APK successfully. Final-artifact QA passed the
concise overflow with its full accessibility name, existing Card actions sheet,
canonical Card navigation/hardware Back, filter sheet and Board/Table switching.
The row action returned at y=1,569 px after Back versus y=1,568 px before opening
Card Detail. PID-scoped AndroidRuntime/ReactNativeJS logs contained no error entries. Evidence is stored in
`docs/design/screens/implementation/mob-22-board-table/`; its
[verification summary](../../design/screens/implementation/mob-22-board-table/verification.json)
records fixture versus device coverage.
Connected hardware: Samsung SM-A507FN, Android 11. iOS is
unavailable on this Windows host and is NOT VERIFIED. Emulator/tablet and
concurrent live Web/Mobile backend QA are NOT VERIFIED.

### Physical Android acceptance

| Scenario                                                                                       | Result and evidence                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 384dp, 100% text, light; official shell, metadata and real Column                              | PASS: [Table](../../design/screens/implementation/mob-22-board-table/android-table-light.png)                                                                                                                                              |
| Same shared filter sheet, keyboard/Back, Apply/Cancel/Reset, query and due-desc sort           | PASS native fixture flow and request trace: [filters](../../design/screens/implementation/mob-22-board-table/android-table-filters.png)                                                                                                    |
| Actual Card stack/hardware Back and Table scroll restoration                                   | PASS acceptance APK; native y positions differed by 1 px; same MOB-17 action sheet                                                                                                                                                         |
| 251 Cards, three pages, final Card and total 251, bounded previews                             | PASS first preview and request trace; the only subsequent source change was the row-action icon. Last-page capture retained in ignored `apps/mobile/apk/mob22-runtime/android-table-last-page.png`                                         |
| 320dp, 160% text, dark/system, long title, restricted roster, unknown label and archived Board | PASS again on acceptance APK: [read-only metadata](../../design/screens/implementation/mob-22-board-table/android-table-320-dark-read-only.png). Shows `1 assigned`, not a forbidden name, and `1 unresolved label`; no row write controls |
| Landscape at 160% text                                                                         | PASS final artifact, native vertical scrolling: [landscape](../../design/screens/implementation/mob-22-board-table/android-table-landscape.png)                                                                                            |
| Socket access hint and authoritative REST 404                                                  | PASS again on acceptance APK; protected title and metadata cleared: [revoked](../../design/screens/implementation/mob-22-board-table/android-table-revoked.png)                                                                            |

Phone density, font scale, night mode and rotation were restored to the recorded
original values after testing. The acceptance APK uses the localhost fixture URL;
it needs USB reverse and that local fixture to read data. Normal application
source/configuration was not changed to use the fixture. Raw fixture service,
request traces, build logs, APKs, motion and reports remain under ignored
`apps/mobile/apk/mob22-*` paths.

The acceptance flow recording is
`apps/mobile/apk/mob22-runtime/android-table-motion.mp4` (55.64 seconds).
All 606 encoded frames decoded successfully with zero black frames; representative
frames were visually inspected across actions, Card/Back, access-check skeleton,
filters and view switch. A skeleton during Board access revalidation is intentional.
This is not proof of sustained 60 fps: under recording/UIAutomator, Android
`gfxinfo` reported 421 rendered frames, 333 janky frames (79.10%), median 19 ms
and p95 42 ms. Sustained 60 fps remains **NOT VERIFIED** on this device; no
unrelated performance rewrite was introduced. Audible TalkBack/VoiceOver traversal,
emulator/tablet, iOS and a concurrent live Web/Mobile backend remain **NOT VERIFIED**.
Accessibility roles, labels, disabled states, readable wrapping, reachable native
controls and minimum touch targets were checked through component tests and the
Android accessibility tree/actual touch flows.

## Handoff

Calendar remains disabled for MOB-35/36. MOB-20/21 child business features and
MOB-14 Board lifecycle expansion are outside this change. The Table consumes
existing authoritative summaries and MOB-19 typed metadata only; future features
should extend those contracts rather than add per-row detail reads.

No push, PR, merge or deployment was performed. The owner approved exactly nine
local Conventional Commits. The first eight contain code/tests; the ninth contains
this task record, task index and final Android screenshots/verification summary.

| Commit                                                         | Responsibility                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `ddf7c3b`                                                      | Fix native Jest exports and exclude local APK staging                     |
| `0ce597f`                                                      | Share the existing native list scroll restoration                         |
| `45afa63`                                                      | Virtualized Table rows and actual MOB-19 metadata                         |
| `2f41878`                                                      | Activate Table in the verified Board Detail entry                         |
| `78a107b`                                                      | Exact filter/sort transport and server page ordering tests                |
| `db8aa5c`                                                      | Responsive metadata, due clock and scroll component tests                 |
| `ff93863`                                                      | Pagination, filters, retry/drift and session-fencing tests                |
| `d456389`                                                      | Actual canonical Card Back and realtime reconciliation tests              |
| `docs(mobile): record MOB-22 contracts and Android acceptance` | Task record/index and five final-artifact captures with verification JSON |

Changed application/test files: `apps/mobile/jest.config.cjs`,
`src/features/boards/{BoardDetailScreen,BoardKanban}.tsx`,
`src/features/boards/table/BoardTable.tsx`,
`test/{board-kanban,board-table,card-detail}.component.test.js` and
`test/workspaces/kanban.test.ts` (paths after the first are under `apps/mobile`).
Documentation/evidence files are this record, `docs/tasks/README.md` and
`docs/design/screens/implementation/mob-22-board-table/`.

The final row-action correction was verified by
`pnpm --filter @kanban/mobile exec jest --runInBand test/board-table.component.test.js test/board-kanban.component.test.js`
(**49 PASS**) plus Mobile lint/typecheck/Android bundle. The preceding full Mobile
suite passed **264 Node + 270 Jest** tests. No application logic changed after
those focused correction checks. Changed-file Prettier, local-link resolution
and `git diff --check` passed. APK staging, native fixture data and logs are ignored
artifacts; they are not production application data or committed test secrets.
