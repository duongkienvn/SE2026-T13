# Final Kanban Board UI refinement

## Approved scope and outcome

Implements the user-supplied **Final Kanban Board UI Refinement** brief and
approved mockup. This supersedes the previous Board header's decorative icon
and stacked desktop metadata. The existing full-size canvas and approved Card
Preview V2 remain in place.

| Reference element                               | State     | Implementation                                                                                                                                                     |
| ----------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Board identity                                  | Available | Name and optional description, without the decorative Board icon or a replacement identity badge.                                                                  |
| Star, role, visibility and presence             | Available | Beside identity on desktop, with a subtle divider; deliberate wrapping below identity on mobile. Visibility uses existing functional lock/people icons.            |
| Overflow menu                                   | Available | Right aligned, retaining its actions, focus and keyboard behavior.                                                                                                 |
| Primary navigation                              | Available | Existing destinations directly beneath identity, indigo active line and thin mobile scrollbar. Activity retains its existing history dialog.                       |
| Full-size canvas                                | Available | Existing continuous surface reaches content sides/bottom. A canvas-only neutral photo tint reduces contrast; cover/preset previews are unchanged.                  |
| Columns                                         | Available | 98% opaque semantic app surface, subtle border/shadow, compact header and count pill. Existing 280px width, Card spacing, actions and ordering logic are retained. |
| Filter toolbar                                  | Available | Restrained translucent surface with real count/chips and Clear, or “No filters applied”. Existing Apply/Reset/Cancel, URL state and drag restrictions remain.      |
| Decorative identity icon / unsupported controls | Excluded  | No Board header icon, fake search, List, Timeline or new features. Existing global shell Soon slots are unchanged.                                                 |

The standard desktop Board header measures **115px**, versus 151px in the
previous implementation's recorded layout: 36px less before the canvas.
Long names retain two-line clamping; desktop descriptions clamp to one line
with the full description available in the existing title tooltip. On narrower
screens descriptions retain their two-line allowance.

The mockup's composition is followed while preserving the official Kanvexa
branding, existing photo catalog and 280px column widths. The app shell,
directories, Workspace Overview, Card Detail and Members/Settings contents
were not redesigned.

## Files changed

- `boards/pages/BoardDetailPage.tsx`: remove decorative identity icon, arrange
  responsive identity/metadata/menu, add a functional visibility badge.
- `boards/components/BoardNavigation.tsx`: canonical indigo indicator and thin
  horizontal navigation scrollbar.
- `boards/components/BoardBackground.tsx` and `src/style.css`: canvas-only photo
  tint, with the existing cover rendering and preset validation preserved.
- `columns/components/KanbanColumn.tsx`: near-opaque surface, subtle separation,
  compact header/count presentation; no drag/mutation changes.
- `boards/components/KanbanBoard.tsx`: compact trailing Add column action.
- `cards/board-filter.tsx`: named filter group, readable toolbar and empty hint.
- `cards/board-filter-ui.test.tsx`: verify empty/applied facet presentation,
  count/chips, Clear callback and restored hint.
- `qa/board-filter-preview.tsx`: DEV-only six-viewer snapshot and validated
  initial filter parameters for reproducible layout QA. The snapshot cannot
  create a socket and does not claim a live server connection.

Feature paths above are under `apps/frontend/src/features/`; the QA entry is
under `apps/frontend/`. `KanbanCard.tsx`, backend, shared contracts, dependencies,
background persistence/versioning, auth/cache/access and realtime code are
unchanged. This task adds one normal local commit and preserves earlier commits.

## Verification

- **PASS:** `pnpm --filter @kanban/frontend exec tsc -b`.
- **PASS:** focused frontend tests with `VITEST_MAX_WORKERS=1`: 8 files / 98 tests
  covering filter draft/history, Kanban, Board navigation/detail, Card deep-link
  viewport behavior and background rendering/dialog checks.
- **PASS:** `VITEST_MAX_WORKERS=1 pnpm test`: frontend 122 files / **1,294 tests**,
  backend 91 suites / **912 tests**, shared **17 tests**.
- **PASS:** `pnpm build` for shared/backend/frontend. Existing Vite NODE_ENV and
  bundle-size warnings remain.
- **PASS:** `pnpm lint`, including a final rerun after the QA fixture addition.
- **PASS:** changed-file Prettier, evidence link/JSON checks and `git diff --check`.
- **FAIL, pre-existing:** full `pnpm format:check` reports 994 unchanged files
  with existing checkout CRLF formatting; no task file is among its warnings.
  No bulk formatting or Git line-ending configuration changes were made.
- **PASS:** [Chrome browser evidence](../../design/screens/implementation/final-kanban-refinement/README.md):
  88 measured layouts, 35 screenshots and eight interaction observations.

At 320 × 600 with long text and six viewers, the main area scrolls vertically
51px to retain the existing 288px minimum canvas. The other measured cases have
no main-area vertical overflow. All 88 avoid page/main horizontal overflow and
keep the canvas full width and at least the remaining height.

Browser QA uses isolated DEV fixtures. It verifies the real presentation and
controls, not live multi-account sockets or backend persistence. Database and
infrastructure integration scripts were not run for this frontend-only change.
Nothing was pushed, merged or deployed.
