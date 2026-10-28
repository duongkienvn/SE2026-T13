# Workspace Boards UI V1 — P2-07 (#114)

Implementation and local QA record, 2026-10-28. This records the checkout, not a
deployment or release claim. The visual foundation is complete; live Workspace
Board browsing and creation remain blocked by #111. No backend, schema, shared
wire contracts, dependencies, remotes, or deployment settings changed.

## Scope and references

- [Issue #114](https://github.com/duongkienvn/SE2026-T13/issues/114), including the
  user's visual-first decisions and eight-local-commit instruction.
- [Workspace Shell #113 record](workspace-shell-overview.md).
- [Roadmap](../../roadmap/post-mvp.md),
  [blueprint](../../design/product-ux-blueprint.md),
  [visual register](../../design/post-mvp/visual-reference-register.md), and
  [Workspace UX spec](../../design/post-mvp/workspace/ux-spec.md).
- [Approved Workspace reference](../../design/post-mvp/workspace/approved-visual-reference-v1.png),
  top-right Boards screen. Approved text, branding, access and scope overrides
  govern pictured sample data and future features.

## Implementation and availability

The real `/workspaces/:workspaceId/boards` child route uses #113's
`WorkspaceLayout`, identity query, breadcrumb, section navigation, sidebar and
mobile drawer. Overview's View all leads here. Workspace switching preserves the
Boards section; Back/Forward works. Existing `/boards/:boardId` navigation is
reused. Members, Settings and Invite retain their existing Soon state.

| Reference element                           | State and implementation                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Workspace shell and active Boards tab       | Available route; existing shell and brand reused                                                     |
| Boards title, subtitle and Create Board CTA | Complete visual slot; creation capability gated                                                      |
| All Boards / Archived                       | Server capability gated; no local production filtering                                               |
| Recent / Starred                            | Static Soon slots; no persistence, navigation or callbacks                                           |
| Search, sort                                | Capability gated; URL state and server query seam                                                    |
| Filter                                      | Static advanced-filter Soon slot                                                                     |
| Grid / List                                 | Grid selected; List static Soon                                                                      |
| Three-column desktop cards                  | Responsive one/two/three columns at 640/1280px                                                       |
| Card preview                                | Uniform semantic-token preview with Board icon; no invented saved backgrounds                        |
| Private and archived labels                 | Authorized metadata only; archived marked read-only                                                  |
| Star on card                                | Static Soon badge outside the link; no accidental Board navigation                                   |
| Member metadata                             | Authorized count only; unavailable text when absent; no secondary member fetch or fabricated avatars |
| Board name and update date                  | Returned metadata, safe wrapping and full accessible link name                                       |
| Archive / Restore                           | Existing REST client, confirmation dialog, Board OWNER plus explicit capability                      |
| Pagination and totals                       | Server page/total metadata; unavailable slot without service support                                 |
| Create dialog                               | Existing `BoardForm` reused, Workspace and Private context, validation and failure retention         |
| Loading, empty, no matches, failure         | Styled grid skeleton, distinct empty states and retry                                                |
| Forbidden / not found / expired session     | Protected data removed, established shared access/session states                                     |
| Billing, Upgrade, subscriptions             | Excluded                                                                                             |

The create form trims names, normalizes optional descriptions, reuses the existing
120/2000-character validation, guards duplicate submissions, and disables fields
while saving. It navigates only after an actual confirmed response belonging to
the current session, Workspace and mounted route. No unscoped `/boards` creation
fallback is used: that existing request cannot select a Team Workspace.

## API boundary and permissions

`boards/gateway.tsx` defaults to unavailable and contains no guessed HTTP paths.
The context is an integration seam, not a second data source. Its types are
frontend presentation models, not finalized #111 DTOs:

- `list(token, workspaceId, filters, signal)` returns items, total, page,
  pageCount and an explicit `canCreateBoard` capability.
- Item fields: id, name, nullable description and updatedAt, isArchived,
  visibility, currentUserRole, canArchive, canRestore and nullable memberCount.
- `create(token, workspaceId, CreateBoardRequest)` returns a confirmed Board id.
- Search, status, supported sorts and pagination have individual feature flags.
- Browser URL parameters `q`, `status`, `sort`, `page` describe local navigation;
  they do not prescribe backend query parameter names. Search is limited to 120
  characters and debounced for 300ms; unsupported URL filters are ignored.
- React Router receives synchronous URL input commits through the DOM
  `flushSync` integration. Browser QA reproduced lost fast-typed characters with
  deferred navigation; the final regression checks every incoming character.

Only `PRIVATE` Boards and direct `OWNER`/`MEMBER` Board roles are accepted. Runtime
checks fail closed if a future `WORKSPACE_VISIBLE` or unsupported role response
arrives before #115. A Workspace `ADMIN` role never grants private Board access,
archive/restore or creation. These UI checks supplement server authorization.

Actual existing integration uses `archiveBoard` and `restoreBoard` from the Board
client (`POST /boards/:id/archive` and `/restore`). The UI requires both Board
OWNER and the corresponding explicit server capability. Controlled network tests
exercise these paths, successful invalidation, forbidden responses and read-only
states. Live writes were not performed: the default Workspace gateway cannot
yet supply verified records and the visual QA gateway disables mutations.

## Session, query and revocation behavior

Workspace identity, Overview and all Board filter variants share a resource
prefix scoped by authenticated user, session generation and Workspace id. Query
functions use the existing authorized runner and AbortSignal. Workspace/account
switches cancel stale requests; prior result cards are hidden during filter
changes. Creation and action completion check session ownership before touching
caches or navigating.

Workspace 403/404 revokes the identity, directory row, Overview and every Board
filter cache. Denied Board archive/restore invokes existing Board cache/access
revocation, cancels Workspace Board and Overview requests, removes all Board list
payloads, clears Overview recent Boards and its count, then revalidates Overview.
This prevents private recent names surviving a rejected action. Global Board
list caches are invalidated after successful mutations; session reset uses the
existing AuthProvider boundary. No socket or persistent business rules changed.

## Browser QA and design comparison

Chrome DevTools exercised the actual shared components at 320, 375, 390, 768,
1280 and 1920px in Light, Dark and Match System (dark OS emulation). Phone captures
are 812px high, tablet 1024px, desktop 1080px. System was also changed dark → light
without reload at 390px; `data-theme` followed both changes. No document or main
horizontal overflow occurred at any measured width.

Evidence lives in
[`workspace-boards-ui/`](../../design/screens/implementation/workspace-boards-ui/):

- [Reference comparison](../../design/screens/implementation/workspace-boards-ui/reference-comparison.png)
  and [responsive contact sheet](../../design/screens/implementation/workspace-boards-ui/responsive-contact-sheet.png).
- `boards-{light,dark,system}-{320,375,390,768,1280,1920}.png` captures all widths;
  `cards-{light,dark}-{320,375,390}.png` shows the scrolled mobile grid.
- [Create validation](../../design/screens/implementation/workspace-boards-ui/create-validation-dark-390.png),
  [create error](../../design/screens/implementation/workspace-boards-ui/create-error-dark-390.png),
  [unavailable create](../../design/screens/implementation/workspace-boards-ui/create-unavailable-light-320.png),
  [long names](../../design/screens/implementation/workspace-boards-ui/long-system-320.png),
  [page two](../../design/screens/implementation/workspace-boards-ui/many-page-2-light-1280.png),
  [no matches](../../design/screens/implementation/workspace-boards-ui/no-matches-system-390.png).
- Loading, empty, error, forbidden, not-found, unavailable, no-permission and
  archived captures are named for their scenario, theme and width.
- [Measurements and interaction results](../../design/screens/implementation/workspace-boards-ui/qa-results.json).

The hierarchy, sidebar/header, selected navigation, indigo CTA, toolbar, cards,
private chips, borders and spacing follow the approved composition. The #113
Workspace header remains above the Boards page, so the page is taller than the
single reference panel. Mobile wraps the status controls into two columns and
stacks toolbar rows; the card grid continues below the fold with intentional
main scrolling. Preview tiles remain neutral because no persisted background
contract exists. Counts and membership details are never invented to copy a
mockup. These are deliberate scope/access differences, not missing future slots.

Keyboard checks covered labelled inputs, validation focusing Board name, drawer
Tab containment, Escape dismissal and focus restoration. Create failures retain
the draft and do not show saved success. Browser search and Next page exercised
the isolated query seam; Soon elements have no interactive semantics or routes.
Final browser console checks reported no warnings/errors after the search fix.
Automated tests additionally cover create success and archive/restore network
contracts, stale completion, account switching and access revocation.

`apps/frontend/qa/workspace-boards.html` and `.tsx` form a separate DEV-only entry,
never imported by production. A visible fixture banner identifies all sample
records. The QA create adapter always rejects and never saves; its Board action
capabilities are false. The production default never returns sample records.
The production build is scanned for QA HTML and fixture markers.

## Verification

Results are local and do not imply CI or deployment verification.

| Check                                                                                                        | Result                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Focused Workspace, shell, Board management and Card navigation regression selection                          | PASS, 9 files / 97 tests before final fast-typing regression                                                                             |
| `pnpm --filter @kanban/frontend test src/features/workspaces/boards/WorkspaceBoards.test.tsx --maxWorkers=2` | PASS, 29 tests including fast typing                                                                                                     |
| `pnpm lint`                                                                                                  | PASS                                                                                                                                     |
| `pnpm build`                                                                                                 | PASS; existing NODE_ENV configuration and Vite chunk-size warnings                                                                       |
| `pnpm test` (default worker count)                                                                           | FAIL, latest run: 5 frontend files / 8 tests failed, 846 passed; mostly five-second timeouts, plus transient duplicate Register alerts   |
| `pnpm --filter @kanban/frontend test --maxWorkers=2`                                                         | PASS, 93 files / 855 tests; focused 29 passed again after the callback return-type correction                                            |
| `pnpm --filter @kanban/backend test`                                                                         | PASS, 57 suites / 565 tests                                                                                                              |
| `pnpm --filter @kanban/shared test`                                                                          | PASS, 7 tests                                                                                                                            |
| `pnpm format:check`                                                                                          | FAIL, existing Windows CRLF baseline: 654 files in final run (656 before formatting intended App/index edits); unrelated files preserved |
| Changed-file Prettier check                                                                                  | PASS                                                                                                                                     |
| `git diff --check`, documentation links, QA production isolation                                             | PASS                                                                                                                                     |
| PostgreSQL, infrastructure and live Workspace API tests                                                      | Not run: no related backend/infrastructure change; #111 API absent                                                                       |

The bounded frontend run covers existing Board/Card/App Shell/Account Settings
tests as well as Workspace tests. Default full-suite failures varied between
runs under high worker concurrency; all frontend tests passed with two workers.
This is evidence of local resource sensitivity, not a claimed default-root pass.
No global timeout, worker setting or unrelated test was changed.

## Handoff and remaining acceptance

1. **#111:** finalize actual Workspace identity/Board list/create REST paths and
   DTOs; implement a production gateway mapping to the presentation models.
   Confirm server-owned private defaults, creator ownership, policy-derived
   creation permission, authorized counts, search/status/sort semantics, stable
   page ordering and pagination metadata. Reconcile field validation against the
   final DTOs and test with real Workspace membership and Board records. Do not
   enable feature flags until those capabilities are verified.
2. **#115:** enforce visibility and resource authorization server-side, including
   REST/socket isolation and access loss. Only then extend this UI's private-only
   types and runtime guards to WORKSPACE_VISIBLE. Never infer Board permission
   from Workspace ADMIN.
3. **#118:** Workspace Settings creation/visibility policies must refresh
   capabilities and invalidate this Workspace resource prefix and identity.
   Do not enable a create dialog from cached permission after policy revocation.
4. **#116 Board Move:** source and destination Workspace resource prefixes plus
   global Board lists must invalidate after confirmed movement; preserve direct
   Board links and session/access checks. No Move controls are implemented here.
5. Re-run live list/create/archive/restore, membership/policy revocation and
   browser integration QA after those contracts land. Resolve the default-worker
   environment and repository line-ending gate before claiming all root gates
   green. Visual completion does not close these functional dependencies.

## Git and changed-file inventory

Branch: `feat/workspace-boards-ui`. Started from the user's existing `d2e2118`
merge of #113, whose content equals the preserved #113 tip `e22dc5b` on
`feat/workspace-shell-overview`. The eight #113 commits were not rebased, squashed
or amended. Eight new #114 commits are counted from `d2e2118`; the pre-existing
merge is not counted as new task work.

| #   | Commit                              | Purpose                                                               |
| --- | ----------------------------------- | --------------------------------------------------------------------- |
| 1   | `e3cae9e`                           | Route and query foundation                                            |
| 2   | `0e61361`                           | Cards and grid                                                        |
| 3   | `8e41fcf`                           | Search and filters                                                    |
| 4   | `b277b61`                           | Workspace create dialog                                               |
| 5   | `a7866cd`                           | Board navigation and archive states                                   |
| 6   | `70a238a`                           | Responsive themes and accessibility                                   |
| 7   | `9b81e3b`                           | State/session tests and revocation fix                                |
| 8   | Final commit containing this record | Browser-found search input fix, regression and visual/backend handoff |

Changed application files, relative to the repository root:

- `apps/frontend/src/App.tsx`, `apps/frontend/src/app/routes.tsx`: router DOM flush integration and
  Boards child route.
- `apps/frontend/src/components/SearchField.tsx`: disabled and description support.
- `apps/frontend/src/features/boards/components/BoardFormDialog.tsx`: shared form
  export, unavailable state and duplicate-submit guard.
- `apps/frontend/src/features/workspaces/boards/`: `types.ts`, `gateway.tsx`,
  `hooks.ts`, `useBoardFilters.ts`, `WorkspaceBoardCard.tsx`,
  `WorkspaceBoardGrid.tsx`, `WorkspaceBoardsToolbar.tsx`,
  `CreateWorkspaceBoardDialog.tsx`, `WorkspaceBoardActions.tsx`,
  `WorkspaceBoards.test.tsx`.
- `apps/frontend/src/features/workspaces/pages/WorkspaceBoardsPage.tsx`.
- `apps/frontend/src/features/workspaces/components/`: `WorkspaceLayout.tsx`,
  `WorkspaceNavigation.tsx`, `RecentWorkspaceBoards.tsx`.
- `apps/frontend/src/features/workspaces/`: `navigation.ts`, `query-keys.ts`,
  `hooks.ts`, `revoke-workspace-access.ts`, `Workspace.test.tsx`.
- `apps/frontend/qa/workspace-boards.html`, `workspace-boards.tsx`: isolated QA.
- This record, `docs/tasks/README.md`, and the implementation evidence directory.

No push, PR, merge or deployment was performed. The final report records the
eighth hash and final clean-tree audit after the documentation commit.
