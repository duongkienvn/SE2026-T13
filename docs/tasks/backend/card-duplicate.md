# Same-Board Card duplicate API

Local implementation record for the backend part of
[#172 (P3-08)](https://github.com/duongkienvn/SE2026-T13/issues/172),
2026-11-01. No duplicate API existed, so P3-08 owns this narrow vertical. The
frontend side is in [Card Detail V2](../frontend/card-detail-v2.md). No
migration, shared contract or dependency change.

## Contract

`POST /api/boards/:boardId/cards/:cardId/duplicate`, Bearer JWT, body
`{ columnId?: UUID }` (unknown fields → 400). Answers **201** with the new
`CardResponseDto` and message `Card duplicated`.

| Copied (fresh IDs)                                                               | Never copied                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------ |
| title, description                                                               | assignees, comments, activity history            |
| `startDate`/`dueDate` instants                                                   | URL and FILE attachments, storage keys or grants |
| card labels of the same Board (`card_labels` rows)                               | permissions, foreign-Board relationships         |
| checklists and items in their order, **every item `isChecked: false`** (0/total) |                                                  |

- **Destination:** the source Card's column unless `columnId` names another
  column of the same Board (foreign column → 404 `COLUMN_NOT_FOUND`). The copy is
  appended at the end of that column with the same position/rebalance rule as
  Card create (`CardsService.appendCard`, now shared by `create`).
- **Creator:** the actor (`createdById`), recorded as one `CARD_CREATED`
  Activity without metadata.
- **Order:** checklist and item `position` values are copied exactly; the
  deferred parent-position UNIQUE constraints hold because each parent is new.

## Authorization, integrity and events

- Runs in one transaction behind `BoardAuthorizationService.requireMember(…,
{ mutable: true })`, the Board row lock used by every Card/label/checklist
  write. Label deletion, checklist edits, Column deletion and member removal
  therefore serialize with duplication; the copy sees a consistent snapshot.
- Read-only actors (Workspace-visible non-members, PRIVATE Workspace admins,
  outsiders) and archived Boards are refused exactly as other Card writes;
  an archived source Card returns 409 `CARD_ARCHIVED`.
- Any failure rolls the whole copy back (Card, labels, checklists).
- `card:created {boardId,cardId,columnId}` is published **after** commit through
  `BoardEventPublisher`; nothing is published on failure.
- **Idempotency:** none, matching Card create. A retry after a lost response can
  create a second copy. The client blocks repeat submits while a request is
  pending and reports the real result; it never auto-retries the POST.

## Verification

- Unit (`test/cards/cards-duplicate.spec.ts`, 5 tests): copied fields, unchecked
  items, label scope to the Board, lock-before-read, post-commit event,
  destination column, archived/404/foreign-column/read-only refusals, no event
  on failure. Mutation check: 4/4 mutants killed (copy `isChecked`, drop label
  Board scope, ignore `columnId`, allow archived source).
- Real PostgreSQL + Nest HTTP (`pnpm --filter @kanban/backend
test:card-duplicate:database`, requires `CARD_DUPLICATE_DATABASE_TESTS=local-only`
  and a loopback `DATABASE_HOST`; creates and drops its own random database):
  **5 groups pass** — full copy/exclusion matrix with reordered checklists,
  Guest duplicate into another column, foreign column/card/invalid body,
  401/outsider/PRIVATE and WORKSPACE_VISIBLE viewers/archived Card/archived Board
  create nothing, concurrent duplicates + label deletion (distinct positions, no
  orphan links), and an injected checklist failure rolling everything back.
- Full backend Jest: 89 suites / 879 tests pass.
