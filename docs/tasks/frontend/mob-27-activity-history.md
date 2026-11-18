# MOB-27 Native Workspace and Board activity history

Task record for [issue #294](https://github.com/duongkienvn/SE2026-T13/issues/294),
implemented on `feat/mobile-activity-history` on 2026-11-18 (Asia/Bangkok).
This records the local implementation and its verification limits; it does not
claim a deployed release.

## Scope and prerequisites

Adds read-only native Workspace and Board timelines, their existing-menu entry
points, bounded server pagination, preference-aware timestamps, safe target
navigation, and session/access/realtime reconciliation. All rows originate from
the existing REST feeds. There are no audit mutations, client-invented events,
new backend/Web/shared contracts, database changes, roster, mention composer,
presence feature, or new dependencies.

MOB-06, MOB-12, MOB-14, MOB-23 and MOB-24 implementations and task records were
present on the initial clean `main`. MOB-25 was also already merged. The
[Mobile roadmap §7 and dependency table](../../mobile/KANVEXA_MOBILE_ROADMAP.md)
still list MOB-25 as a MOB-27 prerequisite; the authoritative issue and task
owner explicitly authorize this work independently of MOB-25. The Activity
implementation imports no Board membership/roster module and derives grants
from current Workspace/Board detail. That discrepancy is recorded here without
changing roadmap scope.

Related contracts: [Workspace activity](../backend/workspace-activity.md),
[Board activity core](../backend/activity-core.md),
[native realtime](mob-06-native-realtime.md),
[Workspace management](mob-12-workspace-management.md), and
[Board lifecycle](mob-14-board-lifecycle.md).

## REST contracts and privacy

Both adapters require the authenticated session client and AbortSignal, expect
HTTP 200 with `ApiPaginatedResponse`, and request one explicit server page.
Native defaults to 20 rows; adapters accept limits 1–100. Validation rejects
invalid page/limit arithmetic, wrong response status, inconsistent page/count
metadata, oversized or duplicate rows, invalid IDs/dates and ordering other than
`createdAt DESC, id DESC`. Dates must be canonical ISO instants. The API client
supplies the configured `/api` base; adapter paths below are relative to it.

| Scope     | REST path                                      | Authorization and projection                                                                                                                                                                                                                                    |
| --------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace | `GET /workspaces/:id/activity?page=1&limit=20` | Fresh Workspace detail must establish explicit joined membership. ADMIN may receive invitation events; MEMBER pages containing invitation or unknown events fail closed. Board-only guest access cannot grant Workspace history.                                |
| Board     | `GET /boards/:id/activities?page=1&limit=20`   | Fresh Board detail must establish `canReadBoard`. Explicit OWNER/MEMBER and authorized Workspace-visible readers can read according to server rules, including archived Boards. MEMBER-entity rows are rejected for a reader without explicit Board membership. |

Server-side ACL and filtered totals remain authoritative. The client does not
filter forbidden rows from an otherwise counted page or invent a replacement
count. An invalid response discards the Activity scope. Neither a Workspace
ADMIN role nor a socket payload grants access to a private Board.

Workspace decoding keeps only the vetted event, current projected actor and
current authorized moved-Board context. Missing actors use `Someone`; deleted
actors use `Deleted user`. Missing moved-Board context uses `Board unavailable`.
Historical avatar URLs are discarded; initials use the existing `Avatar`.

Board decoding discards free-form metadata and live actor details. The only
retained metadata is `OWNER`/`MEMBER` role values for a MEMBER `ROLE_CHANGED`
event. Live actors render as `Someone`; an explicit deleted actor renders as
`Deleted user`. No historical name, email, raw JSON, comment body, arbitrary
title or resource ID is displayed. Unknown actions use `made a change` and
cannot create a Card link. Null entity IDs render `Item unavailable`.

## Timeline and route interfaces

- `ActivityScreen({ id, scope })` accepts a validated `ResourceId | null` and
  `'workspace' | 'board'`. Invalid IDs and unauthenticated sessions use the
  existing resource boundary.
- Expo Router screens live at `/workspaces/:workspaceId/activity` and
  `/boards/:boardId/activity`. `Destination` adds `workspaceActivity` and
  `boardActivity`; `parsePath`/`destinationPath` preserve typed round trips.
- Workspace Overview exposes `Workspace activity`; Board Settings exposes
  `Board activity`. These use existing buttons and ordinary stack navigation.
  Access loss hides protected content and replaces the route with `/boards`.
- `Timeline<T>` receives a query for `ActivityPage<T>`, a row presenter, page
  state, preferences, active/online state, identity and source cache prefix.
  `TimelineItem` contains the safe actor/action/context/time projection and an
  optional vetted `ActivityTarget`.
- `verifyActivityTarget(data, identity, source, target, signal)` returns a route
  only after fresh REST checks. Moved-Board links recheck Workspace membership,
  Board readability and current Workspace relationship. Card links require a
  known CARD action, then recheck Board access, Card existence and same-Board
  relation. Column/member/comment IDs never become Card links. A failed check
  shows a neutral unavailable notice and performs no navigation.

The timeline is newest first and visibly read only. A `FlatList` renders a
single 20-row server page, with `Newer activity`, `Older activity`, explicit
refresh, and the server count/page metadata. It does not accumulate every page
in memory. Changing page scrolls to its top; shrinking totals return to a valid
page. Offset pages can shift between server snapshots as new events arrive;
there is no cross-page append/deduplication or snapshot-continuity guarantee.

Loading skeletons, empty history, offline, retry/cooldown, refresh and unavailable
states reuse existing primitives. Recoverable background errors may retain an
already-authorized page. Offline and active requests disable relevant actions;
429 cooldown does not trigger repeated HTTP. Pending navigation has a
synchronous AbortController guard and is cancelled on page/result/focus changes
or unmount.

`activityTime` uses the existing Card date formatter and saved date/timezone
preferences. Recent rows show relative seconds/minutes/hours plus exact context;
older rows use the saved short date. Accessible labels include ordinal,
actor/action/context, the exact preference-aware timestamp and original ISO
instant. Before preferences load, visible copy explains the UTC fallback. A
30-second timer updates relative text only while focused.

## State and realtime boundaries

Workspace keys extend `queryKeys.workspace(identity, workspaceId)` with
`'activity'`; Board keys extend `queryKeys.board(identity, boardId)` with
`'activity'`. `activityPageKey(prefix, page, limit)` adds `{ page, limit }`.
They remain distinct by session user/generation, resource and feed type.
`workspaceActivityOptions` and `boardActivityOptions` recheck access before
reading history; permission-scope transitions discard old pages. Requests use
the existing session/resource fences, no automatic retry, stale-on-mount reads
and `gcTime: 0`. Blur discards history and cancels outstanding requests; return
requires fresh authorization. Logout/account switch and resource revocation
prevent late results or navigation from repopulating protected state.

Board history subscribes through MOB-06's existing verified room boundary.
Board/Column/Card/Comment/member hints invalidate Activity through the existing
coalesced REST invalidation queue; socket payloads never become audit rows.
Board detail denial revokes its resource grant. Board access/privacy/name/move
hints also cancel and evict affected loaded Workspace Activity projections,
including pages containing that Board. Unrelated Workspace feeds remain scoped.

There is no Workspace audit socket taxonomy. Workspace history polls only its
focused online page every 30 seconds and rechecks on existing focus/reconnect
paths; explicit refresh is available. Other-device Workspace membership changes
are therefore detected on the next authoritative read, not through a new push
guarantee. Existing membership/session/access fences still clear known loss
immediately.

## Incumbent design comparison

This is an ordinary extension of the existing native system. Source comparison
covered `apps/mobile/src/ui/tokens.ts`, `theme.ts`, `content.tsx`, `controls.tsx`,
the Workspace Overview/Board Settings entry points, and
[MOB-02 component guidance](../../mobile/MOB-02-COMPONENTS.md). Activity imports
the existing semantic theme, spacing and typography; `ListRow`, initials
`Avatar`, `Button`, `Skeleton`, `EmptyState` and `ErrorState` retain their current
implementations. The timeline uses safe-area edges and the existing native Stack
header. Text can grow vertically; there are no fixed-height text rows, remote
fonts, decorative assets or bespoke palette. The native touch/focus and
light/dark/system behavior comes from the incumbent primitives.

There is no Activity-specific approved mockup. The implementation used the
existing [Boards](../../mobile/assets/02-boards-and-workspace-switcher.png),
[Board detail](../../mobile/assets/03-board-detail-and-filters.png) and
[Inbox/preferences](../../mobile/assets/06-inbox-and-preferences.png) references
as composition guidance. AppLlama MCP was not connected; this is not a claim of
live external app research. No incumbent design-system files were changed and
no PRODUCT.md, DESIGN.md or `.impeccable` design artifacts were created. Source
and mocked component evidence support consistency with the existing system;
they do not establish rendered fidelity on either native OS.

Skills applied: `appllama-app-design-skill` supplied native stack, safe-area,
growing-text, virtualized-list and state-cycle conventions; `appllama-usage`
guided reference availability checks and the distinction between repository
references and unavailable live research. `kanvexa-ui` preserved the approved
Kanvexa tokens, branding, scope and permission states. `impeccable` supplied
the native accessibility/consistency pass, independent source finish review
and incumbent-system documentation comparison. `ponytail` kept the change on
existing clients, grants, primitives and date helpers without dependencies.
`kanvexa-verification` selected the checks, narrowed by the owner's explicit
Mobile-only restriction. User instructions superseded the skills' native
device/build and broad repository-suite recommendations.

## Implementation and evidence map

| Responsibility                                     | Files                                                                                                                                                                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent REST adapters and safe projections     | `apps/mobile/src/features/activity/workspace/{api,decoder}.ts`, `board/{api,decoder}.ts`, `contracts.ts`                                                                                                               |
| Scoped keys, authorization checks and cancellation | `apps/mobile/src/features/activity/{keys,queries}.ts`                                                                                                                                                                  |
| Native timeline, timestamp and target verification | `apps/mobile/src/features/activity/{ActivityScreen,Timeline}.tsx`, `time.ts`, `navigation.ts`                                                                                                                          |
| Routes and menu entries                            | `apps/mobile/src/app/(private)/workspaces/[workspaceId]/activity.tsx`, `apps/mobile/src/app/(private)/boards/[boardId]/activity.tsx`, `navigation/routes.ts`, `WorkspaceOverviewScreen.tsx`, `BoardSettingsScreen.tsx` |
| Existing realtime reconciliation extension         | `apps/mobile/src/infrastructure/realtime/{client,reconciliation}.ts`                                                                                                                                                   |
| Contract/state/mock integration coverage           | `apps/mobile/test/activity/{fixtures,contracts.test,integration.test}.ts`                                                                                                                                              |
| Native JS component harness                        | `apps/mobile/test/activity.component.test.js`                                                                                                                                                                          |
| Task handoff                                       | This record and `docs/tasks/README.md`                                                                                                                                                                                 |

Tests exercise both endpoint envelopes and permissions; zero/one/many pages;
malformed IDs/dates/counts/order; missing/deleted actors and Board context;
private metadata stripping; unknown events; archived/guest/Workspace-reader
access; revocation/session races; offline/429/503; scoped socket bursts; safe
navigation and cancellation; page shrink; date/timezone/midnight/DST boundaries.
Component cases cover timeline behavior, neutral fallbacks, long text,
themed properties, accessible exact labels and mocked 320dp/160% font inputs.
Those dimensions are JS harness inputs, not screenshots or measured native
layout. REST/socket fixtures do not exercise a live API or PostgreSQL.

Existing `test/realtime/reconciliation.test.ts` and
`test/card-attachments.test.mjs` also assert the newly added Activity
invalidation key while retaining precise child/preview and draft-preservation
checks. `test/navigation-router.component.test.js` exercises push/Back for
both Activity paths through the real Expo Router JS harness using data-free
navigation fixtures; feed authorization is exercised separately in the
Activity harness.

## Verification record and remaining limits

Final checks used Node 22.23.4 and pnpm 10.18.3. Commands ran from the repository
root unless an `apps/mobile` working directory is stated.

| Check                                                                                                                                        | Result                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @kanban/mobile test`                                                                                                          | PASS, exit 0: 377 Node tests and 402 Jest tests across 29 suites. Delayed Jest shutdown warning noted below.                             |
| `pnpm exec jest --runInBand --detectOpenHandles test/activity.component.test.js test/navigation-router.component.test.js` from `apps/mobile` | PASS: 42 tests, two suites, exit 0; no detected open handles. Includes 19 Activity component cases and the two Activity push/Back cases. |
| Focused Activity Node contracts/integration                                                                                                  | PASS: 33 tests, included in the full Mobile run.                                                                                         |
| `pnpm --filter @kanban/mobile lint`                                                                                                          | PASS, exit 0.                                                                                                                            |
| `pnpm --filter @kanban/mobile typecheck`                                                                                                     | PASS, exit 0.                                                                                                                            |
| `pnpm --filter @kanban/mobile bundle:android` with task-local TEMP/TMP                                                                       | PASS, exit 0: Android Metro/Hermes export and native source-map audit; 1,485 native sources, shared ESM and approved logo verified.      |
| Prettier check of all changed/untracked task files                                                                                           | PASS in the final changed-file check.                                                                                                    |
| Task-record relative links and task-index entry                                                                                              | PASS.                                                                                                                                    |
| `git diff --check` and `git status --short`                                                                                                  | PASS in the final changed-file check. Only the 27 intended Mobile/task-document files are changed.                                       |
| Backend/Web/root application and live PostgreSQL suites                                                                                      | NOT RUN under the owner's Mobile-only restriction.                                                                                       |
| Native screenshots, layout, motion, TalkBack/VoiceOver, OS Back, APK/device and iOS visual checks                                            | NOT VERIFIED, as instructed. JS Back-stack checks are not OS-gesture/device verification.                                                |

The first full Node run exposed two old invalidation expectations that did not
include the new Activity key. Their assertions were updated while preserving
child/preview and draft-isolation checks; the focused regression group passed
25/25, followed by the final 377/377 Node result. The first Activity component
harness run had a teardown error in the test helper; it was corrected. The
focused harness subsequently exited cleanly. The full Jest run reported all
402 assertions passing but warned that it had not exited after one second;
the command later exited normally with code 0, about five minutes after the summary. The two changed harness suites also passed with `--detectOpenHandles` and exited 0 independently. Existing
fixture-route and `act(...)` console warnings also appeared; they were not
silently suppressed or described as native failures.

The first Android export failed when Hermes could not write bytecode in the
sandbox's virtual Windows Temp volume (compiler exit 6). The successful retry
set TEMP and TMP only for that shell process to
`apps/mobile/node_modules/.cache/mob-27-hermes-temp`, created under the current
workspace. No app/configuration change, APK build, EAS operation or device
installation was used. The output is an ignored JavaScript/Hermes export under
`apps/mobile/dist/android`, not an APK or device-verification artifact.

The independent source finish review and final delta review found no material
issue at their inspected source scope. Neither review certifies native visual
fidelity. No fake screenshots were created. No EAS build, Expo Go, ADB, device
launch, backend/Web suite or production service was used.

The initial clean checkout matched fetched `origin/main` at
`18a40a8ed97bec162cc20ab8232b6e5feeae59ed`. Implementation and verification were
completed locally on `feat/mobile-activity-history` before publication. In the
follow-up handoff, the owner explicitly authorized nine focused Conventional
Commits, pushing this branch and creating a PR to `main`, without a `codex`
prefix. The commit groups cover contracts/keys, Workspace adapters, Board
adapters, access/navigation guards, timeline presentation, screen/menu routing,
realtime invalidation, regression coverage, and this documentation. Merge and
deployment remain outside that authorization.

Actual small-screen font metrics, safe-area/scroll layout, spoken screen-reader
order, gesture/system Back behavior, real reconnect timing, live PostgreSQL
privacy filters, concurrent offset-page drift and cross-Web/Mobile access
changes remain NOT VERIFIED. These require separate authorized native/live
verification; mock success does not prove them.
