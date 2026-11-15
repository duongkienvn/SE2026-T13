# MOB-16 Native Column management

[Issue #272](https://github.com/duongkienvn/SE2026-T13/issues/272) ·
[Approved Board reference](../../mobile/assets/03-board-detail-and-filters.png)

## Behavior and contracts

MOB-16 extends the MOB-15 Kanban view with an Add column entry point, a
per-Column overflow sheet, a name editor, accessible adjacent moves and an
explicit destructive confirmation. The empty Board shows Add column for
writers. Read-only and archived Boards keep their browsing experience.

| Operation | REST contract under `/api`                                                        | Mobile behavior                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List      | `GET /boards/:boardId/columns?page=&limit=` with 200                              | Reuses the MOB-15 paginated reader and the session-scoped Column key. The order uses exact decimal positions and UUID tie-breaks.                                          |
| Create    | `POST /boards/:boardId/columns` with `{ name }` and 201                           | Validates the trimmed 1–120-character name. After the authoritative refresh, reveals the returned Column by UUID, loading later Column pages when needed.                  |
| Rename    | `PATCH /boards/:boardId/columns/:columnId` with `{ name }` and 200                | Prefills the current name. An unchanged draft closes without saving, including when another client renamed the Column while the editor was open.                           |
| Move      | `PATCH /boards/:boardId/columns/:columnId/move` with `{ beforeColumnId }` and 200 | Uses the next authorized Column ID after computing the adjacent insertion slot. A null anchor appends. Moves wait for a complete, current ordered Column list.             |
| Remove    | `DELETE /boards/:boardId/columns/:columnId` with 204                              | Confirms the named Column. Uses the empty-body adapter. A 409 `COLUMN_NOT_EMPTY` explains that active or archived Cards still block removal and leaves the Column visible. |

The client checks current Board read and write capabilities and active status.
The server requires mutable Board membership and validates the Column and
anchor against the Board inside its write transaction. Card counts and active
filters have no authority over deletion. The server checks every Card
reference and handles a foreign-key conflict if a reference is created during
deletion.

The Board-scoped write lock covers the request and its authoritative refresh.
Writes are pessimistic, and returned positions never recalculate neighboring
ranks. The client cancels superseded reads and invalidates Columns, plus the
Board’s filtered Card lists after deletion. Existing Column socket hints and
foreground/reconnect reads reconcile changes from other clients. A child 404
allows the existing Board access probe to decide whether access was lost.
Session change and confirmed revocation fence late results and dismiss editors.

A recoverable error keeps the name draft. A transport failure that could have
committed a create refreshes the Board and requires the user to check the
server list and acknowledge it before sending another POST. Rate limit retry
uses the API delay. Board access rechecks can temporarily hide the editor
while keeping the draft for the same authorized session.

## Handoff

`apps/mobile/src/features/columns/api.ts` exports the typed `Column` decoder
and `createColumnApi` with `list/create/rename/move/remove`.
`mutations.ts` exports `runColumnMutation`, its discriminated
`ColumnMutationResult`, `columnMoveAnchor` and `canMutateColumns`.
`useBoardKanban` exposes `columns.orderedColumnIds` in server position order
for the pages loaded. Check `columns.complete` before treating the last loaded
Column as the Board's final Column. MOB-17 can pass a selected Column's UUID to
Card create or move using its own Card contract and apply the same verified
Board gate. Column actions are independent of Card placement and gestures.

After MOB-14 lands, verify archived Board restoration, visibility and Workspace
moves, and write-capability loss while a Column sheet or request is active.
The current Board authorization and realtime contracts are used now.

## Verification

- `pnpm test` passed on the serialized rerun with `VITEST_MAX_WORKERS=3`
  and `npm_config_workspace_concurrency=1`. Results were 244 Mobile Node
  tests, 209 Mobile component tests, 1,283 backend tests, 1,677 Web tests,
  and 20 shared tests. The initial run timed out waiting for an unrelated
  Workspace Discovery star control. That suite passed on the rerun.
- Mobile lint, Mobile typecheck, root `pnpm lint`, and changed-file Prettier
  passed. The default root `pnpm format:check` flagged the Windows checkout's
  CRLF line endings. `pnpm format:check --end-of-line auto` passed.
- Root `pnpm build` passed. The Android Hermes export included 1,358 native
  sources, shared ESM, and the approved logo. Its bundle verifier found no
  Web, server, or Node shim imports.
- The Mobile Column transport and mutation suite exercises exact payloads and
  statuses, name and anchor validation, ordering across pages, duplicate and
  concurrent commands, lost access, timeouts, and reconnect invalidation.
  The Board Kanban component suite covers the editor, offline draft recovery,
  removal conflicts, and the existing MOB-15 pagination, filters, previews,
  and scroll restoration regressions.
- `pnpm --filter @kanban/backend test:columns:database` passed on disposable
  PostgreSQL 16. A live REST and Socket.IO smoke on the same local backend
  verified create (201), rename and move (200), and deletion (204). It checked
  both move anchor forms and confirmed that each command published its event
  after persistence.
- Android Expo Go on a Pixel 8 emulator (API 36, 320 dp wide) used the local
  backend. The create action remained reachable with the keyboard open, and
  Android Back closed the keyboard while preserving the draft. The Board
  scrolled to reveal the new Column. Rename and Move left produced the
  expected persisted name and order. The named delete sheet preserved the
  Column with an archived Card and displayed the conflict message. Confirming
  deletion of the empty Column removed it from the real Board.
- The emulator retained the existing Board header, filter strip, and Column
  layout from the approved reference. At 140% system text in dark mode,
  vertical swiping revealed later Cards, horizontal swiping reached the last
  Column, and its Move right action was disabled. The editor accepted a long
  draft with the keyboard open. Android Back offered to discard it, and the
  database order and names remained as seeded. Accessibility labels were
  checked in the Android UI hierarchy. TalkBack, iOS, and a simultaneous
  live Web and Mobile UI session remain unverified.
  [Keyboard open](../../design/screens/implementation/mob-16-column-management/create-keyboard.png) ·
  [New Column revealed](../../design/screens/implementation/mob-16-column-management/created-column.png) ·
  [Archived Card conflict](../../design/screens/implementation/mob-16-column-management/archived-card-conflict.png)
