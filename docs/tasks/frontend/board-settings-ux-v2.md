# Board Settings and Board UX V2

The Board detail route accepts `/boards/:boardId/settings`; Card permalinks and
the existing Members route remain separate. Settings reuses Board mutations,
owner dialogs, and the Board Members page. Workspace metadata is shown only
when provided by an authorized Workspace context. The Board form keeps its
initial values while a remote update arrives and requires reopening the editor
before saving conflicting values.

Favorites and background selection belong to P3-12. Filtering and Card preview
changes belong to P3-13; any future filtered drag must not reorder a subset as
the complete column. No new endpoints or destructive actions are introduced.

Visual reference: [Board and Card V2](../../design/post-mvp/board-card/ux-spec.md).

The isolated Guest OWNER fixture was captured at 320, 375, 768, 1280 (short)
and 1440 pixels in light and dark themes; for example, [375 light](../../design/screens/implementation/board-settings-ux-v2/settings-375-light.png)
and [1440 dark](../../design/screens/implementation/board-settings-ux-v2/settings-1440-dark.png).
The initial viewport measurements showed no horizontal overflow. Its offline
presence indicator is expected because the fixture does not connect to a
realtime server. A synthetic five-column Board was also captured at [375](../../design/screens/implementation/board-settings-ux-v2/kanban-375-light.png)
and [1280](../../design/screens/implementation/board-settings-ux-v2/kanban-1280-light.png),
in both themes; horizontal overflow was confined to the Kanban region.
Keyboard, role and realtime scenario coverage remain unverified. The current
Settings surface uses the existing edit dialog and Members route; it is not a
complete visual or interaction acceptance of P3-11.
