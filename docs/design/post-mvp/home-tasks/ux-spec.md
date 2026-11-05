# Kanvexa — Home Dashboard V2 & My Tasks V1 UX Specification

**Status:** Approved visual direction.  
**Home image:** [Approved Home Dashboard V2](approved-home-dashboard-v2.png),
provided and explicitly approved by the user for Issue #210 on 2026-11-05.
It replaces all earlier Home visual references, including layout, proportions,
gradients, colors, spacing and card styling. Only Home is redesigned; the
Sidebar, Header and all other pages remain unchanged.

**My Tasks image:** `approved-visual-reference-v1.png` (desktop/mobile collage;
Notifications/Settings panes are previews handled in the dedicated spec).

## 1. Home `/home`

- V2 composition: greeting/date, four summary cards, a dominant Up Next panel on
  the left, and Starred Boards/Recently Viewed stacked on the right. Match the
  approved purple accents, gradients, surfaces, borders, rounded cards and rhythm.
- Adapt to short laptops, tablet and mobile with readable content and reachable
  actions in both themes. Preserve existing pagination and accessible links.

- Personalized summary: assigned Card count, upcoming due count, Workspace count based on authorized data; **never fake statistics**.
- **Up Next:** prioritize overdue and due-soon assigned cards. Each row links directly to authorized Card permalink.
- **Starred Boards** and **Recently Viewed:** user-level lists, readable names, optional per-board art; avoid exposing hidden Private Boards through stale histories.
- No chart-heavy analytics, fake productivity metrics or suggested Pro upgrades.
- Greeting personalization optional, without leaking identity information to other viewers.

## 2. My Tasks `/my-tasks`

- Source of truth: active Card assignments whose Board current user is allowed to access. Cross-board results are queried via backend ACL and paginated appropriately.
- Default visible groups: Overdue, Next 7 Days, Later, No Due Date; timezone-aware grouping and explicit due statuses.
- Filters: workspace, board, label and date window; sorting: due date, recently changed, board.
- Each task lists title, Board/Workspace, assignee context, due badge; click opens Card permalink.
- Archived Cards/Boards excluded from active task view unless later explicit Archived view is scoped.
- **No independent task-complete checkbox**. Do not infer Completed merely because its Column text says Done. The mockup checkbox is a presentation artifact, not a guaranteed action.
- Respect loading/empty/permission loss states, especially Card revoked during viewing.

## 3. Responsive design

- Desktop: Home grid with summary cards, prominent task feed and two secondary Board collections. My Tasks full readable task list with quick segmented filters.
- Mobile: stack sections, compact task rows, accessible filters/drawer and anchored header. Use approved App Shell mobile drawer; mockup bottom tab navigation is **not** automatically adopted.
- Dates adapt to locale/preferences; avoid truncating the only accessible item label.

## 4. Interaction details

- `View all` links go to real destination routes after feature launch; before launch omit them.
- Star/unstar updates user preference across sidebar, Home and Board list without ghost entries.
- Recently viewed tracks authorized page views, not background fetching; stale entries are cleaned up/rechecked on open.
- Interactive filters reflect URL/search state for back/forward and can be reset without lost context.
- Up Next must not automatically toggle Card state on checklist-like UI visible in the screenshot.

## 5. Acceptance checks

- Zero tasks/zero boards/new user, large data and revoked boards display safely.
- Same authorized Card results between My Tasks and Board view, with correct due-day boundaries across timezones.
- Screen reader navigates sections, list counts and actionable links; mobile touch targets and dialogs usable.
- No false completion behavior, phantom counts, mock demo names/metrics or `Upgrade to Pro` UI.
