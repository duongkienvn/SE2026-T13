# Kanvexa — Product & UX Blueprint V1

**Status:** Approved product interaction/architecture decisions (2026-10-25).  
**Applies to:** Post-MVP application; the existing MVP stays functional during phased rollout.  
**Related:** `../roadmap/post-mvp.md` and `post-mvp/*/ux-spec.md`.

## 1. Product intent, principles and boundary

Kanvexa remains a real-time collaborative Kanban application, expanded into a secure multi-workspace productivity product. It must retain the existing brand and avoid a generic admin-console redesign. The approved visual direction is clean, minimal, spacious, responsive, and based on indigo `#615CF7`, light lavender framing, near-white surfaces, deep navy text and Inter.

**Principles**

1. Reuse existing working Board/Column/Card/realtime/auth components where possible. No rewrite for visual novelty.
2. Workspace membership and Board membership are distinct; viewer/read-only access is **not** edit permission.
3. Screens should display meaningful, permission-filtered, real data; no interactive dummy controls or fake analytics.
4. Show only implemented navigation and supported actions. Disabled-for-permission and not-yet-built states are not interchangeable.
5. Keyboard, screen reader, responsive layout, empty/error/offline and permission-loss states are part of every feature's UX contract.
6. No pricing, trial tiers, Free Plan, Pro upgrade banner, subscription or ads.

## 2. Approved App Navigation V2

### Information architecture

```text
Kanvexa (authenticated)
├── Home                         /home
├── My Tasks                     /my-tasks
├── Starred Boards               /boards?view=starred (illustrative route; finalize in issue)
├── Workspaces                   /workspaces
│   └── {Workspace}              /workspaces/:workspaceId
│       ├── Overview             /workspaces/:workspaceId
│       ├── Boards               /workspaces/:workspaceId/boards
│       ├── Members              /workspaces/:workspaceId/members
│       └── Settings             /workspaces/:workspaceId/settings
├── Board                        /boards/:boardId (preserved)
│   ├── Kanban view
│   ├── Members                   /boards/:boardId/members (preserved)
│   ├── Activity                 contextual panel/dialog
│   ├── Board Settings           /boards/:boardId/settings (proposed)
│   └── Card                     /boards/:boardId/cards/:cardId
└── Account Settings             /settings/*
    ├── Profile                  /settings/profile
    ├── Appearance               /settings/appearance
    ├── Notifications            /settings/notifications
    ├── Preferences              /settings/preferences
    ├── Security                 /settings/security
    ├── Connected Accounts       /settings/connections
    └── Data & Privacy           /settings/data

Header (global): Search/Ctrl+K, Notification bell, Avatar/Account menu.
Global notifications: /notifications.
Public landing: / (per existing approved K3 design).
```

**Routing rules:** `/boards`, `/boards/:boardId`, `/boards/:boardId/members`, `/profile` stay working during rollout. After account settings launch, `/profile` may redirect to `/settings/profile`. Route choices marked illustrative are finalized before implementation. Card links must support reload, direct access and browser back/forward, never require earlier navigation state.

### Navigation behavior

- Desktop: collapsible sidebar with user-specific Personal (Home, My Tasks, Starred Boards) and expandable Workspaces section; workspace sub-items Overview, Boards, Members, Settings.
- Header: Search, Notifications, Avatar menu; contextual breadcrumb Workspace → Board.
- Mobile: accessible drawer for hierarchical navigation, compact header for search/bell/account. The approved mockups sometimes depict a bottom tab bar; **do not treat it as replacing the drawer without a new UX decision**.
- Expanded/collapsed state is remembered; workspace selection and recent navigation should preserve context when practical.
- Current/expanded/hover/focus states are visually distinct; hide unauthorized actions and enforce actual authorization server-side.
- No inert coming-soon links presented as usable buttons.

## 3. Workspace domain and migration decisions

- Each user can create/join multiple workspaces. A Workspace holds many Boards. A Board belongs to **exactly one Workspace**.
- Personal Workspace exists (created automatically when needed). Team Workspaces support multiple Workspace Members.
- Workspace roles: `ADMIN` and `MEMBER`; keep existing Board roles `OWNER` and `MEMBER` independently.
- Guests are not Workspace role: a Guest is a user with Board membership but no membership in its containing Workspace.
- Workspace ADMIN can manage membership/policies but does **not** automatically gain visibility of PRIVATE Boards.
- Workspace default is private; new Board visibility defaults to `PRIVATE`.
- Board `WORKSPACE_VISIBLE` gives Workspace members view access by default; mutations still require Board membership.
- Public anonymous Boards and multi-Workspace Board membership are deferred.

### Permission matrix (proposed baseline)

| Actor/context                          | PRIVATE Board read | WORKSPACE_VISIBLE Board read | Edit card/column/comment        | Board settings/owner ops                       | Workspace settings      |
| -------------------------------------- | ------------------ | ---------------------------- | ------------------------------- | ---------------------------------------------- | ----------------------- |
| Board OWNER                            | Yes                | Yes                          | Yes when active                 | Yes subject to legacy creator/last-owner rules | Only if Workspace ADMIN |
| Board MEMBER                           | Yes                | Yes                          | Yes when active                 | Limited; owner-only ops not allowed            | Only if Workspace ADMIN |
| Workspace ADMIN, **not** Board member  | **No**             | Yes, read-only               | No                              | No privileged Board operations by default      | Yes                     |
| Workspace MEMBER, **not** Board member | No                 | Yes, read-only               | No                              | No                                             | No                      |
| Board Guest with Board membership      | Yes                | Yes                          | Yes, per Board role when active | Per Board role                                 | No                      |
| Unrelated or unauthenticated user      | No                 | No                           | No                              | No                                             | No                      |

**Extra access rules:** Archived Board is read-only to anyone otherwise authorized; only permitted Board OWNER can restore. Archived Card is read-only until authorized restore on active Board. Workspace-visible read-only users cannot comment, assign, move, drag, change checklist or mutate attachments. Aggregate/search/notifications/export must use the same authoritative access policy. Existing OWNER/MEMBER behavior must not be silently widened.

### Invitations & management

- Workspace Admin can issue invitation by email; invitee can register/login and accept.
- Invitation token: cryptographically random, hashed at rest, single-use, expiry, revocation, target-email binding and replay prevention. Respect rate limiting and do not leak account existence.
- Board-specific invitations/guests are supported as scoped flows; removing someone from Workspace does not silently grant continued Workspace access through Board routes. Retain valid Board Guest access only where explicitly intended.
- Workspace Members can create Boards by default; Workspace Admin manages Workspace member invitations/roles and policy. Board invitations allowed to authorized Board OWNER subject to Workspace policy.
- Prevent zero-admin Workspace; prevent deleting Workspace with remaining boards. Archive/delete of Board follows explicit Board semantics, not cascading Workspace deletion.
- Board move requires owner permission plus destination Workspace policy; preserve data and default PRIVATE if needed to avoid widening read rights. Evaluate Board Guests and pending invites; audit the move.

### Legacy data migration

- Existing Board IDs, Columns, Cards, Comments, assignees, Activities, archived states and role memberships preserved.
- Create Personal Workspace for each relevant legacy Board creator; assign old Boards there while keeping them `PRIVATE`.
- Existing collaborators remain Board Members, possibly **guests** in creator's Personal Workspace, not automatically Workspace Members.
- Plan expand → backfill → verify → constrain schema migration, backups and reversible recovery. Test authorization and Socket.IO revocation before/after.
- No release assumes a one-click destructive rollback for migrated production data.

## 4. Workspace experience

Four primary screens: Overview (visible boards, eligible counts/recent context), Boards (search/filter/favorite/archived), Members (ADMIN/MEMBER/Guests/Pending invites), Settings (General, Members & Invitations, Permissions, Danger Zone). Show Workspace name/icon/description and breadcrumb. Admin-only management controls; mobile stacked layout and accessible member-management actions. A user who only has read-only Board visibility never receives edit-only CTAs.

## 5. Board UX V2

- Header: breadcrumb, board title, favorite star, visibility chip, presence, share/members and overflow menu. Preserve Kanban viewport and existing drag/drop.
- Menu: About, Activity, Archived Cards, Change Background, Board Settings and owner-only Archive. Avoid overflow of actions across header.
- Board Filter (within board) is distinct from Global Search. It filters cards, not columns, with clear/reset and shareable query params; supports text, labels, assignees and due-state.
- Previews stay compact: title, labels, brief description, due badge, checklist progress, counts and assignees. Avoid excessive controls.
- Board has read-only UX for archived or non-Board-member Workspace-visible views. Realtime access revocation must shut down affected updates and invalidate cached protected data.
- Additional views (Calendar/Table) appear in navigation **only when real implementation is delivered**.

## 6. Card UX V2

- Desktop Card Detail: wide dialog or route-linked overlay, main content + metadata/actions side column. Mobile: full-screen, scrollable, one-column layout.
- Main content: title, description with draft/save/cancel, checklists with atomic saves, attachments with auth-checked preview, comments with @mention after collaboration delivery.
- Side/context: assignees, labels, dates, relevant quick actions; archived card status and authorized Restore.
- Card actions: Duplicate, Copy Link, Archive/Restore. No implicit hard Delete or arbitrary cross-board move.
- Card permalink `/boards/:boardId/cards/:cardId`: deep-link load, refresh, close-to-board behavior; preserve scroll/filter when possible. Unauthorized/missing Card yields safe empty/error state without leaking information.
- Concurrent updates: never silently overwrite a user's unsaved form draft. Detect remote edits, use conflict/refresh UI or merge-safe field-level updates; mutations follow existing realtime contracts.

## 7. Personal productivity UX

### Home — `/home`

User-specific Overview (e.g. assigned/due soon/workspaces), Up Next with overdue and upcoming cards, Starred Boards and Recently Viewed. Show real counters only, not demo analytics. Prioritize tasks requiring attention; skip unsupported claims like tracking hours or productivity scores. Respect Board membership/Workspace-visible content boundaries.

### My Tasks — `/my-tasks`

Include active Cards assigned to current user across authorized Boards; groups: Overdue, Next 7 Days, Later, No Due Date. Filters: Workspace, Board, Labels, date; sorting by due date/recent updates/board. Click card → permalink. **Do not equate a Column titled `Done` with an authoritative completion status**. A mockup checkbox is decorative unless a separately approved Task completion model exists.

### Search

Global Ctrl/Cmd+K palette groups Workspace/Board/Card results, supports arrow keys, Enter, Escape, keyboard focus restore, recent items and empty/loading/error; no titles from inaccessible private boards. Board Filter remains its own contextual control.

## 8. Notifications and preferences

- Header bell popover for recent/unread; `/notifications` full page with All/Unread, dates, mark-read, view-all.
- Initial triggers: assignment, @mention, due reminder, Workspace/Board invitation, significant membership/access change.
- Do **not** default-spam all card moves or text updates; optional category toggles can be added after event semantics are established.
- Persist recipient-specific records and unread state; push realtime to authorized user channel with no leakage. Delivery must be idempotent/deduplicated where practical.
- A user opening a notification to a now-inaccessible Card sees an access-safe error; notifications never embed sensitive contents after access revocation without policy.
- Email preferences and in-app preferences separated; mandatory account/security email cannot be disabled by turning off task notifications.
- Deadline reminders run server-side scheduling, not solely in an open tab. Timezone/daylight-saving logic belongs to backend design.

## 9. Account settings, identity & security

Desktop account settings: left-side sections Profile, Appearance, Notifications, Preferences, Security, Connected Accounts, Data & Privacy. Mobile: top-level list → detail. `/settings` redirects to profile. Existing `/profile` and Google linked identity flows must continue to function.

- Profile: display name, existing avatar URL and verified email state; change email uses verified new address. Upload avatar/bio is not automatic scope from screenshot.
- Appearance: Light/Dark/Match System, persistent per-account choice, OS-match detection, no flash on reload; adequate focus/text/icon contrast.
- Preferences: language only when full translations exist, IANA timezone, date format, first day of week; consistent date rendering.
- Security: password change, reset, Google-only set-password flow, rate limits, reauthentication for sensitive changes, safe token lifecycle.
- Sessions/Devices: show and remotely revoke only if backend has session/token identity and revocation; current stateless JWT `/logout` alone cannot guarantee log-out-other-devices.
- Data/Privacy: authorized personal/Board export; account delete workflow handles board/workspace ownership, explicit confirmation and policy on retention; no unsafe cascade deletion.

## 10. State model, responsive and accessibility rules

For each screen, design: loading, empty, error/retry, unauthorized, archived/read-only, saving/success, optimistic/realtime conflict, offline/disconnect and small viewport behavior. Shared notification, dialog, popover, keyboard and focus patterns should be consistent. Aim WCAG 2.2 AA: proper labels, 44px-class touch targets where practical, keyboard activation, visible focus, semantic sections, contrast tested in both themes, reduced motion and responsive overflow.

Breakpoints are implementation decisions, but target QA includes 375×812 mobile, 768×1024 tablet, 1280×800 laptop and ~1440 desktop, in Light and Dark where applicable. Horizontal Kanban scrolling is intentional; entire page should not overflow sideways accidentally. No fixed-height modal that hides essential actions on short screens.

## 11. Cross-document behavioral non-goals

Mockup artifacts do not expand scope. Specifically: `Upgrade to Pro` / `Free Plan` / pricing **forbidden**; `Delete Card`, `Group`, a completion checkbox on My Tasks, Card Priority, arbitrary move-to-another-Board, Card Cover as guaranteed deliverable, Profile Bio, Avatar Upload and cross-device Logout are not automatically required merely because pictured. Features may be approved separately via future changes; current docs hold the prior decisions constant.

## 12. Review contract

For each phase, require feature-specific acceptance criteria, visual comparison evidence against matching mockup plus text exception notes, security/ACL/migration test plan, mobile/keyboard QA and reviewer approval. UI documents cannot replace implementation tests, and a successful UI build cannot substitute authorization proof.
