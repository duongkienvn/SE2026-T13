# Kanvexa board extensions

This extends the incumbent board UI and the approved rules in
`../../docs/design/design-guidelines.md` and
`../../docs/design/post-mvp/board-card/ux-spec.md`. The existing React components
and `src/style.css` remain the visual source of truth; no new palette, fonts,
dependencies, routes or product-wide redesign are introduced for P1-02.

- Mode: operate. Help current board members find archived cards and restore them.
- Tokens: existing Inter sans, primary `#615cf7`, ink `#172038`, muted `#626a83`,
  surface white, line `#e4e8f1`, app `#f7f7f9`. Use semantic Tailwind tokens only.
- Primitives: ActionMenu for board actions, Dialog for the list, Button, Alert,
  Pagination, and ConfirmDialog for restore. Reuse their focus/hover/pending states.
- Layout: a wide dialog, divided list rows with title, column, archive timestamp
  and status; wrap actions beneath content on 375px screens. No nested card grid.
- Typography: existing 14px metadata, 16px row title, dialog heading scale. Long
  names wrap; dates expose full local timestamps through semantic time elements.
- Interaction: list and confirmation are successive dialog states, not stacked
  modals; Cancel returns to the archive list. Pending prevents duplicate submit.
  Success follows the server response and invalidates active/archive/detail caches.
- Accessibility: reuse focus trap, inert background, Escape, focus restoration,
  labelled buttons, live success/error notice, scrollable dialog, keyboard paging.
  Restore has no active-looking affordance on archived boards. No added motion;
  preserve reduced-motion behavior of existing primitives.
- Accepted limitations: the existing app is light themed; no dark-mode work,
  permalink routing, bulk restore, retention, or new global state is part of P1-02.
- QA: real browser at 375px/768px/1280px; archive list, confirmation, success,
  read-only board, paging, keyboard/focus and permission-loss states. Save evidence
  under `docs/design/screens/implementation/card-archive-restore/`.
