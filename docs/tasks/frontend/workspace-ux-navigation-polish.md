# Workspace UX, navigation and responsive polish

Implementation record for [#146](https://github.com/duongkienvn/SE2026-T13/issues/146),
31 October 2026. UX-P01–UX-P07 and B03 are implemented locally, including the
approved UX-P06 Option B after integration of #137.
This record describes local verification, not deployment.

## Findings and implemented behavior

| Item   | Baseline finding / reproduction                                                                                                                                      | Result                                                                                                                                                                                                                                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UX-P01 | Personal Permissions offered the redundant all-members/admin-only Board creation choice.                                                                             | Hide only that choice for PERSONAL. Keep the three Board OWNER invitation, membership and visibility policies and their existing persistence. Explain direct Board Guest membership separately from Workspace-visible access. TEAM controls stay unchanged.                                                                    |
| UX-P02 | Sidebar repeated Overview/Boards/Members/Settings, and switching from Boards preserved that section.                                                                 | Sidebar selects a Workspace and always enters Overview. Horizontal tabs own section navigation. Nested Settings routes and the independent Global Boards entry remain available.                                                                                                                                               |
| UX-P03 | Authenticated shell's Board breadcrumb always returned to Global Boards; no containing Workspace was selected.                                                       | Join the verified Board's current `workspaceId` to the current session's authorized Workspace directory. Use the resulting identity for Sidebar selection and Workspace → Boards → Board links, regardless of entry route. Mobile gets a wrapping breadcrumb inside Board Detail; tablet/desktop retain the header breadcrumb. |
| UX-P04 | `public.ensure_personal_workspace(uuid)` embedded `Personal Workspace`; service, email/Google signup and the legacy Board bridge all reuse that function.            | New migration changes only the function's future creation literal to `Kanvexa Workspace`. No existing-record rename.                                                                                                                                                                                                           |
| UX-P05 | At 320px, a three-part header breadcrumb was cramped; at 768px the search placeholder squeezed its names. Workspace headers consumed too much short-viewport height. | Put mobile Board context in content; use compact search positioning for contextual headers; tighten Workspace identity at the existing short-height breakpoint and the Settings rail at tablet width. Reuse existing tokens and scroll boundaries.                                                                             |
| UX-P06 | Overview supported authorized Board/member counts but Active this week and Total cards were permanently unavailable.                                                 | Approved Option B implemented: remove the two unsupported cards; use two balanced, equal-width supported summary cards and preserve the merged real Activity panel/history.                                                                                                                                                    |
| UX-P07 | PERSONAL showed a disabled header Invite, Invite Member CTA and Invitations tab.                                                                                     | Hide those controls only for PERSONAL; preserve Members and Guests. Direct `?tab=invitations&invite=1` falls back to Members without an invitation request/dialog. TEAM invitation behavior remains intact.                                                                                                                    |
| B03    | Settings layout returned different mobile and desktop Outlet trees at 768px, recreating form state.                                                                  | One stable Outlet owns each existing form across breakpoint changes. Responsive navigation changes without replacing the form; no autosave, new persistence or global state.                                                                                                                                                   |

Existing dialogs, Sidebar scrolling/focus handling, session-scoped Workspace
queries, access-revocation handling, Board authorization and form mutation guards
already supplied the necessary foundations. They were reused rather than replaced.

## Navigation and privacy

The URL determines Workspace section selection. On Board routes, current Board
data and the existing verified Workspace directory determine the containing
Workspace; no route-state hint, Board OWNER role or visibility flag grants
Workspace identity. The same identity is passed through the shell Outlet to the
mobile breadcrumb. Move/refetch changes that identity; archived Boards retain
their authorized context. A directory revocation removes it while preserving an
independent direct Board grant.

Board-only OWNERs, MEMBERs and readers get `Boards → Board` with `/boards` as the
return link. They receive no protected Workspace name or management link through
this context. PRIVATE access remains subject to Board authorization;
WORKSPACE_VISIBLE retains the existing read-only capability model. No backend ACL,
endpoint, cache key or realtime contract changes. Existing user/generation-scoped
directory verification and logout/revocation cache removal remain authoritative.

## Provisioning migration

`1793577600000-PersonalWorkspaceName.ts` is necessary because the default lives
inside a deployed PostgreSQL function, not a TypeScript default. Previous
migrations are unchanged. `CREATE OR REPLACE FUNCTION` preserves its existing
transaction, uniqueness and membership logic; conflict handling never changes a
Workspace name. Both up and down affect only future provisioning defaults, never
existing rows, IDs, ownership or membership. Deployment still requires the normal
explicit migration procedure; nothing runs automatically on application startup.

The new naming integration helper verifies populated old/custom rows including
timestamps, repeated/concurrent provisioning, legacy omitted-Workspace Board
creation, transaction rollback and data-preserving naming down/up. Existing
PostgreSQL fixtures now account for the seventeenth migration while retaining
their historical policy/decline/Activity rollback checkpoints. Email and Google
authentication tests assert the new name through their real service paths.

## Settings and responsive evidence

RTL tests retain the **same form element** across repeated 767/768/1024/375px
transitions for General and Permissions. They cover dirty values, no autosave,
Cancel, failed saves, validation/corrected save, browser Back/Keep editing and
clean Back. Existing section-change/session guards remain covered.

Browser QA uses the DEV-only `apps/frontend/qa/workspace-polish.html` entry with
isolated fixtures and intercepted requests, never production data or real email.
The entry is not imported by the production application.

- [98 layout measurements](../../design/screens/implementation/workspace-ux-navigation-polish/browser-matrix.json): Overview, Boards, Members, Guests, General, Permissions and Board Detail in light/dark at 320×600, 375×700, 768×768, 1280×600, 1280×700, 1280×768 and 1440×768. No document/main horizontal overflow or rendered error alerts in those fixtures.
- [Desktop Board](../../design/screens/implementation/workspace-ux-navigation-polish/desktop-board-dark.jpg), [tablet Board](../../design/screens/implementation/workspace-ux-navigation-polish/board-tablet-dark.jpg), [mobile Board](../../design/screens/implementation/workspace-ux-navigation-polish/mobile-board-light.jpg), [Guest Board](../../design/screens/implementation/workspace-ux-navigation-polish/guest-board-320-dark.jpg).
- [Short laptop Boards](../../design/screens/implementation/workspace-ux-navigation-polish/boards-laptop-light.jpg), [tablet Settings](../../design/screens/implementation/workspace-ux-navigation-polish/settings-tablet-dark.jpg), [Personal Permissions](../../design/screens/implementation/workspace-ux-navigation-polish/personal-permissions-mobile.jpg), [long-name mobile drawer](../../design/screens/implementation/workspace-ux-navigation-polish/mobile-drawer-long-name.jpg), [320px dialog](../../design/screens/implementation/workspace-ux-navigation-polish/invite-dialog-320-dark.jpg).
- Actual browser window resizes 767 → 768 → 767 → 900 → 767 preserve a General draft, enabled Save and a synthetic failed-save error. The main content scroll keeps the form actions reachable. Emulation changes can reload a page, so the draft check uses window resize rather than treating an emulation reload as a form-state failure.
- Many-Workspace chooser fixture has 42 entries. Escape closes the chooser and restores focus. Mobile drawer keyboard trapping and Escape returning focus to Open navigation were checked. A 320×600 invite dialog's controls fit inside the viewport. System appearance follows emulated light/dark preference through the existing ThemeSync. No new modal or scroll implementation was needed.

Available navigation, Personal controls, Settings and the final Overview use the
existing branding, tokens and appearance preferences. Real Activity remains
available; unsupported statistics are removed by the approved decision below. No
new analytics, Search behavior, billing or unrelated redesign was introduced.

## Dependencies and product decision

Initially #136 and #137 were both unmerged. During implementation, #136 merged
through [PR #152](https://github.com/duongkienvn/SE2026-T13/pull/152); the branch was
updated to that completed mainline implementation and the local Personal tests
were combined without conflict. Recipient actions, invitation status/contracts
and teammate implementation files are unchanged by this task's diff. TEAM
Declined-history and Accept/Decline regressions are included in final verification.

[#137](https://github.com/duongkienvn/SE2026-T13/issues/137) merged through
[PR #153](https://github.com/duongkienvn/SE2026-T13/pull/153). The final pass fetched
`6433c49`, found the previous origin/main reference stale, and rebased the existing
feature commit cleanly onto that merged main. Activity component/hook/API/key
implementations and the Overview composition remain unchanged from #137.

For UX-P06, **Option B was explicitly approved by the user in this chat**: remove
the unsupported `Active this week` and `Total cards` cards, rebalance around the
existing authorized Board/member counts, after #137 merges. This is the smaller
scope and needs no new aggregate API. Option A would require reviewed metric
definitions/time windows, ACL-filtered efficient aggregates, contracts and tests;
it is not implemented. Option B is now complete in WorkspaceSummaryCards: only
server-provided Visible boards and Members remain in two equal-width columns; the
existing Recent Boards/Activity composition is preserved. Loading/unavailable
semantics for supported counts remain truthful, including numeric zero. No new
endpoint, aggregate or backend work is needed.

## Initial verification (before #137 integration)

PostgreSQL tests use runner-owned disposable Docker databases, never an environment
database. Final package checks include the merged #136 implementation.

| Command / check (repository root)                                                                                                                                 | Result                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @kanban/frontend test src/app/layout src/features/workspaces src/features/boards/pages src/lib/api-client.test.ts --reporter=dot`                  | PASS: 394 tests, 19 files, normal concurrency. Includes #136 recipient and Declined-history regressions, existing access/session guards and Board owner actions. React `flushSync` lifecycle warnings remain in pagination cases; no failed tests.              |
| `pnpm --filter @kanban/backend test --runTestsByPath test/workspaces/workspaces.service.spec.ts test/auth/auth.service.spec.ts test/auth/google-auth.e2e-spec.ts` | PASS: 27 tests, 3 suites.                                                                                                                                                                                                                                       |
| `pnpm --filter @kanban/backend test:phase2-integrity:database`                                                                                                    | PASS: fresh 17-migration chain, populated upgrade/data preservation, new naming cases, catalog/lifecycle/race/backup checks and existing foundation/API/Activity suites. Includes 19 Workspace foundation groups with actual email/Google service provisioning. |
| `pnpm --filter @kanban/backend test:workspace-members:database`                                                                                                   | PASS: existing invitation/Guest/ACL/visibility/move/realtime/quota and migration checkpoints with the added naming migration.                                                                                                                                   |
| `pnpm exec eslint apps/frontend/src apps/frontend/qa apps/backend/src apps/backend/test`                                                                          | PASS.                                                                                                                                                                                                                                                           |
| `pnpm --filter @kanban/frontend build`                                                                                                                            | PASS: TypeScript and Vite. Existing environment `NODE_ENV` and >500 kB chunk warnings remain; no environment/configuration edits.                                                                                                                               |
| `pnpm --filter @kanban/backend build`                                                                                                                             | PASS: Nest/TypeScript.                                                                                                                                                                                                                                          |
| Browser checks above                                                                                                                                              | PASS for the listed fixture sizes, interactions, themes and privacy fallback; screenshots and measurements are local QA, not proof of deployment.                                                                                                               |

Changed-file Prettier checks, relative documentation links and `git diff --check`
pass after formatting intended files only. All 78 relative links in this record
and the task index resolve; the saved 98-row matrix validates.

`pnpm format:check` failed: it reported 842 files at that stage, including 839
unchanged files and three intended files subsequently formatted and rechecked
successfully. Widespread baseline formatting/Windows line-ending differences are
outside this issue; no repository-wide formatting write was performed.

Earlier tests exposed two old expectations that switching Workspaces would stay
on Boards. Those now assert the approved Overview destination; final tests pass
without reducing worker concurrency. Initial new context tests needed to await
authenticated navigation/query updates before asserting their result.

The full monorepo test suite is intentionally not run, per the implementation
request; focused frontend/backend and PostgreSQL suites cover this diff. CI,
production migration/deployment were not verified. Final #137 integration checks
are recorded below.

## Final UX-P06 and #137 integration verification

The final Overview keeps two supported summary cards at equal width on all
breakpoints; Recent Boards and the real Activity panel retain their existing
responsive composition. The explicit Option B approval supersedes the original
four-card reference's unsupported statistic slots. There is no replacement
analytics, invented value, API or backend change in this final pass.

The production Activity component/hook/REST adapter/query keys are unchanged.
Additional integration tests verify summary/history beside the two real counts,
Back/Forward navigation and history Escape/focus return; simultaneous pending
summary/history cancellation on realtime revocation while another Workspace's
cache survives; and account A → B with late 200/401/403/503 responses. Existing
#137 tests cover ADMIN/MEMBER responses, Guest/outsider denial, stale Workspace
switches, current-session 401, 403/404 refresh, reconnect/focus refetch, loading,
empty/error/retry, authorized optional Board links and pagination.

Final checks:

- **PASS:** `pnpm --filter @kanban/frontend test src/app/layout src/features/workspaces src/features/boards/pages src/lib/api-client.test.ts --reporter=dot` — 417 tests, 21 files, default concurrency. Includes all previously completed #146 frontend behavior, merged #136/#137 and the new UX-P06 integration tests.
- **PASS:** `pnpm --filter @kanban/frontend test src/features/auth src/features/realtime --reporter=dot` — 313 tests, 29 files, default concurrency. Session/callback isolation and reconnect/revocation behavior remain covered separately; existing `act` warnings remain.
- **PASS:** `pnpm exec eslint apps/frontend/src apps/frontend/qa apps/backend/src apps/backend/test` and both `pnpm --filter @kanban/frontend build` / `pnpm --filter @kanban/backend build`; frontend includes TypeScript. Existing NODE_ENV/chunk warnings remain.
- **PASS:** `pnpm --filter @kanban/backend test:phase2-integrity:database` after sequential build setup. The complete 17-migration chain, Personal naming/legacy/email/Google behavior and existing Activity/API ACL, lifecycle, race and database-foundation checks pass on owned disposable PostgreSQL.
- **PASS:** formatting for every text file changed by this feature versus updated main, `git diff --check`, all 83 relative documentation links, and validation of the saved 14 loaded/eight empty-error layouts. Final `pnpm format:check` still fails on 841 files outside the feature diff; no feature file is reported.

The optional broader 50-file frontend selection (the 21-file command plus
`src/features/auth src/features/realtime`) is **not a clean pass**: runs had
2/730 and 8/730 failures involving timeouts or asynchronous readiness assertions.
A controlled comparison against the pre-UX-P06 rebased commit, with the same
50-file/default-worker selection, also failed 5/725 cases in auth session,
Workspace API and Guest navigation. The four source/test files were restored
byte-for-byte after this comparison. This establishes baseline timing failures;
they are not claimed fixed. No worker cap or timeout increase was introduced.
Separate focused selections and the broad failure remain explicitly reported.

The first database attempt overlapped two Nest builds and failed to find a
compiled module. This verification-orchestration mistake was corrected by running
the database command after the other build completed; its final run passes. No
application source change was needed.

[Final responsive measurements](../../design/screens/implementation/workspace-ux-navigation-polish/overview-final-matrix.json)
cover 14 loaded Overview layouts at the original seven size pairs in light/dark,
plus eight Activity empty/error checks at 320/1440px. Two equal-width supported
cards, five real Activity rows and no document/main horizontal overflow were
verified in every loaded case. Empty/error states disable history and retain
truthful messages/Retry. History at 375×700 stays within the viewport, scrolls its
eight fixture events, and Escape restores focus to View all.

- [Desktop light Overview](../../design/screens/implementation/workspace-ux-navigation-polish/overview-final-1440-light.jpg)
- [Tablet dark Overview](../../design/screens/implementation/workspace-ux-navigation-polish/overview-final-768-dark.jpg)
- [320px dark Overview, scrolled to supported summary](../../design/screens/implementation/workspace-ux-navigation-polish/overview-final-320-dark.jpg)
- [Mobile Activity history](../../design/screens/implementation/workspace-ux-navigation-polish/activity-final-history-375-dark.jpg)

Browser evidence uses the existing isolated DEV-only QA entry with the actual
merged components and intercepted REST, not production or manually authenticated
live accounts. Initial screenshots/matrix above are historical evidence from the
first pass; these final Overview images supersede their statistics/Activity state.
UX-P06/#137 integration is no longer deferred. Remaining limitations are baseline
test timing/formatting warnings and unverified CI/deployment, not unfinished
product scope. Issue #147's branch remains at `0e085dc`, untouched and unincluded.
