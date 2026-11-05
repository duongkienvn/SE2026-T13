# P4-07 — Home Dashboard UI

Implements the frontend portion of [issue #197](https://github.com/duongkienvn/SE2026-T13/issues/197),
[CX-03](../../roadmap/post-mvp.md), the [Home/My Tasks spec](../../design/post-mvp/home-tasks/ux-spec.md)
and the [P4-01 API handoff](../backend/p4-my-tasks-home-api.md). Local implementation and
verification only; nothing was pushed or deployed.

## Behavior and scope

- `/home` is a protected route inside the existing `AuthenticatedLayout`. The Home item in
  `app/layout/navigation.ts` changed from `soon` to `available` with `path: '/home'`. The
  landing page, post-login redirect and every other nav item are unchanged.
- The page reads `GET /api/users/me/home` with `apiRequest<HomeDashboard>` and the shared
  `HomeDashboard`, `HomeBoardSummary` and `TaskCardSummary` types. `parseHomeDashboard`
  rejects a malformed aggregate (missing lists, negative or fractional counts, a Card
  permalink or Board path that is not an internal `/…` route) as `INVALID_RESPONSE`, so a
  broken response never renders phantom numbers or links.
- **Greeting:** "Good morning/afternoon/evening, {first name}!" uses the hour in the user's
  saved IANA time zone; the date uses the saved date format. Only the signed-in user's own
  name is shown.
- **Summary tiles:** exactly the four server counts. Each tile links to the real page that
  lists what it counts: `/my-tasks`, `/my-tasks?group=NEXT_7_DAYS`,
  `/my-tasks?group=OVERDUE` and `/workspaces`. Nothing is recomputed from Up Next.
- **Up Next:** the server's up to six due-dated assignments in server order. The badge comes
  only from the server `group` (`OVERDUE` → Overdue, `NEXT_7_DAYS` → Due soon, `LATER` → no
  badge). Each row links to the returned `permalink`. There is **no completion checkbox**;
  the mockup's checkbox slot is a neutral, non-interactive ring tinted by the due group.
  `View all` links to `/my-tasks` (P4-06 is merged).
- **Starred Boards / Recently Viewed:** the server lists, with the real background presets
  (`useBackgroundPresets` + `backgroundStyle`), the Workspace name from the authorized
  Workspace directory (blank when the directory does not contain it — a Board guest never
  sees a Workspace name), and "Viewed …" from `lastViewedAt`. `View all` links to
  `/boards?view=starred` and `/boards?view=recent`, the existing discovery views.
- **Star toggle:** the existing `BoardStar` (PUT/DELETE `/boards/:id/star`) with its existing
  rollback and "Star unavailable" error. On success it now also invalidates the Home
  aggregate, so starring from Home, the Board list or Board Detail keeps both Home lists
  in sync. Home itself never records a Board view.
- **Paging instead of scrolling:** Up Next shows 4 rows and each Board list 3 rows per
  numbered page (existing `Pagination`). Board list pages sit in the section heading.
- **States:** loading skeleton (no motion with `prefers-reduced-motion`), offline, error with
  Retry (malformed, 403/404 wording, network), 401 ends the session through `runAuthorized`,
  per-section empty states (no assignments, assignments without due dates, no starred, no
  recent) with links to `/boards` or `/my-tasks`, and a quiet "Could not refresh" notice
  when a background refetch fails while data is shown.

## Data lifecycle

The query key is `['productivity', 'home', userId, sessionGeneration, timeZone]`:

- It sits under the existing `productivityKey`, so the existing Board/Workspace revocation,
  realtime `access:changed`, connection loss and reconnect paths that already clear and
  refetch My Tasks also clear and refetch Home. No new socket subscription or polling.
- `gcTime: 0`, `refetchOnMount/WindowFocus/Reconnect: 'always'`: returning to Home after a
  Card, Board or membership change elsewhere refetches it. A saved time zone change changes
  the key and refetches.
- Data is rendered only while `scope.isCurrent()`; a late response from a previous account
  or session generation is never shown (covered by a test).

## Accessibility

Landmarks: `h1` greeting, a labelled Summary region, one labelled region per section with
`h2`. Tiles have full names ("3 cards due in the next 7 days"). Task rows announce Board,
Workspace and "Due …"; Overdue/Due soon is text, not color only. Every link and button has a
visible focus ring; Board rows open through the name link while the star stays a separate
keyboard stop. Tested light and dark.

## Files touched outside the feature folder

| File                                        | Why                                                        |
| ------------------------------------------- | ---------------------------------------------------------- |
| `app/routes.tsx`                            | Register `/home`.                                          |
| `app/layout/navigation.ts` (+ 2 test files) | Home slot `soon` → `available`; tests assert the new link. |
| `features/boards/components/BoardStar.tsx`  | One extra `invalidateQueries` for the Home aggregate.      |

No shared tokens, global CSS, App Shell, header, sidebar or other page styles changed. All
new styles are in `features/productivity/home/home.css`, scoped to `.home-page`.

## Visual reference and differences

Matched panels 1 (desktop) and 5 (mobile) of the
[approved reference](../../design/post-mvp/home-tasks/approved-visual-reference-v1.png):
greeting + date row, four icon tiles, Up Next on the left (wider column), Starred Boards and
Recently Viewed stacked on the right, colored Overdue/Due soon pills with the date below,
Board rows with a thumbnail, subtitle and star.

Deliberate differences:

- No checkbox (spec: no task completion) and no per-row avatar (the API has no avatar field).
- Starred rows show the Workspace name only when the authorized directory knows it.
- Numbered pages replace an ever-growing list so desktop screens do not scroll.
- Mobile keeps the canonical App Shell drawer, not the pictured bottom tabs, and stacks the
  sections (a phone cannot fit them all without scrolling).
- Tile labels follow real data: "Due Soon" counts the next 7 days; singular forms for 1.

Evidence (HTTP-fixture captures with mocked API data, not production data) is in
[implementation screenshots](../../design/screens/implementation/p4-home-dashboard-ui/):
`full-*` (populated), `empty-*` (new user), `*-full` (whole stacked page on tablet/phone)
and `regression-main-*` / `regression-current-*` pairs.

Layout fit measured on the built app (`scrollHeight − clientHeight` of `main`): 0 px at
1280×800, 1366×657, 1536×730 and 1920×945 in light and dark; no horizontal overflow at any
size. 768×1024 and 375×812 stack and scroll by design.

Regression: Boards and Settings Profile were captured on `main` and on this branch at
1280/768/375 px, light and dark, and pixel-compared. The only differences are the Home nav
row (now a normal link instead of a muted Soon item) at 1280 and 768; 375 pairs are
identical. One light Settings pair also differed in ~130 anti-aliased logo pixels.

## Verification

Local verification on November 4, 2026:

| Check                                                                             | Result                                         |
| --------------------------------------------------------------------------------- | ---------------------------------------------- |
| `vitest run src/features/productivity/home`                                       | PASS: 2 files, 20 tests                        |
| `vitest run --maxWorkers=2 src/features/productivity src/app src/features/boards` | PASS: 37 files, 284 tests                      |
| Mutation: drop Home invalidation from `BoardStar`                                 | Caught by "unstars through the real endpoint…" |
| Mutation: accept external Board paths                                             | Caught by "rejects external Board path"        |
| `pnpm lint`                                                                       | PASS                                           |
| Frontend `vite build` / `tsc --noEmit`                                            | PASS                                           |
| Browser QA (Chrome + Playwright route mocks on `vite preview`)                    | Done; screenshots above were all viewed        |

Full frontend suite `vitest run --maxWorkers=2`: PASS, 129 files / 1,347 tests. Root
`pnpm format:check` is not used as evidence on this Windows checkout (`core.autocrlf=true`
flags unrelated CRLF files); changed files pass `prettier --check --end-of-line auto`.
