# Kanvexa — Post-MVP Visual Reference Register V1

**Approval:** All five visual directions approved during the 2026-10-25 Post-MVP design conversation. These are concept compositions, **not pixel-perfect implementation blueprints or proof that the underlying features exist**.

| Area                                | Approved image                                            | Governing spec                      |
| ----------------------------------- | --------------------------------------------------------- | ----------------------------------- |
| App Shell V2                        | `app-shell/approved-visual-reference-v1.png`              | `app-shell/ux-spec.md`              |
| Workspace UI V1                     | `workspace/approved-visual-reference-v1.png`              | `workspace/ux-spec.md`              |
| Board & Card Detail V2              | `board-card/approved-visual-reference-v1.png`             | `board-card/ux-spec.md`             |
| Home Dashboard & My Tasks V1        | `home-tasks/approved-visual-reference-v1.png`             | `home-tasks/ux-spec.md`             |
| Account Settings & Notifications V1 | `settings-notifications/approved-visual-reference-v1.png` | `settings-notifications/ux-spec.md` |

## Review procedure

1. Match screen purpose, information architecture, visual rhythm and visual hierarchy, not sample task titles, sample people or fake stats.
2. Apply **text overrides** from `../product-ux-blueprint.md`, `../design-guidelines.post-mvp.md`, and per-screen `ux-spec.md` wherever collage details conflict with scope/security.
3. Compare a real browser screenshot at equivalent viewport; document differences in PR. Check mobile and both themes (once theme exists).
4. Use official Kanvexa logo/brand tokens and existing components. The image itself must not be sliced into rendered UI or used as a page background.
5. Never interpret a mockup as explicit approval of background data, file-storage policies, pricing, new permission roles or unsafe destructive actions.

## Overrides applying to multiple images

- **Strictly forbidden: `Free Plan`, `Upgrade to Pro`, subscription/pricing/paid promotion**. Some reference imagery includes these unexpectedly; the user expressly rejected them and approved everything else only under this exception.
- `#615CF7` is the canonical primary indigo, even if mockup buttons appear blue.
- Workspace roles only ADMIN/MEMBER. Board roles OWNER/MEMBER. Mockup sample role labels are not a schema.
- Dashboard figures, profile names/photos/emails, deadlines, icons, backgrounds and Board contents are illustrative.
- Card hard Delete, Grouping, multi-board Move, My Tasks completion checkboxes, Bio/avatar upload and server session revocation must not be inferred from mockup alone.
- Mobile drawer follows App Navigation V2; a visually suggested mobile bottom bar does not supersede the approved model.

## Redistribution reminder

These generated concept images belong in design reference documentation. Do not extract pictured avatar faces, mock background art, stock-like imagery or other decorative image elements as production assets without reviewing ownership, accessibility and relevant usage permissions.
