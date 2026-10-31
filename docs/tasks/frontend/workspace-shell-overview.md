# Workspace Shell, Navigation & Overview UI V1

Follow-up: [Workspace API integration](workspace-api-integration.md) connects the
production gateways. The unavailable/API handoff notes below are historical.

## Delivery status

Issue [#113](https://github.com/duongkienvn/SE2026-T13/issues/113), P2-06 / WS-01 discovery slice and WS-04 Overview. Checked on 2026-10-28.

**Visual-first pass implemented; real Workspace API integration remains blocked. Do not close the issue on this evidence alone.**

The task started in the clean, user-prepared `feat/workspace-shell-overview` checkout at `0f4b484`, matching remote `main` when inspected. The schema foundation (#110 / PR #120) was already merged. The entire issue and its visual-first clarification were read; it had no comments. Issue #111 was open and the checkout contained a Workspace provisioning service/entities, but no Workspace controller or lifecycle/Overview wire DTOs. No other checkout, backend, schema, migration, remote branch or deployment was modified.

## Implemented composition and behavior

- Authenticated `/workspaces` discovery and `/workspaces/:workspaceId` Overview routes use the existing App Shell V2, React Router and authentication boundary.
- Shared `WorkspaceShellSlots` extend the existing sidebar and mobile drawer. PERSONAL navigation, brand assets, Board/Card URLs, account actions and Settings routes are preserved.
- Workspace selector, independently collapsible WORKSPACES group, Personal/Team hierarchy, current Workspace indication and nested section navigation share the same components. The route determines selection; no Workspace or permission is persisted in storage.
- Breadcrumb: `Workspaces > Workspace name > Overview`. Direct entry, switching, Back and Forward are covered by router tests. A compact rail opens the actual discovery picker; the expanded sidebar and mobile drawer provide the full selector.
- Identity header includes a generated initial, name, description, Personal/Team distinction, permitted member count and an explicitly Soon invitation slot. No avatar upload or guessed icon representation is enabled.
- Four summary cards retain the approved composition. Only an adapter-provided actor-visible Board count and permitted member count can display values. Unsupported activity/card metrics retain an em dash and accessible Unavailable text.
- Recent Boards uses actor-accessible summaries, audited timestamps and unchanged `/boards/:boardId` links. Archived summaries say read only. No hidden Board fetch/filter/count, fake collaborators, favorite mutation or arbitrary thumbnails.
- Activity retains its approved adjacent panel with an honest Soon state. No Workspace activity API is presumed.
- Discovery includes complete Personal/Team sections, membership cards and loading/empty/error/unavailable states. Personal provisioning stays server-owned.
- Create Team Workspace dialog includes name, optional description, generated icon preview, inline validation, focus management, pending/error states, submission deduplication and session/mount guards. Production Create is disabled with an accessible explanation. Controlled gateway tests exercise success, failure and late-response behavior; they are not live backend integration evidence.
- Existing theme tokens, Light/Dark/System synchronization, modal primitive and reduced-motion behavior are reused. No dependencies were added.

## Availability and visual parity matrix

The [Workspace reference](../../design/post-mvp/workspace/approved-visual-reference-v1.png), [Workspace UX spec](../../design/post-mvp/workspace/ux-spec.md), [register](../../design/post-mvp/visual-reference-register.md), [blueprint](../../design/product-ux-blueprint.md), [base guidelines](../../design/design-guidelines.md), [addendum](../../design/design-guidelines.post-mvp.md), [App Shell spec](../../design/post-mvp/app-shell/ux-spec.md) and existing shell source/screenshots govern this pass.

| Reference element               | Implemented position                                           | Production availability                                  |
| ------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------- |
| Workspace selector              | Existing sidebar's upper identity slot; full mobile drawer     | Opens real selection UI; records unavailable until #111  |
| PERSONAL hierarchy              | Existing sidebar/drawer group                                  | Existing Boards route; other approved slots stay Soon    |
| WORKSPACES hierarchy            | Below PERSONAL; scrollable with fixed account footer           | Discovery and Create dialog entry work; no invented rows |
| Personal / Team membership rows | Sidebar, selector and discovery sections                       | Adapter seam only; production unavailable                |
| Breadcrumb and identity         | Above Workspace section navigation                             | Generic identity until a verified authorized response    |
| Overview                        | Under identity, selected indigo underline                      | Route and complete composition work; data unavailable    |
| Boards / Members / Settings     | Adjacent section slots and selected Workspace's nested sidebar | Static, accessible Soon states; no placeholder routes    |
| Member summary / Invite         | Identity header's trailing area                                | Count unavailable; Invite Soon                           |
| Four statistic cards            | One desktop row; two columns on small screens                  | No fabricated values; unsupported metrics unavailable    |
| Recent Boards / Activity        | Two desktop panels; stacked on phones                          | Empty/unavailable and Soon; controlled QA fixtures only  |
| Create dialog                   | Existing modal primitive over discovery                        | Form can be explored; production save unavailable        |
| Search / Notifications          | Existing global header slots                                   | Existing static Soon states; no shortcuts/counts         |
| Pricing / plan / upgrade        | Absent everywhere                                              | Excluded                                                 |

Intentional differences from the illustrative collage:

1. Official Kanvexa branding, canonical indigo and the existing frame/tokens replace the collage's blue artwork. Existing PERSONAL Boards and Account Settings stay reachable.
2. The full selector remains in the approved App Shell V2 upper slot. Explicit Personal/Team labels and 44px navigation targets make the sidebar taller than the collage; its middle scrolls independently.
3. Desktop retains the identity → four sections → four cards → Recent Boards/Activity hierarchy. Phones use the canonical drawer, wrapping breadcrumbs, a two-by-two section layout and stacked panels. The 1920px content is centered with a readable maximum width.
4. Licensed landscape imagery, sample people/avatars, star controls, fake analytics, notifications and card totals are not copied. Board thumbnails use semantic icon treatments; unimplemented functions retain visible Soon/Unavailable states.
5. There is no approved Create-dialog image in the collage; the dialog uses the repository's existing modal/form vocabulary and the approved name/description/optional-icon requirements.
6. The production unavailable notice adds height but keeps the entire visual composition. A populated QA screenshot is not evidence of real account data or API availability.

## Browser QA and evidence

Run `pnpm --filter @kanban/frontend dev --host 127.0.0.1 --port 5173` and open the **separate development entry** `/qa/workspace.html?theme=light`. It is never imported by production routes and is absent from the Vite build output. Every preview visibly says ISOLATED QA FIXTURES / No saved data. No Workspace HTTP mock endpoints exist.

Parameters: `theme=light|dark|system`, `scenario=ready|empty|no-workspaces|loading|forbidden|not-found|error|unavailable|long|many`, and optional `route=/workspaces` or `/workspaces?create=team`. `unavailable` uses the production unavailable adapter. Creation in the populated QA preview deliberately rejects rather than pretending to persist; successful creation is covered through an explicitly controlled test gateway.

Real Chrome screenshots were reviewed against the approved Overview region, with subsequent corrections for an unbroken long heading, compact-rail picker clipping, archived timestamp spacing and screen-reader Soon descriptions.

- [Side-by-side reference comparison](../../design/screens/implementation/workspace-shell-overview/reference-comparison.png): reference collage region and scaled real 1280×800 browser capture. This compares composition, not pixel identity or data correctness.
- [All 12 responsive/theme captures](../../design/screens/implementation/workspace-shell-overview/responsive-contact-sheet.png).
- [Browser QA measurements and limitations](../../design/screens/implementation/workspace-shell-overview/browser-qa.json).

| Viewport  | Light                                                                                           | Dark                                                                                           | Page / main horizontal overflow |
| --------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------- |
| 320×812   | [Capture](../../design/screens/implementation/workspace-shell-overview/overview-light-320.png)  | [Capture](../../design/screens/implementation/workspace-shell-overview/overview-dark-320.png)  | None                            |
| 375×812   | [Capture](../../design/screens/implementation/workspace-shell-overview/overview-light-375.png)  | [Capture](../../design/screens/implementation/workspace-shell-overview/overview-dark-375.png)  | None                            |
| 390×812   | [Capture](../../design/screens/implementation/workspace-shell-overview/overview-light-390.png)  | [Capture](../../design/screens/implementation/workspace-shell-overview/overview-dark-390.png)  | None                            |
| 768×1024  | [Capture](../../design/screens/implementation/workspace-shell-overview/overview-light-768.png)  | [Capture](../../design/screens/implementation/workspace-shell-overview/overview-dark-768.png)  | None                            |
| 1280×800  | [Capture](../../design/screens/implementation/workspace-shell-overview/overview-light-1280.png) | [Capture](../../design/screens/implementation/workspace-shell-overview/overview-dark-1280.png) | None                            |
| 1920×1080 | [Capture](../../design/screens/implementation/workspace-shell-overview/overview-light-1920.png) | [Capture](../../design/screens/implementation/workspace-shell-overview/overview-dark-1920.png) | None                            |

Additional evidence:

- [Discovery desktop](../../design/screens/implementation/workspace-shell-overview/discovery-light-1280.png), [discovery mobile dark](../../design/screens/implementation/workspace-shell-overview/discovery-dark-390.png), [no memberships](../../design/screens/implementation/workspace-shell-overview/no-workspaces-light-390.png).
- [Production-adapter unavailable composition](../../design/screens/implementation/workspace-shell-overview/unavailable-light-1280.png), [empty accessible Boards](../../design/screens/implementation/workspace-shell-overview/empty-light-1280.png), [loading](../../design/screens/implementation/workspace-shell-overview/loading-light-1280.png).
- [Forbidden](../../design/screens/implementation/workspace-shell-overview/forbidden-dark-390.png), [not found](../../design/screens/implementation/workspace-shell-overview/not-found-light-390.png), [network error/retry](../../design/screens/implementation/workspace-shell-overview/error-dark-1280.png).
- [Unavailable Create at 320px](../../design/screens/implementation/workspace-shell-overview/create-unavailable-light-320.png), [dark Create](../../design/screens/implementation/workspace-shell-overview/create-unavailable-dark-390.png).
- [Unbroken long name, system dark](../../design/screens/implementation/workspace-shell-overview/long-system-320.png), [48 memberships in system light selector](../../design/screens/implementation/workspace-shell-overview/many-selector-system-light-390.png). Selector list scrolls at 256px; drawer has no horizontal overflow.

Chrome accessibility-tree inspection confirmed dialog names/descriptions, landmark labels, `aria-current`, unavailable action descriptions and screen-reader Soon text. Keyboard checks exercised dialog Tab wrapping, Escape, restoration to Create Workspace, nested selector Escape before drawer close, and visible input focus. RTL covers mobile drawer focus trap/restoration, closing on navigation and creation without nested modals. Existing shared primitive tests cover backdrop dismissal. Reduced-motion media emulation was enabled for state checks. A live screen-reader software audit was not performed.

Final preview console had no errors and no failed API requests. Initial QA-only preference cache eviction caused failed preference requests; changing the isolated preview cache retention removed those failures. Production preference behavior was not modified.

The actual application entry `/workspaces/direct-check` was also opened in a clean browser context and redirected to the real Login page. Authenticated live API reload behavior still needs #111 and an authorized test account. New task/index Markdown links were checked: 83 targets exist.

## API handoff: P2-02 / #111

`features/workspaces/api.ts` defines a **frontend gateway interface**, not speculative backend DTOs. The default adapter is explicitly unavailable and has no HTTP paths. `types.ts` contains presentation models using existing shared Workspace type/role enums. Do not treat these models as the approved wire contract.

Before enabling the production adapter, verify the backend owner's exact routes, envelopes, validation, pagination, ordering, visibility and error semantics, then map actual DTOs through `apiRequest`:

| Adapter operation             | Required verified backend behavior                                                                                                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list(token, signal)`         | Membership-only Personal/Team discovery; ID, name, nullable description, type, caller role; stable ordering/paging. No Board Guest-only entries.                                                                                                      |
| `overview(token, id, signal)` | Authorize Workspace membership; metadata, ACL-filtered visible Board count, nullable/withheld member count and bounded recent readable Boards. Return Board IDs/names, audited update timestamps and archive state without confidential member lists. |
| `createTeam(token, input)`    | Authenticated TEAM creation plus creator ADMIN, atomic and server-authoritative. Return confirmed identity; no client owner/role or Personal creation input.                                                                                          |

Issue #111 proposes `/api/workspaces` and `/api/workspaces/:id/overview`, but this checkout does not implement them. No probe requests or production fallback mock is made. The form's 100-character name and 1000-character description limits are provisional UI guardrails; reconcile them with the actual validators, trimming/optional/null semantics and error mapping before activation. Icon representation/upload and Workspace activity are not assumed.

Queries include user ID, auth generation and Workspace ID. Reads pass AbortSignal through `runAuthorized`, and protected views require a successful check after mounting. Any read failure hides old content; 403/404 additionally removes that Workspace from the directory and clears its cached Overview payload. `AuthProvider` already clears protected caches at session boundaries, rejects late credentials/responses and handles 401. Forms ignore late success after logout, account change or unmount. Tests cover those boundaries.

No Workspace realtime/revocation event contract exists here. P2-03/P2-04 must connect actual access-loss signals to cancellation/removal/invalidation under the scoped key factory; query refresh already handles denied access. This is not proof of server-side ACLs or instantaneous revocation delivery.

## Downstream route ownership

`workspaceSections(workspaceId)` is the single typed section inventory shared by the page and nested sidebar. `WorkspaceLayout` owns identity, breadcrumb, section navigation and a typed Outlet context (`useWorkspacePage`).

- #114 adds a real `boards` child route and then activates the Boards item and Recent Boards View all destination; it owns filters and Board creation.
- #117 adds the Members route/content and permitted invitation workflow before activating Members/Invite.
- #118 adds Settings route/content and authorized metadata editing before activating Settings/contextual management.
- Update the section/breadcrumb title when adding non-Overview child routes. No downstream placeholder content or route is registered in this pass.
- Retain existing Board/Card deep links; Workspace role never implies a private Board grant.

## Verification

| Command / check                                                                     | Result                                                                                                                        |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @kanban/frontend test -- src/features/workspaces/Workspace.test.tsx` | PASS: 23 tests                                                                                                                |
| Targeted Workspace + Board management/detail + Board Members tests                  | PASS: 74 tests after status-announcement fix                                                                                  |
| Targeted shell/session/Card navigation tests                                        | PASS; full-suite regression also covers these                                                                                 |
| `pnpm test`                                                                         | PASS: shared 7; frontend 826 in 92 files; backend 565 in 57 suites                                                            |
| `pnpm lint`                                                                         | PASS                                                                                                                          |
| `pnpm build`                                                                        | PASS; existing root `.env` NODE_ENV warning and frontend >500kB chunk warning remain                                          |
| `pnpm format:check`                                                                 | FAIL: 638 existing checkout files flagged; unchanged files reproduce LF-vs-CRLF formatting failures with `core.autocrlf=true` |
| Prettier check on all changed frontend files and task/evidence documentation        | PASS                                                                                                                          |
| Representative unchanged files with `--end-of-line auto`                            | PASS: CI workflow, Board service, README; their Git diff is empty                                                             |
| `git diff --check`                                                                  | PASS                                                                                                                          |
| Production output scan                                                              | No QA HTML, fixture credential, `qa-team` ID or fixture banner in `dist`                                                      |
| Browser QA                                                                          | Performed with isolated fixtures; evidence above                                                                              |
| PostgreSQL / live Workspace REST / deployment                                       | Not run: no backend/schema change; Workspace controller absent; deployment outside authorization                              |

The first full test run exposed seven Board/member announcement assertions because a status region existed inside the closed selector. Removing that unnecessary live region fixed the regression; the subsequent full run passed. No existing tests were weakened.

## Changed files and local Git delivery

Application shell changes: `apps/frontend/src/app/routes.tsx` and `app/layout/{AppShell,AuthenticatedLayout,NavDrawer,Sidebar}.tsx`. Typechecking includes the separate QA entry via `apps/frontend/tsconfig.json`.

New feature files under `apps/frontend/src/features/workspaces/`:

- `api.ts`, `types.ts`, `query-keys.ts`, `gateway-context.tsx`, `hooks.ts`, `navigation.ts`.
- `components/{CreateWorkspaceDialog,RecentWorkspaceBoards,WorkspaceActivity,WorkspaceIdentity,WorkspaceLayout,WorkspaceNavigation,WorkspaceSections,WorkspaceState,WorkspaceSummaryCards}.tsx`.
- `pages/{WorkspacesPage,WorkspaceOverviewPage}.tsx` and `Workspace.test.tsx`.

QA sources: `apps/frontend/qa/workspace.html` and `workspace.tsx`. Documentation: this record, task index, frontend architecture note, and the linked `docs/design/screens/implementation/workspace-shell-overview/` artifacts.

Eight meaningful local commits were authorized, in order:

1. `25e0d9b feat(workspace): add typed frontend workspace foundation`
2. `e84bc48 feat(router): introduce workspace routes and shared layouts`
3. `1b771cb feat(navigation): integrate workspace selector into app shell`
4. `171d8a4 feat(workspace): build workspace discovery and creation UI`
5. `7f39be5 feat(workspace): implement overview page visual composition`
6. `0b6b2c8 feat(workspace): refine responsive themes and accessibility`
7. `9a43cfd test(workspace): cover navigation states and session isolation`
8. `docs(workspace): document visual QA and API integration handoff` (this record/evidence commit).

No push, PR, merge or deploy. Remaining closure work: merge/verify #111's real contract, implement its frontend adapter, reconcile validators/permission fields, connect real access-loss invalidation, and run live authenticated/ACL/creation/reload tests plus populated visual QA with authorized real test data.

## P2-C06 Activity integration (2026-10-31)

The Overview Activity slot reads the persisted Workspace Activity endpoint and shows at most five recent rows. View all opens paginated history using server totals. The server filters rows and Board associations for the requesting member; the UI neither enriches them from other caches nor infers hidden activity. Actors omitted by the API receive a neutral label, unknown event types receive a generic label, and only a Board object returned by the API creates a link. The checked-in API uses `POLICY_UPDATED` and `BOARD_MOVED` (rather than the names in the initial handoff).

| State                               | Presentation                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| Loading or revalidating             | Loading status/skeleton; previously cached rows hidden                           |
| Ready, empty                        | Workspace-change empty message; View all disabled                                |
| Ready, populated                    | Recent rows and accessible history dialog with server pagination                 |
| Network error                       | Panel-level error and retry                                                      |
| Workspace 403/404 or session change | Existing Workspace revocation/session handling clears or isolates protected data |

Activity pages are scoped by user, session generation and Workspace and pass the query AbortSignal to the HTTP client. Existing Workspace resource invalidation covers workspace/member/settings/Board actions. Mount, focus and reconnect trigger revalidation; there is no new realtime event. A history page beyond the server's last page returns to the last available page.

Verification for this integration: focused component and Workspace adapter tests passed (30 tests); `pnpm lint` and `pnpm build` passed. `pnpm test` was interrupted after backend HTTP suites failed with sandbox loopback `EACCES`. Repository-wide `pnpm format:check` reported 670 existing checkout formatting issues. The follow-up below records additional browser and session/revocation checks. The local Node version (22.12.0) is below the repository requirement (22.13.0).

### Follow-up verification and privacy fixes

The fallback for an absent actor is now “Unknown user”, since a declined invitation can come from someone who was never a Workspace member. Activity pages use zero inactive cache retention, so leaving the page cancels in-flight reads and discards pages after their last observer is removed. The history trigger retains focusability while marked unavailable, allowing focus restoration even during refresh.

Focused tests exercise page selection, the shrinking-last-page case, retries, server-filtered ADMIN/MEMBER results, inaccessible Workspaces, cancellation on Workspace and account changes, stale responses, HTTP 401/403/404, realtime revocation, focus/reconnect and focus restoration. These tests use controlled HTTP responses; they do not replace the backend's database ACL integration tests.

Isolated browser fixture QA used the existing Workspace preview and intercepted Activity HTTP responses. The [results](../../design/screens/implementation/workspace-activity/qa-results.json) cover light/dark at 320, 375, 768, 1280 and 1440 px, with no document horizontal overflow and successful keyboard open/Escape/focus restoration. Accessible dialog tree snapshots and dialog screenshots are alongside the results; examples: [mobile dark](../../design/screens/implementation/workspace-activity/history-dark-375.png), [desktop light](../../design/screens/implementation/workspace-activity/light-1280.png). The screenshots contain isolated test fixtures, not production data.

Follow-up commands used the bundled Node 24 runtime. `pnpm lint`, `pnpm build`, and the focused Activity/Workspace/Board Activity tests passed. The full frontend run with `vitest run --maxWorkers=2` passed 104 files and 1,107 tests; the newest Activity-specific cases also passed in a separate focused run. The root `pnpm test` retry with loopback permission was stopped after concurrent frontend suites timed out. A separate backend run passed 71 suites and 748 tests but failed the BoardsModule bootstrap wrapper with `ETIMEDOUT`; the wrapper also timed out when rerun alone, so the backend suite is not recorded as a pass.

The underlying `node -r ts-node/register test/boards/boards-module.bootstrap.mjs` passed when run directly with loopback access; it verifies real Nest module wiring using a mock DataSource. This does not change the failed Jest wrapper result above.

Final checks: changed-file Prettier and `git diff --check` passed. A fresh repository-wide `pnpm format:check` still reports formatting differences in 667 unchanged checkout files; no repository-wide formatting was applied.

### Additional end-to-end ACL and interaction verification

The `test:workspace-api:database` suite passed against a disposable PostgreSQL 16 container bound to localhost; it created and dropped its own random database. A separate real Chrome → frontend → Nest HTTP → PostgreSQL run used four isolated test accounts and a PRIVATE Board. [Results](../../design/screens/implementation/workspace-activity/real-acl-qa.json): ADMIN saw the invitation event but not the ungranted PRIVATE Board; MEMBER saw the granted Board but not the invitation event; Board-only guest and outsider received 404 and no protected content. Test users and data existed only in the temporary database. The container and temporary database were removed after the run.

Additional [browser interaction results](../../design/screens/implementation/workspace-activity/interaction-qa.json) cover light/dark at 320, 375, 768, 1280, and 1440 px. Each run exercised summary retry, history retry, Tab to page 2 and Enter, Escape/focus restoration, and a 403 Workspace without an Activity request. Screenshots are stored alongside the results. The Workspace 403 scenarios and retry responses in this browser pass used the isolated preview fixture.

The previously timing-out BoardsModule Jest test passed in isolation with `TS_NODE_TRANSPILE_ONLY=true` using Node 24; `pnpm build` independently checks TypeScript. This does not retroactively turn earlier failed or interrupted test runs into passes.

Final root `pnpm test` passed with the bundled Node 24.22.1, `VITEST_MAX_WORKERS=2` and `TS_NODE_TRANSPILE_ONLY=true`: shared 7 tests, backend 72 suites/749 tests, and frontend 104 files/1,108 tests. `pnpm build` separately passed TypeScript checking. This successful run follows and does not overwrite the earlier timeout results above.

A repository-wide `pnpm exec prettier --check . --end-of-line auto` also passed on the Windows checkout. The standard `pnpm format:check` remains a failure on the existing CRLF/LF differences noted above; the repository configuration and unrelated files were not changed.
