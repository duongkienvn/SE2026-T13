# H2a Activity History Core

H2a provides the structured Activity persistence and board-scoped read API. It does not claim that the full audit history is populated: H2b still needs to call the recorder from Board, BoardMember, Column, Card and Comment mutations.

## REST read API

`GET /api/boards/:boardId/activities?page=1&limit=20` requires a valid JWT and current `BoardMember` membership. `page` starts at 1, `limit` defaults to 20 and is capped at 100. The response is the standard success envelope with pagination metadata.

Archived Boards remain readable. Missing Boards and non-members both receive a safe `404`. The query is restricted by the route `boardId`, and rows are ordered by `createdAt DESC, id DESC`. The ID is only a deterministic tie breaker; it is not used as a timestamp.

Example `data` entry:

```json
{
  "id": "activity-uuid",
  "boardId": "board-uuid",
  "actorId": "actor-uuid",
  "actionType": "CARD_MOVED",
  "entityType": "CARD",
  "entityId": "card-uuid",
  "metadata": {
    "fromColumnId": "source-column-uuid",
    "toColumnId": "destination-column-uuid"
  },
  "createdAt": "2026-10-16T12:00:00.000Z"
}
```

Only the DTO fields above are public. User, Board and ORM relations are not serialized. `metadata` is either `null` or a flat, action-specific JSON object; the API does not render display sentences.

## Writer contract

`ActivitiesService` implements the internal `ActivityRecorder` contract from `apps/backend/src/api/activities/activity-recorder.ts`:

```ts
record(manager: EntityManager, input: RecordActivityInput): Promise<void>
```

The caller must pass the `EntityManager` from its own business transaction. The recorder never starts a second transaction and never writes through the global repository. Therefore the business mutation and Activity row commit or roll back together. F2 realtime broadcasting remains outside this module and must happen only after commit.

The action/entity mapping is fixed to the existing enum values:

- `BOARD_UPDATED` → `BOARD`;
- `MEMBER_ADDED`, `MEMBER_REMOVED`, `ROLE_CHANGED` → `MEMBER`;
- `COLUMN_*` → `COLUMN`;
- `CARD_*` → `CARD`;
- `COMMENT_*` → `COMMENT`.

The first metadata policy allows only flat, bounded values for these actions:

- `CARD_MOVED`: `fromColumnId`, `toColumnId`;
- `COLUMN_MOVED`: `beforeColumnId`, which may be `null`;
- `ROLE_CHANGED`: `fromRole`, `toRole` using `OWNER` or `MEMBER`;
- `MEMBER_REMOVED`: `targetUserId`;
- `COMMENT_CREATED`: `cardId`.

All other actions use `null` metadata in H2a. IDs must be UUIDs, nested objects and long values are rejected, and the contract has no request-body, JWT, password, email, comment-content or description passthrough.

## Module boundary and limits

`ActivitiesModule` imports `AuthModule`, `BoardMembersModule` and the Activity repository, exports `ActivitiesService` for future trusted domain callers, and exposes only the GET controller route. There is deliberately no public POST, PATCH or DELETE Activity endpoint. The module does not modify Board, BoardMember, Column, Card or Comment mutation services, realtime code, frontend code, or the existing Activity schema/migration.

H2a can therefore produce an empty feed during normal operation until H2b integrates recorder calls. Full Activity History is blocked on H2b write integration and H2c frontend rendering.

## Verification

From the repository root:

```bash
pnpm --filter @kanban/backend test -- --runTestsByPath test/activities/activities.service.spec.ts test/activities/activities.dto.spec.ts test/activities/activities.e2e-spec.ts
pnpm --filter @kanban/backend test:activities:database
```

The database test creates a random temporary PostgreSQL database, runs migrations, verifies commit and rollback, forced insert failure, board isolation, stable tie ordering, archived-board reads, removed-actor history and non-member rejection, then drops the temporary database in `finally`.

Verification on 17 October 2026:

- focused activity unit/DTO/HTTP tests: PASS, 3 suites and 13 tests;
- `pnpm lint`: PASS;
- `pnpm build`: PASS;
- changed-file Prettier check and `git diff --check`: PASS;
- `pnpm format:check`: NOT PASS because the repository already has broad formatting drift across unrelated files;
- `pnpm test`: NOT PASS because three unrelated frontend tests time out/fail (`RegisterPage`, `CardActions`, `ColumnActions`);
- `pnpm --filter @kanban/backend test`: did not complete within the 300-second command timeout;
- `pnpm --filter @kanban/backend test:activities:database`: PASS after starting Docker PostgreSQL; persistence, commit/rollback, forced FK failure rollback, isolation, stable ordering, archived-board read and removed-actor history all passed.
