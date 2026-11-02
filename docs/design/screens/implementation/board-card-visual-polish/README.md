# Board and Card polish implementation evidence

Captured in Chrome using the repository's isolated DEV fixtures and real React
components, with no request reaching a real account. Fixture data is labelled in
the screenshots and never imported by the production entry point.

- `global-{light,dark}-{375,1440}.webp`: unified Board covers/details and compact
  directory controls, compared visually with both user-supplied approved mockups.
- `workspace-{light,dark}-{375,1440}.webp`: same Board presentation, existing
  Workspace shell and a single-row secondary status navigation.
- `kanban-{light,dark}-{375,1440}.webp`: real bundled photographic canvas and
  compact preview metadata. Horizontal Board scrolling remains intentional.
- `kanban-color-{light,dark}-1440.webp`: softened color canvas in both themes.
- `create-{light,dark}-{375,1440}.webp`: creation form with bundled photo choices.
- `filter-{light,dark}-{375,1440}.webp`: collapsed desktop facets and expanded
  mobile facets, one scrolling dialog and sticky actions.
- `responsive-qa.json`: 30 measured layouts across global/workspace/Kanban,
  both themes and widths 320, 375, 768, 1280 and 1440. No document or main-content
  horizontal overflow; Card footers fit; Workspace status rows stay 44px high.
- `actions-light-1440.webp`: permitted overflow actions render outside the tile, above adjacent controls; Edit opens the right Board and Escape restores focus.
- `interaction-qa.json`: dialog width, visible actions, no nested scroll areas,
  focus inside dialogs, Escape dismissal and restoration to the opener.

The reference images include illustrative backgrounds, people and unsupported
controls. Implementation uses the existing bundled photographs, canonical colors,
authorized metadata, available actions and existing shell rather than reproducing
that illustrative business data. Exact dates retain saved formatting/timezone in
accessible labels/tooltips; preview text uses abbreviated month names and date
ranges. No new List or Timeline view was added.

Reproduce with `pnpm --filter @kanban/frontend dev --host 127.0.0.1` and:

- `/qa/workspace-boards.html?theme=light&route=/boards` (global).
- `/qa/workspace-boards.html?theme=dark` (Workspace).
- `/qa/board-filter-preview.html?theme=light` (photo Kanban).
- `/qa/board-filter-preview.html?theme=dark&background=blue` (softened color).

These artifacts establish local rendering, not live server/realtime deployment.
See the [task record](../../../../tasks/frontend/board-card-visual-polish.md) for
contract, regression and database validation.
