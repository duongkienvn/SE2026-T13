# Card Detail V2, safe duplicate and quick actions

Local implementation record for
[#172 (P3-08)](https://github.com/duongkienvn/SE2026-T13/issues/172),
2026-11-01. Built together with [checklists & labels](checklists-labels.md)
(#173) and [attachments & advanced dates](card-attachments-advanced-dates.md)
(#174) on one branch. Backend part: [Card duplicate API](../backend/card-duplicate.md).
Design: [Board & Card V2 spec](../../design/post-mvp/board-card/ux-spec.md) and
its approved reference image.

## Layout

`CardDetailDialog` stays the route-linked overlay of
`/boards/:boardId/cards/:cardId` (Board stays mounted behind it). New dialog size
`detail` (`max-w-5xl`), full screen below `sm`.

| Area          | Content                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------- |
| Header        | Title, `Column in Board · Created · Updated`, **Edit title** (pencil) and **Close card** (×) |
| Under header  | Read-only label badges; archived / view-only notices                                         |
| Main column   | Description → Checklists (#173) → Attachments (#174) → Comments                              |
| Side rail     | Assignees → Labels (#173) → Dates (#174) → Actions                                           |
| Phone (< 768) | One column: main sections, then the rail, then Comments                                      |

Each block is its own component (`CardDetailSection` for main sections,
`CardRailGroup` for the rail) with its own Add/Edit action, so later work slots
in without changing the layout. No global "Add to card" menu (optional per the
issue); no Move, Delete, Group, Priority or cover controls.

## Editing lifecycle

- Title, description and dates use explicit **Edit → Save / Cancel**. Save sends
  only that field through the existing Card PATCH and leaves edit mode only after
  the server answers; errors keep the draft (`Description saved.` only on 2xx).
- Drafts live in `useCardDraft` (query cache key `card-draft/board/card`, never
  persisted), so a remount or breakpoint change keeps them; `clearBoardDrafts`
  still removes them on access loss, and logout clears the cache.
- Each draft remembers the server value it started from. When a refetch or
  `card:updated` brings a different value, the editor shows "Someone else
  changed …" with **Discard mine and load theirs**; Save then overwrites
  knowingly. Remote data never replaces typed text silently.
- `useLeaveGuard` blocks Close, Escape, Back/Forward, another card or page
  (React Router blocker) and reloads (`beforeunload`) while anything is dirty:
  card fields plus small section inputs (checklist item text, label rename, link
  form, an upload in progress) that report through `DirtyRegistryContext`.
- If the card turns read-only while a draft exists (archived elsewhere, role
  lost), the text is kept read-only with **Discard**; on 400/403/404 the draft
  and protected caches are removed and only a generic message remains.

## Quick actions

| Action    | Shown when                                | Behavior                                                                                                         |
| --------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Duplicate | active Board, editable role, active Card  | `POST …/duplicate`; disabled while pending (no auto-retry); success says what was not copied + **Open the copy** |
| Copy link | always                                    | existing clipboard/fallback behavior, rail styling                                                               |
| Archive   | same as Duplicate                         | existing confirm-in-place; warns unsaved edits will be discarded; closes after success                           |
| Restore   | archived Card on an editable active Board | existing restore endpoint; card becomes editable in place                                                        |

`boardReadOnly` (archived Board, Workspace-only viewer, `canWriteBoard: false`)
hides every mutating control; Copy link and reading stay.

## Verification

- New/updated tests: `CardDetailV2.test.tsx` (12), `CardActions.test.tsx`
  (explicit edit flow), permalink suites (Edit before typing; second card opens
  without the discarded draft). Mutation checks (part of 14/14 frontend): no
  restore on archived Board, duplicate disabled while pending, guard covers
  section drafts, remote change notice.
- Real backend + Chrome (disposable `kanban_p3_qa` database, memory attachment
  driver): duplicate copied 0/5 unchecked items, labels and dates and no
  assignees/attachments; Escape on an unsaved description prompted; a
  Workspace viewer saw no edit controls; a member restored an archived card.
- Screens in
  [`implementation/card-detail-v2/`](../../design/screens/implementation/card-detail-v2/):
  320/375/768/1280/1440, light and dark, no horizontal overflow at any size.

## Notes and risks

- The dialog body scrolls on short screens (spec allows it for Card Detail).
- `KanbanCard` previews were not touched (P3-13 owns them).
