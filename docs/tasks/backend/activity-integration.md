# H2b Activity Recording Integration

H2b wires the H2a recorder into existing Board, BoardMember, Column, Card and Comment mutations. `plan.md` is not present in this repository; the 15-action scope comes from the H2b issue, the existing enums and [H2a](activity-core.md). H2c frontend rendering is separate.

| Action            | Persistent change                          | Entity ID             | Metadata                                                   |
| ----------------- | ------------------------------------------ | --------------------- | ---------------------------------------------------------- |
| `BOARD_UPDATED`   | Board name/description                     | Board ID              | `null`                                                     |
| `MEMBER_ADDED`    | Added existing user                        | membership ID         | `null`                                                     |
| `MEMBER_REMOVED`  | Membership deletion and assignment cleanup | deleted membership ID | `{ "targetUserId": "uuid" }`                               |
| `ROLE_CHANGED`    | Membership role changed                    | membership ID         | `{ "fromRole": "OWNER/MEMBER", "toRole": "OWNER/MEMBER" }` |
| `COLUMN_CREATED`  | Column created                             | Column ID             | `null`                                                     |
| `COLUMN_UPDATED`  | Column renamed                             | Column ID             | `null`                                                     |
| `COLUMN_MOVED`    | Column reordered                           | Column ID             | `{ "beforeColumnId": "uuid-or-null" }`                     |
| `COLUMN_DELETED`  | Empty Column deleted                       | deleted Column ID     | `null`                                                     |
| `CARD_CREATED`    | Card created                               | Card ID               | `null`                                                     |
| `CARD_UPDATED`    | Card title/description/due date changed    | Card ID               | `null`                                                     |
| `CARD_MOVED`      | Card moved or reordered                    | Card ID               | `{ "fromColumnId": "uuid", "toColumnId": "uuid" }`         |
| `CARD_ARCHIVED`   | Card archived                              | Card ID               | `null`                                                     |
| `COMMENT_CREATED` | Comment created                            | Comment ID            | `{ "cardId": "uuid" }`                                     |
| `COMMENT_UPDATED` | Own Comment content changed                | Comment ID            | `null`                                                     |
| `COMMENT_DELETED` | Own Comment soft-deleted                   | Comment ID            | `null`                                                     |

All 15 writers await `ActivityWriterService.record(manager, ...)` **inside the existing TypeORM business transaction**, after persistence and before commit. Validation/insert failures roll back the business write; rejected and effective no-op mutations do not write Activity. The actor is the authenticated caller. F2a publishes only after commit; membership removal still commits, evicts the removed user's sockets while holding the realtime queue, then publishes. Neither audit data nor the realtime event contains business text or request bodies.

`ActivityWriterModule` is write-only and imports no business modules. `ActivitiesModule` imports it and `BoardMembersModule` for its existing read authorization; business modules import only the writer. This avoids a circular module dependency and shares one writer provider across callers. `ActivitiesService.record(manager, input)` still delegates to the same writer for H2a callers. No new REST write route or websocket activity event exists.

Board create/archive and Card assign/unassign have no dedicated MVP action enum and **do not produce Activity**; F2a assignment events remain unchanged. Do not map them to another action type without product approval. Board/Column/Card/Comment unchanged updates and effective reorder no-ops retain their existing success responses without audit. H2c should consume the existing board-scoped `GET /api/boards/:boardId/activities?page=1&limit=20` endpoint, render action/metadata client-side, and retain `createdAt DESC, id DESC` ordering and BoardMember authorization; it must not write activities.

The isolated PostgreSQL script `pnpm --filter @kanban/backend test:activities:database` creates a random database, runs real migrations and services for the action matrix, verifies no-ops, actor/target IDs, safe metadata and real rollback when an Activity insert trigger rejects a write. It boots the real AppModule, checks HTTP Board update and Comment create appear through GET, then closes connections and drops **only** the generated database in `finally`. Existing F2a, service and HTTP regression suites run with `pnpm test`.
