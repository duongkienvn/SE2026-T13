# P4-04 — Notification events and comment mentions

This record describes the working-tree implementation, not a deployment. Apply
the additive, forward-only comment mentions migration explicitly after backup;
existing comments have no spans. Account cleanup must handle retained mention
User references, and hard deletion of a Comment cascades its spans.
The [P4-03 foundation record](p4-notification-foundation.md) is historical;
its statement that production producers do not yet exist predates this work.

| Committed source                    | Kind                 | Recipient and occurrence                                 |
| ----------------------------------- | -------------------- | -------------------------------------------------------- |
| New Card assignment                 | `CARD_ASSIGNED`      | Assignee, assignment UUID                                |
| Explicit mention added              | `COMMENT_MENTIONED`  | Mentioned Board member, comment UUID + recipient UUID    |
| Workspace invitation confirmed SENT | `WORKSPACE_INVITED`  | Existing verified matching account, invitation UUID      |
| Board membership add/remove         | `MEMBERSHIP_CHANGED` | Affected member, `add:` / `remove:` plus membership UUID |
| Board or Workspace role change      | `MEMBERSHIP_CHANGED` | Affected member, fresh role-change UUID                  |
| Workspace membership removal        | `MEMBERSHIP_CHANGED` | Affected member, `remove:` plus membership UUID          |

Routine self-actions do not create notices. Workspace joins through invitation
acceptance are self-actions. Board grants are immediate memberships, with the
existing informational email retained; `BOARD_INVITED` has no V1 producer.
Disabled in-app preferences suppress new rows. Best-effort
`notifications:changed` hints contain `{}` and follow commit. Reconnect and
REST reload remain authoritative.

## Comment contract for P4-10

POST and PATCH retain `content` and accept optional `mentions`, for example:

```json
{
  "content": "😀 @Linh",
  "mentions": [
    { "userId": "10000000-0000-4000-8000-000000000001", "start": 3, "end": 8 }
  ]
}
```

Offsets are zero-based JavaScript UTF-16 code units, start inclusive and end
exclusive: the emoji occupies offsets 0–2, the space 2–3, and `@Linh` 3–8.
The existing request validation trims leading and trailing content whitespace;
calculate spans against that final trimmed content.
Spans must be disjoint, whole surrogate pairs, and exactly `@` plus the current
display name of an explicit Board member. At most 20 spans and 10 distinct
recipients are accepted. Repeating a user creates one notice. Unannotated text
never creates a mention. A changed PATCH without `mentions` clears spans; an
unchanged PATCH without them preserves spans. Explicit arrays replace spans.
Responses add `mentions` with only `userId`, `start`, and `end`, sorted by start;
readers without access to the Board member directory receive an empty array.
The editor owns span tracking, accessible suggestions and safe text rendering.

For a permitted reader, the comment response includes, for example:

```json
{
  "id": "20000000-0000-4000-8000-000000000002",
  "cardId": "30000000-0000-4000-8000-000000000003",
  "authorId": "40000000-0000-4000-8000-000000000004",
  "content": "😀 @Linh",
  "mentions": [
    { "userId": "10000000-0000-4000-8000-000000000001", "start": 3, "end": 8 }
  ],
  "createdAt": "2026-11-04T10:00:00.000Z",
  "updatedAt": "2026-11-04T10:00:00.000Z"
}
```

Workspace invitation notices are resolved against the current invitation,
verified account and normalized email, pending status, expiry and SENT state.
No acceptance proof is stored or reconstructed, so the notice has a null target.
The required invitation email remains the acceptance channel.

P4-05 may add its durable optional email outbox at the same committed business
occurrence boundary, independently of in-app preferences, without changing these
occurrence identities or altering mandatory invitation mail.

## Local verification

The disposable PostgreSQL 16 server was bound to loopback. The notification
integration runner passed its 16 groups, including populated upgrade, fresh
migration chain, metadata drift, current ACL, authenticated HTTP and Socket.IO,
commit visibility, notification delivery failure and invitation verification.
The Card, Comment, Board member, Activity, Workspace API, Workspace membership
and invitation, database foundation, and PostgreSQL Board event regressions
also ran against disposable databases. Mail was fake; no production migration or
real mail was sent. Root `pnpm test` encountered parallel frontend timeouts;
the frontend rerun with `--maxWorkers=1` passed 122 files and 1,297 tests. The
backend run encountered a shared build-output race and an outdated comment DTO
assertion; both affected suites passed separately after correcting the fixture.
Repository-wide `pnpm format:check` reported formatting drift, while the changed
files passed a separate Prettier check. See the handoff response for the exact
check outcomes and limitations.
