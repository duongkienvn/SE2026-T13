# MOB-17 Native Card lifecycle

[Issue #273](https://github.com/duongkienvn/SE2026-T13/issues/273) ·
[Board reference](../../mobile/assets/03-board-detail-and-filters.png) ·
[Card Detail reference](../../mobile/assets/04-card-detail.png)

The existing Board offers Add card in each writable active Column and a Card
overflow for Rename, Move to…, Duplicate, and Archive. Board actions opens
the paginated archive for authorized readers. Archived Cards open a read-only
preview through the existing typed route. Full Card Detail editing belongs to
MOB-18.

## REST and reconciliation

| Action    | Contract under `/api/boards/:boardId/cards`                    | Native behavior                                                                                                                                                                           |
| --------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read      | `GET /` with supported filters or `GET /:cardId`, 200          | Uses the existing filtered Kanban reader and scoped Card query. Archive uses `status=archived` in server order.                                                                           |
| Create    | `POST /` with `{ columnId, title }`, 201                       | Trim 1–120 characters. The adapter also handles optional nullable description and dates for later editors.                                                                                |
| Rename    | `PATCH /:cardId` with `{ title, expectedTitle }`, 200          | Skip unchanged titles. Preserve the draft on conflict. The backend checks the original title under its existing lock.                                                                     |
| Move      | `PATCH /:cardId/move` with `{ toColumnId, beforeCardId }`, 200 | Uses a same-Board Column and a UUID anchor. Explicit `null` appends.                                                                                                                      |
| Duplicate | `POST /:cardId/duplicate` with `{}` or `{ columnId }`, 201     | The server appends a new Card and copies title, description, dates, labels and checklists with fresh unchecked items. Assignees, comments, attachments and activity stay with the source. |
| Archive   | `POST /:cardId/archive` with no body, 200                      | Confirm before removing from the active feed. Readable content remains available via the archive.                                                                                         |
| Restore   | `POST /:cardId/restore` with no body, 200                      | Append to the original Column. Explain an unavailable Column or already-active conflict without a replacement destination.                                                                |

Precise placement reads a complete, unfiltered destination in pages of at
most 100 rows and refuses duplicated, inconsistent, or out-of-order pages.
The command rechecks the source and compares a fresh destination snapshot
with the one offered in the picker. Filtered or sorted Kanban views offer
append. The client preserves exact server positions and never supplies a
numeric rank. The backend transaction resolves races after the preflight.
Quick rename sends the original title as `expectedTitle`. The backend
checks it inside the existing Board-locked transaction and returns
`409 CARD_TITLE_CHANGED` on conflict. Existing updates can omit the
precondition. Ordering still has no snapshot token across requests.

Writes use the verified Board capability and resource grant, a per-Board
Card write lock, and an abortable authenticated transport with no retries.
The Board read gate remains available to authorized viewers and archived
Boards, while a confirmed revocation or session change removes protected
state. A child 404 prompts the existing Board access check. Pending and
ambiguous creates and duplicates survive Board navigation in the current
session. An ambiguous POST requires a fresh, unfiltered Board read and
explicit acknowledgement before another POST. The transport preserves
offline feedback and records whether fetch began. An ambiguous move
requires reopening the picker. The client keeps pending
changes pessimistic. Success and recoverable failures invalidate scoped
Card lists, affected detail and previews, and Home, My Tasks, and Search.
Existing Socket.IO hints and reconnect reconciliation use the same keys.
Server-filtered feeds decide which Cards remain visible after a write.

## MOB-18 handoff

- `features/cards/api.ts` exposes `createCardApi` with list, detail and
  lifecycle methods, plus typed create, patch and move inputs. Lists use the
  MOB-15 Kanban projection. Detail and write responses use the full
  allowlisted decoder from `features/cards/decoder.ts`.
- `cardOptions` and `useCard` in `features/cards/queries.ts` use the
  canonical `queryKeys.card`. Keep editor drafts separate from the
  authoritative detail query. The existing Board/Card route already uses the
  scoped Card adapter and observes Board access.
- `runCardMutation` applies the Board write gate and reconciliation.
  `reconcileCards` can refresh after additional scoped operations.
  Reuse `columns.orderedColumnIds`, `columns.complete`, and
  `canMutateColumns` for Column context and capability checks.
- After MOB-14, verify Board archive, restoration, visibility and Workspace
  moves while Card actions or an archived preview are open, including
  permission loss during a pending request.

## Verification

- Root `pnpm test` passed with `VITEST_MAX_WORKERS=3` after correcting a
  test fixture that mixed the preview projection with the full Card DTO.
  Totals were 247 Mobile Node tests, 214 Mobile component tests, 1,283
  backend tests, 1,677 Web tests, and 20 shared tests.
- Mobile lint and typecheck, root `pnpm lint`, and root `pnpm build` passed.
  The Android Hermes verifier checked 1,366 native sources, shared ESM,
  and the approved logo. Changed-file Prettier and `git diff --check`
  passed. Default `pnpm format:check` flagged the Windows checkout's CRLF
  line endings. `pnpm format:check --end-of-line auto` passed.
- The focused Mobile Board and auth-route component suites passed 29 tests.
  The three focused Node tests covered exact request/response contracts,
  251-Card ordering, drift, a duplicate-submission fence, live hint handling
  and reconnect/session isolation.
- On disposable PostgreSQL 16, `node test/cards/cards.integration.mjs`
  passed 15 groups, including simultaneous moves,
  dense positions, filtered pagination, archived read/restore, and role
  enforcement. `node test/cards/cards-duplicate.integration.mjs` passed five groups,
  including the copied fields and exclusions, concurrent duplicates and
  rollback. Both scripts ran from `apps/backend` after the backend build.
- Two independent REST clients on the disposable backend agreed on order,
  title, destination, copied fields, archive read access, and restoration
  after refetch. A Socket.IO subscriber received the corresponding
  post-commit hints.
- Pixel 8 Android Expo Go (API 36, 320 dp) ran against the disposable
  backend. Native touches created and renamed a Card, moved the first
  Card down, moved a Card across Columns, duplicated it, opened its
  read-only archived route, and restored it to the end of its original
  Column. PostgreSQL confirmed the final order. The narrow Board retained
  the approved reference's header, filters, and horizontal Column layout.
  A vertical swipe revealed later Cards. At 140% system text, the editor
  retained a 120-character title and Android Back offered to discard it.
  [Board](../../design/screens/implementation/mob-17-card-lifecycle/board.png) ·
  [Move actions](../../design/screens/implementation/mob-17-card-lifecycle/move-actions.png) ·
  [Archived Cards](../../design/screens/implementation/mob-17-card-lifecycle/archived-cards.png) ·
  [Large-text editor](../../design/screens/implementation/mob-17-card-lifecycle/large-text-editor.png)
- A separate Web sign-in opened the Board after Android's changes. Chrome
  showed the same To do order and both active Cards with the new title in
  Review after the archived copy was restored. iOS and screen-reader
  announcements were outside this smoke. Android control labels were
  inspected in the native UI hierarchy.
