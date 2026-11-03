# Full Kanban canvas implementation evidence

Actual browser captures from the local Vite DEV fixture
`/qa/board-filter-preview.html`, using the production application shell, Board
header, navigation, canvas, columns and Cards. The fixture intercepts requests;
these images contain synthetic QA data, not a production account. Captured and
visually inspected in the in-app browser. These are implementation evidence, not
new approved design references.

## Responsive coverage

[Layout measurements](layout-qa.json) record 84 cases. The main matrix covers
320, 375, 768, 1280 and 1440px in both themes: populated photo/color, empty
photo/color, long title/description, Workspace reader and archived owner.
Additional cases cover tall columns, 600px viewport height and empty read-only
Boards. All cases avoid page/main horizontal overflow. The standard matrix has
flush canvas sides/bottom and a plain header with compact navigation.

At 320 Ã— 600 with the long-text header, the canvas retains its 288px minimum
workspace height and the main area scrolls vertically by 38px. It does not clip
the canvas or introduce page-level horizontal scrolling. Tall Boards keep their
five existing column scroll areas within the canvas.

## Screenshots

31 unedited native browser JPEGs were captured and inspected. Desktop captures
are 1440 Ã— 900 unless their filename specifies another width; mobile captures
are 320/375 Ã— 812. Intermediate widths use 900px height.

| Case             | Light                              | Dark                              |
| ---------------- | ---------------------------------- | --------------------------------- |
| Photo, 320px     | [View](photo-light-320.jpg)        | [View](photo-dark-320.jpg)        |
| Photo, 375px     | [View](photo-light-375.jpg)        | [View](photo-dark-375.jpg)        |
| Photo, 768px     | [View](photo-light-768.jpg)        | [View](photo-dark-768.jpg)        |
| Photo, 1280px    | [View](photo-light-1280.jpg)       | [View](photo-dark-1280.jpg)       |
| Photo, desktop   | [View](photo-light-1440.jpg)       | [View](photo-dark-1440.jpg)       |
| Color, mobile    | [View](color-light-375.jpg)        | [View](color-dark-375.jpg)        |
| Color, desktop   | [View](color-light-1440.jpg)       | [View](color-dark-1440.jpg)       |
| Empty, mobile    | [View](empty-photo-light-375.jpg)  | [View](empty-photo-dark-375.jpg)  |
| Empty, desktop   | [View](empty-photo-light-1440.jpg) | [View](empty-photo-dark-1440.jpg) |
| Long text        | [Mobile](long-light-375.jpg)       | [Desktop](long-dark-1440.jpg)     |
| Workspace reader | [Mobile](reader-light-375.jpg)     | [Desktop](reader-dark-1440.jpg)   |
| Archived owner   | [Mobile](archived-light-375.jpg)   | [Desktop](archived-dark-1440.jpg) |
| Tall columns     | [View](tall-light-1440.jpg)        | [View](tall-dark-1440.jpg)        |

Additional captures:

- [Canvas scrolled to the trailing column/action](scroll-right-light-1440.jpg).
- [Inline Card draft](inline-card-light-1440.jpg).
- [Saved background affects the canvas only](saved-background-light-1440.jpg).
- [Empty Workspace reader](empty-reader-dark-375.jpg).
- [Empty archived owner](empty-archived-light-1440.jpg).

## Interaction coverage and limits

[Interaction observations](interaction-qa.json) record keyboard column
pick-up/move/cancel and its announcement, restrictive-filter removal of drag
handles and restoration on Clear, Add column dialog/Cancel, horizontal panning,
inline Card draft/Cancel, Members/Settings routing and background Cancel/Save.
The browser reported no console errors during these checks. Unit/integration
tests exercise successful creation, ordering, moving, deep links, session/access
revocation and background refusal/version handling.

Live backend persistence, multiple real accounts and socket reconnects were not
retested in the browser for this frontend layout change. Presence retains the
existing fixture connection state; screenshots do not claim a live roster or
deployment. No backend, contract, preset storage or realtime logic changed.
