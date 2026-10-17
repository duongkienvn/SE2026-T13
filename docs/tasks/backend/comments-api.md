# Comments REST API

H1a exposes the persistent, board-scoped Comments API. It does not publish Socket.IO events, create Activity rows, or change the frontend.

## Endpoints

All routes require a JWT bearer token and use the global `/api` prefix.

| Method   | Route                                                         | Success           |
| -------- | ------------------------------------------------------------- | ----------------- |
| `GET`    | `/api/boards/:boardId/cards/:cardId/comments?page=1&limit=20` | `200`             |
| `POST`   | `/api/boards/:boardId/cards/:cardId/comments`                 | `201`             |
| `PATCH`  | `/api/boards/:boardId/cards/:cardId/comments/:commentId`      | `200`             |
| `DELETE` | `/api/boards/:boardId/cards/:cardId/comments/:commentId`      | `204`, empty body |

Successful responses use the existing envelope:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "OK",
  "data": {}
}
```

The list response has `data` as an array and adds `meta` with `page`, `limit`, `total`, and `totalPages`.

## Request and response DTOs

Create and update accept exactly one field:

```json
{ "content": "A comment, including Unicode and newlines." }
```

`content` is trimmed and must contain 1–2000 characters. Unknown fields, `null`, empty/whitespace-only values, non-string values, and oversized values return `400`.

The public response contains only `id`, `cardId`, `authorId`, `content`, `createdAt`, and `updatedAt`. Timestamps are ISO 8601 UTC strings. `authorId`, `cardId`, `deletedAt`, and ownership never come from the request body.

List ordering is stable `createdAt ASC, id ASC`, with page 1 and limit 20 by default and a maximum limit of 100. Soft-deleted comments remain in PostgreSQL but are excluded from normal reads.

## Permissions

| Operation   | OWNER    | MEMBER   | Non-member | Member who is not the author |
| ----------- | -------- | -------- | ---------- | ---------------------------- |
| List        | Allow    | Allow    | `404`      | Allow                        |
| Create      | Allow    | Allow    | `404`      | N/A                          |
| Edit        | Own only | Own only | `404`      | `403`                        |
| Soft-delete | Own only | Own only | `404`      | `403`                        |

The URL is authoritative: the server verifies that the Card belongs to the Board and the Comment belongs to the Card. Archived Boards or Cards remain readable through list, but create/edit/delete return `409`. A deleted comment is treated as not found for normal update/delete requests.

Mutations acquire the Board row lock before checking Card and Comment state. This keeps Comment mutations ordered with Board/Card archive operations and prevents stale edit/delete operations from resurrecting a soft-deleted row. No Activity or realtime integration is included in H1a; those belong to later issues.
