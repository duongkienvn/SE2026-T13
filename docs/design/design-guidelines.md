# UI Design Guidelines — Realtime Collaborative Kanban

> **Status: Approved visual targets**  
> These five screen images are the **required visual design** for the user interface, **not** loose inspiration or optional references.  
> Applies to the Realtime Collaborative Kanban (SE2026-T13) frontend.  
> Important: Visual design approval does not automatically approve business features outside the MVP.

## 1. Visual source of truth

Use the five unmodified images in `docs/design/screens/reference/` as visual acceptance baselines. Screenshots of the running application belong in `docs/design/screens/implementation/<task-slug>/` and are evidence, not design sources:

| File                                 | Target screen                  | Source image dimensions |
| ------------------------------------ | ------------------------------ | ----------------------- |
| `screens/reference/login.png`        | Login                          | 1672 × 941              |
| `screens/reference/boards.png`       | Boards list                    | 1672 × 941              |
| `screens/reference/kanban-board.png` | Kanban board / columns / cards | 2048 × 1283             |
| `screens/reference/card-detail.png`  | Card detail modal              | 1672 × 941              |
| `screens/reference/team-members.png` | Member-management page         | 1672 × 941              |

Each screenshot is an **approved UI target**, not a substitute for actual React components or working business behavior. Do not independently redesign, replace with generic admin dashboards, or use the screenshots as flat background images in the app.

Branding exception: the official Kanvexa artwork in `branding-assets/` replaces
the older placeholder symbols and product wordmark in these references. Use the
shared `Brand` / `BrandLogo` components without altering the supplied gradient
or proportions. The wordmark is separate text, and inherits the surrounding
text color so it can be used on light and dark surfaces. The existing light UI
palette and layout remain the visual baseline; branding does not introduce a
new application theme or a theme switcher.

### Visual fidelity required

At desktop viewport sizes corresponding to the images, implement UI as close as practicable to the screenshots in:

1. Overall layout and spatial proportions, including side rail, top bar, content padding, card sizing and gaps.
2. Typography hierarchy (display headings, section headings, labels and secondary copy).
3. Color palette, gradients, borders, shadows, corner radii and density.
4. Component appearance (buttons, search boxes, role chips, user avatars, board cards, Kanban cards, dialogs, metadata rows).
5. Alignment, icon sizes and visual hierarchy.
6. Hover, focus, loading and empty states that remain visually consistent with the provided design.

Use responsive behavior at other screen widths rather than fixed screenshot coordinates or non-responsive pixel positioning. Text/content may change naturally when real data replaces the mock content in the screenshots.

## 2. Design language observed in the screenshots

The images consistently establish:

- Light interface with a near-white main surface and subdued lavender/lilac outer frame.
- Saturated indigo-violet primary accent, also used for the active sidebar item and major actions.
- Deep navy/charcoal headings; muted slate gray descriptions, labels and icons.
- Thin, subtle borders; light, soft shadows; rounded cards and input fields.
- Slim vertical left navigation rail and horizontal header on most authenticated screens.
- Spacious desktop layout without excessive decoration.
- Compact status chips, overlapping avatar groups, understated metadata and clear primary call-to-action.

### Provisional palette (sampled/approximated from screenshots)

These are a **starting point for visual matching**, not an exact comprehensive design-token extraction:

| Token                    | Initial value | Role                         |
| ------------------------ | ------------- | ---------------------------- |
| `--color-primary`        | `#615CF7`     | Major button / active icon   |
| `--color-primary-strong` | `#6058F9`     | Primary emphasis             |
| `--color-bg-app`         | `#F7F7F9`     | Main app background          |
| `--color-surface`        | `#FFFFFF`     | Panels/cards                 |
| `--color-outer-frame`    | `#E5E8F9`     | Lavender surrounding surface |
| `--color-text-primary`   | `#172038`     | Heading (approx.)            |
| `--color-text-muted`     | `#6E7891`     | Secondary text (approx.)     |
| `--color-border`         | `#E4E8F1`     | Soft borders (approx.)       |

Refine tokens through side-by-side comparison with the source images. Avoid inventing a conflicting color system. The font family cannot be verified from screenshots alone; choose one consistent, similar sans-serif family rather than asserting an exact original font.

### Implemented tokens (frontend foundation)

The frontend defines these tokens in `apps/frontend/src/style.css` (Tailwind `@theme`, so `--color-line` is used as `border-line`, and so on). Values marked _refined_ were re-sampled from the authenticated screenshots or adjusted for WCAG AA text contrast. Keep this table and `style.css` in sync.

| Provisional token        | Implemented token        | Value                 | Note                                                                                        |
| ------------------------ | ------------------------ | --------------------- | ------------------------------------------------------------------------------------------- |
| `--color-primary`        | `--color-primary`        | `#615CF7`             |                                                                                             |
| `--color-primary-strong` | `--color-primary-strong` | `#6058F9`             |                                                                                             |
| —                        | `--color-primary-hover`  | `#4F49E6`             | Added: visible hover for primary buttons                                                    |
| —                        | `--color-primary-soft`   | `#F0F2FE`             | Added: active navigation background                                                         |
| —                        | `--color-brand`          | `#6466FA`             | Legacy accent; the official Kanvexa logo retains its supplied colors                        |
| —                        | `--color-brand-soft`     | `#9294FC`             | Legacy accent; the logo tile now uses the surrounding surface                               |
| `--color-bg-app`         | `--color-app`            | `#F7F7F9`             |                                                                                             |
| `--color-surface`        | `--color-surface`        | `#FFFFFF`             |                                                                                             |
| `--color-outer-frame`    | `--color-frame`          | `#A6A9D0`             | _Refined_: sampled from boards/kanban/team screens (`#E5E8F9` matches the login background) |
| `--color-text-primary`   | `--color-ink`            | `#172038`             |                                                                                             |
| `--color-text-muted`     | `--color-muted`          | `#626A83`             | _Refined_: sampled; `#6E7891` is below 4.5:1 on `#F7F7F9`                                   |
| `--color-border`         | `--color-line`           | `#E4E8F1`             |                                                                                             |
| —                        | `--color-danger`         | `#D1343A`             | Added: error states; darkened from `#E5484D` (3.9:1) to pass 4.5:1 for error text on white  |
| —                        | `--color-success`        | `#16803C`             | Added: success feedback (5.0:1 on white)                                                    |
| —                        | `--color-auth-backdrop`  | `#E6E8F9`             | Added: login/register page background (sampled from `login.png`)                            |
| —                        | `--color-auth-panel-*`   | `#F1F1FE` → `#E1E2FE` | Added: login product-panel gradient (sampled from `login.png`)                              |

Font: Inter (400/500/600/700) with a system sans-serif fallback.

### Layout indicators (approximate visual observations)

- Authenticated screenshots show a left rail roughly 60–70 px wide at the 1672 px reference size.
- The main top bar occupies roughly the first 75–90 px of the page frame.
- Boards page uses a three-column card grid at the reference desktop width.
- Kanban board uses a horizontally arranged set of columns with independent vertical card stacks.
- Card detail is a centered overlay with a dimmed backdrop and a content/metadata two-column split.
- Login uses a large two-panel centered container: illustrative/product presentation left, form right.

These are measured design guides, not hard-coded fixed dimensions. Use CSS grid/flex, responsive constraints and tokens.

### Fit-to-viewport rule (implemented)

The reference images were drawn at about 1672 px wide, so copying their pixel sizes 1:1 made screens scroll on common laptops (for example 1366×657 and 1536×730 browser viewports). The frontend therefore uses compact sizes and should fit normal content within the viewport. Auth forms with long errors or very small viewports may scroll inside their form panel so controls remain reachable:

- Controls: inputs and large buttons are 44 px high, regular buttons 40 px, field labels 14 px. The header is 60 px high and the side rail 60 px wide.
- Login and Register share the same frame: up to 1380 px wide, the existing 48/52 desktop panel split, and a form content width up to 560 px. Outer margins are 16 px on mobile and 24 px from `sm`. Card height is viewport minus those margins, capped at 720 px from `sm`; navigation between the two forms does not change the frame dimensions. Form horizontal padding is 24/40/48/64 px across the base/`sm`/`lg`/`xl` breakpoints. The right panel scrolls when necessary and centers shorter forms with auto margins, keeping taller forms reachable from the top. The shared layout also applies to Check Email and Verify Email.
- Register keeps Display name/Email and Password/Confirm Password in pairs from `sm`. Login/Register form groups are separated by 20 px normally (12 px in short viewports); the register field pairs use 16 px gaps (12 px when short), and checklist rows use 8 px (4 px when short). The form column omits the duplicate brand on large screens because the side panel already shows it.
- `short:` is a custom Tailwind variant (`max-height: 640px`, defined in `apps/frontend/src/style.css`) that tightens vertical spacing on short viewports.
- When data does not fit (for example many boards or members), use numbered pagination sized to the available space instead of scrolling or "Load more".
- Board cards use a compact row layout (icon beside the title, role chip and update time under it, then a two-line description) at a fixed 136 px height, instead of the taller icon-on-top card in `boards.png`, so two rows fit on a 1366×657 laptop. Long board descriptions in page headers are clamped to two lines.
- Row action menus ("⋮") open upwards when there is no room below, so they never make the content area scroll.
- Verify new screens at 1280×600, 1366×657, 1536×730, 1920×945 and 390×844, including error states.

## 3. Screen-by-screen contract

### A. `login.png`

- Match the pastel lavender grid/gradient background and centered large white/light panel.
- Match split composition: product narrative and embedded board visual left; login form right.
- Match spacing, heading hierarchy, field outlines, input icons, button height and indigo primary button.
- Login/register API and authentication logic belong to future auth feature issues, **not** the frontend-foundation task.
- Screenshot also shows “Remember me” and “Forgot password?”: do not assume the MVP includes these behaviors. Only show functional controls for approved scope; avoid inert links.

### B. `boards.png`

- Match left navigation rail, top header, page title row, search/filter/action alignment and board-card grid.
- Match board-card thumbnail/icon container, title, description, avatar stack, role chip and update-time placement.
- Screen includes mock workspace/project labels. The current MVP has **Boards, not a Workspace domain**; use suitable MVP terminology/data without creating a workspace feature.
- The screenshot includes a `Viewer` role; the MVP allows **OWNER** and **MEMBER** only. Never add a `VIEWER` role merely to mimic a badge.

### C. `kanban-board.png`

- This is the principal visual target for the board working area.
- Match top toolbar, narrow rail, four-column desktop layout, soft gray column backgrounds, compact white cards, inline add controls and avatar alignment.
- The **number of columns is data-driven**, not hard-coded to the four headings in the screenshot.
- Card positions and column positions come from backend-persisted ordering once the relevant features exist.
- Screenshot shows **priority badges** and some attachment icons. Priority/attachments are _not_ current MVP domains; do not implement those business features without scope approval.

### D. `card-detail.png`

- Match dimmed board backdrop, large centered white modal, two-column content/side-metadata layout, close control, comments section and activity rail.
- The MVP supports title, description, due date, multiple assignees, comments and structured Activity. Match their visual treatments closely.
- Screenshot also shows checklist, labels, attachments and priority. These are out of MVP. Do **not** add database fields/API or fake interactive controls for them. Reflow the modal gracefully using approved fields while retaining the same visual language and relative composition.

### E. `team-members.png`

- Match the side rail, table/panel design, toolbar controls, avatar/status composition and role-chip styling.
- The MVP handles **BoardMember**, not workspace-wide team/project management. Interpret this as the visual target for a **Board Members** screen/panel; do not create Workspace or Organization entities.
- Only OWNER and MEMBER roles exist in MVP. Admin/Viewer badges in the screenshot are presentation examples, **not** approved domain roles.
- MVP adds an existing registered user to a board; invitation emails/tokens and pending invitation status shown in the screenshot are out of scope.
- Presence can drive online indicators when implemented; do not invent persistent online status or last-seen tracking without an approved requirement.

## 4. Visual fidelity versus feature scope

The **look and composition** must follow the five images. The **underlying capabilities** must remain inside the MVP specified in `docs/project-overview.md` and `docs/architecture/database-design.md`.

The source images contain examples of unapproved features: Workspace/Organization, Admin/Viewer roles, priority, labels, checklist, attachment, notification badge, analytics, invitation workflow, last-active tracking and forgot-password flow. Treat them as **visual artifacts**, not implicit product requirements.

When an image element conflicts with MVP scope:

1. Preserve layout/styling as closely as possible.
2. Replace with an MVP-supported equivalent where semantically valid.
3. Omit and reflow out-of-scope controls that otherwise would be dead/inert.
4. Record material departures in the feature PR description; if a feature is desired, propose a separate scope decision and issue.
5. Never sneak in new tables, enums, permissions or API endpoints merely because the reference image depicts them.

## 5. Implementation phases

### `feat/frontend-foundation` (the upcoming issue)

Implement only the **common visual foundation**:

- Theme tokens + typography and reusable style rules consistent with these designs.
- Base shell proportions (side rail / top header / content surface), if part of the chosen foundation.
- App-level provider organization, QueryClient, structural components and generic UI primitives when useful.
- Responsive foundations without hard-coded domain data.

**Not required in this issue:** full login, board list, Kanban board, card modal, team members, CRUD, Socket.IO integration or mock business screens.

### Later feature issues

- Auth frontend: follow `login.png`.
- Boards frontend: follow `boards.png`.
- Column/Card + drag/drop frontend: follow `kanban-board.png`.
- Card detail/comments/activity frontend: follow `card-detail.png`.
- Board member UI: follow `team-members.png`, constrained to BoardMember MVP.

Each screen PR should explicitly compare implementation screenshots against the corresponding target image.

## 6. Suggested visual acceptance workflow

For each completed screen:

1. Capture a desktop screenshot at the target's approximate viewport size.
2. Compare side by side with the approved screen in `docs/design/screens/reference/`.
3. Fix structural mismatches first, then typography, spacing, color, border/shadow and icons.
4. Verify keyboard navigation, focus/hover and small-screen usability.
5. Verify business behavior and authorization independently from pixel-level visual accuracy.
6. Show a screenshot comparison in the PR and explain any deliberate MVP-scope differences.

**Do not** claim pixel-perfect parity without visual verification.

## 7. Asset usage and attribution

These screen images are project-provided visual baselines. The team should verify the original creators' licensing/permissions before distributing them in a public repository, and record attribution or source links if needed. Embedding an image in this design package does not establish copyright ownership or permission to reuse individual photographs, icons or other assets from it in production.

---

**Visual direction:** implement these five approved designs faithfully rather than generating a generic Kanban/dashboard appearance. **Feature direction:** adhere to the actual documented MVP.
