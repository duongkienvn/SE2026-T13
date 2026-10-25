# Kanvexa — App Shell V2 UX Specification

**Status:** Approved visual direction, with one explicit modification: remove all `Upgrade to Pro` / `Free Plan` UI.  
**Image:** `approved-visual-reference-v1.png`.

## 1. Scope

Authenticated application frame for every Post-MVP page: brand/header, navigation, Workspace switcher/group, contextual content and responsive behavior. Reuse current `AppShell`, `AppHeader`, `Sidebar`, `AuthenticatedLayout`, routing and existing Kanvexa branding instead of a new layout stack.

## 2. Desktop composition

- Preserve a light lavender/gray outer frame and rounded, subtle-shadow app shell. Sidebar white/surface panel, header white, content near-white. Body with Inter, ink navy and primary indigo `#615CF7`.
- Sidebar sections: **PERSONAL** → Home, My Tasks, Starred Boards; **WORKSPACES** → expandable list of available workspaces and sublinks Overview, Boards, Members, Settings; explicit Create Workspace action once supported.
- Workspace list can scroll independently or inside sidebar without hiding fixed branding/account controls. Current Workspace and current page have unambiguous active states.
- Top header: global Search with Ctrl/Cmd+K, Notifications bell with unread count, avatar/account menu; responsive contextual breadcrumbs.
- Contextual Board tabs and actions live in the Board page, not as duplicates in global Sidebar.
- At collapse, icons retain accessible tooltip and label; selecting a Workspace without available context does not open a broken route.

## 3. Mobile and tablet

- Mobile: top header with brand/menu and compact Search/Bell/Avatar affordances, **drawer-based hierarchy** for Personal/Workspaces; backdrop, focus management, Esc close and body-scroll locking as appropriate.
- Tablet: choose collapsible rail or drawer based on actual fit; content remains the priority. Responsive Board horizontal scroll should not cause global overflow.
- Preserve feature context when opening and closing drawer; accessible 44px-ish touch targets and visible focus.

## 4. Interaction and persistence

| Action/state | Behavior |
|---|---|
| Sidebar expand/collapse | User-controlled, restore prior preference without layout flash |
| Workspace group expand/collapse | Independent remembered state when feasible; available workspaces only |
| Header search | Opens accessible, keyboard-first search palette once CX-04 exists |
| Bell | Popover with unread state; full page via `/notifications`, once CX-01 exists |
| Avatar | Profile, Account Settings, Logout; no payment/account-plan items |
| Inaccessible Workspace/Board | Remove stale protected titles/links from shell, invalidate data |
| Unimplemented new feature | No fake clickable link, no generic 'coming soon' masquerading as functionality |
| Offline/realtime disconnect | Show consistent non-blocking state and safe reconnect behavior |

## 5. Explicit exclusions

The reference collage depicts an upsell area and `Free Plan` badges; **these are categorically removed on every breakpoint and theme**. The freed area remains whitespace or reserved for meaningful user navigation, *not* another promotion. Keep official Kanvexa logo rather than stylized mockup artwork. Do not add Billing, Pricing or Pro links.

## 6. Acceptance checks

- Active route correct across nested Workspace/Board pages and back/forward.
- Header/Sidebar consistent on Home, Board, Card deep link, Workspace and Settings.
- Works at 375px phone, 768px tablet, 1280px laptop and full desktop.
- Keyboard navigation, focus order/restore, aria-current, labels and reduced motion.
- Neither `/boards` nor `/profile` existing bookmarked routes break.
- No pricing/upsell text visible in UI or nav definitions.
