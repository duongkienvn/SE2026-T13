# Kanvexa Mobile — Design System & UI/UX Specification

> **Document:** `KANVEXA_MOBILE_DESIGN_SPEC.md`\
> **Version:** 1.0 — approved mobile visual baseline\
> **Date:** 2026-11-07\
> **Product:** Kanvexa Mobile (Android + iOS)\
> **Status:** The **10 primary screen groups and visual direction** were approved by the product owner in conversation. The behavioral, API-alignment, accessibility and implementation rules below are the proposed implementation specification; they do not imply that every illustrative control in the images is already backed by an API.\
> **Audience:** Product owner, UI implementers, Codex, code reviewers and QA.\
> **Scope:** One complete Kanvexa product on Web and Mobile. **No separate Mobile MVP/Post-MVP split.** Delivery phases may exist for engineering coordination, not to redefine feature completeness.

---

## 0. How to use this document

This is an implementation-facing source of truth, not a list of optional UI ideas.

**Precedence in a conflict:**

1. **Security, permissions, data integrity, and actual backend/API contracts** win over everything. The server is authoritative.
2. **Already approved mobile mockups in `assets/`** govern the visual language, compositions, relative density and major interaction surfaces.
3. **This document** resolves intended navigation, interactive behavior, screen states, accessibility, tokens and mobile adaptations.
4. **Current Kanvexa Web** governs existing business capabilities and nomenclature when a mockup shows fictional data, an unsupported switch, or a feature that has changed since the image was generated.
5. If a genuine conflict remains, **record the discrepancy and obtain owner approval** before changing the design or adding an API. Never silently invent backend capabilities or show decorative, non-working buttons.

**Implementation contract for Codex:**

- Follow the approved visual references closely; do not creatively redesign screens, change spacing/density wholesale, replace the logo, recolor the app, add banners or promotional elements, or alter already polished Kanvexa Web pages.
- Reuse the production backend and `@kanban/shared` contracts where compatible with React Native. Do not fork business entities or keep a second independent copy of server state.
- Check the latest `main`, `AGENTS.md`, the existing Web implementation, contracts, security behavior and tests **before** implementing each feature. This spec is dated; later merged functionality overrides historical descriptions of API availability.
- The product owner approves meaningful changes to navigation, feature scope, behavior, primary visual treatments and screenshot baselines. Small layout adjustments for accessibility, safe areas, localization, small screens and Android/iOS conventions are allowed when they preserve intent.
- Keep prototype values, fictional names, avatars, dates and counts **out of production data**. Real text, roles, counts and actions come from the server.

### 0.1 Reference assets (included in the companion Design Pack ZIP)

| Group               | Approved image                                                                               | What is authoritative                                                          |
| ------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 01 · Home           | [`assets/01-home-dashboard.png`](assets/01-home-dashboard.png)                               | Home header, greeting, summary cards, Up Next, board previews, 4-tab shell     |
| 02 · Boards         | [`assets/02-boards-and-workspace-switcher.png`](assets/02-boards-and-workspace-switcher.png) | Workspace selector bottom sheet, starred board tiles, board list               |
| 03 · Board Detail   | [`assets/03-board-detail-and-filters.png`](assets/03-board-detail-and-filters.png)           | Compact horizontal Kanban columns, previews, filters, floating Add             |
| 04 · Card Detail    | [`assets/04-card-detail.png`](assets/04-card-detail.png)                                     | Full-screen single-column detail, scrolling content, sticky actions            |
| 05 · My Tasks       | [`assets/05-my-tasks.png`](assets/05-my-tasks.png)                                           | Grouped tasks, filter sheet, board grouping                                    |
| 06 · Inbox          | [`assets/06-inbox-and-preferences.png`](assets/06-inbox-and-preferences.png)                 | All/Unread states, notification rows, preferences layout                       |
| 07 · Search         | [`assets/07-global-search.png`](assets/07-global-search.png)                                 | Full-screen search, result groups, filtering composition                       |
| 08 · Calendar       | [`assets/08-calendar.png`](assets/08-calendar.png)                                           | Month/Week layout, selected-day tasks, filters                                 |
| 09 · Authentication | [`assets/09-authentication.png`](assets/09-authentication.png)                               | Login, registration, recovery, email verification                              |
| 10 · Settings       | [`assets/10-profile-and-settings.png`](assets/10-profile-and-settings.png)                   | Profile, edit profile, security, data/privacy                                  |
| Brand               | [`assets/kanvexa-logo-v1.png`](assets/kanvexa-logo-v1.png)                                   | **Official logo uploaded by owner**; replaces every generated placeholder logo |

The other Board menu/Create Card sketches in the conversation were **not** substituted for the approved Card Detail reference. The actual Card Detail design is `04-card-detail.png`.

**Asset usage:** Keep the logo's transparency, aspect ratio and gradient intact. Do not redraw it as generic stacked squares. The ZIP preserves the original owner-provided logo. The mockups are pixel references, not exported Figma components or a complete sprite/icon set; implement UI natively rather than slicing screenshots.

---

## 1. Product design principles

1. **Same product, mobile-native usage:** Full functional parity with _supported_ Kanvexa Web capabilities; layout and controls are optimized for touch instead of mimicking desktop.
2. **Calm professional SaaS:** Light, airy, neutral surfaces; navy text; restrained indigo/violet emphasis; teal/blue only where semantically useful or native to the official logo.
3. **Content first:** Work items, due dates, collaborators and boards are the focus. Avoid decorative charts, huge illustrations and repeated marketing banners in authenticated screens.
4. **One clear primary action:** A screen may have many tools, but one obvious CTA. Destructive actions remain intentionally separate.
5. **Progressive disclosure:** Compact cards and lists at the overview layer; dense metadata in detail views, bottom sheets, contextual menus and filters.
6. **Continuous hierarchy:** Brand header → screen heading → active view/filter controls → prioritized content → contextual actions.
7. **Readability at real phone sizes:** No clipped headings, cut-off actions, inaccessible pills or nested scrolling traps.
8. **Honest UI:** Never claim a mutation succeeded, a notification was delivered, a timer/reminder is enabled, or another person is online without authoritative confirmation.
9. **Safe collaboration:** Permissions, realtime updates, access revocation and unsaved edits matter as much as the appearance.
10. **One design system:** Home, Boards, Tasks, Inbox, Auth and Settings must feel built by the same product team.

### 1.1 Language and copy

- Baseline mockups are **English**. Reuse the existing Kanvexa English product terms: _Workspace, Board, Column/List, Card, My Tasks, Inbox, Calendar, Table, Labels, Members, Activity_.
- Preserve accessible, plain-language labels. Do not introduce English/Vietnamese hybrids within one localized view.
- Use real user display names and board names, not the sample people/emails in mockups.
- Short informative empty states are preferred to slogans. Error messages must offer recovery when safe.
- Label dates relative to the user's selected timezone and date preferences, with absolute date accessible on demand.

---

## 2. Design tokens

These tokens describe an **implementation baseline** extracted from approved visual direction and the known existing Kanvexa primary color. They are not an assertion that every pixel in a generated image matches the numerical value. Define them centrally and use semantic aliases. Match screens to reference images, then adjust only within this token family.

### 2.1 Core palette (light)

| Token                  | Value                   | Usage                                                                                  |
| ---------------------- | ----------------------- | -------------------------------------------------------------------------------------- |
| `brand.primary`        | `#615CF7`               | Primary CTA fill, active tab, focus and important links; match established Web primary |
| `brand.primaryPressed` | `#4F46E5`               | Pressed/stronger interactive state                                                     |
| `brand.primaryTint`    | `#F0EEFF`               | Selected rows, icon tile, quiet emphasis                                               |
| `brand.primaryBorder`  | `#DCD9FF`               | Selected outlines, outlined buttons                                                    |
| `brand.logo`           | Original provided asset | Official blue→teal→indigo gradient; **do not replace with generic purple icon**        |
| `bg.app`               | `#F8F9FE`               | Main screen background                                                                 |
| `bg.surface`           | `#FFFFFF`               | Cards, list rows, modals                                                               |
| `bg.surfaceSoft`       | `#F5F5FC`               | Section grouping, filter fields and secondary surfaces                                 |
| `text.primary`         | `#171A35`               | Headings, important values                                                             |
| `text.secondary`       | `#5E6685`               | Supporting descriptions, board names, metadata                                         |
| `text.muted`           | `#858CA8`               | Subdued placeholders; verify contrast on actual background                             |
| `border.subtle`        | `#E5E7F0`               | Hairlines, field outlines and separators                                               |
| `status.success`       | `#109B81`               | Confirmed success, completed checklist, positive statuses                              |
| `status.warning`       | `#F59E0B`               | Due soon and attention states                                                          |
| `status.danger`        | `#EF4444`               | Overdue, errors and destructive actions                                                |
| `status.info`          | `#3B82F6`               | Information and neutral date states                                                    |
| `overlay.scrim`        | `rgba(15,20,48,0.48)`   | Dim background beneath sheets/dialogs                                                  |

- **Board label colors and background thumbnails are data-driven**. Use the canonical values sent by the API, not fixed designer-invented labels.
- Status colors always pair with an icon/word; never convey meaning by color alone.
- Do not indiscriminately apply the official logo's gradient to every button. Standard primary buttons are solid indigo; gradient is reserved for occasional approved emphasis.
- Web and Mobile theme preferences should follow the same account setting semantics. The **approved screenshots are light-mode baselines**; dark mode must use a semantic token mapping with equivalent hierarchy and contrast, not inverted screenshots.

### 2.2 Typography

- Preferred visual family: **Inter**, with native SF Pro on iOS and system/Roboto fallback on Android when appropriate. Do not assume font files are present or ship fonts without checking license and assets.
- Baseline scale (logical dp/pt at default accessibility text setting):

| Role                 | Size / weight   | Example                             |
| -------------------- | --------------- | ----------------------------------- |
| Display / greeting   | 26–28 / 700     | “Good morning”                      |
| Screen title         | 24–26 / 700     | “My Tasks”, “Boards”, “Inbox”       |
| Section title        | 17–19 / 650–700 | “Up next”, “Starred boards”         |
| Card title / key row | 14–16 / 600–700 | Card title, settings row label      |
| Body                 | 14–15 / 400–500 | Description, notification summary   |
| Supporting           | 12–13 / 400–500 | Workspace, timestamp, list metadata |
| Caption / badge      | 11–12 / 500–600 | Due chip, count, short status       |
| Numerical emphasis   | 24–30 / 700     | Task count, due soon                |

- Use comfortably generous line-height (roughly 1.25–1.45 depending on role). Wrap important text; avoid clipping with large Dynamic Type. Clamp low-priority preview snippets only.
- Use **tabular numerals** for counts and dates where possible.
- Never bake text into UI images. Use native text with selectable accessibility labels.

### 2.3 Spacing, radii and elevation

- Spacing scale: `4, 8, 12, 16, 20, 24, 32, 40` dp; **outer screen gutter 16–20 dp** (reference mockups visually land around this range).
- Major vertical group spacing: 20–28 dp. Within cards: 8–12 dp. Dense list rows: 10–14 dp.
- Corner radii: tiny `8`, controls `12–14`, cards `16–18`, large surface `20–24`, bottom sheet top corners `24–28`, fully rounded pills `999`.
- Shadows: subtle short soft shadows; do not create dark neumorphic borders or heavy floating surfaces. On Android use restrained elevation and ensure readable borders when elevation unavailable.
- Dividers: 1 physical pixel / hairline where possible. Prefer grouping and whitespace to over-dividing.
- Header touch targets, navigation icons and option buttons: minimum **44×44 pt iOS**, **48×48 dp Android** where practical. Text-field rows around 48–54 dp; primary CTA 48–54 dp.

### 2.4 Iconography, illustrations and avatars

- Use a consistent rounded stroke icon family, ~20–22 dp for regular actions, 16–18 dp for metadata, 22–24 dp in bottom tabs.
- **Official Kanvexa K** is a brand asset, not a standard content icon. Other board glyphs may use the app icon set.
- Default user avatar: small circular image; initials fallback when missing. Multi-user avatar stacks overlap subtly and have accessible count labels.
- Preset board backgrounds are thumbnails/headers obtained from actual Board configuration; preserve aspect ratio and provide graceful loading fallback.
- No decorative stock avatar portraits or fictitious board statistics in actual UI.

### 2.5 Components and states

Canonical reusable primitives should include:

`AppHeader`, `ScreenHeader`, `BottomTabs`, `PrimaryButton`, `SecondaryButton`, `IconButton`, `SearchField`, `TextField`, `PasswordField`, `SectionHeader`, `StatTile`, `BoardTile`, `BoardRow`, `CardPreview`, `TaskRow`, `NotificationRow`, `Avatar`, `AvatarStack`, `LabelChip`, `DueChip`, `StatusChip`, `SegmentedControl`, `FilterChip`, `ListRow`, `EmptyState`, `ErrorState`, `Skeleton`, `BottomSheet`, `ConfirmDialog`, `Snackbar`, `FormFooter`, `UnsavedChangesPrompt`.

Required state variants: default, hover (web previews only), pressed, focused, selected, checked, disabled, loading, success, validation error and unavailable/read-only where relevant. Do not build independent one-off pills/rows in each screen.

---

## 3. Navigation and application shell

### 3.1 Main tab structure (approved, fixed)

| Tab | Name         | Role                                         |
| --- | ------------ | -------------------------------------------- |
| 1   | **Home**     | Cross-Workspace dashboard and Up Next        |
| 2   | **My Tasks** | Assigned work across Boards                  |
| 3   | **Boards**   | Workspace switcher, favorites and all Boards |
| 4   | **Inbox**    | Notification center and unread badge         |

- Tabs retain labels and icons at all times, with active indigo icon/text and a quiet selected treatment. Unread badge on Inbox reflects server count; no fake number.
- Tab bar is **anchored to the bottom safe area**, never covering scrollable content or native system navigation.
- Tab changes retain sensible route/scroll/filter state per stack until logout or access change; no stale private data after identity change.
- Full-screen deep detail pages can hide bottom tabs to prioritize content; preserve Back to parent and system Back/interactive swipe behavior. The approved visual references show the tabs on primary views and no tabs in dedicated Search/Auth/Settings subpages.
- Global Search is a **full-screen pushed route**, not a fifth bottom tab. Calendar and Table are contextual Board views, not permanent bottom tabs.

### 3.2 Suggested route topology (conceptual, not an existing API)

```text
Root
├── Public/Auth Stack
│   ├── Sign In
│   ├── Sign Up
│   ├── Forgot Password / Reset Password
│   └── Verify Email / Email Verification Notice
└── Authenticated
    ├── Tabs
    │   ├── Home
    │   ├── My Tasks
    │   ├── Boards
    │   └── Inbox
    ├── Workspace → Workspace Detail / Members / Invitations
    ├── Board → Board Kanban | Board Table | Board Calendar
    │   ├── Card Detail
    │   ├── Board Members / Activity / Settings
    │   └── Board Filter / Create Card / More Actions sheets
    ├── Global Search → Workspace / Board / Card Detail
    ├── Account Settings
    │   ├── Profile / Edit Profile
    │   ├── Appearance / Preferences
    │   ├── Notifications
    │   ├── Security / Connected Accounts
    │   └── Data & Privacy
    └── Deep Link Dispatcher
```

Route names and file placement are an engineering decision during Expo Router setup. Do not hardcode public app URI schemes or assume Web `target.path` is already valid on native. Create a guarded mapping for **approved internal** Workspace/Board/Card destinations and reject malformed/external routes.

### 3.3 Header patterns

- **Primary tab screens:** top safe-area header with Kanvexa logo/wordmark on the left, Search trigger (where appropriate), avatar on the right; screen-specific heading below.
- **Board/Detail screens:** Back, compact K/logo, context title and subtitle, contextual action(s)/overflow. Do not repeat a huge marketing logo beside every Card title.
- **Auth screens:** ample white space, official logo with wordmark, minimal Back control when navigable, no tabs.
- **Sheets:** grabber, clear title, optional Reset/Close, content then safe-area-aware CTA.
- Screen can be scrolled without losing the ability to return or operate its primary contextual action.

### 3.4 Responsive and device treatment

- Design primary validation sizes: narrow phone (~320–360 dp), mainstream phone (~375–430 dp), large phone and tablet. The mockups target modern iPhone-like proportions; **Android must receive the same product, not a shrunk screenshot**.
- Respect safe area, notches, status bar, home indicator, Android gesture/3-button navigation and keyboard insets.
- Portrait is baseline. In landscape or tablets, use wider layouts/adaptive columns where justified; do not stretch cards into unreadably wide lines.
- Keyboard appears without covering password fields, Search inputs, comments, sheet CTAs or Save controls.
- Avoid horizontal scrolling everywhere except explicitly horizontal Kanban columns, tab/filter chip rows and optional date strips.
- No mandatory app-level landscape/portrait lock unless separately approved.

---

## 4. Screen specifications (10 approved groups)

### 4.1 Screen 01 — Home Dashboard

**Reference:** `assets/01-home-dashboard.png`\
**Entry:** Home tab, after valid session verification.\
**Purpose:** Immediate overview of work and fast navigation, **not** a replacement for My Tasks.

**Layout hierarchy:**

1. Header: official Kanvexa K + wordmark, short tagline, Search, current-user avatar.
2. Greeting: “Good morning/afternoon/evening” (local device/selected timezone as appropriate), one-line supporting copy.
3. Optional small feature banner only if it is a meaningful, approved product surface; the design image shows one variation with a “Stay on track” banner, another without. **Default to the simpler version without a permanently repeated decorative banner** to preserve useful vertical space.
4. Two prominent statistic tiles: `My tasks` and `Due soon`/upcoming. Counts from authenticated Home API only.
5. `Up next`: up to six due-dated assigned Cards; title, Board, relative due status, optional metadata; `View all` → My Tasks.
6. `Your boards`: compact starred/recent Board tiles/rows with backgrounds or small icons; `See all` → Boards.
7. Anchored 4-tab bottom navigation.

**Behavior:**

- Tap stat → My Tasks with a compatible supported filter/group. Map UI labels to actual server buckets; do not infer counts from loaded previews.
- Tap task → Card Detail, resolving Board access and handling revoke/archived cases.
- Tap board → Board Detail; Starred/recent ordering from the existing Home response.
- Pull-to-refresh re-queries with existing auth, throttling and invalidation conventions. On app foreground/reconnect, use bounded refresh rather than repeated fetch loops.
- Do not force workspace selection here: Home is cross-Workspace by design.

**States:** first load skeleton for stat tiles and content, empty Up Next message, empty Board list CTA, partial failure inline Retry, offline stale/last-updated indication where safe; after access loss remove invalid private content promptly.

**API reality check:** Current Home API reports assigned active Cards, overdue and next-7-day counts, Workspace count, Up Next, starred Boards and recent Boards. Use returned semantics, not fictional task counters.

**Acceptance:** no layout jumps when counts arrive; long Board names truncate gracefully with accessible full name; all list entries have real destinations.

### 4.2 Screen 02 — Boards & Workspace Switcher

**Reference:** `assets/02-boards-and-workspace-switcher.png`\
**Entry:** Boards tab.\
**Purpose:** Discover and manage Boards by Workspace, quickly open starred Boards.

**Layout hierarchy:**

1. Primary Kanvexa header, Search and avatar.
2. Title `Boards`, subtitle `All your boards, across workspaces.`
3. Prominent **Workspace selector** card with actual name, type (Personal/Team), member count if authorized, chevron.
4. `Starred boards` horizontal or two-column scrollable tiles, each with true Board background, name, small metadata and star indicator.
5. `All boards` stacked rows with thumbnail, name, useful permitted metadata, star toggle, contextual overflow.
6. Quiet `Create board` action in section header, shown only when authorized.
7. Persistent 4-tab bottom nav.

**Workspace switcher bottom sheet:**

- Title `Switch workspace`; list Personal Workspace first when present, then Team Workspaces (order should match existing app rules, not arbitrary fiction).
- Current Workspace shown with selected outline/check; item shows name, type and member count only when available.
- Tap Workspace → close sheet; update Board list and selection. Keep selected Workspace across tab navigation in app session as appropriate; do not cache data belonging to a previous authenticated user.
- Include `Create new workspace` and `Manage workspaces` only if already supported and user is authorized. Empty list and request/error states must be handled.

**Board actions:**

- Tap tile/row opens Board. Star toggle does not also open Board.
- Overflow actions depend on role and Board status: settings, archive/unarchive, background, manage members/invite, export, etc., **only where the Web product supports them**.
- A Workspace-only reader or Guest may see fewer actions. Archived Boards get an explicit visual read-only/archived distinction.
- Use true Board summary fields; no made-up list/card counts from partial data.

**States:** empty Personal Workspace, Team Workspace with zero Boards, no starred Boards, long workspace names, access revoked mid-page, image load failure, create/edit validation, loading skeletons.

### 4.3 Screen 03 — Board Detail / Kanban / Filters

**Reference:** `assets/03-board-detail-and-filters.png`\
**Entry:** Board list, Home tile, global Search, deep link.\
**Purpose:** Primary touch-first Board experience.

**Composition:**

1. Context header with official K mark, Board title, Workspace subtitle, Search/overflow actions as appropriate.
2. Compact view/filter area: active `All`, `Mine`, `Due soon`, `Labels` chips or equivalent scoped filters. Retain current filter indicator and Clear action.
3. **Horizontally swipeable Kanban columns** beneath filter area. Each column uses a soft tinted panel, column title, accurate count, contextual menu; cards in vertical order.
4. Compact Card preview: title, authentic labels, checklist fraction/progress, due chip, avatars, attachment/comment counts if available. Clipped previews should not hide critical overdue status.
5. `+ Add card` inside an authorized column and optional floating primary Add action at bottom-right. Avoid duplicate primary CTAs competing on the same device/viewport.
6. For feature parity, `Board | Table | Calendar` switcher must be accessible on Board Detail, with visual tokens matching the approved Board screen (the first Board reference mainly depicts Kanban + filters).

**Interaction rules:**

- Horizontal swipe changes visible column; vertical swipe scrolls cards inside the column. Do not let horizontal paging hijack vertical card scrolling or interfere with interactive elements.
- Tap Card → full-screen Card Detail; Back restores Board column, scroll and filters where feasible.
- Card moving/reordering must preserve the existing Board/Column/Card invariants. Prefer verified mobile gesture support **plus** an accessible `Move to…` action. No dependency on precision drag as the only method.
- Cards, columns and active Board change via Socket.IO hints + authorized refetch/optimistic updates. Preserve other users' work; avoid duplicate invalidations and phantom reordering. Use actual server ordering.
- Filter sheet: Assignee, Labels, due status/date and supported sort/filter parameters; Apply/Reset with clear selected chip count. Search/filter must be permission-safe and compatible with Board views.
- **Readonly:** archived Boards/Cards, guest/viewer roles and permission revocations remove or disable mutation controls with explicit copy. No stale UI acceptance after a server 403/404.
- **Board management:** Members, Background, Activity, Export, Archived Cards, Board Settings, Star (where supported) via contextual menu/screen. Archive/destructive actions require confirmations. Never introduce hard-delete, cross-board move or duplicate-board actions solely because an intermediate sketch showed them.

**View variants (feature parity):**

- **Table:** a readable mobile alternative to Web Table View; horizontal grid/row inspector as needed. Columns, sorting, filters and Cards must match current Web semantics. No fake `Priority` field.
- **Calendar:** uses the dedicated Calendar spec §4.8, scoped to this Board when opened here.
- A change in view should preserve a compatible filter context and not force a data reset unrelated to that view.

**Performance & QA:** Test 0 / 1 / 100 / 101 / 250+ Cards, long titles, many labels, 1/10/30+ columns, reorder during other-user edits, reconnect and revoked access. Respect ongoing Web performance remediation instead of copying the historical serial-fetch pattern uncritically.

### 4.4 Screen 04 — Card Detail / Editing / Collaboration

**Reference:** `assets/04-card-detail.png`\
**Entry:** Board Card, My Tasks, Home, Search, Notification deep link.\
**Purpose:** Full Card management in a single native scroll, not a tiny Web modal.

**Top-to-bottom sections:**

1. Compact Back + K/logo + `Card details` header, parent Board subtitle, contextual overflow; keep compact sticky access.
2. Breadcrumb: Board / Column (actual values), Card title prominently wrapped across lines; metadata such as creator/updated at only if present and permitted.
3. Label chips (can wrap); no hardcoded invented priority classification.
4. Metadata grid or stacked rows: Assignees, Start/Due Dates, possibly list/column. Each row opens native picker/bottom sheet with real permissions.
5. Description reading surface; explicit `Edit` starts editable mode with **Save / Cancel**. Support valid formatting from existing Card description contract; do not execute arbitrary HTML or script.
6. Checklists: one or more lists, title, progress fraction/bar, checkbox items, Add item, reorder/edit/remove where supported. Completed count is authoritative/derived from current item states.
7. Attachments: private uploaded files and URL attachments; filename, type/size, safe Open/Download and Add actions. Use authenticated transfer; never expose raw S3 object URLs as public links.
8. Comments: avatar, author, text, timestamps, edits/deletes/mentions only if supported; comment composer with native keyboard avoidance and Send status.
9. Activity/history: contextual entry or collapsed section backed by supported API.
10. Sticky bottom action area with contextual `Move`, `Activity`, `Edit card` or `Add comment` depending on scroll/role; **do not create duplicate contradictory Save paths**.

**Interaction rules:**

- Card mutations update the local view without claiming success until the server confirms. A failed Save retains the draft, indicates Retry and does not overwrite remote state.
- If Back is pressed during unsaved description/comment/edit, show `Discard changes?` with Keep editing / Discard unless content has been safely preserved per current contract.
- Checklist toggles have immediate accessible feedback, rollback on failure, and do not change historical activity or other items unexpectedly.
- `Move` chooses a real destination Column and valid position within **the same Board unless Web explicitly supports otherwise**. Archived Card is read-only; only authorized Restore is available.
- Tapping attachment opens safe preview/share handling per native file permissions; URL actions check supported schemes. Upload limits match the existing backend (currently 10 MiB/file, 20/Card, 100 MiB/Board for enabled private uploads), not arbitrary design limits.
- Mention suggestions should work when keyboard is open and preserve cursor/composer content on unsuccessful sends.
- Comments and Card Detail must update correctly when changes arrive via another user's socket without destroying a local unsaved draft.
- Screens entered via direct link always repeat authorization checks. Lost access means clear protected content and show non-disclosing unavailability.

**States:** no description, zero checklists, empty checklist, no attachments, empty comments, very long title, multiple assignees, archived Card, archived Board, mutation failure/conflict, file upload pending/failure, slow/offline Card detail.

**Non-goals from visual fiction:** No invented status field, priority model, task completion endpoint, custom Card cover, public file URL, hard delete, unapproved cross-Board moving.

### 4.5 Screen 05 — My Tasks

**Reference:** `assets/05-my-tasks.png`\
**Entry:** My Tasks tab; Home summary links.\
**Purpose:** Cross-Workspace list of active assigned Cards using the **existing productivity API**.

**Layout:**

- Kanvexa header, title `My Tasks`, subtitle `All tasks assigned to you, across workspaces.`
- Horizontal scannable group chips (approved visual uses `All`, `Overdue`, `Due soon`, `Completed`). **Functional mapping must follow the server's real groups**; see below.
- Grouped list default; visible section headings/counts; each row shows title, Board, labels and due status; icon and overflow only for real actions.
- Filter control opens bottom sheet with grouping, Workspace, Board, Label and due date range. Group by Board option is a presentation choice where compatible with API.
- Compact page/load-more behavior for long task sets; retain filter state on navigating to a Card and returning.

**Contract reconciliation (mandatory):**

- `GET /api/users/me/tasks` provides `ALL`, `OVERDUE`, `NEXT_7_DAYS`, `LATER`, `NO_DUE_DATE`, plus server group counts, filters and pagination. Use this for counts/order. Display labels can say `Overdue`, `Next 7 days`, `Later`, `No due date`.
- The mockup's `Completed` chip is **visual only**; do **not** implement completed filtering or a completed task checkbox unless the authoritative Web API exposes completion semantics. In v1 UI, replace unsupported group with an existing group or a compact `More groups` control while preserving the pill style.
- A circle/check icon in Task rows should not toggle a fictional `Task completed` flag. It can be decorative/accessibility-safe or replaced with a Card detail/action affordance that actually exists.
- `groupCounts` is authoritative and calculated after supported non-group filters. The UI must not recompute total groups from a partial page.
- `dueFrom` is inclusive and `dueTo` exclusive, both valid timestamp instants; combine with saved timezone preferences carefully. No date-only query values submitted to this endpoint.
- The mockup's `Group by: Board` should group **loaded** items only when semantics remain clear, or use appropriate existing server sort/group capabilities. Do not present fake complete Board totals from an incomplete page.

**States:** no assigned tasks, no upcoming tasks, no due date, tasks across many Workspaces, 20+ pages, inaccessible Card removed, labels not loaded, stale API responses after filter changes.

### 4.6 Screen 06 — Inbox / Notification Preferences

**Reference:** `assets/06-inbox-and-preferences.png`\
**Entry:** Inbox tab and dedicated notification settings route.\
**Purpose:** Review and act on supported Kanvexa events.

**Inbox layout:**

- Kanvexa header, `Inbox`, supportive subtitle.
- Segmented `All` / `Unread (count)`, trailing `Mark all as read` where appropriate.
- Group notifications by `Today`, `Yesterday`, earlier dates in user's saved timezone; row has type icon, actor avatar (if allowed), plain-text summary, Board/Workspace context, timestamp and unread dot.
- Unread: quiet lilac-tinted row; read: white/neutral surface. Keep rows compact and readable; avoid giant separate rounded cards for dozens of notifications.
- Tap an available target → mark read as appropriate, navigate through authorized internal route. If target is unavailable/revoked, row becomes safe stub without link.
- `Mark all as read` only succeeds when the server confirms; show retry on failure. Unread badge uses `GET /notifications/unread-count`, not current page item count.
- Paginate/load more using the supported API; no silent cap at five notifications (five is Web's historical page size, not a mobile visual limit).

**Notification Preferences layout:**

- Back + page title, grouped rows for **In-app** and **Email** preferences; each toggle has explanation, state and disabled reason where relevant.
- The canonical supported in-app kinds: Card Assigned, Comment Mentioned, Workspace Invited, Board Invited, Membership Changed and Due Reminder. Email currently supports Card Assigned, Comment Mentioned and Due Reminder.
- The mockup also shows `Push notifications`, `Comments`, `Board activity` and `Quiet hours`. **These are NOT automatically supported server preferences.** Show push only after mobile push infrastructure/device registration exists; show additional notification kind and scheduling switches only after backend support/owner approval. Otherwise preserve visual grouping with supported controls rather than shipping dead toggles.
- `Board Invited` should follow actual producer availability; currently Web labels it as reserved/not sent yet.
- Disabled email sending must be explained (server feature-flag readiness), even when an account-level preference can be stored. Security/account emails are not optional casual notification toggles.
- Save/Cancel and dirty state apply to preference drafts; preserve unsaved changes across refetch/failure and warn on navigation.

**Security/realtime:**

- Only trust the canonical notification DTO. Never render notification summary as HTML. Drop unsafe/external target paths.
- `notifications:changed` is an invalidation hint; dedupe/coalesce refetch. Reconcile count and rows after mark-read/membership change.
- On Board/Workspace access revocation, private actor/context/target details disappear immediately and become server-provided unavailable stubs without leaking names/links.

**States:** zero notifications, zero unread, long body, 99+ unread count, deleted target, expired authorization, offline, failed mark-read, failed preference save, notification kind unknown/unavailable.

### 4.7 Screen 07 — Global Search

**Reference:** `assets/07-global-search.png`\
**Entry:** Search icon in primary header or Board header.\
**Purpose:** Quickly locate Workspaces, Boards and Cards across authorized data.

**Default state:**

- Full-screen route with Back, official K logo, high-visibility search field auto-focused when ready.
- `Recent searches` list may be persisted only on-device per user and cleared on sign-out/account switch; **this is local UI history, not a backend search-history feature**. It is optional until consent/privacy policy is decided. `Clear` and row `×` must actually remove items.
- Suggested result types `Cards`, `Boards`, `Workspaces` are shortcuts into preselected search type, not fabricated trending data.

**Results state:**

- Search field retains entered query; chips `All`, `Boards`, `Cards`, `Workspaces` with real total counts.
- Group results by Workspace/Board/Card in the `All` view, using server count and pagination semantics.
- Rows display safe title, context, limited subtitle/snippet, and route affordance. Match highlight must escape/literal-match text; never insert raw HTML.
- Tap Card → Card Detail; Board → Board; Workspace → Workspace, with a fresh access check.
- Debounce input appropriately and cancel/ignore stale responses; 400/401/429/server errors have meaningful states.

**Search filter reconciliation (mandatory):**

- Current `GET /api/search` supports **`q`, `type`, `limit`, `page` only**. For `type=all`, a `page` parameter is forbidden. Type-specific views support pagination.
- The mockup filter sheet visually includes Workspace and Board selects, but **these are not currently accepted server query parameters**. Do not submit unsupported params or imply complete filtered counts after locally filtering a page. Hide/disable those options with no false affordance until the Web/backend contract supports them; owner approval is required for a new backend search filter.
- Results with `q=''` are empty per server contract; recent searches and shortcut suggestions are UI-only and must not imply backend “suggested results”.
- Search type selector already supplies the primary useful filter; a bottom sheet is optional only when it has real supported controls.

**States:** no query, loading, zero results, one group missing, long query (up to server maximum), all-results hasMore, pagination failure, access revoked between search and opening detail.

### 4.8 Screen 08 — Calendar (Month / Week / Filters)

**Reference:** `assets/08-calendar.png`\
**Entry:** Board Detail's Calendar view; optional My Tasks entry only if it preserves existing scope/filters and is approved.\
**Purpose:** See dated Cards, select a day and open details.

**Month:**

- Back + Kanvexa header, `Calendar`, filter action, `Month | Week` segmented control and `Today` jump.
- Month label with previous/next; grid honors `weekStartsOn` preference (`monday` / `sunday`).
- Each day shows number plus colored dot(s)/small count indicating Cards with relevant dates; selected day has indigo state. Overflowing dots become an accessible count, never an illegible cluster.
- Lower agenda shows selected date and applicable Cards, with due chips, Board context, labels where available.

**Week:**

- Compact 7-day date strip, previous/next week, Today and selected day.
- The approved mockup shows a **time-axis timeline with 10:00–11:30 events**. Real Card dates are ISO instants (`startDate`, `dueDate`), not a dedicated calendar event or scheduling model. **Do not invent meeting start/end times or durations.**
- Default safe implementation: week date strip + grouped daily Card agenda, or only draw a time block when existing date fields validly define the corresponding semantics. A single dueDate is a deadline point, not an arbitrary timed meeting.

**Filters:**

- Preserve Board scope if entered from a Board, and restrict assignee/labels to truly supported Board filters. `Show tasks with due date` and `Show tasks with start date` may control client rendering only if every relevant Card is available, or must be backed by a correct query.
- A Card spanning multiple days should follow the **current Web Calendar semantics** unless the owner explicitly approves a cross-platform change. Do not silently switch from due-date grouping to interval-spanning rendering because the mockup has colored dots.
- Apply/Reset, summary count, consistent timezone/date formatting; a view switch must not change underlying Card data.

**States/QA:** February/leap years, locale week start, DST changes, month spanning 5/6 grid rows, empty day, multiple Cards same day, date in saved timezone, Card start after due invalid, unauthorized Card, changing Board labels/dates via realtime.

### 4.9 Screen 09 — Authentication

**Reference:** `assets/09-authentication.png`\
**Entry:** Signed-out flow; deep links to reset/verification.\
**Purpose:** Authenticate securely with the existing product's account policies.

**Common visual language:**

- Prominent authentic Kanvexa K + wordmark; white/light background with subtle soft violet wave near bottom; spacious form; no authenticated tabs.
- Screen title ~26 dp, concise supporting copy, bordered icon-leading fields, full-width indigo primary CTA, inline links.
- Visible password icon changes secure entry state; do not log values. Keyboard `next` and `done`, autofill and password manager support.

**A. Login**

- Email, Password, Forgot password, Sign in, `or continue with`, official Google Sign-In action where configured, Sign up link.
- Prevent duplicate submits, show field/server errors, preserve email after non-sensitive validation failure. Never treat email/password as a secure authentication replacement for Google sign-in.
- Google on mobile requires a correctly configured native OAuth/identity flow and backend exchange, not the Web GIS DOM/iframe integration copied verbatim.

**B. Sign Up**

- Full name, Email, Password, Confirm password, terms/privacy acknowledgment where legal/product rules require it; Sign up and Sign in.
- Validation aligns with server password policy and email verification; do not invent success on rejected registration.
- Long form must scroll/avoid keyboard on smaller phones; keep CTA accessible.

**C. Forgot Password / Reset**

- Forgot: email input and Send reset link, privacy-preserving response (avoid account existence disclosure).
- Reset: dedicated valid-token screen with new password/confirm; securely handle expired/reused/invalid links, show actionable recovery.
- The mockup's `30 minutes` is example copy; show an exact expiration only if the current server contract guarantees it.

**D. Email Verification**

- Confirmation page with masked/actual submitted address as appropriate, instructions, Resend action with cooldown/throttling, Back to sign in.
- Support a verification deep link and explicit success/failure states. Verify before login as required by Web policy.
- Do not place verification tokens in analytics/logging, crash breadcrumbs or untrusted external redirects.

**Session invariants:**

- Existing Web currently uses **fixed-lifetime access JWTs with no refresh flow**. Do not implement an imaginary mobile refresh token or promise permanent login. Store tokens only with a secure native storage strategy, protect session-generation state, end local session on expiry/401, clear protected caches/sockets on logout/account switch.
- Password reset/change and access changes must revoke related authorized socket state per backend behavior; mobile must reconnect only with a valid token.
- Any future session extension/refresh is a **separate backend security design decision**, not an implicit UI requirement.

### 4.10 Screen 10 — Profile & Settings / Security / Data & Privacy

**Reference:** `assets/10-profile-and-settings.png`\
**Entry:** Avatar in authenticated header; Settings submenu.\
**Purpose:** Manage account identity, preferences, security and exports safely.

**A. Profile & Settings landing:**

- Header with authentic K, title `Profile & Settings`.
- Current user card: avatar, display name, email, chevron.
- Grouped rows by `Account`, `Preferences`, `Security & Data`; Sign out isolated in danger color at bottom.
- Primary groups: Edit Profile, Change Email, Notifications, Appearance, Preferences, Security, Connected Accounts, Data & Privacy. Other proposed labels only where supported.
- Mockup `Language` selector is not proof of multilingual support; don't ship a dead setting when no translation system exists.

**B. Edit Profile:**

- Current avatar with Edit/Upload, full name, relevant current account fields, Save changes; dirty guard, success/error feedback.
- Optional Bio input in mockup is **not a confirmed current User profile field**. Omit until API/data model support is approved. Avatar handling follows existing profile upload/authorization contract; no unverified local public URL.
- Timezone belongs to supported Preferences rather than being silently stored as an Edit Profile field; it may be linked from this page to Preferences if desired.

**C. Security:**

- Real `Change password` form, validated with server password policy; recovery route link and correct reauthentication expectations.
- The mockup shows `Active sessions`, `2FA` and `Login activity`. No confirmed current session registry, 2FA contract or audit-log surface supports these controls. **Do not present them as active switches/actions.** Keep the section visually ready for future owner-approved backend features; for now show supported Security and Connected Accounts options only.
- Account/security changes may invalidate current/other sessions. Wipe protected in-memory data and realtime connections as required.

**D. Data & Privacy:**

- `Export account data`, `Change email`, `Delete account` grouped with clear summaries; destructive action isolated in red and protected by confirmation/verification according to existing backend flow.
- Board JSON/CSV export is exposed from **authorized Board settings**, not mistakenly as an unrestricted account export.
- Existing export endpoints return **raw JSON/CSV download bytes, not a normal REST envelope**. Save through authenticated native file/download APIs; never persist secret files to public storage without user consent.
- Export Board only for explicit Board OWNER (including qualified guest OWNER); do not infer permission from Workspace ADMIN alone. Export may be allowed on archived Boards according to current contract.
- Account export should use the current authenticated user's endpoint. No arbitrary user selector or administrative scope.
- Error bodies must not be saved as files or presented as successful downloads.
- Account deletion requires clear irreversible consequences, protected confirmation and a correct post-delete local logout/cache wipe.
- Privacy illustration is a quiet decorative supporting element below controls; never replaces explanatory content or adds false guarantees.

**E. Appearance & Preferences (functional subpages, visual system inherited):**

- Existing preference values: `theme = light | dark | system`, `timeZone`, `dateFormat = DD/MM/YYYY | MM/DD/YYYY | YYYY-MM-DD`, `weekStartsOn = monday | sunday`.
- Sync account preference with Web; do not let a new user's cached theme flash after account switch. Match System responds to native OS changes.
- Save server-backed settings accurately, preserving unrelated fields and unsaved drafts. `Theme` may apply immediately in line with the established Web interaction model.

**States:** avatar upload error, no avatar, invalid name/email, pending verification, changed password, inaccessible connected account, download progress/failure, destructive confirmation cancellation, unsaved preferences, offline, session expired mid-save.

---

## 5. Shared native interaction patterns

### 5.1 Bottom sheets, dialogs and pickers

- Use bottom sheets for a **short local choice**: Workspace switching, filters, member/label/date selection, Create Card, overflow actions. Major multi-step management uses a pushed full screen.
- Bottom sheets have top drag handle, title, optional Reset, scrollable content if needed, safe-area/footer-aware CTA. They can be dismissed by swipe/backdrop/Back only if doing so does not destroy unsaved changes.
- Destructive confirmations use explicit action name (e.g., `Archive board`), explanation and red confirmation. Never use generic `OK` for account deletion.
- Respect platform date picker conventions while preserving the saved timezone, ISO contract and date precision.

### 5.2 Loading / empty / failure / offline

Every screen that loads remote data requires:

| State                  | Expected behavior                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| First load             | Layout-matching skeleton or stable progress, no fake zero counts                              |
| Empty successful load  | Contextual explanation and available authorized next action                                   |
| Refreshing             | Preserve useful content while clearly indicating refresh                                      |
| API error              | Inline safe error, Retry; do not replace entire app shell for a single section failure        |
| Offline                | Display cached content only when permitted; clearly mark stale, disable unsupported mutations |
| Unauthorized / expired | Clear protected data, disconnect sockets, navigate to safe sign-in flow                       |
| Forbidden / not found  | Non-disclosing unavailable state; no hidden object details or privileged actions              |
| Mutation pending       | Disable duplicate submits, indicate progress, no early success                                |
| Mutation rejected      | Preserve user draft, show correction/Retry, reconcile server truth                            |

- Offline mode is **not** assumed to include a durable write queue. Do not queue edits persistently without a separately designed conflict/privacy mechanism.
- Pull-to-refresh and reconnect must not generate bursts of duplicate API requests or stale-data flashes.

### 5.3 Navigation consistency

- Android hardware Back closes active sheet first, then nested screen, then returns through tab/stack; avoid accidental exits from the application.
- Back from Card Detail restores prior Board/My Tasks/Search context when it remains permitted.
- Search, Board and notification deep links into Cards should open a **single** Card Detail implementation.
- Never use nested unbounded `ScrollView`s or require horizontal swipe for basic actions.
- Animated transitions are restrained (approx. 150–250 ms for small state changes), respect Reduce Motion and do not hide actionable loading/error states.

### 5.4 Forms and validation

- Inline field errors, accessible status announcements, keyboard appropriate to field type, autocomplete where supported.
- Primary actions remain visible above keyboard or within scroll reach, not permanently overlaid on content.
- Dirty-form prompt has unambiguous `Keep editing` / `Discard` options. Do not silently reset forms when server refetches.
- API values are revalidated server-side; client-side checks are for UX only.

---

## 6. Permissions, realtime, privacy and data integrity

### 6.1 Access-first rendering

- Authorization is checked by backend for **every read and mutation**, not assumed from disabled UI. Unknown/unauthorized Workspace/Board/Card must not be distinguishable through leaked titles/counts/avatars.
- Explicit Board and Workspace roles can differ. Do not extrapolate Board OWNER from Workspace ADMIN or vice versa. Guest Board access is not the same as Team Workspace membership.
- Archived Boards and Cards are clearly marked read-only with permitted Restore options rather than editable-looking forms.
- Access revocation invalidates protected screen data, queued actions and navigation targets; stop showing private preview summaries immediately.

### 6.2 Realtime

- Mobile uses the existing Socket.IO event contract and auth handshake **after** valid session restoration. On logout/revoke/expiry, disconnect and clear relevant cache.
- Foreground and reconnect: refresh eligible views once using coordinated query invalidation; don't rely on the app maintaining a socket continuously in background.
- Remote edits can update a viewed Card but **must not discard unsaved local description, checklist or comment drafts**. Surface reconciliation/refresh appropriately.
- Presence is ephemeral online-now information; never fabricate “last seen” or persistent presence history.
- Avoid the known Web risks of redundant invalidation and unbounded full-Board REST waterfall: mobile must not inherit them as a design requirement. Base fetch strategy on verified contracts and measured behavior.

### 6.3 Native security

- Sensitive tokens stored in native secure storage only; never AsyncStorage for bearer secrets, source-controlled env values, log body or navigation params.
- Authenticate native file downloads and handle permissions securely. Do not copy user private attachments to public media library without explicit intent.
- Google identity flow, credential exchange and redirect/deep links must use appropriate native authorization and validated state/nonce/redirects.
- Notifications and notification previews must not expose restricted details when the user changes account or loses permission.
- Avoid broad persistent caching of protected data. A future deliberate offline strategy needs encryption, retention and wipe rules.

---

## 7. Accessibility and localization QA

**Non-negotiable acceptance:**

- Touch targets ≥44×44 pt on iOS / ≈48×48 dp on Android, including chip dismiss and tiny overflow actions. When icons are visually smaller, expand their hit slop.
- Body text and labels meet WCAG AA contrast where applicable: ~4.5:1 normal text, ~3:1 large text and essential non-text UI boundaries. Some pale mockup colors may need contrast corrections.
- Screen reader labels describe **action + context**: `Star Product Roadmap`, `Mark notification as read`, `Open filter options`, not just `star` or `more`.
- Roles/selected/disabled/expanded and counts are exposed to VoiceOver/TalkBack; dynamic counts and error summaries announce appropriately without spamming.
- Do not identify categories solely by color or colored dots. Calendar dates with Cards require a spoken count/description.
- Dynamic Type / font scaling: test at least 100%, 130%, 160%, plus large-accessibility sample where possible. Cards can grow vertically; no clipped Save/Delete buttons.
- Test font and keyboard on narrow screens; UI must not assume English strings are always short.
- Saved timezone, date format and week start determine user-visible calendar/due state. Relative labels (Today/Tomorrow/Overdue) must recompute when time crosses boundaries or app foregrounds.
- Use text alternatives for meaningful content images, decorative images hidden from screen reader. Do not treat a Board's decorative background image as a text label.
- Reduced motion: remove non-essential animations, preserve sheet/cross-screen comprehension.

---

## 8. Screen-to-contract alignment and mockup exceptions

> This table is intended to prevent implementation agents from confusing illustrative generated imagery with existing Kanvexa features. Verify again against latest `main` before coding: features may merge after 2026-11-07.

| Mockup/control                                             | Existing capability / source of truth                                                  | Mobile decision                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Home counters, Up Next                                     | `GET /api/users/me/home`                                                               | Use returned counts/items; no fictitious dashboards                                |
| My Tasks grouping                                          | `GET /api/users/me/tasks` with `ALL`, `OVERDUE`, `NEXT_7_DAYS`, `LATER`, `NO_DUE_DATE` | Replace unsupported mockup `Completed` group; do not fake completion               |
| Workspace/Board Search filters                             | `/api/search` supports `q`, `type`, `limit`, `page`; no Workspace/Board filter         | Keep look of sheet only if real controls exist; otherwise omit unsupported options |
| Search recent terms                                        | No account-level recent query API assumed                                              | Optional per-device, per-user local history with Clear                             |
| Calendar time-block meetings                               | Cards have `startDate` / `dueDate` timestamps                                          | Date-oriented agenda by default; never fabricate meeting duration                  |
| Calendar multi-day representation                          | Current Web calendar grouping semantics                                                | Respect Web parity unless owner approves behavior change                           |
| Notification kinds                                         | Six in-app / three email preference booleans                                           | Use supported kind controls; not generic mockup-only categories                    |
| Native push + quiet hours                                  | Not confirmed in existing API                                                          | Not active until purpose-built mobile backend/platform support exists              |
| Google Sign-in                                             | Web Google identity flow exists                                                        | Native OAuth/identity implementation, not Web iframe copy                          |
| Access token refresh                                       | Web access JWT fixed 1h; no refresh                                                    | Expire/re-login securely; no invented refresh API                                  |
| Profile Bio                                                | Not confirmed in current profile contract                                              | Omit until explicitly supported                                                    |
| Language selector                                          | No confirmed language system                                                           | Omit unless localizations are implemented                                          |
| 2FA / active sessions / login activity                     | No confirmed corresponding APIs                                                        | Do not ship decorative functioning-looking controls                                |
| User theme / timezone / date format / week start           | `GET/PATCH /api/users/me/preferences`                                                  | Fully functional, same enum semantics                                              |
| Board/account export                                       | Existing authorized export endpoints                                                   | Use native authenticated download, enforce owner rules                             |
| Uploaded attachments                                       | Private S3 backend when enabled; strict limits                                         | Never assume upload availability or expose raw files                               |
| Board/Column hard Delete, duplicate Board, custom Priority | Visual sketches elsewhere included speculative controls                                | Not mandated by approved screenshots; only existing approved Web actions           |

### 8.1 Known API anchors (orientation, not exhaustive contracts)

```text
GET   /api/users/me/home
GET   /api/users/me/tasks
GET   /api/search
GET   /api/notifications
GET   /api/notifications/unread-count
PATCH /api/notifications/:id/read
POST  /api/notifications/read-all
GET   /api/users/me/notification-preferences
PATCH /api/users/me/notification-preferences
GET   /api/users/me/preferences
PATCH /api/users/me/preferences
GET   /api/boards/:boardId/export?format=json|csv
GET   /api/users/me/export
```

Do not treat this selection as the entire API: Board/Card/Workspace/Auth/Attachment endpoints must be read from latest shared contracts, controllers and Web client. Export requests are **raw successful bytes**; most other listed endpoints use standard REST envelopes.

### 8.2 Source code references used to resolve ambiguities

- `pnpm-workspace.yaml`, `packages/shared/package.json`, `apps/frontend/src/features/auth/AuthProvider.tsx`.
- `docs/tasks/frontend/cross-tab-authentication.md` (fixed-lifetime JWT; no refresh flow).
- `docs/tasks/backend/p4-my-tasks-home-api.md` (My Tasks & Home contract).
- `docs/tasks/backend/p4-global-search.md` (Search contract and params).
- `docs/tasks/frontend/p4-notifications-ui.md`, `apps/backend/src/api/notifications/notification-preferences.ts`.
- `docs/tasks/backend/p5-authorized-data-export.md` (Board/account exports).
- `docs/tasks/backend/user-preferences.md` (theme/timezone/date/week prefs).
- `docs/design/post-mvp/board-card/ux-spec.md` (Board/Card behavior and mockup exceptions).
- `apps/frontend/src/features/boards/components/BoardViews.tsx` and `CalendarBoard.tsx` (actual Board views/date interpretation).

---

## 9. Design-to-implementation conventions

### 9.1 Asset repository placement

Recommended place in the existing repository (when owner authorizes commit):

```text
docs/design/mobile/
├── KANVEXA_MOBILE_DESIGN_SPEC.md
└── assets/
    ├── 01-home-dashboard.png
    ├── 02-boards-and-workspace-switcher.png
    ├── 03-board-detail-and-filters.png
    ├── 04-card-detail.png
    ├── 05-my-tasks.png
    ├── 06-inbox-and-preferences.png
    ├── 07-global-search.png
    ├── 08-calendar.png
    ├── 09-authentication.png
    ├── 10-profile-and-settings.png
    └── kanvexa-logo-v1.png
```

The pictures document **approved UI composition**; actual app resources should use original brand assets, backend Board backgrounds and native-drawn components. Don't bundle giant mockup image sheets into production code or runtime APK/IPA.

### 9.2 Component boundaries

- Share tokens and simple visual primitives across all screens. Group screen-specific components by feature/domain (Home, Boards, Cards, My Tasks, Inbox, Search, Calendar, Auth, Settings).
- Separate presentation from API hooks. Avoid copy/pasting Web browser-dependent code such as DOM APIs, localStorage or `window.location`.
- Keep authorization and session scope in one shared mobile infrastructure layer. An intercepted 401 or auth-version change must be applied coherently.
- Query keys include authenticated session/user scope and are cleared at logout/account switch.
- Avoid introducing any backend migration, queue, event type or API just to imitate generated screenshot placeholders without explicit authorization.

### 9.3 Required visual review artifacts per UI issue

1. **Screenshot** of actual running native UI at standard phone width, same key state as approved reference.
2. At least one **Android** run and, where accessible, one **iOS/simulator** verification; state any platform that was not tested.
3. Before/after or reference-to-implementation comparison of layout, typography, spacing, icon sizes, colors, safe areas and tab behavior.
4. Screenshot of a non-happy-path state: long text / loading / empty / error / read-only, appropriate to feature.
5. Confirmation of feature contract, responsive and accessibility tests and **any** deliberate mismatch from the image.

Screen capture should stay focused and restrained (normally 3–5 useful screenshots per issue) rather than spending excessive time/tokens generating redundant comparisons.

### 9.4 Visual deviation policy

**Must be pre-approved:** replacing a layout, adding/removing a main navigation tab, changing brand color or logo, changing board interaction model, altering Card Detail information architecture, introducing an unsupported settings toggle, introducing a new backend workflow.

**May adapt without reapproval if documented:** modest spacing at narrow widths, font scaling fixes, safe-area/keyboard accommodations, minor icon equivalent, contrast fix for accessibility, Android/iOS system conventions and conditional omission of unsupported mockup-only functionality.

---

## 10. Definition of done for mobile design implementation

A feature screen is **not** done merely because it resembles a screenshot. It meets all applicable checks:

- [ ] Correct authentic logo, typography, semantic palette and approved screen composition.
- [ ] Correct 4-tab primary navigation; correct detail/sheet/Back behavior.
- [ ] No overlap with keyboard, system bars, notches, Android nav bar or sticky CTA.
- [ ] All visible actions work or are hidden/clearly non-interactive where unsupported; no misleading fake affordance.
- [ ] Backend contract, required role, auth/session, archived/read-only behavior and deep links are respected.
- [ ] Loading, empty, error, offline, pending mutation and unavailable states are implemented where relevant.
- [ ] Realtime/refresh and cached data do not leak another user's or revoked Board's information.
- [ ] Long copy, small screen, tablet/landscape, light/dark setting, text scaling and screen reader checked.
- [ ] Dates, counts, labels and statuses come from authoritative data; no sample values survive.
- [ ] At least relevant component, screen and integration tests pass; no Web app regression caused by mobile integration.
- [ ] Any deviations from reference/mockup exceptions are documented for the owner.
- [ ] Screenshot evidence is produced and reviewed before a feature is considered visually complete.

### 10.1 Cross-screen final QA journeys

1. Register → verify email → sign in → Home → Workspace/Board → Card → comment → back to Board.
2. Sign in via Google → open My Tasks → filter by Workspace/Label → Card Detail → return with filter preserved.
3. Home due Card → Card Detail → update Checklist → verify another authorized Web client sees change.
4. Inbox unread → mark read → open Card → use Back; unread count and row state reconcile.
5. Global Search → find Card in another Board → open via protected route; revoke access on another client → no stale private content.
6. Board Kanban ↔ Table ↔ Calendar; preserve correct Card identities and filter meanings.
7. Toggle theme/date settings on Web → reopen Mobile → correctly reflect server preference; and vice versa.
8. Request Board export as explicit OWNER → valid JSON/CSV file; repeat as MEMBER → no download. Account export works only for current user.
9. Draft a Card edit → background app → reconnect → receive remote update → draft not silently discarded; resolve accordingly.
10. Password reset/change, logout, token expiry and account switch → protected queries/sockets/files cleared, no cross-account residue.

---

## 11. Open implementation checks (not unapproved feature requests)

Before writing an issue or implementing a given screen, resolve these in the repo and log the outcome:

- Confirm newest Phase 5 + optimization merges and their effect on Board fetching, Table/Calendar, export, auth and realtime.
- Confirm mobile-compatible `@kanban/shared` package exports and Metro/pnpm resolution.
- Confirm supported OAuth native client IDs and provider handoff, secure storage, deep-link handling and native file-sharing path.
- Confirm Android/iOS notification permission strategy **only if** native push is explicitly added; existing in-app inbox does not require push delivery.
- Confirm exact current Board/Workspace roles, archived actions, lifecycle, routes and API limits.
- Confirm whether any unsupported design-only rows have gained backend support; if not, keep them omitted as documented above.
- Confirm the current `app` device theme accessibility behavior, chosen supported languages, and how board background assets load securely.

These are **verification gates**, not grounds for redoing the Mobile MVP/Post-MVP planning process. The aim is still **one complete mobile app reflecting the completed Web product**.

---

## 12. Owner approval ledger

| Visual group                    | Decision                                                      |
| ------------------------------- | ------------------------------------------------------------- |
| Home Dashboard / 4 tabs         | **Approved**                                                  |
| Boards + Workspace Switcher     | **Approved**                                                  |
| Board Detail / Kanban + Filters | **Approved**                                                  |
| Card Detail                     | **Approved**                                                  |
| My Tasks                        | **Approved**                                                  |
| Notifications / Inbox           | **Approved**                                                  |
| Global Search                   | **Approved**                                                  |
| Calendar                        | **Approved**                                                  |
| Authentication                  | **Approved**                                                  |
| Profile & Settings              | **Approved**                                                  |
| Official logo                   | **Owner-provided: required everywhere**                       |
| Product delivery split          | **One complete Mobile roadmap; no Mobile MVP/Post-MVP split** |

**Important:** Approval means **visual composition and intended flow**, not automatic approval to add unsupported backend APIs, 2FA, a language system, push infrastructure, account Bio, fictional completed-task behavior or fabricated Calendar event durations. These exceptions are explicitly resolved in §4 and §8.

**Document ends.**
