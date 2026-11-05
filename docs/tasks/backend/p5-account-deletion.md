# P5-03 — Safe account deletion and identity erasure

Implements [Issue #218](https://github.com/duongkienvn/SE2026-T13/issues/218),
roadmap AC-01. This record describes local implementation and verification;
it does not certify a deployment. P5-01 export and P5-02 email change are included
in the implementation base. P5-08 frontend work remains with Mylecute.

## API and P5-08 handoff

`DELETE /api/users/me` requires a current verified-account Bearer JWT and JSON:

```json
{ "confirmation": "DELETE", "currentPassword": "current password" }
```

Alternatively supply `googleCredential` instead of `currentPassword`. Exactly
one proof is permitted, including for dual-provider accounts. Password bytes are
not trimmed. Confirmation is case sensitive and is not trimmed. Google ID tokens
must pass the existing signature, audience, issuer and expiry validation, be
issued within five minutes, and match the **stored linked subject**; matching
email alone is insufficient. Credentials are verified outside database locks.

| Outcome                                                               | Status/code                                | Frontend action                                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Committed irreversible identity closure                               | `204`, empty body                          | Clear protected session/query caches and sockets; discard proofs; route to signed-out confirmation. No new JWT. Fence late completions against a newer session. |
| Missing/incorrect confirmation, malformed/unknown fields, both proofs | `400 VALIDATION_FAILED`                    | Correct input; never normalize confirmation into acceptance.                                                                                                    |
| Missing proof or wrong current identity                               | `403 INVALID_CREDENTIALS`                  | Offer fresh reauthentication. Invalid Google tokens use existing `401 INVALID_GOOGLE_CREDENTIAL`; malformed proof values use 400.                               |
| Expired/revoked/deleted JWT or changed authentication snapshot        | `401 UNAUTHORIZED`                         | Sign in again. Repeating a completed deletion with the old JWT is rejected.                                                                                     |
| Valid identity but ownership blockers                                 | `409 ACCOUNT_DELETION_BLOCKED`             | Show each category and resource count; guide resolution using existing ownership and Board Move tools.                                                          |
| Persistent concurrent changes/contention                              | `409 CONFLICT`                             | Retry after the competing operation finishes; no partial deletion.                                                                                              |
| Account/IP limit                                                      | `429 TOO_MANY_REQUESTS`                    | Respect retry timing. Five attempts per five minutes in each process, including incorrect proofs; existing global IP guard plus account bucket.                 |
| Google unavailable / unexpected pre-commit failure                    | Existing `503` / safe `500 INTERNAL_ERROR` | Retry later. No SQL, provider internals or credentials in responses.                                                                                            |

Blockers extend the standard error envelope with a top-level `blockers` array:

```json
{
  "success": false,
  "statusCode": 409,
  "code": "ACCOUNT_DELETION_BLOCKED",
  "message": "Resolve ownership requirements before deleting your account",
  "timestamp": "2026-11-05T00:00:00.000Z",
  "path": "/api/users/me",
  "blockers": [
    {
      "type": "BOARD_REQUIRES_ANOTHER_OWNER",
      "totalCount": 24,
      "resources": [
        { "id": "00000000-0000-4000-8000-000000000001", "name": "Project" }
      ]
    }
  ]
}
```

Only present categories are returned, in this order:

1. `PERSONAL_WORKSPACE_HAS_BOARDS`: resources are Boards, active **or archived**.
   Move all to eligible Team Workspaces; even another Board OWNER does not waive
   this rule. No automatic move or Board deletion occurs.
2. `BOARD_REQUIRES_ANOTHER_OWNER`: resources are Boards lacking another current
   OWNER, including archived Boards. Promote an existing eligible member first.
3. `TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN`: resources are Team Workspaces lacking
   another current ADMIN. Board OWNER and Workspace ADMIN are distinct roles.

Normal archive/read-only rules still apply while resolving blockers; restore an
archived Board before a move or role change when required by those existing APIs.

`totalCount` is the full category count. `resources` contains at most 20 `{id,name}`
entries sorted by UUID; compare its length with `totalCount` to show truncation.
No member emails or other private identities appear. IDs/names are the caller's
own resources, and names must be rendered as text. The shared package exports
`DeleteAccountRequest`, `AccountDeletionBlocker` and `AccountDeletionBlockerType`.
Swagger documents the request, 204 and blocker schema.

The current frontend `ApiError` adapter retains code/details but drops unknown
top-level fields. P5-08 must preserve and validate `blockers` using the shared
contract before presenting actionable errors; this backend task does not modify
that frontend adapter.

Before submission, explain irreversibility and this retention boundary: account
identity and private settings are erased; shared Cards, Comments and files remain
with Deleted user attribution. There is no undo or recovery period. Do not claim
that every personal string written in shared content is removed.

Comment responses add `author: {displayName: "Deleted user", isDeleted: true}`
only for a deleted author; Activity responses add the equivalent `actor`. These
are strictly allowlisted markers, not live User entities. Workspace Activity and
authorized notification actors expose `isDeleted: true` with the tombstone name.
Render these without a live profile link/avatar. Existing technical author/actor
UUIDs remain for referential integrity. Missing historical member data alone is
not evidence of deletion. Generic nested User serialization marks tombstones and
returns an empty email rather than exposing the internal placeholder. No frontend
component, mock data or approved design was changed here.

Current Comments and Board Activity components still resolve authors from live
membership lists and otherwise show Former/Unknown member. P5-08 must consume the
new attribution markers to distinguish a tombstone from an ordinary former member.

## Transaction and concurrency boundary

`AccountDeletionService` accepts a server-only fresh proof snapshot. The deletion
transaction bounds lock waits to two seconds and individual statements to five
seconds. It acquires invitation actor then recipient-email advisory locks,
enumerates dependencies, locks sorted Boards, sorted Workspaces, then the User
`FOR UPDATE`. This matches Board Move's Board-before-Workspace order and keeps
credential/private-recipient state behind the resource locks. All blocker checks
run before cleanup. Password hash or linked Google subject, email, authVersion,
verification, deletedAt and session expiry are rechecked under current authority.

Database live-reference triggers take a User `FOR SHARE` lock before new active
grants, credentials, private state, or Board/Workspace creator references are
inserted. Membership/assignment updates also check the live account. Unlike FK
`KEY SHARE`, this conflicts with deletion's User lock. After acquiring that fence,
deletion re-enumerates its resource set. A newly committed dependency causes a
fresh transaction and lock snapshot. Deadlock/serialization/lock-timeout retries
are bounded to three transactions; exhausted contention returns safe 409. Other
database failures roll back the entire transaction. Older mixed-domain writers
can still lose a deadlock race; database rollback, not an in-process queue,
provides the integrity boundary.

Consequently competing deletions, last-owner/admin changes, Board moves,
Board/Workspace creation, new memberships/assignments, invitation issuance,
password/reset and email-change confirmation cannot partially anonymize an
account or recreate a deleted account's grants. The ordinary interactive creator
protection remains unchanged; successful, verified deletion is its narrow
membership-removal exception. Shared creators are never reassigned.

Commit precedes synchronous `BoardRoomCoordinator.revokeUserSessions`, which
sets the existing monotonic revocation floor before scanning connected sockets.
It clears receive grants and fences handshakes not yet present in the namespace.
Deletion shares the read-grant coordination boundary; Board invalidations publish
after that queue is released through `BoardEventPublisher`. Event failure cannot
roll back a committed identity deletion. REST authentication, reconnect and private
user delivery explicitly reject deleted accounts using database authority.

This preserves the supported single-process realtime assumption. It does not add
a distributed socket registry: established Board sockets on another process need
that deployment's disconnect/reconciliation boundary or original token expiry.
Private user delivery rechecks persisted authVersion/deletedAt. Operations already
committed before deletion are retained. Mail checks immediately before dispatch
suppress deleted recipients, but an already-started provider call/delivered email
cannot be recalled. No database lock spans provider calls or expensive reauth.

## Reviewed FK and private-data inventory

The disposable migration test queries every actual PostgreSQL FK before/after
upgrade and verifies identical definitions. No FK action or shared table is
weakened to make deletion work. Current User references:

| Table / User column                                                                                                    | Actual ON DELETE    | Deletion treatment                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `boards.created_by_id`, `cards.created_by_id`, `comments.author_id`, `activities.actor_id`, `workspaces.created_by_id` | NO ACTION           | Retain UUID attribution and shared content; empty Personal Workspace is the sole Workspace removal.             |
| `card_assignees.assigned_by_id`                                                                                        | NO ACTION, nullable | Retain historical assigning actor on **other users'** assignments.                                              |
| `card_attachments.uploader_id`                                                                                         | RESTRICT            | Retain Board URL/file attachments, storage objects, metadata and cleanup tickets.                               |
| `comment_mentions.user_id`                                                                                             | NO ACTION           | Retain spans/UUIDs in shared text; no future delivery to deleted recipient.                                     |
| `workspace_activities.actor_id`, `user_notifications.actor_user_id`                                                    | SET NULL, nullable  | Retain reference to tombstone; resolve safe Deleted user attribution within current ACL.                        |
| `board_workspace_moves.actor_id`                                                                                       | NO ACTION           | Retain historical move audit. Source/destination Workspace UUIDs are intentionally not live FKs.                |
| `board_members.user_id`, `workspace_members.user_id`, `card_assignees.user_id`                                         | NO ACTION           | Remove only after locked alternative OWNER/ADMIN checks.                                                        |
| `google_identities.user_id`                                                                                            | NO ACTION           | Delete linked subject mapping. Later signup gets a new UUID, never an implicit merge.                           |
| `email_verification_tokens.user_id`, `password_reset_tokens.user_id`, `pending_email_changes.user_id`                  | CASCADE             | Explicitly delete account proofs; hard-delete cascade is not relied upon.                                       |
| `user_preferences.user_id`, `notification_preferences.user_id`                                                         | NO ACTION           | Explicitly delete private settings.                                                                             |
| `user_notifications.recipient_user_id`                                                                                 | NO ACTION           | Delete own inbox, retaining other recipients' notifications.                                                    |
| `task_notification_email_outbox.recipient_user_id`, `welcome_email_deliveries.user_id`, `board_user_states.user_id`    | CASCADE             | Explicitly delete all own rows, including frozen welcome recipient/message JSON and attempted mail state.       |
| `workspace_invitations.invited_by_id`                                                                                  | NO ACTION           | Preserve safe history, revoke pending invitations and rotate proofs; scrub recipient copies.                    |
| `avatar_uploads.user_id`                                                                                               | NO ACTION           | Retain only durable object ownership/retry information until confirmed cleanup. Pending completion is rejected. |

Personal Workspace cleanup removes its invitation rows and all remaining member
rows (including legacy extra members) before the empty Workspace. Its Activity
FK cascades; notification Workspace references become null. No Board is deleted.
The existing non-FK `deleted_workspace_invitation_quota` ledger retains only
technical IDs, recipient SHA-256 digests and timestamps for anti-abuse accounting.

Direct identity copies are explicitly reviewed: User profile fields are cleared;
Google subjects and account token/private tables are removed; welcome message JSON
is removed; incoming and outgoing invitation recipient strings become unique
`deleted-invite+<invitation UUID>@users.invalid` addresses and proofs rotate.
`erased_recipient_hash` preserves the existing recipient quota and 60-second
cooldown without keeping plaintext. Actor and Workspace counts remain unchanged.
Empty Personal Workspace invitation quota moves to the existing one-hour ledger.
Deleting another empty Workspace preserves already-scrubbed recipient digests.
Another User's pending email-change target/original copy of the erased email is
redacted and its proof consumed/rotated while retaining its rolling issuance quota.

Activity metadata producers allow only role/technical UUID fields, not profile
copies. Notification/outbox data resolves current names or stores technical IDs;
no account identity text is duplicated there. Board/Workspace names, Card titles
and descriptions, Comment text, mention text, labels, checklist text, attachment
names/content and URLs are collaborative content and **are not rewritten**.
No new plaintext identity audit log or account deletion email is created.

A lost HTTP acknowledgement can hide an already-committed deletion. Retrying its
old JWT intentionally returns 401; a transport failure is not evidence that the
account still exists. There is no public deletion-status or recovery endpoint.

## Avatar cleanup and operation

Reuse `avatar_uploads` and `AvatarService.cleanup`; no new queue, S3 adapter or
dependency. In the identity transaction, clear User avatar pointers, advance its
revision and mark owned intents rejected/due. The cleanup-only User lock explicitly
allows tombstones; every user-facing avatar mutation rejects deleted users.
Existing completed intents retain ownership of active keys, so no shared Card
file can enter this cleanup path.

The existing bounded sweep runs every five minutes when storage is configured,
waits until original intent expiry (covering still-valid upload grants), rechecks
references, deletes pending/orphan active objects outside transactions, retries
provider failure after five minutes and retains successful reconciliation records
until the existing seven-day expiry horizon. A 204 proves committed identity
closure and durable cleanup scheduling, **not** immediate physical S3 erasure.
Disabled storage leaves retry work persisted; restore the configured private
avatar driver to drain it. Monitor due `avatar_uploads` for deleted Users and the
existing generic cleanup warnings; never expose object keys or old identities in
client errors or public logs. No real S3 object was touched in verification.

## Migration and roll-forward notes

`1794614400218-AccountDeletion.ts` adds nullable `users.deleted_at`, nullable
`workspace_invitations.erased_recipient_hash`, tombstone/live-email CHECKs,
irreversibility and live-reference triggers. Existing records keep null deletedAt
and their UUIDs/data. Internal tombstone addresses reserve `@users.invalid` for
non-login-able rows. Before deployment, check for legacy live accounts using this
reserved domain; migration refuses incompatible rows rather than silently edit
their identity. Review/remediate through an explicitly authorized operator plan.
Registration, email-change issuance and Workspace invitation issuance/dispatch
also reject the internal placeholder domain, so it never becomes a mail target.

Deploy through the existing explicit migration gate before serving this code,
with a drained-writer window, reviewed backup and rehearsed restore. Migration
locks/backfill timing on production-sized data is not established by local tests.
Keep `synchronize: false` and `migrationsRun: false`. `down()` always refuses:
removing deletedAt/revocation guards can reactivate identities, and deleted private
data or physical avatar bytes cannot be reconstructed. Keep compatible deletion-
aware code/schema and roll forward with a reviewed corrective migration. Restoring
an old backup may revive credentials/identity data and requires a separate security
and reconciliation plan. Backups/provider logs and already-delivered messages are
outside this live database erasure boundary and follow operator retention policy.

## Files and responsibilities

- [AccountDeletionService](../../../apps/backend/src/api/users/account-deletion/account-deletion.service.ts),
  [controller/Swagger](../../../apps/backend/src/api/users/account-deletion/account-deletion.controller.ts),
  [request DTO](../../../apps/backend/src/api/users/account-deletion/delete-account.dto.ts),
  [reauthentication](../../../apps/backend/src/api/users/account-deletion/account-deletion-reauthentication.service.ts),
  [locks/blockers](../../../apps/backend/src/api/users/account-deletion/account-deletion-locks.ts),
  [private-state cleanup](../../../apps/backend/src/api/users/account-deletion/account-deletion-state.ts)
  and the dedicated blocker exception own the lifecycle; `UsersModule` wires it.
- [Migration](../../../apps/backend/src/database/migrations/1794614400218-AccountDeletion.ts),
  User/WorkspaceInvitation entities and the [shared contract](../../../packages/shared/src/account-deletion.ts)
  define persistence and the frontend boundary; the global filter allowlists the
  structured error. No existing applied migration is rewritten.
- Auth/password/verification/email-change/Google services, welcome/task-mail
  dispatch, notification recipient locking, profile/preferences and AvatarService
  reject deleted identities. Invitation issuance/deletion preserves digest quotas.
  Comment/Activity/Workspace Activity/notification DTOs expose safe attribution.
- [Owned PostgreSQL runner](../../../apps/backend/test/users/account-deletion.integration.mjs),
  [acceptance matrix](../../../apps/backend/test/users/account-deletion.acceptance.mjs),
  [race tests](../../../apps/backend/test/users/account-deletion.races.mjs) and
  [service unit tests](../../../apps/backend/test/users/account-deletion.service.spec.ts)
  supplement proof/blocker unit tests. Existing migration fixtures, delivery mocks
  and strict serialization tests are updated for the additive boundary. Board and
  Workspace historical rollback fixtures also stop before the older P5-02
  forward-only migration; its own refusal remains tested.
- This record, task index, backend guide, database design and private-avatar
  runbook carry the security/operational handoff. Frontend files are unchanged.

## Verification

The runner owns a disposable PostgreSQL 16.15 Docker container on a random
loopback port, generates synthetic credentials, ignores `.env`, uses fake mail,
fake Google identity verification and memory/disabled storage, then removes the
container. It applies the actual migration chain and a populated upgrade; Google
SDK signature/freshness behavior also retains its offline signed unit tests.

```powershell
pnpm --filter @kanban/shared build
pnpm --filter @kanban/backend test:account-deletion:database
# Also run the domain regressions against the same disposable server:
pnpm --filter @kanban/backend test:account-deletion:database --regressions
```

| Check                                                                                                         | Result                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                                                                   | **Pass**, including the final invitation guard.                                                                                                                                                                                                                                                             |
| `pnpm build`                                                                                                  | **Pass**, shared ESM/CommonJS, backend and frontend, including the final guard.                                                                                                                                                                                                                             |
| `VITEST_MAX_WORKERS=2 pnpm test`                                                                              | **Pass**, 114 backend suites / 1,258 tests, 140 frontend suites / 1,472 tests, 20 shared tests. This completed run preceded the last reserved-domain guard; that guard is covered by the focused test and final database run below.                                                                         |
| `pnpm --filter @kanban/backend test --runTestsByPath test/workspaces/workspace-invitation-dispatch.spec.ts`   | **Pass**, six tests, including rejection before issuance and zero provider calls for internal tombstone recipients.                                                                                                                                                                                         |
| Backend and shared `exec tsc --noEmit -p tsconfig.json`                                                       | **Pass**.                                                                                                                                                                                                                                                                                                   |
| `pnpm --filter @kanban/backend test:account-deletion:database`                                                | **Pass**, final 20 PostgreSQL/Nest/Socket.IO acceptance groups, including the reserved-domain guard, full 29-migration chain, populated upgrade, unchanged FK definitions and zero ORM drift.                                                                                                               |
| Database regressions through `--regressions` and focused/resumed runner modes                                 | **All 19 domain suites passed individually**: foundation, email change, password security, Google auth, email verification, preferences, avatars, Boards, Workspace API, Board members, Cards, Comments, Activity, welcome mail, notifications, task notifications, private files, attachments and exports. |
| Combined `test:account-deletion:database --regressions`                                                       | **Fail in one unchanged export stress case**: the 10,000-Card export hit its existing `EXPORT_TIMEOUT` and returned 503. No timeout, assertion or production limit was weakened.                                                                                                                            |
| `exec node test/users/account-deletion.integration.mjs --regressions-only --from-regression=exports/exports`  | **Pass**, isolated export rerun: all ten groups, including 10,000 Cards, size limits, ACL/session races and privacy. This is valid isolated evidence, not a claim that the interrupted combined run passed.                                                                                                 |
| `exec node test/users/account-deletion.integration.mjs --realtime-only`                                       | **Pass**, final 16 realtime scenarios and 11 Board-event groups against PostgreSQL/Socket.IO.                                                                                                                                                                                                               |
| `node apps/backend/test/workspaces/workspace-members-invitations.integration.mjs`, fake mail/disabled storage | **Pass**, full owned-container membership/invitation/Guest/policy/ACL/realtime/concurrency suite.                                                                                                                                                                                                           |
| Changed-file Prettier, relative documentation paths and `git diff --check`                                    | **Pass**.                                                                                                                                                                                                                                                                                                   |
| `pnpm format:check`                                                                                           | **Fail**, existing formatting/CRLF warnings in untouched files. Changed files are formatted and pass their focused check; unrelated files were not committed as formatting cleanup.                                                                                                                         |
| Redundant final full-workspace repeat                                                                         | **Stopped at the user's request** after lint/build had passed. Earlier completed tests remain the evidence; no pass is claimed for the stopped repeat.                                                                                                                                                      |

Initial migration-fixture and mocked-query failures were fixed without weakening
rollback, legacy preservation, FK or serialization assertions. The unrestricted
frontend run encountered timeout failures under worker load; the completed
two-worker run passes without frontend changes. The export stress timeout above
is retained as a verification caveat. Existing non-fatal Vite bundle-size and
PostgreSQL-driver schema-inspection deprecation warnings remain.

Final review covered the actual feature diff, transaction/lock boundaries,
retained FKs, private cleanup, reauthentication, delivery and receive-grant paths;
no remaining critical correctness/security/data-loss blocker was identified.
Disposable databases/containers are cleaned up. Production migration/deployment,
remote CI, live Google/mail/S3 and P5-08 UI verification are **not run**. No push,
PR, merge, production access, real email or real-object deletion was performed.
