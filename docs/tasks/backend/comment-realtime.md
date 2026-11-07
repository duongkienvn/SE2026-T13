# Comment realtime synchronization (H1c)

Comment POST, PATCH and DELETE keep the H1a REST contract. Each successful change and its Activity record commit in one TypeORM transaction before `BoardEventPublisher` sends an ID-only Socket.IO hint through the authorized Board delivery path. Unchanged PATCH requests create no Activity and send no event. Delivery failures do not change the committed REST result.

| REST mutation  | Business event    | Payload                          |
| -------------- | ----------------- | -------------------------------- |
| Create         | `comment:created` | `{ boardId, cardId, commentId }` |
| Changed update | `comment:updated` | `{ boardId, cardId, commentId }` |
| Soft-delete    | `comment:deleted` | `{ boardId, cardId, commentId }` |

`boardId` is emitted in lowercase. Card and Comment IDs come from persisted rows. The payload contains no content or user metadata. Authorization, archived-state checks and transaction rollback remain in CommentsService; a rejected or rolled-back mutation sends no event. The frontend treats events as hints and refetches the matching Card's comments through REST.

PERF-01 optionally echoes a valid UUIDv4 `X-Kanvexa-Operation-Id` request header as `operationId` on the corresponding committed event. Invalid or absent headers are ignored. It is an opaque per-request hint, not an authorization credential or user identifier; it does not change recipients or persistence. Older clients can ignore it, and clients must handle events without it. The originating tab can correlate its own hint with its REST refresh, while other tabs continue to process it.

Query keys stay nested under the Board detail and Card detail prefixes. Rejoining a Board resyncs mounted comment queries, including changes missed while offline. There is no event replay or outbox in this MVP phase.
