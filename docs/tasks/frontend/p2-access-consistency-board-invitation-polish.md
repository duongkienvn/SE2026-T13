# Phase 2 access consistency and Board/invitation polish

Local implementation record for [#147](https://github.com/duongkienvn/SE2026-T13/issues/147),
31 October 2026. Initial audit baseline (before final integration): `origin/main` at
`57dcc1e7d97743a55fbd96896f64b1664863d84d` (includes #136 / PR #152).
Current branch: `fix/p2-access-cache-board-invitation-polish`.

The initial checkout was clean and the previous access-polish branch was preserved.
At initial implementation, #146 was separate and unmerged, so no unfinished #146
work was included. The final rebase below now inherits completed #137/#146 from
main, preserving their implementations rather than duplicating their changes.

## Reproducibility audit

| Finding | Result                                           | Actor / operation, baseline evidence and remedy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B01     | **FIXED**, Activity integration verified         | Authorized Workspace member/ADMIN starts an Overview; a Workspace mutation returns 404. Mutation hooks passed the Overview key as the supposedly rejecting source query, exempting that unrelated read from cancellation. A controlled late success restored its protected payload. Separately, leave/delete forgetting filtered the directory without cancelling its pending request, which restored membership. An ADMIN invitation-page 403 invalidated Overview but did not cancel or clear sibling invitation pages; late success restored recipient data. All three tests failed on the baseline and pass with the fixes below. |
| B02     | **ALREADY RESOLVED** for creation/cache behavior | `useCreateWorkspaceBoard` already invalidates the originating Workspace resource prefix (Boards and supported Overview summary) and global Board lists only after confirmed success. Its existing 403 capability refresh, transient/conflict error behavior, captured Workspace scope and session checks are retained. The mutation-404 cancellation defect is fixed under B01. New key-targeting/switch tests supplement existing zero-to-first, duplicate-submit, closed-route and logout cases; no speculative counts or optimistic records added.                                                                                 |
| B05     | **FIXED**                                        | A Workspace-visible reader without explicit Board membership opens Archived cards on an active Board. `readOnly` produced “This board is archived.” New UI regression reproduced it. Pass explicit archive and Restore capability facts; give separate archived, active-read-only and unknown/checking messages. Unknown/failed capability checks cannot enable Restore.                                                                                                                                                                                                                                                              |
| B06     | **FIXED**                                        | Team ADMIN creates/resends an invitation. Existing feedback said “Email sent”, merged FAILED/UNKNOWN results, described `createdAt` as Sent, and claimed a send on cooldown. The invite form also issued two POSTs for two submit events before React rendered; the new baseline test observed two requests. Distinguish every backend sendState, label Created, state provider acceptance separately from inbox delivery, use neutral cooldown/ambiguous-request guidance and synchronous create/resend guards. Pending DISPATCHING cannot be resent until refreshed server state permits it.                                        |
| B07     | **ALREADY RESOLVED**                             | Presence snapshots carry deduplicated user IDs, not names/emails. `BoardPresence` resolves only an authorized roster when `canReadMembers`, plus the signed-in user's own profile; unresolved viewers use a neutral `?` / Unknown viewer. A new read-only test confirms no roster request, no UUID/email display, multi-tab deduplication and clearing after revocation. Existing owner/member/Guest, reconnect, snapshot/ACK and server authorization tests pass. No Presence production or shared-contract change needed.                                                                                                           |

This scope implements stabilization for WS-01/WS-02/WS-04 query boundaries,
BD-02 access behavior and existing Card Restore/Presence. It does not implement
Board/Card V2, a new access model or analytics.

## Changes and security boundaries

- `revoke-workspace-access.ts`: the source-query exception is optional and used
  only by a read rejecting itself. Mutations cancel every affected read. The
  helper starts cancellation and clears sensitive data synchronously before
  awaiting completion; a transport ignoring AbortSignal cannot restore cancelled
  TanStack Query results. Directory cancellation occurs before filtering.
- Members/settings/Board creation hooks no longer pass an unrelated Overview as
  a mutation's source. Invitation-history 403 clears only ADMIN invitation pages,
  then rechecks Overview; it does not assume Workspace membership is lost.
  Leave/delete forgetting also cancels the pending directory read.
- Existing user/generation/Workspace query keys, AuthProvider's `runAuthorized`
  checks and synchronous session replacement/cache clearing are unchanged. Tests
  cover A → B with late success, 401, 403 and transient errors, as well as stale
  Board create results. Old callbacks cannot clear or invalidate B's caches.
- 503/network/conflict responses are not permanent revocation. The new tests
  retain another Workspace's valid cache, and existing retry/error UI is kept.
  Socket Workspace revocation and reconnect cancellation already worked; new
  tests verify pending Overview/Members/Guests/Invitations/Policies cannot return
  cleared data. Existing direct-link, Back/Forward and realtime actor tests remain
  in the regression selection.
- `ArchivedCardsDialog` takes separate `isArchived` and `canRestore` facts.
  Board Detail supplies its authorized Board state; a failed Board refresh makes
  Restore capability unknown. The dialog clears pending confirmation on capability
  loss and suppresses archive copy when access is unavailable. Existing Restore
  confirmation, synchronous submit lock, server errors and API remain unchanged.
- Invitation feedback uses backend state only. FAILED and UNKNOWN have distinct
  retry guidance. No quota timer or delivery estimate is invented. Error and
  success notices check the initiating session. The pending-state guard has a
  synchronous ref to cover same-frame duplicate events. Longer delivery labels
  wrap rather than truncate away the inbox caveat.

Workspace ADMIN never implies PRIVATE Board access. A Board-only Guest retains
only independent Board grants; Workspace-visible nonmembers remain read-only.
No backend ACL, persistence, endpoint, migration, dependency, REST DTO or Socket.IO
event changes. No proof/hash is added to URLs, logs, UI or browser storage.
The merged recipient Accept/Decline implementation, `DECLINED` status, terminal
history and invitation send-state contracts remain intact.

## Initial verification (before #137/#146 integration)

| Command from repository root                                                                                                                                                                                                            | Result                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm --filter @kanban/frontend test src/features/workspaces src/features/realtime src/features/presence src/features/auth src/features/cards/components/ArchivedCards src/features/boards/pages --reporter=dot`                        | **PASS: 709 tests, 46 files**, default concurrency (46 workers). Covers new races, real HTTP adapter mocks, create/refusal/switch behavior, Restore states, all send-state create/resend paths, #136 recipients/history, auth/session and realtime lifecycle.                                                                                                      |
| `pnpm --filter @kanban/backend test --runTestsByPath test/realtime/presence/presence.e2e-spec.ts test/realtime/presence-concurrency.spec.ts test/realtime/board-presence.spec.ts test/workspaces/workspace-invitation-dispatch.spec.ts` | **PASS: 18 tests, 4 suites**. Presence E2E uses real local Socket.IO/AppModule with a memory database double; its internal eight groups cover authorization, snapshots, tabs, expiry, reconnect and revocation. Delivery/eviction error logs are deliberate negative cases.                                                                                        |
| `pnpm --filter @kanban/backend test:workspace-members:database`                                                                                                                                                                         | **PASS** on runner-owned disposable Docker PostgreSQL: invitation create/accept/decline/revoke/expiry/reinvite, send attempts/quotas/cooldown/concurrency, Guest lifecycle and roster privacy, PRIVATE/WORKSPACE_VISIBLE actor matrix, Board moves, Socket.IO revocation and locking races. Uses test mail transport, never real email or an environment database. |
| `pnpm exec eslint apps/frontend/src apps/frontend/qa`                                                                                                                                                                                   | **PASS**.                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm --filter @kanban/frontend build`                                                                                                                                                                                                  | **PASS**, TypeScript and Vite. Existing NODE_ENV configuration and >500 kB chunk warnings remain; no environment changes.                                                                                                                                                                                                                                          |

Initial test-first runs reproduced the three B01 defects, B05 false copy and B06
duplicate submission. Two new test assertions needed correction: mutation status
must await Query observer notification, and ActionMenu deliberately uses
`aria-disabled` with focusable reason text rather than native `disabled`. A new
old-session 401 fixture initially also fed that denial into an unintended new
session request; restricting it to the initiating account corrected the fixture.
These were not production cache or session defects. No timeout or worker-count
increase was used. Final default-concurrency tests pass. Existing pagination
`flushSync` and auth-session test `act` warnings were observed in unchanged cases.

Full-root tests are intentionally not run for this frontend-only change. Backend
regression and PostgreSQL checks above were selected to verify the requested
cross-layer Presence/invitation access matrix; server source is unchanged.

Changed-file Prettier and `git diff --check` pass. All 75 relative links in this
record/task index resolve, and the 40 saved layout/state measurements validate.
`pnpm format:check` fails on **847 unchanged files**, with no changed file reported;
these are baseline formatting/Windows line-ending differences. No unrelated files
were reformatted.

## Initial browser QA

The DEV-only `apps/frontend/qa/access-polish.html` entry renders the real shell,
Board Detail, Archived Cards, Presence and Workspace Members components. It uses
isolated synthetic Auth, REST and Presence fixtures; it is not imported by the
production application. Browser screenshots are not live multi-account/server
verification; those behaviors are covered by the separate tests above.

[40 measured layouts](../../design/screens/implementation/p2-access-consistency/browser-qa.json)
cover active read-only, active permitted Restore, archived Board and Invitations
at 320/375/768/1280/1440 × 700px in light/dark. No document/main horizontal
overflow, offscreen archive dialog, incorrect Restore availability or modal focus
failure was observed. Existing tokens, composition and scroll regions are kept;
the header/breadcrumb limitations belonging to unmerged #146 are unchanged.

Evidence:

- [Active reader, 320px light](../../design/screens/implementation/p2-access-consistency/reader-320-light.jpg)
- [Archived Board, 1280px dark](../../design/screens/implementation/p2-access-consistency/archived-1280-dark.jpg)
- [Permitted Restore, 768px light](../../design/screens/implementation/p2-access-consistency/owner-768-light.jpg)
- [Anonymous viewer fallback, 1440px dark](../../design/screens/implementation/p2-access-consistency/presence-1440-dark.jpg)
- [All five delivery states, 375px dark](../../design/screens/implementation/p2-access-consistency/invitations-375-dark.jpg)
- [Synthetic 429, 320px dark](../../design/screens/implementation/p2-access-consistency/invite-cooldown-320-dark.jpg)

Keyboard checks: eight Tab presses remain inside the invite dialog; Escape closes
it and returns focus to Invite Member. Presence popup Escape returns focus to
Show viewers. The 320px failed invite preserves the entered address and reachable
retry/Cancel controls. Checked browser pages had no unexpected console warnings
or errors. Error responses in these fixtures are intentionally synthesized.

Available controls remain connected to their existing APIs; unrelated Search and
other Coming soon slots stay inert. No reference redesign or excluded feature is
introduced.

## Final rebase and Activity integration

The paused rebase of `0e085dc` was completed onto `fef2447` (merged #146 via
PR #154, including #137 via PR #153). Fetch confirmed this was the latest main.
The only unresolved file was `docs/tasks/README.md`: both the Workspace UX entry
and the #147 access-polish entry were preserved once each, with all other entries
kept. No commit was skipped, no rebase aborted and no implementation discarded.
A range-diff immediately after continuation showed only the expected task-index
context adjustment versus the original patch.

Semantic review confirmed that the automatically merged Board Detail retains
#146 Workspace/mobile breadcrumbs and supplies separate archive/Restore facts
for B05. Personal Workspace controls, two supported Overview statistics and
real Activity/history remain inherited from main. B01 cancellation accepts the
actual denying Activity query as its optional source while cancelling sibling
requests; mutation failures exempt no unrelated query. All completed B01/B02/
B05/B06/B07 changes remain intact.

Existing merged integration tests already cover simultaneous pending summary/
history revocation, old Workspace responses, A → B with late 200/401/403/503,
Guest/outsider gating, current-session 401, focus/reconnect refetch, pagination,
Back/Forward navigation and history dismissal/focus. Only missing checks were
added: HTTP 403/404 on summary cancels pending history without evicting another
Workspace; Board-create 404 clears pending Activity as well as Overview; and a
confirmed invitation invalidates Activity only in its originating Workspace.
Production Activity component, hooks, API and key contracts are unchanged.

Activity integration is no longer deferred. Final verification on the rebased
branch:

- **PASS:** `pnpm --filter @kanban/frontend test src/features/workspaces/access-consistency.test.tsx src/features/workspaces/WorkspaceActivity.integration.test.tsx src/features/workspaces/api.integration.test.tsx src/features/cards/components/ArchivedCards.test.tsx src/features/cards/components/ArchivedCardsRecovery.test.tsx --reporter=dot` — 63 tests, five files, including the newly added checks.
- **PASS:** `pnpm --filter @kanban/frontend test src/app/layout src/features/workspaces src/features/boards/pages src/lib/api-client.test.ts --reporter=dot` — 454 tests, 22 files, default concurrency.
- **PASS:** `pnpm --filter @kanban/frontend test src/features/auth src/features/realtime src/features/presence src/features/cards/components/ArchivedCards --reporter=dot` — 341 tests, 33 files, default concurrency. Together the two selections cover 795 distinct tests; no worker cap or timeout change.
- **PASS:** `pnpm exec eslint apps/frontend/src apps/frontend/qa` and `pnpm --filter @kanban/frontend build` (TypeScript + Vite). Existing NODE_ENV/chunk warnings and unchanged test `act`/`flushSync` warnings remain.
- **PASS:** all feature-file Prettier checks, `git diff --check`, 79 relative documentation links and task-index validation (every main entry retained; #146/#147 entries each appear once). No unresolved conflict markers remain.
- **FAIL, baseline:** final `pnpm format:check` reports 859 files outside this feature diff; no feature file fails. No unrelated formatting cleanup was performed.

No backend test/database rerun was necessary in this final integration pass:
server source, schema and shared contracts are unchanged. Backend results above
are evidence from the initial implementation, not a claimed new run. Full-root
tests and CI/deployment were not run. The broad-run timing limitations recorded
by #146 are not claimed fixed by these focused, default-concurrency passes.

Post-rebase browser smoke uses existing isolated DEV-only fixtures:
[measurements](../../design/screens/implementation/p2-access-consistency/rebased-integration-qa.json),
[1280px light Overview](../../design/screens/implementation/p2-access-consistency/rebased-overview-1280-light.jpg)
and [320px dark active-reader archive](../../design/screens/implementation/p2-access-consistency/rebased-reader-320-dark.jpg).
The actual merged Overview retains two authorized counts and five Activity rows;
its authorized Activity Board link opens the containing Workspace breadcrumb
without highlighting Global Boards. The mobile dialog keeps the truthful
read-only Restore reason, no Restore action, viewport bounds and focus handling.
No unexpected browser console warning/error or horizontal overflow was observed.
These fixtures do not prove live-account server behavior; the security sequences
are exercised in the integration tests above.

CI, production behavior and real inbox delivery are not verified. No push, PR,
remote merge, deployment, production database/resource access or real email.

## PR #154 follow-up: mobile Board Members return navigation

The final checkout was verified clean on
`fix/p2-access-cache-board-invitation-polish`, based directly on `fef2447`, with
one feature commit (`b836338`). No branch creation, switch or additional rebase
was performed.

The confirmed P2 finding reproduced on a direct `/boards/:boardId/members`
permalink: #146 hides the shared header breadcrumb below 768px, and the Members
page provided no content-level return link. A test-first permalink/return test
failed on the missing link before the fix.

`BoardMembersPage` now renders **Back to board** below 768px, after its existing
loading/unavailable/initial-error guards. It uses the loaded Board's canonical ID,
existing link/focus tokens and a 44px minimum target. The generic label introduces
no Workspace identity or new permission inference. Desktop retains the shared
breadcrumb; Board Detail breadcrumbs, Board/Workspace roles and all existing
B01/B02/B05/B06/B07 implementations are unchanged.

Regression coverage verifies direct permalink loading, navigation to Board
Detail and Back, and hiding the link/roster after Board or membership access loss
(403/404). Real Chrome checks at **320/375/767/768 × 700px** in light/dark verify
the actual CSS breakpoint: the link is visible and keyboard reachable below
768px, hidden at 768px with the desktop breadcrumb visible, and absent from
denied pages. The 24 allowed/403/404 cases show no page/main horizontal overflow.
Enter on the focused mobile link opens Board Detail, which still exposes its
Members navigation. No unexpected browser console messages were observed.

Evidence: [24 viewport/permission checks](../../design/screens/implementation/p2-access-consistency/members-return-qa.json),
[375px light Members](../../design/screens/implementation/p2-access-consistency/members-return-375-light.jpg),
[768px dark Members](../../design/screens/implementation/p2-access-consistency/members-return-768-dark.jpg).
These use isolated DEV-only fixtures, not live accounts or a production backend.

The existing merged Activity integration tests were re-executed rather than
duplicated: membership revocation during requests, late summary/history results,
A → B with late success/errors, reconnect/focus, command invalidation, unrelated
Workspace retention and #146 Overview/navigation are already covered. The focused
Members/Activity/access/API command passed **82 tests in four files**. No backend,
shared contract, migration or dependency change is required for this follow-up.

Final follow-up verification:

- **PASS:** `pnpm --filter @kanban/frontend test src/features/board-members/pages/BoardMembersPage.test.tsx src/features/workspaces/access-consistency.test.tsx src/features/workspaces/WorkspaceActivity.integration.test.tsx src/features/workspaces/api.integration.test.tsx --reporter=dot` — 82 tests, four files.
- **PASS on unchanged rerun:** `pnpm --filter @kanban/frontend test src/features/board-members src/app/layout src/features/workspaces src/features/boards/pages src/lib/api-client.test.ts --reporter=dot` — 491 tests, 24 files, default concurrency. First run had one timeout in the previously documented Guest keyboard/history case; no timeout, worker-count or unrelated test change was made. This timing limitation is not claimed fixed.
- **PASS:** `pnpm --filter @kanban/frontend test src/features/auth src/features/realtime src/features/presence src/features/cards/components/ArchivedCards --reporter=dot` — 341 tests, 33 files, default concurrency. Together the final two selections pass 832 distinct tests.
- **PASS:** `pnpm exec eslint apps/frontend/src apps/frontend/qa` and `pnpm --filter @kanban/frontend build` (TypeScript + Vite). Existing environment/chunk and test `act`/`flushSync` warnings remain.
- **PASS:** feature-file Prettier checks, `git diff --check`, 82 relative documentation links and the saved 24-case viewport/permission matrix. Final root `pnpm format:check` fails on 857 files outside this feature; no feature file fails.

No backend test/database rerun is needed for this frontend navigation change.
CI, production and real-account browser authorization remain outside these local
fixture/test results. The current local feature commit is amended, preserving one
commit above `fef2447`; no push, PR, merge or deployment.
