# P2-C02 — ACL-scoped Workspace Guests tab

Local implementation for [Issue #135](https://github.com/duongkienvn/SE2026-T13/issues/135),
the WS-02/WS-04 Guests-read UI in the [roadmap](../../roadmap/post-mvp.md) and
[Workspace UX §4](../../design/post-mvp/workspace/ux-spec.md#4-members-page).
Uses the real [P2-C01 contract](../backend/workspace-guests-directory-api.md),
within the existing [Members/Invitations UI](workspace-members-invitations-ui.md).
No backend, shared contract, migration, dependency or lockfile changes.

## Base and scope

At preparation, #132 was closed as completed and PR #140 was merged into main.
The requested `feat/workspace-guests-directory-ui` branch already existed,
was clean and matched freshly fetched `origin/main` (`7aae342`). It therefore
uses the merged backend directly; no stacked-branch rebase is required for #132.
The user requested exactly one final local commit, with no push/PR/merge/deploy.
This record is checkout evidence, not CI or production verification.

## Route, API and presentation

- `/workspaces/:workspaceId/members?tab=guests` activates the third tab.
  Members remains the default and Invitations retains its ADMIN-only behavior.
  Tab clicks push history; refresh and Back/Forward preserve the URL selection.
  ArrowLeft/ArrowRight wrap across three tabs; Home/End select first/last, move
  focus and prevent native page scrolling. Selected tab has the only tab stop,
  `aria-selected` and the shared panel's `aria-labelledby`/`aria-controls` pair.
- Existing Members `q`/`role`/`page` and Invitations `status`/`page` handling
  stays intact. Switching tabs resets list-specific filters as before; browser
  Back restores the previous filtered URL. Opening/closing Invite preserves
  Guests search/page too, and Escape restores focus without sending mail.
- `GET /api/workspaces/:workspaceId/guests?page=N&limit=10&search=...` is the
  sole directory query. Search is display-name-only, debounced 300ms, bounded
  to 120 characters and trimmed before sending; URL key is `q`. A search edit
  resets page 1 and hides the prior results during debounce. Invalid page
  values fall back to 1; pages range from 1 through 1,000,000. Guest paging
  pushes history; an authoritative response that shrinks the last page clamps
  to `max(1, totalPages)` with replace while retaining search.
- The wire type is exactly #132: `user:{id,displayName,avatarUrl:string|null}`,
  `boards:[{boardId,name,role:'OWNER'|'MEMBER',isArchived}]`,
  `visibleBoardCount:number`. Existing envelope pagination maps to
  `{items,total,page,pageCount}`. No email, Workspace Guest role, global total
  or invented field is consumed. Pagination/count/deduplication are server-owned;
  the browser never loads Board rosters to construct or filter this directory.
- Each distinct Guest row has the existing `UserAvatar`, name, permitted Board
  count, and all returned Board associations. Each association links to its
  authorized `/boards/:boardId`, uses the existing Board `RoleChip`, and marks
  archived associations `Archived · Read-only`. There are no Guest actions.
  Existing Board Members UI remains the place for membership changes.
- The panel explicitly says **Guests on boards you can view member details
  for** and explains that a Guest is a Board member outside the Workspace.
  Private other-Board Guests are excluded; Workspace ADMIN and read-only Board
  access do not grant roster access. Counts are labeled **in this directory**.
  The unfiltered empty state is **No guests on boards you can see member
  details for**; search-empty wording is similarly scoped.
- Existing Workspace skeleton/error/retry/permission primitives cover loading,
  network/server errors, 403 and 404. Shared AuthProvider handles 401, logout
  and account changes. Workspace-only access denial blocks the Guests request.
  Personal owners use the same query; invitations remain Team ADMIN-only.

## Cache and authorization boundary

Keys are `['workspaces', userId, sessionGeneration, 'workspace', workspaceId,
'guests', {search,page,limit}]`. Queries forward AbortSignal through the existing
HTTP helper and `runAuthorized`; retry is explicit, mount always revalidates,
and there are no previous-page placeholders. Protected rows and counts are
hidden during every fetch and while the parent Workspace is being verified.
403/404 invokes the existing Workspace revocation helper, clearing every
resource page plus the protected header. Session generation and `isCurrent`
checks prevent cross-account responses from rendering.

Successful Board-member mutations now clear/invalidate Guest snapshots too.
Received member add/remove/role, Board access-change and archive/restore hints
cancel all pending Guest reads and clear every cached Guest page before
refetching; they do not wait for ordinary batched Board invalidation. This also
handles downgrade to read-only without full Board revocation. Existing Board
and Workspace revocation, generic access-change, disconnect/reconnect and
focus refetch boundaries continue to cover the new query namespace. Existing
Workspace membership commands already invalidate the Workspace resource.
Cancellation prevents a delayed old response from restoring cleared details,
even when a transport ignores abort. Independent Members caches are not cleared
by the Guest-only refresh helper.

Limitations follow the backend/existing realtime model: received hints trigger
immediate revalidation; changes without a delivered hint are checked on focus,
reconnect, mount or another refetch. No new Board-room subscriptions or server
events are added. The server's authorized in-flight snapshot cannot be retracted
retroactively; the client discards it after an observed invalidation. Offset
pages can shift as the underlying directory changes. No management action,
role filter, hidden Board completeness claim or polling service is introduced.

## Visual parity and browser QA

Reference: [approved Workspace composition](../../design/post-mvp/workspace/approved-visual-reference-v1.png),
Members panel; [visual register](../../design/post-mvp/visual-reference-register.md)
and [Post-MVP guidelines](../../design/design-guidelines.post-mvp.md).

| Reference element                           | Availability and implementation                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Shell, breadcrumb and Workspace sections    | Existing Available shell retained, including its mobile drawer and account theme.                                                 |
| Members / Invitations / Guests              | All three Available; Guests Soon treatment removed. Existing Invite flows retained.                                               |
| Name, avatar and compact member-style panel | Available; two-column rows from 640px and stacked Guest/Board groups below. Long names wrap.                                      |
| Search and result count/pagination          | Available using server data; counts explicitly scoped. Guest role filtering is not supported by #132, so no fake filter is added. |
| Role and archived marker                    | Board OWNER/MEMBER only, per association; archived read-only text and Board deep link.                                            |
| Guest actions, emails/global Board totals   | Excluded from this DTO and page. No guessed counts or management menu.                                                            |
| Existing future shell slots                 | Existing Coming soon treatment retained; no new future route or shortcut.                                                         |
| Pricing/paid promotion/extra roles          | Excluded.                                                                                                                         |

Chrome DevTools MCP exercised the real frontend against compiled AppModule and
the merged #132 endpoint on an owned, loopback-only disposable PostgreSQL 16
container. Only synthetic test accounts/Boards were seeded, outside production
code; no application DB credentials were read, no live emails sent. The
temporary harness used the existing backend fixture without changing backend
files. It included 12 permitted Guests, a multi-Board Guest, archived Board,
long names, a hidden PRIVATE Board/Guest, an ADMIN without explicit Board
membership, and a Board-only Guest.

Evidence: [screenshots and manifest](../../design/screens/implementation/workspace-guests-directory-ui/).
The matrix covers 320×812, 375×812, 768×1024, 1280×800 and 1440×900 in both
Light and Dark via system-theme changes. Main/page/tab-strip overflow checks
pass for all ten combinations; hidden Guest and hidden Board labels are absent.
The narrow tab strip was refined to remove an unintended scrollbar and keep
all three 44px-high controls visible at 320px. The inherited Workspace identity
header plus explicit privacy explanation require intentional vertical content
scrolling on phones; Guest rows stack rather than clip associations.

Manual browser checks: real login; Guests deep link and reload on page 2;
Back/Forward; server search with page reset; hidden-name search returning scoped
zero; Invite open/Escape with retained search and focus restoration; Home/End
tab selection and focus; actual archived Board deep link and its read-only
banner; zero-result ADMIN with no explicit Board memberships; Board-only Guest
receiving safe Workspace-not-found with no Guest rows. A second signed-in
browser was then granted an explicit Board membership, displayed a directory
of 12 permitted Guests,
and was removed through the existing Members UI in the first browser. Its live
Workspace revocation immediately cleared all Guest identities, Board labels,
counts and the protected header without a reload. No Guest management
mutation or real invitation send was attempted. Authenticated Guests rendering
had no console errors/warnings in the inspected navigation; normal reads
succeeded, with expected cancelled development requests during React StrictMode.
Rebuilding shared output during the live Vite session also produced transient
missing-output HMR errors; the production build passed and a fresh browser smoke
check after restarting the local services verified rendering without that overlap.
Permission-denial requests
were intentionally 404. Error/loading/stale-response and session cases are
covered by automated tests below, rather than screenshots claiming those were
all exercised manually. No screen-reader software or live-provider QA was run.

## Automated verification

Verification date: 2026-10-30. Node v22.17.0 / pnpm 10.18.3.

| Check                                                                                                                                                       | Result                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                                                                                                                 | PASS, including final source.                                                                                                                                                                                                                                                                                  |
| `pnpm --filter @kanban/frontend test -- src/features/workspaces/members/WorkspaceGuests.test.tsx src/features/workspaces/members/WorkspaceMembers.test.tsx` | PASS: 2 files / 62 tests (28 Guest cases, 34 existing Members/Invitations cases).                                                                                                                                                                                                                              |
| `pnpm --filter @kanban/frontend test -- --maxWorkers=2`                                                                                                     | PASS: 102 files / 1,010 tests.                                                                                                                                                                                                                                                                                 |
| `pnpm test` with `VITEST_MAX_WORKERS=2` in the command environment                                                                                          | PASS: backend 69 suites / 701 tests; frontend 102 files / 1,010 tests; shared 7 tests. No repository test configuration changed.                                                                                                                                                                               |
| Initial `pnpm test` with default worker concurrency                                                                                                         | FAIL: 5 frontend timing failures, including the new navigation case and 4 unchanged test files. Three hit the 5-second test timeout; two hit DOM wait conditions. Both bounded full-suite reruns above passed. These are reported as load-sensitive failures, not silently classified as pre-existing defects. |
| `pnpm build`                                                                                                                                                | PASS: shared, backend, frontend. Existing Vite NODE_ENV-in-env and large-chunk warnings remain.                                                                                                                                                                                                                |
| `pnpm format:check`                                                                                                                                         | FAIL: 817 existing base files differ on Windows CRLF versus LF. An initially reported formatting difference in the new test was fixed; the final strict result includes base files only. No unrelated normalization performed.                                                                                 |
| `pnpm format:check --end-of-line auto`                                                                                                                      | PASS: entire repository, including changed files.                                                                                                                                                                                                                                                              |
| Local Markdown link/path validation                                                                                                                         | PASS: 74 relative links/paths across the three changed documents.                                                                                                                                                                                                                                              |
| `git diff --check`                                                                                                                                          | PASS.                                                                                                                                                                                                                                                                                                          |
| Backend/shared diff audit                                                                                                                                   | PASS: no changes to `apps/backend` or `packages/shared`.                                                                                                                                                                                                                                                       |
| Real Chrome / real #132 API visual and interaction QA                                                                                                       | PASS as detailed above and in the evidence manifest.                                                                                                                                                                                                                                                           |

Tests cover exact request/mapping/cancellation; server search, paging/clamping
and honest empty counts; names/avatars/per-Board roles/archive links; URL,
keyboard, Invite and history behavior; loading/error/retry; 401/403/404;
Board-only denial; member/Board/archive/access hints; Workspace revocation;
late responses; cross-account/same-account session replacement and logout;
and all-page Guest cache clearing without changing independent Members caches.
The updated historical Soon assertion now checks that Guests data is loaded
only when selected. The initial implementation's mistaken Board-role type
import was corrected before the successful builds. No test timeout or global
worker setting was committed. Existing injected realtime delivery/eviction
failure logs appeared in passing backend tests.

Separate PostgreSQL regression scripts, CI, production deployment, live mail
and live OAuth were not run for this frontend-only change. Browser QA used the
real backend and disposable database; backend authorization regression evidence
remains in the merged #132 task record. The QA container and local Vite server
are stopped after evidence capture.

## Changed files

- `apps/frontend/src/features/workspaces/members/GuestsPanel.tsx`: scoped
  search, rows, states, links and numbered paging.
- Members `types.ts`, `api.ts`, `hooks.ts`, Workspace `query-keys.ts`, and
  `pages/WorkspaceMembersPage.tsx`: exact DTO integration, scoped query and tabs.
- `members/refresh-guests.ts`, Board-member `hooks.ts`, realtime
  `RealtimeProvider.tsx`: immediate Guest cache clearing and revalidation.
- `members/WorkspaceGuests.test.tsx` and `WorkspaceMembers.test.tsx`: new Guest
  behavior/security cases and replacement of the historical Soon assertion.
- This record, task index, prior Members record and implementation screenshots.

P2-08's original Soon note and the older architecture overview describe earlier
milestones; this record supplies the completed Guests slice without rewriting
their historical verification. No backend or schema changes are required for
this UI, and no deployment or remote Git action is part of this task.
