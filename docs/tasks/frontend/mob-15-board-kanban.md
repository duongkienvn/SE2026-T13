# MOB-15 Native Board Detail and filters

[Issue #271](https://github.com/duongkienvn/SE2026-T13/issues/271) ·
[Approved visual reference](../../mobile/assets/03-board-detail-and-filters.png) ·
[Mobile design spec](../../mobile/KANVEXA_MOBILE_DESIGN_SPEC.md#43-screen-03--board-detail--kanban--filters)

## Board entry and access

The MOB-13 directory, starred Boards, Home and deep links all enter the same
typed Board route. The screen reads the Board directly and requires a successful
access check for the current session before showing protected content. It records
one MOB-13 view on authorized entry. The Board header uses official branding,
real artwork and the server-authorized Workspace name. A Board-only guest can
read the Board with a generic Workspace fallback when the Workspace endpoint
denies access. The existing per-user star control remains available with read
access.

Archived or non-writable Boards show read-only status. The Board view is active,
with noninteractive Table and Calendar slots reserved for future releases. The
detail screens use the existing stack and Back behavior. The four-tab shell
remains on primary screens. Card presses open the existing guarded Card route.
The Board route retains applied filters and per-Column and horizontal offsets
when returning. Successful focus revalidation keeps the requested page depths
available. Confirmed denial evicts the Board subtree and resets local context.

## Verified source contracts

| Read or action                           | Mobile handling                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /boards/:id`                        | Read gate and capability projection from `BoardResponseDto`. Archived status and independent Board rights are authoritative. The dedicated probe carries the session identity and a Board fence revision.                                                                                  |
| `GET /boards/:id/columns`                | Independently paginated at 100 per page. Exact signed scaled-integer decimal comparison and UUID tie-breaks reproduce the backend position order.                                                                                                                                          |
| `GET /boards/:id/cards`                  | Board-wide infinite query. The default sends active status and omits sort options. Queries normalize literal search, UUID v4 CSV sets, due status and explicit-offset range endpoints, optional Column, sort and archived status. Explicit sort preserves server order within each Column. |
| `GET /boards/:id/card-preview-summaries` | Up to 100 unique active Card IDs per loaded page. Validates identity and nonnegative counts. Missing or failed summaries retain Card content and expose a retry. Archived Cards have no batch preview request.                                                                             |
| `GET /boards/:id/labels` and `/members`  | Independently paginated catalogs. Roster availability depends on explicit Board access to that endpoint. Assignee visuals use authorized names/photos or the Card's real assignment count.                                                                                                 |
| `GET /users/me/preferences`              | Reads the account time zone for date chips. Due-status classification uses backend preferences. Range inputs use exact user-entered offsets, with inclusive start and exclusive end.                                                                                                       |
| `POST /boards/:id/views`                 | Existing MOB-13 adapter reports an authorized entry and invalidates Home's recent Boards.                                                                                                                                                                                                  |

The query keys include session generation, Board identity, normalized filters and
preview-batch membership. The filter sheet keeps drafts apart from applied
filters, with Reset editing the draft and Cancel discarding it. Apply and Clear
start at page one. Requests use the session transport and TanStack cancellation.
The implementation is contained in the Mobile workspace.

## Pagination, realtime and performance

The screen groups loaded Cards by Column and deduplicates every collection by ID.
It displays the Board-wide server total and explicitly labels incomplete Column
counts as loaded counts. A Column with zero loaded matches can still receive
Cards on a later global page. Visible Load more controls advance each collection
independently. The horizontal and vertical `FlatList` windows bound mounted
Columns and Cards. Each batch's membership stays stable when a new page arrives.

The component test matrix verifies these request counts on initial load and after
each Load more action, excluding independent access, header and catalog calls.

| Cards | Columns | Card pages | Column pages | Preview requests |
| ----: | ------: | ---------: | -----------: | ---------------: |
|     0 |       1 |          1 |            1 |                0 |
|     1 |      10 |          1 |            1 |                1 |
|   100 |      30 |          1 |            1 |                1 |
|   101 |      30 |          2 |            1 |                2 |
|   251 |     101 |          3 |            2 |                3 |

The MOB-06 room is active on Board route focus. Column and Card hints invalidate
the matching queries. Card metadata hints match preview batches containing that
Card. Permission-sensitive events suspend and reverify access, with stale
responses fenced. Reconnect and foreground reads rebuild from page one.
Observed pagination drift triggers one authoritative repair read. If it persists,
the screen retains explicit partial counts and offers a manual refresh. Each
OFFSET page is a separate server snapshot.

## Acceptance and handoff

- Authorized detail, canonical navigation, precise Column/Card order, real
  metadata, large Board boundaries and partial states are covered by the
  decoder, integration and screen tests.
- Filter drafts, Apply, Reset, Cancel, forbidden catalog access, isolated
  preview failure, 429, offline, 401, access revocation and late account
  responses are covered by screen and transport tests.
- A simulated concurrent Card move verifies that a Socket.IO hint refreshes
  loaded pages from page one without duplicate Cards. The existing MOB-06 tests
  exercise reconnect, foreground, denial and room release.
- MOB-16 can consume `useBoardKanban`, `KanbanColumn` and `BoardKanban`. Gate
  Column actions using the verified Board capabilities and archive state, and
  reconcile writes with `queryKeys.columns(identity, boardId)`.
- MOB-17 can reuse `kanbanCardOptions`, `KanbanCard`, `KanbanFilters` and the
  Board-scoped Card and preview keys. Card writes must refresh affected
  filtered collections and preview batches.
- MOB-18 can replace `ResourcePreview` using the existing typed Card destination
  and parent relationship verification. Card routing does not need a new
  Board stack or separate filter owner.
- After MOB-14 merges, wire its authorized settings destination into this
  header, then test archive/restore, Workspace move, visibility changes,
  capability refresh and revoked access while the Board is open.

## Verification

- `pnpm --filter @kanban/mobile test` passed 240 Node tests and 196 Jest
  component tests. `pnpm --filter @kanban/mobile typecheck`,
  `pnpm --filter @kanban/mobile lint` and `pnpm lint` passed.
- `pnpm build` passed with the normal app entry, including the Android
  Hermes export and its bundle verifier. The changed-file Prettier check and
  `git diff --check` passed. Root `pnpm format:check` reported 1,523
  formatting failures outside the changed paths in this Windows checkout.
- The first `pnpm test` run reported 32 Web failures under default Vitest
  concurrency. Setting `VITEST_MAX_WORKERS=3` and rerunning `pnpm test` passed
  20 shared, 1,283 backend, 1,677 Web, and 436 Mobile tests. The standalone
  Mobile run was repeated after the final native spacing and sheet changes.
- Android API 37 and Expo Go 58.0.5, at 320 dp, used local HTTP and Socket.IO
  fixtures. The MOB-13 directory opened the Board, horizontal and vertical
  swipes moved independently, and Android Back from a Card restored the
  horizontal and vertical positions. The filter sheet kept its actions in
  view above the safe area. Keyboard entry, apply, the empty result and clear
  were exercised. System dark mode and 160% font scale were inspected on the
  Board at the same width.
- The emulator displayed 100 of 251 Cards before loading more, 200 of 251
  after one action and the full 251 after two. The fixture logged one Card
  request each for pages 2 and 3 and preview batches of 100 and 51 IDs. The
  initial Board room handshake can overlap the first REST read and cause an
  extra first-page refresh. The 30- and 101-Column component cases mounted
  fewer panels than the server total. Frame timing on physical hardware remains
  unmeasured.
- The Windows Expo Go development smoke used the temporary entry workaround
  recorded in [MOB-08](mob-08-native-auth.md#native-visual-evidence).
  The repository entry is used for the Android release export.
- Physical Android, iOS, TalkBack announcements and concurrent Web clients
  against a staging server remain unverified. The component and integration
  suites cover these paths at the application and fixture levels where
  applicable.

[320 dp Board and partial count](../../design/screens/implementation/mob-15-board-kanban/board-320.png) ·
[320 dp filter sheet and pinned actions](../../design/screens/implementation/mob-15-board-kanban/filters-320.png) ·
[320 dp dark Board at 160% font scale](../../design/screens/implementation/mob-15-board-kanban/board-dark-large-320.png)
