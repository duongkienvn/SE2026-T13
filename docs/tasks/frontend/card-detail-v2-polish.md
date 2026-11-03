# Card Detail V2 visual and UX polish

Implements the supplied Card Detail mockup within existing functionality:
a balanced 1152px desktop dialog, fixed compact header, internally scrolling
body, main content and a separated properties/actions rail. Mobile stacks the
sections in one column. Board context remains visible when the Card is outside
the loaded Card page, with a focused regression test.

Description surfaces, checklist spacing, file/link attachment tiles, comments
and composer now use consistent hierarchy and spacing. Properties have section
icons, assignee chips, readable dates and a distinct archive action. Existing
editors, confirmations, permissions, validation, private download/preview flow,
cache/revocation handling, realtime and permalink behavior are preserved.
Unsupported mention/emoji controls and automatic file thumbnails were not added.

## Files

- `components/Dialog.tsx`: Card Detail sizing, header labels and body scrolling;
  other dialog sizes retain their presentation and shared focus handling.
- `cards/components/CardDetailDialog.tsx`, `CardAssignees.tsx`,
  `ArchiveCardSection.tsx`, `detail/CardDetailSection.tsx`, `CardDates.tsx`,
  `CardQuickActions.tsx`, `CardTextEditors.tsx`: composition and properties.
- `cards/checklists/CardChecklists.tsx`, `cards/attachments/CardAttachments.tsx`,
  `comments/CommentsSection.tsx`, `labels/components/CardLabels.tsx`: section
  presentation; attachment grid also constrains long filenames at 320px.
- `cards/components/CardDetailV2.test.tsx`: missing-column Board context.
- DEV-only `qa/board-filter-preview.tsx`: reproducible Card Detail fixture.

Component/feature paths above are relative to `apps/frontend/src/` (feature
groups under `features/`); the QA entry is under `apps/frontend/`.
Board layout, Kanban Card Preview, backend, contracts and dependencies are unchanged.

## Focused verification

- PASS: 102 tests across Dialog, Card Detail V2, Card actions, Card viewport,
  access and route navigation, checklists, attachments, labels and comments,
  using `VITEST_MAX_WORKERS=1 pnpm --filter @kanban/frontend test --` with those
  ten related test files. Final attachment rerun after the overflow fix: 15/15.
- PASS: `pnpm exec eslint apps/frontend`.
- PASS: `pnpm --filter @kanban/frontend build`; existing Vite NODE_ENV and
  large-bundle warnings remain.
- PASS: changed-file Prettier and `git diff --check`.
- Browser: draft/Keep editing/Cancel, date editor, 320px overflow, focus wrapping,
  mobile body scrolling with fixed header, empty description and read-only
  controls checked. No console errors found. Browser data uses isolated DEV
  fixtures; live S3 and multi-account realtime were not retested.
- Full frontend and backend/database suites were not run, as requested.

Exactly four primary screenshots were captured and visually inspected:

| Viewport   | Light                                                                                  | Dark                                                                                  |
| ---------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1440 × 900 | [Desktop](../../design/screens/implementation/card-detail-v2-polish/desktop-light.jpg) | [Desktop](../../design/screens/implementation/card-detail-v2-polish/desktop-dark.jpg) |
| 375 × 812  | [Mobile](../../design/screens/implementation/card-detail-v2-polish/mobile-light.jpg)   | [Mobile](../../design/screens/implementation/card-detail-v2-polish/mobile-dark.jpg)   |

All four have no dialog/body or page horizontal overflow; 320px also fits after
the grid correction. Nothing was pushed, merged or deployed.
