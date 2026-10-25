# Kanvexa — Post-MVP Design Guidelines Addendum V1

**Purpose:** Additive instructions for the approved Post-MVP visual design. **Do not overwrite** the repository's current `docs/design/design-guidelines.md`, whose five MVP visual baselines remain in force for existing screens until explicitly superseded. Read both when implementing a Post-MVP feature.

## Authority and approved references

- Functional and access rules: `product-ux-blueprint.md` and `../roadmap/post-mvp.md`.
- Screen-level behavior: `post-mvp/<area>/ux-spec.md`.
- Design composition reference: `post-mvp/<area>/approved-visual-reference-v1.png`.
- Existing MVP design source: `docs/design/screens/reference/*.png` and current base guidelines.

## Brand and foundations

- Official `Brand` / `BrandLogo` components and official Kanvexa logo assets: no invented logo redesign or recoloring of the actual artwork.
- Typography: Inter with consistent system fallback.
- Existing tokens, sampled from current `apps/frontend/src/style.css` at baseline:

| Token                   | Value     | Use                                          |
| ----------------------- | --------- | -------------------------------------------- |
| `--color-primary`       | `#615CF7` | Primary controls, focus/selected affordances |
| `--color-primary-hover` | `#4F49E6` | Primary button hover                         |
| `--color-primary-soft`  | `#F0F2FE` | Selected navigation or accent backgrounds    |
| `--color-app`           | `#F7F7F9` | App content canvas                           |
| `--color-surface`       | `#FFFFFF` | Cards/dialogs/light surfaces                 |
| `--color-ink`           | `#172038` | Body/headings                                |
| `--color-muted`         | `#626A83` | Secondary labels                             |
| `--color-line`          | `#E4E8F1` | Hairline borders/dividers                    |
| `--color-danger`        | `#D1343A` | Warnings/destructive actions                 |
| `--color-success`       | `#16803C` | Confirmed success                            |

The **mockups sometimes skew toward vivid blue**; implementation must normalize to approved Kanvexa indigo tokens. Where source guidelines and screenshots disagree on colors, prefer current approved brand tokens and verify contrast. Do not paste hard-coded screenshot colors into many components.

## Theming

Light / Dark / Match System is approved Post-MVP scope, despite the prior MVP guidelines stating no theme switcher at MVP time. Extend semantic tokens and components; do not blanket-invert images or logo. Keep contrast accessible, focus visible, and avoid theme flash on initial render. Persist per-user preference with a safe early default and system sync in `system` mode.

## Layout composition

- Preserve current outer lavender frame, surface/card hierarchy, subtle border/shadow, generous desktop whitespace.
- Authenticated desktop App Shell: collapsible hierarchical sidebar + slim global header + scrollable main content.
- Mobile: drawer navigation, compact global actions, content width fully responsive; mockup bottom bar is not a mandatory navigation replacement.
- Board: breadcrumb, title/star/privacy/presence/share and Kanban/Filters, with secondary actions in overflow menu.
- Card: compact preview; detailed main-plus-side metadata on desktop and full-screen single-column on mobile.
- Workspace: Overview / Boards / Members / Settings; shared shell remains stable when switching pages.
- Settings: left rail on desktop, hierarchical list/details on mobile.

## UI primitives and behavior

Use reusable accessible primitives for Button, Input, Dialog, Dropdown/Menu, Tabs, Toast, Badge, Avatar, Skeleton, Empty/Error State, Date Picker, File Picker, Checkbox and Confirmation Dialog. Prefer existing components and extend them before adding competing copies. Respect keyboard, ESC, focus trap/restore, pointer/touch, loading/disabled/saving states, ownership and aria-current. Data-rich pages should support pagination/infinite lists appropriately and avoid fake counts.

## Explicit visual exceptions and exclusions

1. App Shell image includes `Upgrade to Pro`/`Free Plan`: **remove completely**, in light, dark, tablet and mobile. No replacement paid-tier tile or pricing.
2. Board & Card collage shows controls such as hard Delete, arbitrary Move, Group: these do **not** authorize new scope. Hide or replace with approved actions only.
3. Home/My Tasks collage shows task-completion checkboxes and may show mobile bottom navigation: not approved standalone completion model; drawer remains canonical on mobile.
4. Settings collage contains Bio, Upload Avatar and Sessions/Logout: not automatically approved. Reuse current avatar URL; sessions require backend revocation before any claim that they work.
5. Samples include names, avatars, tasks, email addresses, dates and metrics: all placeholders, not content or branding assets.

## Quality & review

For each feature PR, capture comparable screenshots on desktop, mobile and any breakpoint with material layout changes; test both supported themes, focus/keyboard, permissions/read-only and loading/error states. Include a short discrepancy report if any intentionally different design decision is made. Mockup imagery may not be used as app backgrounds or frozen UI. Do not add icons, typefaces or images with unverified redistribution rights as production assets.

**Implementation instruction:** A visual approval alone does not approve code changes, database changes, feature scope or deployment. Follow approved functional design, repo architecture and PR workflow.
