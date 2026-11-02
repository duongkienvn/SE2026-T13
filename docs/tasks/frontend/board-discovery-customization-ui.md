# Board discovery and customization UI

Workspace Board filters and personal Starred/Recent use the
authenticated discovery API and URL parameters `view`, `q`, `sort`, `status`,
and `page`. Star mutations and recorded Board visits refresh account-scoped
Workspace and Board lists. Background changes refresh Board details and lists;
the existing Board access event refreshes them for other occupants.
Personal Board tiles render the selected preset; a failed star-state request can
be retried. A failed view recording retries on reconnect, while a confirmed
access denial evicts protected data. Late responses from an earlier Board access
version do not update or evict the current grant.
When access must be rechecked after reconnect, cached private star state is
cleared and fetched again under the current grant; late reads cannot restore it.

## Photo preset manifest

The bundled JPEGs in `apps/frontend/public/board-backgrounds/` are resized
copies of the photographs already identified by the backend catalog. Their
source is Unsplash and the backend handoff identifies the
[Unsplash License](https://unsplash.com/license):

| ID        | Source                                                       |
| --------- | ------------------------------------------------------------ |
| mountains | https://images.unsplash.com/photo-1464822759023-fed622ff2c3b |
| forest    | https://images.unsplash.com/photo-1448375240586-882707db888b |
| coast     | https://images.unsplash.com/photo-1500530855697-b586d89ba3ee |
| lake      | https://images.unsplash.com/photo-1470770841072-f978cf4d019e |

## Concurrent background edits

The additive `background_version` migration initializes existing Boards to
zero. Each background change increments this counter under the existing Board
row lock. The picker sends `expectedVersion`; a stale version returns 409,
including when the preset changed and then changed back. Apply the migration
before deploying this frontend. To preserve existing API clients the field is
optional, so older clients still perform unconditional writes; migrate those
clients to the conditional contract. Downgrade refuses to drop nonzero
versions; preserve the database and roll forward.
The Board PostgreSQL integration suite saved and reloaded all 12 presets on a
temporary local container and exercised concurrent conditional writes.

The personal `/boards` directory now requests one server page at a time. The
query, status, view, sort and page are encoded in the URL. The Workspace API
PostgreSQL/HTTP suite (`pnpm --filter @kanban/backend test:workspace-api:database`)
passed against a temporary local container, covering private Board denial,
Board Guests, Workspace-visible readers, revocation, visibility and moves.
The isolated Workspace, personal Board directory, and background picker fixtures were rendered in
Chrome at 320, 375, 768, 1280 and 1440 CSS pixels in light and dark themes.
At each width the document and main content reported no horizontal overflow.
The personal directory initially overflowed at 320 and 375 pixels; the grid
was fixed and the measurements and captures repeated. Fixtures use simulated
star state, so they do not demonstrate live API persistence.
The picker displayed four usable photo choices at each viewport and its dialog
reported no horizontal overflow. See [320px light picker](../../design/screens/implementation/board-discovery-customization-ui/picker-light-320.png)
and [1440px dark picker](../../design/screens/implementation/board-discovery-customization-ui/picker-dark-1440.png).

Chrome captures: [320px light](../../design/screens/implementation/board-discovery-customization-ui/workspace-light-320.png),
[375px dark](../../design/screens/implementation/board-discovery-customization-ui/workspace-dark-375.png),
[768px light](../../design/screens/implementation/board-discovery-customization-ui/workspace-light-768.png),
[1280px light](../../design/screens/implementation/board-discovery-customization-ui/workspace-light-1280.png),
and [1440px dark](../../design/screens/implementation/board-discovery-customization-ui/workspace-dark-1440.png).
Personal directory captures include [320px light](../../design/screens/implementation/board-discovery-customization-ui/personal-light-320.png)
and [1440px dark](../../design/screens/implementation/board-discovery-customization-ui/personal-dark-1440.png).
