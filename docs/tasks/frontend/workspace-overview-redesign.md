# Workspace Overview visual redesign

This frontend redesign follows the light/dark Workspace Overview mockup supplied
with the task. The [Workspace UX spec](../../design/post-mvp/workspace/ux-spec.md),
[base guidelines](../../design/design-guidelines.md),
[Post-MVP addendum](../../design/design-guidelines.post-mvp.md) and existing
API/access contracts remain authoritative for behavior and data.

## Implementation

- `WorkspaceIdentity` provides one shared indigo-tinted hero with the saved
  Workspace icon (or existing initial fallback), name, type, description and
  authorized metadata. Mobile descriptions are visually clamped, retaining the
  full text/title. The type badge remains visible when repeated type metadata
  is hidden on phones. Long names and breadcrumbs remain bounded.
- Team ADMIN users retain the existing Invite route, preserving Members query
  parameters. Personal and non-admin Workspaces have no invitation action.
  Overview's Create Board link appears only when `canCreateBoards` is true and
  opens the existing verified Boards creation flow. It is omitted from the
  hero on other sections, avoiding a duplicate Boards-page creation control.
- `WorkspaceSections` keeps the existing four routes, icons, `aria-current`
  behavior and keyboard focus. Narrow screens use a single horizontal strip;
  active and focused links scroll into view. Compact sidebar behavior remains.
- Two balanced summary cards show only `visibleBoardCount` and `memberCount`,
  with larger values, icon backgrounds and explanatory text. Missing values
  stay unavailable/loading, distinct from a server-provided numeric zero.
- Recent Boards and Activity use aligned panels, with Recent Boards slightly
  wider on desktop. Board rows have restrained hover/focus states, compact
  icons, relative dates, authorized counts and navigation arrows. A thin
  timeline connects semantic Activity markers; actor, action, related Board
  link and full timestamp remain real server values. History and pagination
  logic are unchanged.
- Scoped `workspace-overview.css` reuses existing semantic theme tokens. No
  fonts, dependencies, API endpoints, backend code or migrations were added.
  Small badge/active-tab text uses the stronger existing indigo text token;
  the type badge measures 5.49:1 in light mode. Primary fills and indicators
  retain Kanvexa's established accent.

The Overview adapter now retains the visibility already validated by
`mapWorkspaceBoard`; this is a frontend presentation field, not a wire-contract
change. Alternate gateways omitting that optional field show no visibility
indicator. No Board backgrounds, discovery controls, filters or Card UI changed.
Query keys, session checks, cancellation and access-revocation implementation
are unchanged.

## Reference fidelity and deliberate differences

| Reference element                                                      | Implemented state                                                                       |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Workspace hero, icon, badge, description and metadata                  | Available from the existing verified Overview                                           |
| Create Board                                                           | Available only under `canCreateBoards`, using the existing flow                         |
| Manage members button pictured on Personal Workspace                   | Excluded there; Team ADMIN uses the existing Invite action                              |
| Visible boards and Members metrics                                     | Available from the two authorized Overview fields                                       |
| Recent activity / last seven days metric                               | Excluded: no approved seven-day aggregate exists; pagination totals are not that metric |
| Recent Board privacy, archived state and member count                  | Available only when supplied; private member counts remain private                      |
| Activity timeline, Board link, View all and history pages              | Existing real functionality, with presentation changes only                             |
| Mock people, example Board names, annotation sidebar and extra metrics | Excluded from production UI; preview data exists only in the DEV fixture                |

The composition, density, primary accent, tinted surfaces and light/dark
hierarchy follow the supplied reference. Mobile panels stack; longer real feeds
grow naturally instead of hiding entries to match the illustration's two rows.
No unsupported Coming soon controls were added to this surface.

## Verification

- **Pass:** `$env:VITEST_MAX_WORKERS='2'; pnpm test`: **1,276 frontend tests**
  across 113 files, **889 backend tests** across 91 suites, **17 shared tests**.
- **Pass:** focused Workspace/API/Activity tests. The final core run included
  71 tests, including the new hero capability matrix, both missing metrics,
  the Overview-to-Board-creation flow and validated visibility mapping.
- **Pass:** `pnpm lint`; `pnpm build` (TypeScript + Vite and all workspaces).
  Vite's existing bundle-size and root `NODE_ENV` warnings remain outside scope.
- **Pass:** final focused Workspace/runtime and API route run: 45 tests.
- **Pass:** Prettier on all 17 task text files, task-record links, measured QA
  matrix assertions and `git diff --check`.
- **Fail, pre-existing:** `pnpm format:check` reports 1,009 unchanged files in
  this checkout. No task files appear in its warnings. Existing CRLF/formatting
  differences were left untouched.
- PostgreSQL integration, live backend/two-browser socket QA, CI and deployment
  checks were not run for this frontend-only change.

Real-browser QA used `/qa/workspace-polish.html?scenario=overview&route=...`,
which renders production routes with locally intercepted fixture data. The
fixture does not contact a backend. [Measured results](../../design/screens/implementation/workspace-overview-redesign/browser-qa.json)
cover **20 combinations** of Personal/Team, light/dark and **320, 375, 768,
1280 and 1440px**: no page/main horizontal overflow, one hero, two metrics and
one navigation row. Sixteen additional cases cover Member, read-only, empty,
loading, error, denied, long content and Activity failure at 320 and 1440px.
Unavailable services and missing/private metrics are also covered by the
automated tests. Boards, Members and Settings were checked at 320 and 1280px
for a single shared header, active navigation and no duplicate hero Create
Board action. Activity history opens and closes with focus restored. Automated
tests retain refresh/reconnect, session change, Workspace/Board revocation,
403/404 cancellation and late-response coverage.

All screenshots were visually inspected against the supplied reference:

| Workspace | Desktop light / dark (1440 × 900)                                                                                                                                                                         | Mobile light / dark (375 × 812)                                                                                                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Personal  | [Light](../../design/screens/implementation/workspace-overview-redesign/personal-desktop-light.webp) / [Dark](../../design/screens/implementation/workspace-overview-redesign/personal-desktop-dark.webp) | [Light](../../design/screens/implementation/workspace-overview-redesign/personal-mobile-light.webp) / [Dark](../../design/screens/implementation/workspace-overview-redesign/personal-mobile-dark.webp) |
| Team      | [Light](../../design/screens/implementation/workspace-overview-redesign/team-desktop-light.webp) / [Dark](../../design/screens/implementation/workspace-overview-redesign/team-desktop-dark.webp)         | [Light](../../design/screens/implementation/workspace-overview-redesign/team-mobile-light.webp) / [Dark](../../design/screens/implementation/workspace-overview-redesign/team-mobile-dark.webp)         |

Scrolled mobile panels: [Personal light](../../design/screens/implementation/workspace-overview-redesign/personal-mobile-light-panels.webp),
[Team dark](../../design/screens/implementation/workspace-overview-redesign/team-mobile-dark-panels.webp).

## Manual QA with authorized server data

1. Open a Personal Overview and a Team Overview as ADMIN and MEMBER. Confirm
   identity, counts, Board metadata and the two supported statistics. Verify
   Personal has no Invite action and policy-denied creation has no hero CTA.
2. Use Create Board from Overview, wait for verification, create a Board, and
   confirm the normal Board route. Follow Invite as a Team ADMIN; confirm it
   opens the existing Members dialog. Check role/access loss disables writes.
3. Switch Overview/Boards/Members/Settings, including direct URLs and reload.
   Confirm one hero, correct breadcrumbs/current tab and reachable controls.
4. Open Recent Boards and Activity Board links. Open history, change pages,
   refresh, close with Escape and check focus restoration. Revoke access from
   another session and verify stale names, rows and pending responses disappear.
5. Check both themes at the five widths, including long names/descriptions,
   missing counts, empty boards, loading and request failures. Scroll the mobile
   tab strip with keyboard/touch and inspect the stacked lower panels.
