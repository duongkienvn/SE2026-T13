# Board Navigation & Settings UX Polish

Kanban, Members and Board Settings now share the Board detail shell. The
Members URL is a child route with the same verified Board/Workspace context,
title, presence, overflow menu and primary navigation. Only the selected
content mounts: Members and Settings do not mount Kanban or load its columns
and cards. Board realtime synchronization remains in the parent, so switching
these routes retains one room subscription. Card permalink routing is unchanged.

The shared `BoardNavigation` uses ordinary links with `aria-current="page"` and
a single horizontally scrollable row. Route changes and keyboard focus reveal
the relevant link on small screens. The header keeps the overflow button beside
the title; very long titles and descriptions are limited to two visual lines,
with their full text retained. Mobile breadcrumbs use the same authorized
Workspace directory context as desktop; Guest access never implies Workspace
membership.

`BoardSettings` presents label/value rows, an intentional empty-description
state, an Active/Archived badge, concise visibility guidance, policy-aware
actions and a bordered Danger zone. Edit Board is contextual to General;
visibility and move stay in Permissions; Archive/Restore stay in Danger zone
with the existing confirmation dialogs. Members remains a primary destination
and has no duplicate Settings section. General, Permissions and Danger zone
form a single column, capped at 48rem, without a secondary section navigation.
Semantic tokens support both themes.

The overflow menu now contains only Archived cards and Copy board link. Copy
success appears only after clipboard completion; unavailable or rejected
clipboard access exposes a selectable canonical Board link. Activity remains
in the primary navigation.

Edit Board preserves drafts on cancelled navigation and closes the editor when
discarding a draft to navigate. A matching refetch/realtime update during a
pending save no longer produces a false remote-conflict warning. Different
incoming values still produce the warning and keep the draft intact.

## Scope and references

This focused brief supersedes the longer menu and redundant Members settings
section in the older [Board/Card V2 spec](../../design/post-mvp/board-card/ux-spec.md),
[blueprint](../../design/product-ux-blueprint.md) and BD-03 roadmap wording.
Brand, spacing and themes follow the [base guidelines](../../design/design-guidelines.md)
and [Post-MVP addendum](../../design/design-guidelines.post-mvp.md).

| Element                                                     | Availability and placement                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Kanban, Members, Activity, Settings                         | Available in the shared Board navigation; Members requires Board membership            |
| General and visibility metadata                             | Available from verified, authorized data; inaccessible Workspace identity stays hidden |
| Edit, visibility, move, archive, restore                    | Available only under the existing role/capability/archive/policy rules                 |
| Archived cards and copy link                                | Available in overflow, including read-only Board access                                |
| Settings Members shortcut and configuration menu duplicates | Removed by this brief                                                                  |
| Background customization, favorites and discovery           | Deferred to P3-12; misleading background placeholder removed                           |
| Filtering, Card Preview and Card Detail V2                  | Excluded from this change; no Card implementation modified                             |

No dependencies, backend APIs, domain contracts, migrations, realtime contracts
or Workspace navigation behavior outside the Board context changed.

## Verification

- **Pass:** `pnpm lint`.
- **Pass:** `pnpm build` (shared, Nest/TypeScript, frontend TypeScript and Vite).
  Vite reports the existing large-bundle and root `NODE_ENV` configuration
  warnings; they are outside this task.
- **Pass:** `$env:VITEST_MAX_WORKERS='2'; pnpm test`: frontend **113 files / 1,270
  tests**, backend **91 suites / 889 tests**, shared **17 tests**. This includes
  the focused Board Detail, Members and navigation regressions, Card permalinks,
  access loss and realtime suites.
- **Pass:** `pnpm exec prettier --check <all 14 changed text files>`, local
  task-record link/path checks and `git diff --check`.
- **Fail, pre-existing:** `pnpm format:check` reports 1,009 unchanged files.
  The checkout uses `core.autocrlf=true`; a sampled affected file is LF in Git
  and CRLF on disk, and its committed LF content passes Prettier. None of the
  reported files belongs to this change. No repository-wide rewrite was made.
- The initial default-concurrency test run hit frontend timeouts. Validation
  uses `$env:VITEST_MAX_WORKERS='2'; pnpm test`. Workspace builds and tests must
  run sequentially because both rebuild shared output.

Browser QA used the isolated DEV-only fixture at
`/qa/board-owner-actions.html?scenario=workspace-owner`, with `&settings=true`
or `&route=members`, and `&theme=dark` when needed. It renders the production
components with locally intercepted API fixtures, never a real backend.
All three routes were checked at **320, 375, 768, 1280 and 1440px**, in both
themes: no page/main horizontal overflow, one primary navigation row and the
correct active link. Keyboard Tab/Enter navigation, focused-link scrolling,
menu bounds/Escape/focus restoration, long titles, viewer/member/archived
controls and policy-denied visibility were also checked. Console inspection
found no errors or warnings; the fixture made no real API network requests.

Screenshots were captured and visually inspected:

| Surface         | Desktop (1440 × 900)                                                                                           | Mobile (375 × 812)                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Settings, light | [Screenshot](../../design/screens/implementation/board-navigation-settings-polish/settings-desktop-light.webp) | [Screenshot](../../design/screens/implementation/board-navigation-settings-polish/settings-mobile-light.webp) |
| Settings, dark  | [Screenshot](../../design/screens/implementation/board-navigation-settings-polish/settings-desktop-dark.webp)  | [Screenshot](../../design/screens/implementation/board-navigation-settings-polish/settings-mobile-dark.webp)  |
| Members, light  | [Screenshot](../../design/screens/implementation/board-navigation-settings-polish/members-desktop-light.webp)  | [Screenshot](../../design/screens/implementation/board-navigation-settings-polish/members-mobile-light.webp)  |
| Members, dark   | [Screenshot](../../design/screens/implementation/board-navigation-settings-polish/members-desktop-dark.webp)   | [Screenshot](../../design/screens/implementation/board-navigation-settings-polish/members-mobile-dark.webp)   |

[Mobile Permissions and Danger zone](../../design/screens/implementation/board-navigation-settings-polish/settings-mobile-dark-actions.webp)
shows the lower settings content after scrolling. The fixture's connecting
presence label is expected; actual socket subscription/access behavior is
covered by automated tests. Live backend/two-browser realtime QA and deployment
verification were not run. Database integration checks are not applicable to
this frontend-only change.

## PR #180 follow-up: Activity CI race and simpler Settings

The [failed CI run](https://github.com/duongkienvn/SE2026-T13/actions/runs/41438716283)
reported the HTTP 404 Activity cancellation test finding `Authorized summary`
after invalidation. A single local Activity integration run passed all 15 tests.
Repeating the two cancellation cases with `--repeats=99` reproduced the exact
assertion **10 times across 200 executions**, affecting **both 403 and 404**.
An unbounded full frontend run also completed, with eight other failures under
load; this Activity assertion did not fail in that particular run.

Temporary diagnostics at the failing assertion confirmed the summary and history
cache entries were already `null` with `status: error`, and the history request's
AbortSignal was already aborted. The transport mock deliberately ignores aborts,
so its late reply also exercises TanStack Query's cancelled-retryer protection.
`useWorkspaceActivity` handles 403/404 identically through
`revokeWorkspaceAccess`/`denyWorkspaceQueries`: cancel siblings, clear all scoped
Workspace resources, remove its directory entry, and leave other Workspaces
alone. The originating failed query is exempt from self-cancellation.

TanStack Query's `notifyManager.batchCalls` schedules React observer updates
using the default `setTimeout(callback, 0)`. Awaiting `invalidateQueries` and
async `act` does not guarantee that scheduled notification has rendered. This
was a DOM assertion race, with no evidence of a persistent access-revocation bug.
The test now asserts cache clearing, error status and request abortion **before**
resolving late history, then uses `waitFor` for DOM removal. The post-reply cache
and other-Workspace isolation checks remain. No production authorization,
cancellation, cache or notification behavior changed; no sleeps, retries or
longer test timeouts were introduced. The fixed 403/404 cases each passed 100
executions with the same `--repeats=99` command.

Settings' redundant section links were removed at every breakpoint. The three
panels align in one constrained column; their semantic headings/IDs, actions,
primary Board navigation and permission rules remain. The existing navigation
regression now asserts the secondary navigation is absent. Updated Settings
screenshots above were inspected in both themes; the single-column layout,
active primary tab and absence of page overflow were verified at all five widths.

## Manual QA on real authorized data

1. Open `/boards/:boardId`, then Members → Board settings → Kanban. Confirm the
   Board identity, Workspace breadcrumb and active destination remain correct.
   Open each URL directly and reload it; also open a Card permalink.
2. On Members, search by name/email, clear search, change numbered pages and
   exercise Add member, role changes and removal as an authorized owner. Verify
   archived and MEMBER Boards offer no membership management actions.
3. On Settings, edit metadata, cancel draft navigation, then confirm discard.
   Save and verify there is no false remote warning. Check real remote conflicts,
   policy refusal and access loss. Archive through confirmation, verify return
   to Boards, reopen archived Settings and restore while staying on Settings.
4. At the listed widths in both themes, navigate via keyboard, scroll the tab
   strip and settings content, and open overflow. Confirm only the two actions
   appear, copy feedback is accurate and no controls clip or overflow the page.
