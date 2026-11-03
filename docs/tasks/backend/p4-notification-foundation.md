# P4-03 — Persistent Notification Foundation

Implementation record for [Issue #189](https://github.com/duongkienvn/SE2026-T13/issues/189),
implementing CX-01's backend foundation under the [roadmap](../../roadmap/post-mvp.md),
[Blueprint §8](../../design/product-ux-blueprint.md) and
[Notification UX specification](../../design/post-mvp/settings-notifications/ux-spec.md).
This record describes local implementation and verification, not deployment.

## Scope and module boundaries

`NotificationsModule` owns the six authenticated REST operations, inbox resolution
and read state. `NotificationPersistenceModule` exports `NotificationService`,
the two entity repositories and `NotificationInvitationResolvers`. It imports no
Auth, business-domain, mail or realtime module, so future producers can import it
without a circular dependency. `RealtimeDeliveryModule` exports the separate
`NotificationEventPublisher`; `NotificationInvalidation` is the inbox's transport
port. Persistence never invokes a transport.

No assignment, mention, invitation, membership or deadline producer is wired in
production. No startup records, debug creation endpoint, optional email sending,
scheduler, frontend or browser/push notification feature is included. Existing
assignment/comment/invitation mutations and transactional/security emails retain
their behavior. Synthetic occurrences and invitation verifiers exist only in tests.

## Schema and rollout

The additive `1794268800000-NotificationFoundation.ts` migration creates:

| Table / field                                          | Storage and invariant                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `user_notifications.id`                                | Generated UUID primary key                                                           |
| `recipient_user_id`                                    | Required User FK, `NO ACTION`; one recipient per row                                 |
| `kind`                                                 | Required varchar with CHECK restricting the six kinds below                          |
| `dedupe_key`                                           | Required varchar(200), unique with recipient, CHECK for kind-prefixed ASCII identity |
| `actor_user_id`, `workspace_id`, `board_id`, `card_id` | Nullable FKs, `ON DELETE SET NULL`; indexed individually                             |
| `created_at`                                           | Finite `timestamptz`, DB `clock_timestamp()` default                                 |
| `read_at`                                              | Nullable finite `timestamptz`, CHECK `read_at >= created_at`                         |
| `notification_preferences.user_id`                     | User primary key/FK, `NO ACTION`                                                     |
| Six `in_app_*` columns                                 | Non-null booleans, all default true                                                  |
| Three `email_*` columns                                | Non-null booleans, all default false                                                 |
| Preference timestamps                                  | Non-null `created_at` / `updated_at`, DB defaults; ORM updates modification time     |

Inbox index: `(recipient_user_id, created_at DESC, id DESC)`. Unread uses the same
index shape with `WHERE read_at IS NULL`. There are no saved titles, comment text,
email addresses, invitation proofs, arbitrary URLs or HTML. Timestamps represent
UTC instants and serialize as ISO strings ending in `Z`; notification storage has
no user-local grouping. P4-05 owns local reminder windows and DST calculations.

Card occurrences store Card and Board references; Board occurrences store only
Board; Workspace occurrences store only Workspace. Optional supplied parent IDs
are validated against the current hierarchy. Current Workspace is projected from
the readable Board, including after a Board move. Scope is retained in the dedupe
identity: deleting a Board cannot reinterpret its item as a Workspace notification.

Notification history and read state survive context deletion or access loss.
Recipient and preference FKs follow the existing explicit account-cleanup policy:
deleting a User with retained rows is refused until authorized account cleanup
handles them. Actor deletion nullifies only the actor reference. No purge is added.

Apply the new migration explicitly before starting the new application version;
`synchronize: false` and `migrationsRun: false` remain unchanged. Old application
code ignores the additive tables; no legacy data is rewritten. Take the normal
database backup and rehearse on an explicitly designated staging/test database
before a separately authorized rollout. `down()` always refuses destructive
rollback, including for empty tables. Recover by rolling forward; an application
rollback must retain the schema and history. No migration was run on development
or production data during this implementation.

## Kind and preference matrix

| Kind                 | In-app key (default ON) | Optional email key (default OFF) | Required context              |
| -------------------- | ----------------------- | -------------------------------- | ----------------------------- |
| `CARD_ASSIGNED`      | `cardAssigned`          | `cardAssigned`                   | Card                          |
| `COMMENT_MENTIONED`  | `commentMentioned`      | `commentMentioned`               | Card                          |
| `WORKSPACE_INVITED`  | `workspaceInvited`      | None                             | Workspace and source verifier |
| `BOARD_INVITED`      | `boardInvited`          | None                             | Board and source verifier     |
| `MEMBERSHIP_CHANGED` | `membershipChanged`     | None                             | Board or Workspace            |
| `DUE_REMINDER`       | `dueReminder`           | `dueReminder`                    | Card                          |

In-app OFF blocks future persistence only. Existing notifications, read state and
unread count remain. Email is independent: enabling it does not enable in-app or
send mail in this issue. Invitation mail and mandatory authentication, password,
verification and security mail are outside these toggles. `user_preferences`
remains separate and untouched.

## REST contract

All routes use the existing JWT/session guard, global rate limit and error
envelope, response DTO allowlists, Swagger and `Cache-Control: no-store`. All
successful operations return HTTP 200. Identity comes from the session, never
from a request's recipient field. The default prefix is `/api`.

| Method and route                                | Request                                                      | `data` result                            |
| ----------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| `GET /api/notifications`                        | `filter=all\|unread` (all), `page` (1), `limit` (20; 1..100) | `NotificationResponse[]`; sibling `meta` |
| `GET /api/notifications/unread-count`           | None                                                         | `{ "count": 3 }`                         |
| `PATCH /api/notifications/:notificationId/read` | UUID; no body or `{}`                                        | One `NotificationResponse`               |
| `POST /api/notifications/read-all`              | No body or `{}`                                              | `{ "updatedCount": 3 }`                  |
| `GET /api/users/me/notification-preferences`    | None                                                         | Full preferences below                   |
| `PATCH /api/users/me/notification-preferences`  | Partial nested booleans                                      | Full resulting preferences               |

Inbox example, `GET /api/notifications?filter=unread&page=1&limit=20`:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "OK",
  "data": [
    {
      "id": "10000000-0000-4000-8000-000000000001",
      "kind": "CARD_ASSIGNED",
      "createdAt": "2026-11-03T10:00:00.000Z",
      "readAt": null,
      "actor": {
        "id": "10000000-0000-4000-8000-000000000002",
        "displayName": "Linh"
      },
      "summary": "You were assigned to \"Review onboarding copy\"",
      "context": {
        "workspaceId": "10000000-0000-4000-8000-000000000003",
        "boardId": "10000000-0000-4000-8000-000000000004",
        "cardId": "10000000-0000-4000-8000-000000000005"
      },
      "target": {
        "kind": "card",
        "path": "/boards/10000000-0000-4000-8000-000000000004/cards/10000000-0000-4000-8000-000000000005"
      },
      "isUnavailable": false
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

`NotificationResponse` has exactly the nine fields shown. `actor` is null when
not currently disclosable; context IDs can be null according to scope. `target`
is `{kind: 'workspace'|'board'|'card'|'invitation', path: string}` or null. `readAt`
is null or the first server read instant. Repeating read preserves the exact
stored instant; repeating read-all returns zero. Read mutations include unavailable
history. They emit a hint only when rows changed.

Lists filter recipient and read state in SQL before count/page and always sort
`createdAt DESC, id DESC`. Each list count, page, contexts and actors use one
repeatable-read snapshot. An empty inbox yields `data: []`, `total: 0`,
`totalPages: 0`; an out-of-range page is empty with the actual total. Offset paging
is deterministic within a snapshot; new events between page requests can shift
offsets, so invalidate/reload pages on change rather than treating them as cursors.
No retention cap deletes history. Unavailable unread rows still contribute to count.

Read-all locks the recipient then performs one conditional bulk UPDATE. A producer
committed before that serialized update is included; one ordered afterward remains
unread. Concurrent first reads use conditional UPDATE and serialization retries,
preserving the first timestamp.

Preferences GET on an absent row performs no insert and returns:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "OK",
  "data": {
    "inApp": {
      "cardAssigned": true,
      "commentMentioned": true,
      "workspaceInvited": true,
      "boardInvited": true,
      "membershipChanged": true,
      "dueReminder": true
    },
    "email": {
      "cardAssigned": false,
      "commentMentioned": false,
      "dueReminder": false
    }
  }
}
```

PATCH example: `{"inApp":{"dueReminder":false},"email":{"dueReminder":true}}`.
The response is the same full shape, with only these two leaves changed.
Writes serialize per User row, including initial-row races and disjoint PATCHes.
At least one recognized boolean leaf is required. `{}`, null, arrays, empty
groups without another actual leaf, strings, unknown nested/root keys, null
groups/leaves and attempted security-mail settings are rejected. Read commands
reject supplied fields such as `readAt` or `recipientUserId`.

Malformed fields, unsafe page offsets, limits outside 1..100 and invalid UUIDs
return 400. Missing, expired or invalidated sessions return 401; absent and other
recipients' notification IDs return the same safe 404; throttled calls return 429.
Validation errors follow the existing `VALIDATION_FAILED` envelope; malformed JSON
can be rejected earlier as `BAD_REQUEST`. No raw entity, SQL or error stack escapes.

## Authorization and unavailable history

The list itself belongs to the recipient, independent of current Board access.
Details require the current canonical SQL Board ACL. Explicit Board OWNER/MEMBER
grants include guests; Workspace members can read WORKSPACE_VISIBLE Boards.
Workspace ADMIN alone grants no PRIVATE Board access. Workspace-only details
require current Workspace membership; a Board guest gains no Workspace directory
or name access. Actor resolution is batched but checks each item's own scope;
access to another Board on the same page cannot reveal that item's actor.

Current Board/Card archive rules preserve authorized read entitlement, so archive
alone does not erase details. Revocation, missing/deleted context or loss of read
entitlement returns exactly this historical item (example ID/kind/timestamps):

```json
{
  "id": "10000000-0000-4000-8000-000000000001",
  "kind": "CARD_ASSIGNED",
  "createdAt": "2026-11-03T10:00:00.000Z",
  "readAt": null,
  "actor": null,
  "summary": "This notification is no longer available",
  "context": null,
  "target": null,
  "isUnavailable": true
}
```

Names are resolved live after authorization and rendered through server-authored
plain-text templates; controls/bidi formatting are removed and names bounded.
No protected IDs, old titles, actor details or targets survive in unavailable
stubs. Paths are generated from existing `/workspaces/:id`, `/boards/:id`,
`/boards/:boardId/cards/:cardId` and `/invitations/workspace#proof=...` routes.
Clients render summaries as text, never HTML.

### Invitation verifier extension for P4-04

Register one batched verifier per invitation kind using
`NotificationInvitationResolvers.register(kind, resolver)`; unregister on module
cleanup if appropriate. The callback receives the caller's snapshot EntityManager,
recipient ID and readonly rows; returns a Map keyed by notification ID containing
`VerifiedNotificationInvitation`. `notificationOccurrence(row)` recovers the
stable source occurrence; the notification never stores a proof or email.

The originating module must check live source existence, pending state, expiration,
verified recipient ownership/email binding and any proof/session constraints
**before** returning a current name and IDs. It may opt in to the inviter's public
identity with `actorVisible`. Without that binding there is no invitation exception
to ACL. No handler, invalid context, source failure or terminal invitation yields
details: the safe fallback is unavailable. The registry caches handlers only.

A verified Workspace invitation may return a current 43-character base64url proof
as structured `destination: {kind:'workspaceInvitation', proof}`; only the fixed
fragment route is constructed, and no proof is stored by this foundation. If the
source cannot safely recover a proof, omit destination: target remains null.
A Board destination must match the verified Board and its current read ACL;
otherwise target remains null. Source verifiers must batch queries and avoid I/O
outside the supplied snapshot. P4-03 intentionally registers no production verifier.

## Producer and post-commit contract

Import the narrow persistence module and inject `NotificationService`. The API is
`record(manager: EntityManager, input: RecordNotificationInput)` or
`recordMany(manager, readonly inputs[])`. Both require the same DataSource and an
active caller-owned transaction. All IDs must be UUID v4. Invalid transaction,
kind, occurrence or mismatched context throws `NotificationRecordValidationError`.

`occurrenceKey` is backend-owned, 1..140 ASCII characters matching
`[A-Za-z0-9][A-Za-z0-9:._+-]*`. It is never an HTTP field. The stored key is
`<kind>:<card|board|workspace>:<occurrenceKey>` and fits varchar(200). Scope prevents
fallback after parent deletion. Callers must use a stable identity for one event:
new assignment row UUID, comment UUID plus mention-recipient identity, invitation
UUID, membership-change occurrence, or Card/recipient/due-instant/reminder-window
identity. Use a deterministic ASCII digest if the complete reminder identity is
too long. Never use titles, proofs, emails or an unbounded raw payload as identity.

Result: `{status, notificationId, recipientUserId}`. Status is `created`,
`duplicate` (existing ID), `disabled` or `recipient-missing` (null ID). Preference
OFF does not remove prior records; replay returns the existing record even after
access/context deletion. A new occurrence validates current context. Unique
recipient/key conflict uses insert-on-conflict and does not abort the business
transaction. Different occurrences can create new records.

Example for a future producer (illustrative integration code, not a wired trigger):

```ts
const outcome = await dataSource.transaction(async (manager) => {
  // Perform and authorize the domain mutation first, using its existing Board lock.
  const occurrence = await persistAuthorizedDomainChange(manager);
  const notification = await notificationService.record(manager, {
    kind: NotificationKind.CARD_ASSIGNED,
    recipientUserId: occurrence.assigneeId,
    actorUserId: authenticatedUserId,
    cardId: occurrence.cardId,
    occurrenceKey: occurrence.assignmentRowId,
  });
  return { domainResult: occurrence.response, notification };
}); // Transaction promise resolves only after COMMIT. Rejection publishes nothing.

if (outcome.notification.status === 'created') {
  await notificationEventPublisher.afterCommit([
    outcome.notification.recipientUserId,
  ]);
}
return outcome.domainResult;
```

The publisher catches transport failures and never turns committed business success
into an HTTP failure. Do not publish inside the transaction or inside a Board
coordinator queue. Do not retry an arbitrary committed domain mutation because a
hint failed. Normal transaction retries reuse the occurrence identity; rollback
leaves neither domain change nor notification. Duplicates, OFF and missing-user
results need no creation hint. Read and read-all already publish after their own commit.

Preference PATCH, producers and read-all acquire the User row with
`FOR NO KEY UPDATE`. This serializes preference/insert/read-all ordering without
blocking FK key-share checks for actors. For multiple recipients use `recordMany`
once: it prelocks distinct recipient IDs in sorted order and returns results in
input order. Future callers must preserve existing domain-lock order, avoid taking
User locks before Board locks and avoid loops that acquire recipient locks in
conflicting orders. Context/actor queries use the supplied manager, never a global
repository transaction. No outbox or durable transport replay is introduced;
PostgreSQL REST state is authoritative.

## Realtime and frontend integration

Shared `RealtimeServerEvents` declares `notifications:changed` with
`NotificationsChangedPayload = Record<string, never>`; runtime payload is exactly
`{}`. `RealtimeNotificationEvent.CHANGED` is separate from Board mutation event
constants. There is no notification socket write API, user-selectable room,
private backlog replay or title/ID/context in the event.

`emitToUser` snapshots existing authenticated sockets, queries the recipient's
current verified account/authVersion, then checks each socket's immutable original
owner, active connection and token expiry immediately before delivery. Multiple
tabs/devices receive their own hint only. Forged handshake/room/user data cannot
change ownership. Invalidated/expired sessions lose receive grants and disconnect
through the existing cleanup path. One broken socket cannot block another tab.
Logs contain static transport failure messages, no identity or content. Existing
Board grants, room coordinator, presence and business event APIs remain in place.

For P4-09, use shared contracts and the existing HTTP response helper, scope all
query caches/subscriptions by authenticated session and fetch inbox, count and
preferences on initial load. On `notifications:changed`, invalidate/refetch inbox
and unread count; coalesce bursts and discard stale session responses. Re-fetch
after reconnect/focus/reload to repair missed best-effort hints. Notification
preferences PATCH returns the full resulting object: update/invalidate that query
from the response. Preference changes do not themselves alter old history/count.
Settings consumers should refetch on focus/reconnect rather than expect a separate
preference socket event.

Show the unavailable stub without linking to protected context. Marking read does
not imply navigation succeeds; handle current Board/Card access loss safely and
use existing Card permalinks. Allow null actor/context/target. Do not compute unread
count from the visible page, auto-delete unavailable history or fabricate empty
data. Clear protected caches and subscriptions on logout/session change. P4-10
submits typed mentions only after P4-04 defines the comment mention input contract;
it consumes this inbox response without redesigning it.

| Downstream owner | Required next integration                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P4-04, @narromi  | Authorized assignment/mention/invitation/membership mutations; stable occurrence IDs; transaction-bound record calls; post-commit publisher; source-specific invitation verifiers and typed mention contract |
| P4-05, @narromi  | Server scheduler, due-instant/local-window dedupe, retries and optional opt-in email; independent channel preference checks; no mandatory-mail changes                                                       |
| P4-09, @mylecute | Bell/popover/page/preferences UI using exact shared REST types, unavailable states and session-scoped invalidation/reconnect                                                                                 |
| P4-10, @mylecute | Mention editor/submission through P4-04's future contract; safe text rendering and existing Card navigation                                                                                                  |

## Verification

`test:notifications:database` requires `NOTIFICATION_DATABASE_TESTS=local-only`,
a loopback `DATABASE_HOST`, explicit test-server connection settings and a
non-production environment. It never loads dotenv. The script creates random
databases, migrates/tests only those databases and closes/drops them in `finally`.
Mail is fake and avatar storage disabled. Run shared build before the command:

```sh
pnpm --filter @kanban/shared build
pnpm --filter @kanban/backend test:notifications:database
```

The 16 PostgreSQL/HTTP/Socket.IO groups cover a fresh full chain, populated upgrade,
zero ORM drift, forward-only refusal, constraints/indexes/retention, caller-owned
rollback/replay, preferences and races, ACL and actor privacy, archive/revocation,
deleted context, test-only invitation verifiers and terminal validity, observed
read-all/insert blocking in both orders, first-read races, multi-recipient ordering,
post-commit visibility/failure isolation, multi-tab ownership, real expiry and
authVersion revocation, reconnect and fresh-application recovery. A 1,200-row inbox
uses five SELECTs for either one or 100 Card-context items and an actual EXPLAIN
plan; this is a local scale sanity check, not a production latency guarantee.

Historical Board and Workspace rollback fixtures now perform their original
assertions before this forward-only migration, then verify current-schema behavior.
The database foundation fixture also updates current metadata discovery and includes
the existing Board-background migration in its historical extension rehearsal.
Email verification's isolated historical fixture similarly excludes the new
forward-only boundary, while its main source runs all migrations. Welcome-mail
rollback checks explicitly invoke the outbox migration under a transaction rather
than accidentally testing an unrelated newest migration; they assert table removal,
empty re-creation, zero full-schema drift and rejection of populated rollback.
No production migration or historical migration source was modified.

Local verification on November 3, 2026 used Node 22.17.0, pnpm 10.18.3 and
PostgreSQL 16.15. The notification server was a dedicated disposable Docker
container bound to `127.0.0.1:55489`; other integration scripts either used random
databases on that designated server or owned/removed their own local container.

| Check / command from repository root unless specified                                                  | Final result                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                                                            | PASS; full repository ESLint, including all new tests                                                                                                                        |
| `pnpm --filter @kanban/backend test`                                                                   | PASS: 99 suites, 1,069 tests; all unit and HTTP E2E, including 55 new tests in three suites                                                                                  |
| Shared tests in `pnpm test`                                                                            | PASS: 20 tests, including ESM/CommonJS notification exports and compile-time private-event contracts                                                                         |
| `pnpm --filter @kanban/backend test:notifications:database`                                            | PASS: 16 PostgreSQL/HTTP/Socket.IO groups; final expanded preference/empty-state fixture also passed via direct `node` after build                                           |
| `node apps/backend/test/database/database-foundation.integration.mjs`                                  | PASS: schema discovery, constraints, historical rollback/reapply and full current schema/forward-only boundary                                                               |
| `node apps/backend/test/boards/boards.integration.mjs`                                                 | PASS: discovery, per-user state, ACL, lifecycle, race, upgrade and query-plan regressions                                                                                    |
| `node apps/backend/test/workspaces/workspace-api.integration.mjs`                                      | PASS: Workspace lifecycle, ACL, rollback, concurrency and compatibility                                                                                                      |
| `node apps/backend/test/cards/cards.integration.mjs`                                                   | PASS: 14 groups, including assignments, filtering, archive/restore and races                                                                                                 |
| `node apps/backend/test/comments/comments.integration.mjs`                                             | PASS: persistence, author permissions, pagination, soft deletion and archived-Card read-only behavior                                                                        |
| `node apps/backend/test/users/user-preferences.integration.mjs`                                        | PASS: existing account preferences and concurrency                                                                                                                           |
| `node apps/backend/test/auth/password-security.integration.mjs`                                        | PASS: 16 PostgreSQL/REST/Socket.IO security groups                                                                                                                           |
| `node apps/backend/test/productivity/productivity.integration.mjs`                                     | PASS: nine My Tasks/Home groups, including ACL, timezone and snapshot races                                                                                                  |
| `node apps/backend/test/search/search.integration.mjs`                                                 | PASS: seven global-search groups                                                                                                                                             |
| `pnpm --filter @kanban/backend test:workspace-members:database`                                        | PASS: members, invitations, fake mail, Guest and Board ACL/realtime/race regressions                                                                                         |
| `node test/board-members/board-members.integration.mjs` from `apps/backend`                            | PASS: membership, assignment cleanup, access revocation and fake post-commit member mail                                                                                     |
| `pnpm --filter @kanban/backend test:email-verification:database`                                       | PASS: 16 groups plus its database-foundation child check                                                                                                                     |
| `node test/auth/welcome-email.integration.mjs` from `apps/backend`                                     | PASS: 15 groups; fake mail and mocked SDK, no real provider request                                                                                                          |
| `node -r ts-node/register test/realtime/realtime.integration.mjs` from `apps/backend`                  | PASS: existing real PostgreSQL/socket auth, rooms and session regressions                                                                                                    |
| `node -r ts-node/register test/realtime/board-events/board-events.integration.mjs` from `apps/backend` | PASS: existing real Board events, ordering, rollback, revocation and delivery-failure regressions                                                                            |
| `pnpm build`                                                                                           | PASS: all workspace packages; final backend rebuild also passed after the read-command Swagger fix                                                                           |
| `pnpm --filter @kanban/frontend test --maxWorkers=1`                                                   | PASS: all 122 files / 1,297 tests, unchanged tests/timeouts                                                                                                                  |
| `pnpm test`                                                                                            | FAIL: default parallel frontend run reproduced 12 timing-sensitive failures in nine unchanged frontend files; shared passed; complete backend subsequently passed standalone |
| `pnpm format:check`                                                                                    | FAIL: 1,078 unchanged files flagged; zero overlap with this issue's changed files                                                                                            |
| Changed-file `pnpm exec prettier --check`, `git diff --check`, relative documentation links            | PASS                                                                                                                                                                         |

Direct regression commands were run with the explicit local connection/opt-in
environment required by each script, never against the configured application
database. The new test runner creates/drops random databases and refuses production.
All synthetic mail uses fake or mocked transports. No real notification producer,
mail delivery, scheduler or frontend code was added.

The default frontend failures concern login redirection, Board directory paging,
Card detail/navigation/archive interactions, Settings navigation and Workspace
invitation feedback. The complete one-worker run passes with no timeout or test
changes. Repository-wide formatting drift is unrelated to the feature; the
changed-file check covers every feature commit, not just the last working diff.
Expected injected transport/provider-error logs, PostgreSQL schema-inspection
deprecation and existing Vite environment/bundle-size warnings remain.

Final source review traced recipient filters, SQL context/actor ACL, serialization,
retained deletion state, transaction and lock ordering, post-commit failure paths,
socket identity/version/expiry, module imports and future consumers. No remaining
P4-03 implementation blocker was found. The disposable databases were verified
removed before stopping/removing the notification test container. Production,
deployment/image checks and browser UI verification were not run: no deployment
or frontend implementation is in scope. Review readiness includes the explicitly
reported default-test and repository-formatting limitations. No push, PR, merge,
deployment, production access or production migration occurred.
