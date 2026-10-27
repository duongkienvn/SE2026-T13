# App Shell V2 and responsive navigation (P1-04) — Issue #91

## Scope and integration

The authenticated frame now follows the approved App Shell V2 composition
([visual reference](../../design/post-mvp/app-shell/approved-visual-reference-v1.png),
[UX spec](../../design/post-mvp/app-shell/ux-spec.md)) on desktop, tablet and
phone. It is a frontend-only change: no API, migration, dependency or shared
contract was added, and the Kanban drag-and-drop, card detail, auth session,
realtime and REST client code are unchanged. `RequireAuth` and
`AuthenticatedLayout` still own the guards and the board context, and the public
landing route `/` stays outside the shell.

Work was done on `feat/app-shell-v2`, branched from `main` at `93a3b13`
(includes the P1-03 card permalinks).

This record supersedes the sidebar inventory described in
[Sidebar navigation and board creation UX](app-navigation-board-ux.md) (#81);
that record is kept as history.

## Approved decisions

The issue's **visual-first, functionality-progressive** decision applies: approved
shell slots without a shipped feature are shown as disabled “Soon” status, never as
links, buttons, routes, popovers, badges or shortcuts. This is the approved
issue-specific exception to the older “hide unimplemented navigation” wording in the
blueprint and the App Shell UX spec; it covers only noninteractive shell slots.

Clarified with the product owner before implementation (2026-10-27):

| Question                     | Decision                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| PERSONAL items               | Home, My Tasks, Boards, Starred as listed in the issue. Notifications appears only as the header bell slot, not again in the sidebar. |
| Sidebar “Board members” item | Removed. Members stays board-contextual: the Board page's Members button and the header breadcrumb.                                   |
| Header “+ Create” button     | Omitted: not in the issue inventory, and Create Board already lives on `/boards`.                                                     |
| Tablet (768–1023px)          | Compact icon rail plus a header menu that opens the full drawer. Phones (< 768px) use the drawer only.                                |

## Navigation model

`app/layout/navigation.ts` describes the shell as typed groups. Each item has a
stable `id`, label, icon and explicit `availability`; only `available` items have a
`path`, which the type system enforces. `findActiveNavItemId` picks the most
specific available item for the current route, so Boards stays active on board,
members and card routes.

To activate a slot when its feature ships, give it a `path` and mark it
`available` after the real page, API and authorization behavior are verified. The
sidebar, drawer and active-state logic need no other change.

| Slot                    | Availability          | Rendering                                                                                           |
| ----------------------- | --------------------- | --------------------------------------------------------------------------------------------------- |
| Boards                  | Available (`/boards`) | `<Link>` with `aria-current="page"` when active                                                     |
| Home, My Tasks, Starred | Soon                  | Muted, unfocusable list item with a “Soon” badge, a `title` and screen-reader text “…, coming soon” |
| Workspaces group        | Soon                  | Heading, “Workspaces are coming soon.” and a Create Workspace Soon row; no Workspace rows           |
| Workspace switcher      | Soon                  | Static “Workspace / Coming soon” card; no name, menu or plan badge                                  |
| Search                  | Soon                  | Field-shaped static slot (not an input), “Soon” badge, no Ctrl/Cmd+K                                |
| Notifications           | Soon                  | Static bell, no unread badge or popover                                                             |
| Account                 | Available             | Header avatar menu (Profile, Log out), unchanged; also in the mobile drawer                         |

Soon items are deliberately not focusable, so keyboard users never land on a dead
control. Their status remains available to screen readers as text.

## Layout by viewport

| Width      | Shell                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ≥ 1024px   | 256px sidebar (brand, workspace slot, PERSONAL, WORKSPACES, collapse control) or a 64px collapsed rail. The preference persists in `kanvexa.sidebar.expanded`. |
| 768–1023px | 64px rail (no collapse control) plus the header menu button for the full drawer                                                                                |
| < 768px    | No rail. Header shows the menu button, the logo, a compact search icon, the bell and the avatar                                                                |

Header: white bar with a bottom border, `Boards › Board name` breadcrumb inside a
board, the Search slot, the bell and the account menu. The board name is still
hidden as soon as access is lost or revalidation fails (`useVerifiedBoard` and the
member-list refusal check are unchanged).

## Mobile drawer and accessibility

`NavDrawer` renders the same groups as the sidebar (`SidebarNavContent`) in a
modal `role="dialog"` named “Navigation menu”, with Profile and Log out at the
bottom (`AccountLinks`).

- The menu button exposes `aria-haspopup`, `aria-expanded` and `aria-controls`.
- Opening moves focus to Close. Tab and Shift+Tab are trapped, and focus returns
  to the menu button on close.
- The drawer closes on Escape, the backdrop, the Close button, any navigation
  (link, Back or Forward) and when the viewport reaches desktop width.
- While it is open, `#root` is `inert` and body scroll is locked.
- All drawer targets are 44px. On short phones (`short:` variant, height ≤ 640px)
  the name/email row is hidden so the whole drawer fits 320×568 without inner
  scrolling. The avatar remains in the header.
- The slide-in uses `motion-safe:`, so reduced-motion users get no animation.

`Dialog`'s focus trap, Escape, `inert`, scroll lock and focus restore moved
unchanged into the shared `hooks/useModalFocus.ts`, used by both components.

## Visual parity matrix

Compared against `approved-visual-reference-v1.png` (desktop home, board view,
tablet and mobile drawer panels).

| Reference element                                       | Status                    | Implementation and differences                                                                                                     |
| ------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Kanvexa logo and wordmark, top of sidebar               | Available                 | Official `BrandLogo` plus wordmark; on phones the logo moves to the header                                                         |
| Workspace switcher card (“Development Team”, Free Plan) | Soon                      | Same position and card shape. Generic “Workspace / Coming soon”; no team name, plan or chevron                                     |
| Home, My Tasks                                          | Soon                      | Same order and icons, muted with a Soon badge                                                                                      |
| Notifications (sidebar)                                 | Excluded from the sidebar | Decision above; the header bell slot covers it                                                                                     |
| Boards                                                  | Available                 | Added to PERSONAL (issue inventory); pill active state in primary indigo                                                           |
| Starred                                                 | Soon                      | Added to PERSONAL (issue inventory)                                                                                                |
| Workspaces heading with rows and Create Workspace       | Soon                      | Heading, empty-state text and Create Workspace Soon row. No sample rows. Static heading (no collapse chevron, nothing to collapse) |
| Upgrade to Pro panel, Free Plan badges                  | Excluded                  | Not rendered on any breakpoint (spec §5); the space stays empty                                                                    |
| Header search with Ctrl K                               | Soon                      | Same position and shape; no shortcut hint                                                                                          |
| Header “+ Create”                                       | Deferred                  | Omitted by decision                                                                                                                |
| Bell with red unread dot                                | Soon                      | Bell only, no badge                                                                                                                |
| Avatar                                                  | Available                 | Existing account menu                                                                                                              |
| Board breadcrumb (workspace › board)                    | Available                 | `Boards › Board name`; there is no workspace level yet                                                                             |
| Board-level actions (Share, Filter, Group, star)        | Out of scope              | Board page content, not shell; unchanged                                                                                           |
| Tablet rail                                             | Available                 | Icons for workspace slot, Personal items and Create Workspace, with tooltips                                                       |
| Mobile drawer with user, nav, Settings and Log out      | Available/Soon            | Same hierarchy; account block at the bottom. Settings is omitted until P1-05 (#92) ships the page                                  |
| Dark-mode sidebar panel                                 | Deferred                  | P1-05; layout uses semantic tokens only                                                                                            |
| Collapse control                                        | Available                 | Not pictured; kept from MVP at the bottom of the desktop sidebar                                                                   |

## States covered

| State                                                                | Result                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Desktop expanded / collapsed                                         | Labels with Soon badges / icon rail with `title` and screen-reader labels; preference persists across refresh and routes |
| Board, members, card routes                                          | Boards active, breadcrumb shown after verification                                                                       |
| Revoked or missing board (403/404, cached data, member-list refusal) | No board name or link in the header                                                                                      |
| Session loading or expired                                           | Existing guards; the shell is not rendered before the user loads                                                         |
| Narrow and short content                                             | No page scroll or horizontal overflow; the Kanban board keeps its intentional horizontal scroll                          |

## Evidence

Screenshots are in
[`docs/design/screens/implementation/app-shell-v2/`](../../design/screens/implementation/app-shell-v2/).
They were taken in Chrome against the Vite dev server, with API responses mocked by
Playwright routes (Docker was not running), so board data is placeholder QA data.

| File                                                                                                                                    | Shows                                   |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `expanded-boards-1280x720.png`, `expanded-boards-1920x945.png`                                                                          | Desktop sidebar and header on `/boards` |
| `expanded-board-1366x657.png`                                                                                                           | Breadcrumb on a board                   |
| `collapsed-board-1280x720.png`                                                                                                          | Collapsed 64px rail                     |
| `mobile-boards-768x1024.png`, `drawer-768x1024.png`                                                                                     | Tablet rail and drawer                  |
| `mobile-boards-320x568.png`, `mobile-boards-375x812.png`, `mobile-boards-390x844.png`, `mobile-board-375x812.png`, `drawer-390x844.png` | Phone header and drawer                 |

Measured in the browser:

- No horizontal overflow and no page or `main` scroll on `/boards`, a board, and
  members at 320×568, 375×812, 390×844, 768×1024, 1024×768, 1280×600, 1280×720,
  1366×657, 1536×730 and 1920×945.
- No truncated sidebar labels at 1280px.
- Drawer from 320×568 to 1023×600: no inner scroll, smallest target 44px, body
  locked, `#root` inert, focus on Close and restored to the menu button after
  Escape.

## Tests and checks

New or updated tests cover:

- the nav inventory and the rule that only available items have routes;
- active-route mapping;
- Soon items not being focusable or links;
- the workspace slot without an invented name or plan;
- header slots with no input, badge or shortcut;
- the board breadcrumb, and its removal on revocation;
- the drawer: dialog semantics, focus trap and restore, Escape, backdrop, Close,
  navigation including Back/Forward, closing at desktop width, scroll lock;
- Profile and Log out from the drawer;
- the existing Card permalink test at 375px.

Each new behavior was mutation-checked: breaking it made at least one test fail.

| Check                                                 | Result                                                                                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                           | Pass                                                                                                                             |
| `pnpm build`                                          | Pass                                                                                                                             |
| Frontend tests (`vitest run`)                         | 693/693 pass (3 consecutive runs)                                                                                                |
| Backend tests                                         | 541/541 pass                                                                                                                     |
| `packages/shared` test                                | Fails with `ERR_MODULE_NOT_FOUND` (Node 24 `.js` specifier). It fails the same way on `main`, so it is not caused by this change |
| `prettier --check --end-of-line auto` (changed files) | Pass. Plain `format:check` reports CRLF false positives on this Windows checkout                                                 |
| `git diff --check`                                    | Pass                                                                                                                             |

During development, a few full-suite runs failed one or two board or card page
tests. A different test failed each time, and each passed alone. Three later
consecutive full runs passed on both this branch and `main`. The cause was not
confirmed; the failures coincided with the dev server and browser QA running in
parallel.

## Deferred

- Home, My Tasks, Starred, Workspaces (rows, switcher, create), Search palette and
  Notification Center keep their Soon slots until their workstreams ship.
- Account Settings link in the avatar menu and drawer: P1-05 (#92).
- Dark mode: P1-05.
- Brand link to the Landing Page: #102.
