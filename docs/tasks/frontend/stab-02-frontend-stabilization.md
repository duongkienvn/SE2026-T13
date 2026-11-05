# STAB-02 — Frontend stabilization and Home Dashboard V2

Implementation record for [Issue #210](https://github.com/duongkienvn/SE2026-T13/issues/210).

## Scope and evidence

Read the original CodeRabbit feedback on
[My Tasks PR #202](https://github.com/duongkienvn/SE2026-T13/pull/202) and
[Global Search PR #204](https://github.com/duongkienvn/SE2026-T13/pull/204).
Both findings reproduce in the starting code: effect-driven URL corrections push
history, and Search discards settled pages and resets selection during fetching.

The user's replacement [approved Home V2 image](../../design/post-mvp/home-tasks/approved-home-dashboard-v2.png)
is the Home visual source of truth. It supersedes previous Home references.
My Tasks and Search changes are functional only. No shared styles/tokens, shell,
Sidebar, Header, routes, backend, migrations or deployment files changed.

## FIX-04 — My Tasks history

Automatic corrections use replacement: page clamping, removal of unavailable
Board/label filters, pruning invalid labels, and loss of label access. Existing
URL normalization and invalidation replacement remain intact. User filter and
pagination changes continue to push history.

Regression coverage follows Back and Forward through five correction cases
(invalid page, page beyond the last page, revoked Board, invalid label and label
access denial). A separate test confirms user pagination pushes and restores the
chosen page with Back/Forward. Existing filter and deep-link tests remain.

## FIX-05 — Search refresh and authorization

Ordinary refetches expose settled pages from the current query keys while fresh
requests run, including after a network failure. Active keyboard selection uses
result type/ID, so reordering does not select a different result. A removed result,
changed input/view or cleared authorization snapshot clears selection. Initial
loads still show skeletons; retained results do not. Existing pagination guards,
deduplication, loading announcements and Retry remain.

There is no separate snapshot store. Keys still include user, session generation,
query, view and page; `scope.isCurrent()` gates exposure. Existing Board/Workspace
invalidation, revocation and authorization refresh still cancel reads and clear
protected snapshots before refetching. A 401/403/404 clears current-session cached
data while retaining the error for Retry, preventing a denied snapshot from
returning during Retry or after a subsequent network failure.

Tests cover pending/successful/failed background refresh, identity after reordering,
loading an additional page, denial followed by a failed Retry, explicit access
refresh, domain invalidation, changed input and late responses from an unmounted
session.

## UI-01 — Home V2 visual parity

| Reference element                         | State                  | Implementation                                                                                                     |
| ----------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Greeting, description and date            | Available              | Existing personalized/timezone-aware greeting and date, reference copy and alignment, scoped purple background     |
| Four summary tiles                        | Available              | Existing counts, accessible singular/plural labels and destinations; balanced cards, large icons, gradient accents |
| Up Next                                   | Available              | Dominant left panel, calendar heading, subtitle, due badges/dates, Board/Workspace context and real Card links     |
| Starred Boards                            | Available              | Upper right panel, icon/subtitle, actual Board backgrounds, starring, existing pagination and View all             |
| Recently Viewed                           | Available              | Lower right panel, icon/subtitle, actual Board links/backgrounds, relative times, starring and pagination          |
| Loading/empty/error/offline/refresh       | Available              | Existing states and recovery preserved; skeleton follows the new three-panel composition                           |
| Sidebar/Header pictured in reference      | Outside redesign scope | Existing shell preserved exactly as instructed                                                                     |
| Completion toggles/demo statistics/charts | Excluded               | No new completion action, fake production data or chart introduced                                                 |

Home-only components and CSS implement the image; the PNG is documentation only.
Desktop uses a 1.34:1 column ratio with a 24px gutter and equal stacked Board
panels. Short laptop styles reduce row/panel spacing. Tablet stacks Up Next over
two Board panels; mobile stacks all panels with reachable pagination and 44px
star/pagination targets. Light mode uses existing semantic surfaces/text tokens;
dark Home surfaces match the approved purple treatment. Focus rings and reduced
motion remain supported. Long task titles clamp visually while retaining their
full accessible link text; Board names retain their full title tooltip.

## Browser verification

Screenshots are under
[`docs/design/screens/implementation/stab-02-home-v2/`](../../design/screens/implementation/stab-02-home-v2/).
QA used actual application routes/components and an isolated, temporary API/auth
fixture with deterministic dates/data. The fixture was removed from the checkout;
no fixture data ships. These checks do not claim a deployed or live-server pass.

| Viewport | Themes      | Populated Home result                                               |
| -------- | ----------- | ------------------------------------------------------------------- |
| 1672×941 | Dark        | Reference composition checked; no horizontal or vertical overflow   |
| 1366×768 | Light, dark | All three panels fit; no horizontal or vertical overflow            |
| 768×1024 | Light, dark | Stacked tablet composition fits; no horizontal or vertical overflow |
| 375×812  | Light, dark | No horizontal overflow; intentional vertical scrolling              |

Also captured empty/loading/initial-error states, long titles on laptop/mobile,
six tasks and seven Boards with pagination. Paginated Home fits 1366×768 without
extra scrolling. Mobile top/lower captures show the inner main scroller, rather
than claiming that a document screenshot captures its complete scrollable content.

Representative evidence:

- [Desktop dark](../../design/screens/implementation/stab-02-home-v2/home-1672-dark.png),
  [laptop light](../../design/screens/implementation/stab-02-home-v2/home-1366-light.png),
  [tablet](../../design/screens/implementation/stab-02-home-v2/home-768-dark.png).
- [Mobile dark](../../design/screens/implementation/stab-02-home-v2/home-375-dark.png)
  and [lower panels](../../design/screens/implementation/stab-02-home-v2/home-375-dark-lower.png).
- [Laptop pagination](../../design/screens/implementation/stab-02-home-v2/pages-1366-dark.png),
  [mobile pagination](../../design/screens/implementation/stab-02-home-v2/pages-375-light-lower.png),
  [long titles](../../design/screens/implementation/stab-02-home-v2/long-375-dark.png).
- [Empty](../../design/screens/implementation/stab-02-home-v2/empty-1366-dark.png),
  [loading](../../design/screens/implementation/stab-02-home-v2/loading-1366-dark.png),
  [initial error](../../design/screens/implementation/stab-02-home-v2/error-1366-dark.png).
- [Production-bundled pagination](../../design/screens/implementation/stab-02-home-v2/production-pages-1366-dark.png),
  [cached refresh error](../../design/screens/implementation/stab-02-home-v2/production-refresh-error-1366-dark.png),
  [production mobile](../../design/screens/implementation/stab-02-home-v2/production-home-375-light.png).

The production-mode QA bundle uses the normal Vite plugins/configuration with
only a temporary QA entry/output directory. Keyboard Enter changed Up Next to
page 2 with a visible focus ring; unstar removed a Board from Starred and updated
its recent-row state; a simulated 500 retained Home with the refresh Retry notice.
No browser console errors/warnings or failed static asset requests were observed
on this production fixture.

A read-only export of `origin/main` (no branch/worktree creation) ran the same
fixture. Paired `unchanged-*-{main,current}.png` screenshots compare My Tasks,
settled Search, Boards, Notifications and Preferences at 1366×768 in both themes.
Eight pairs are pixel-identical after settling Board background loading; the
remaining two differ only by one RGB level in 19 and 5 antialiased pixels. No
layout/style changes were observed. The existing shell differs from the mockup
and is deliberately preserved under the user's strict scope.

The generic style inspector flags gradients, greeting emoji, icon button effects,
panel borders/shadows and small metadata. The approved image explicitly requires
the former visual treatments; desktop metadata remains secondary and mobile
actions retain touch targets. Its dev-server warning was followed by the separate
production-bundle check above. These generic art-direction rules do not override
the user's approved reference or authorize shell changes.

## Automated verification

Results are recorded after running checks in the current checkout. PostgreSQL,
deployment and live-server integration checks are outside this frontend-only diff.

| Check                                                                                                                                                  | Result                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `pnpm --filter @kanban/frontend test src/features/productivity/home src/features/productivity/MyTasksPage.test.tsx src/features/search --maxWorkers=2` | Pass: 70 tests, 6 files                                                     |
| `pnpm --filter @kanban/frontend test --maxWorkers=2`                                                                                                   | Pass: 1,471 tests, 140 files                                                |
| `pnpm test`                                                                                                                                            | Pass: frontend 1,471 tests, backend 1,095 tests/105 suites, shared 20 tests |
| `pnpm lint`                                                                                                                                            | Pass: workspace ESLint                                                      |
| `pnpm --filter @kanban/frontend exec tsc -b`                                                                                                           | Pass                                                                        |
| `pnpm build`                                                                                                                                           | Pass: shared, backend and frontend production builds                        |
| Changed-file `pnpm exec prettier --check ...`                                                                                                          | Pass                                                                        |
| `git diff --check`                                                                                                                                     | Pass                                                                        |
| Documentation local-link checks                                                                                                                        | Pass                                                                        |
| `pnpm format:check`                                                                                                                                    | Fail: 1,193 untouched files; no warnings overlap this change                |

The build reports the existing `.env` `NODE_ENV` advisory and a JavaScript chunk
over 500kB; neither fails the build. Backend failure-path tests intentionally log
delivery/eviction/worker errors and still pass. No unrelated formatting, auth UI,
backend or configuration fixes were included. The approved PNG copy has the same
SHA-256 as the user's attachment.
