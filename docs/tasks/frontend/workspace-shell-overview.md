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
