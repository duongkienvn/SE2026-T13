# Final Kanban refinement browser evidence

Native Chrome DevTools screenshots of the production Board components in
`/qa/board-filter-preview.html`. The DEV entry intercepts requests and uses
synthetic QA data. The optional six-viewer snapshot renders the actual presence
component through a fixture client; it creates no socket. These are
implementation captures, not replacement approved design references.

## Coverage and visual comparison

[88 layout observations](layout-qa.json) cover light/dark modes at 320, 375,
768, 1280 and 1440px: populated photo/color, empty, long text, three active
filters, Workspace reader and archived owner. Additional cases cover collapsed
sidebars at 1280/1440, tall columns, empty read-only Boards and 600px height.
Viewports use device scale factor 1; mobile heights are 812px, desktop/tablet
heights 900px unless the short-height case specifies otherwise.

The captured UI was visually compared with the supplied approved mockup:
no decorative Board icon, desktop metadata beside identity, connected navigation,
a subdued recognizable photo, defined near-opaque columns and a compact filter
toolbar. Card Preview V2 remains unchanged. The standard desktop header is 115px
and the unfiltered toolbar is 58px. Active chips wrap within the mobile toolbar.
Existing 280px columns and official branding are retained per the brief.

All measured cases have flush canvas sides and fill at least the remaining
height, without page/main horizontal overflow or toolbar overflow. Read-only
and filtered cases have zero drag handles. At 320 × 600 with long text and six
viewers, the main area scrolls vertically 51px to retain a usable minimum canvas;
the other cases have no main-area vertical overflow.

## Screenshots

35 unedited native browser captures. Photo/color/empty/long/filter rows include
both themes; filenames identify theme and width. Representative desktop/mobile
captures from each state were visually inspected against the approved layout.

| Case                  | Light                              | Dark                              |
| --------------------- | ---------------------------------- | --------------------------------- |
| Photo, 320px          | [View](photo-light-320.jpg)        | [View](photo-dark-320.jpg)        |
| Photo, 375px          | [View](photo-light-375.jpg)        | [View](photo-dark-375.jpg)        |
| Photo, 768px          | [View](photo-light-768.jpg)        | [View](photo-dark-768.jpg)        |
| Photo, 1280px         | [View](photo-light-1280.jpg)       | [View](photo-dark-1280.jpg)       |
| Photo, 1440px         | [View](photo-light-1440.jpg)       | [View](photo-dark-1440.jpg)       |
| Color, 375px          | [View](color-light-375.jpg)        | [View](color-dark-375.jpg)        |
| Color, 1440px         | [View](color-light-1440.jpg)       | [View](color-dark-1440.jpg)       |
| Empty, 375px          | [View](empty-light-375.jpg)        | [View](empty-dark-375.jpg)        |
| Empty, 1440px         | [View](empty-light-1440.jpg)       | [View](empty-dark-1440.jpg)       |
| Long text, 375px      | [View](long-light-375.jpg)         | [View](long-dark-375.jpg)         |
| Long text, 1440px     | [View](long-light-1440.jpg)        | [View](long-dark-1440.jpg)        |
| Three filters, 375px  | [View](filters-light-375.jpg)      | [View](filters-dark-375.jpg)      |
| Three filters, 1440px | [View](filters-light-1440.jpg)     | [View](filters-dark-1440.jpg)     |
| Workspace reader      | [375px](reader-light-375.jpg)      | [1440px](reader-dark-1440.jpg)    |
| Archived owner        | [375px](archived-light-375.jpg)    | [1440px](archived-dark-1440.jpg)  |
| Collapsed sidebar     | [1440px](collapsed-light-1440.jpg) | [1440px](collapsed-dark-1440.jpg) |

Additional states: [tall columns](tall-light-1440.jpg),
[empty Workspace reader](empty-reader-dark-375.jpg),
[empty archived owner](empty-archived-light-1440.jpg).

## Interaction checks and limits

[Eight recorded interactions](interaction-qa.json) verify:

- Filter Cancel preserves all three facets and drag restrictions; Reset/Apply
  restores the empty hint, 15 drag handles and focus to Filter.
- A Workspace reader's presence popover shows the current user and five unknown
  viewers, without exposing the protected roster. Escape closes it and restores
  focus without horizontal overflow.
- Keyboard column pick-up, ArrowRight and Escape announce cancellation and
  retain the original five-column order.
- Members, Board Settings and Kanban keep one Board title and the same 115px
  shared header with correct active navigation. Only Kanban has the canvas.

No browser console errors were found. Unit/integration tests additionally cover
actual mutations, routing/history, authorization/revocation, background versions
and realtime behavior. Browser QA does not claim live backend persistence,
multi-account socket/reconnect verification or deployment.
