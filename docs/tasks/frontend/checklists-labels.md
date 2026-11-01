# Card checklists and Board-scoped labels UI

Local implementation record for
[#173 (P3-09)](https://github.com/duongkienvn/SE2026-T13/issues/173),
2026-11-01. Uses the merged [checklists backend](../backend/card-checklists.md)
(P3-01) and [labels backend](../backend/board-card-labels.md) (P3-02) unchanged,
inside the [Card Detail V2](card-detail-v2.md) layout.

## Data layer

| Module                      | Query key                                | Notes                                                   |
| --------------------------- | ---------------------------------------- | ------------------------------------------------------- |
| `features/cards/checklists` | `[...boardKeys.card(b,c), 'checklists']` | all nine P3-01 routes in one typed `runChecklistAction` |
| `features/labels` (catalog) | `[...boardKeys.detail(b), 'labels']`     | whole catalog (≤ 200, two pages of 100)                 |
| `features/labels` (card)    | `[...boardKeys.card(b,c), 'labels']`     | assign answers the full list; unassign is 204           |

Keys sit under the Board/Card keys, so `card:updated` (item and label changes),
access revocation and logout reach them. `labels:changed` now also invalidates
the catalog (plus every card's labels, as before).

## Checklists

- Multiple checklists with title, `checked/total`, percent and an accessible
  progress bar, all from server counts (empty = 0%). Rename, delete (confirm
  when it has items; no soft delete), add items (field stays open for the next),
  edit item text, toggle, remove.
- **Order:** Move up/down buttons send anchors only (`before…Id`, `null` = end);
  positions are never computed or parsed on the client.
- **Fast toggles:** a click flips the value currently in the cache, previews it at
  once, and requests run one at a time per card, so the server receives them in
  click order. The server's answer is stored only when nothing else is queued;
  the last action or any failure refetches. Failures roll back to server state
  with a plain message (stale anchor/item, 403/404, 429, offline, limits).
- States: loading, none (editor hint vs reader text), empty checklist,
  saving/refreshing spinner, failed with retry, permission lost. Read-only
  viewers see checklists with disabled checkboxes and no actions.

## Labels

- Header and rail show named, colored badges (`LabelBadge` picks white or dark
  text by contrast; the name is always shown).
- **Edit labels** opens an in-place picker: search, tick/untick to assign on this
  card, edit name/color, create (assigned to this card), delete with a board-wide
  warning ("removed from every card … untick it instead"). Ten preset colors;
  an existing non-preset color is kept as "Current color".
- Errors: duplicate name, 200-label limit, deleted label, archived card/board,
  permission, 429, offline.
- Archived card on an active Board: **Manage board labels** keeps catalog edits
  (Board-level, per P3-02) while assignment checkboxes are disabled. Archived
  Board or read-only viewer: badges only.

## P3-13 handoff (Board previews, owned by Narromi)

Reusable, layout-free pieces: `LabelBadge` / `LabelBadges` (`size="sm"` for
tiles) from `features/labels/components/LabelBadge.tsx`, `useCardLabels`,
`labelKeys`, and `checklistKeys`. A lightweight `GET …/checklists/summary` hook
was not added because no preview uses it yet.

## Verification

- `CardChecklists.test.tsx` (11) and `CardLabels.test.tsx` (8), plus
  invalidation tests for the new keys. Mutation checks: stale DOM toggle,
  unserialized requests, catalog not refreshed, missing delete warning, all
  caught.
- Real backend + Chrome: a toggle persisted (4/5 on the server); ticking a
  label assigned it.
- Screens in
  [`implementation/checklists-labels/`](../../design/screens/implementation/checklists-labels/).
