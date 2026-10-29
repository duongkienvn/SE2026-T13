# P2-04 — Board visibility and access enforcement

Implements BD-02 with the WS-01/WS-02 foundation in the
[roadmap](../../roadmap/post-mvp.md), following the
[approved access matrix](../../design/product-ux-blueprint.md#3-workspace-domain-and-migration-decisions).
This record describes the current checkout and local evidence, not deployment.

## Authorization contract

| Actor                                     | PRIVATE read            | WORKSPACE_VISIBLE read  | Active Board content writes | Board/member management                              |
| ----------------------------------------- | ----------------------- | ----------------------- | --------------------------- | ---------------------------------------------------- |
| Explicit Board OWNER                      | Yes                     | Yes                     | Yes                         | OWNER rules, creator/last-owner protections retained |
| Explicit Board MEMBER                     | Yes                     | Yes                     | Yes                         | No                                                   |
| Workspace ADMIN without Board membership  | No                      | Yes                     | No                          | No                                                   |
| Workspace MEMBER without Board membership | No                      | Yes                     | No                          | No                                                   |
| Board Guest without Workspace membership  | According to Board role | According to Board role | According to Board role     | According to Board role                              |
| Unrelated or unauthenticated actor        | No                      | No                      | No                          | No                                                   |

Archive preserves existing read grants. All archived Board mutations fail;
only an explicit OWNER can restore. Archived Cards require authorized restore
on an active Board before other edits. Workspace ADMIN never overrides PRIVATE.
No membership, role, invitation, public URL or anonymous grant is synthesized.

`BoardAuthorizationService.requireRead()` establishes explicit or derived read
access. `canReadBoard()` supports room reconciliation. `requireMember()` remains
the explicit-membership seam for writes and administrative membership reads;
mutations pass `mutable: true` and the transaction manager, acquiring the Board
row lock before checking persisted membership. Owner operations use the existing
`requireOwner()` / `requireMutableOwner()` gates. Client capabilities never
authorize a mutation. `boardCapabilities()` projects these same rules.

Board detail, Columns, Cards (including route-linked details and archives),
Comments and Activity reads use the read seam. Nested queries still match both
resource ID and its Board/Card parent. There are no standalone bulk or assignee
read endpoints bypassing these checks. Assignee IDs remain part of the permitted
Card DTO; assignment changes require explicit Board membership.

Board and Workspace Board lists use the same parameterized SQL read predicate,
before search, counts, sorting and pagination. Workspace Overview uses that
predicate for all counts and recents, within its existing repeatable-read
snapshot. Workspace directory/Overview/Members/Settings access still requires
Workspace membership; a Board Guest cannot enumerate them.

## REST and DTOs

`PATCH /api/boards/:boardId/visibility`

```json
{ "visibility": "WORKSPACE_VISIBLE" }
```

Only PRIVATE and WORKSPACE_VISIBLE are accepted, with no additional properties.
The authenticated actor must be an explicit OWNER of an active Board. Repeating
the persisted visibility is valid and still reconciles connected grants. A
changed value records existing BOARD_UPDATED activity within the transaction.
The response is the persisted Board DTO with server-computed capabilities.

All Board DTOs, including global lists and Workspace summaries, now include:

```json
{
  "workspaceId": "<uuid>",
  "visibility": "WORKSPACE_VISIBLE",
  "currentUserRole": null,
  "capabilities": {
    "canReadBoard": true,
    "canWriteBoard": false,
    "canManageBoard": false,
    "canManageMembers": false,
    "canRestoreBoard": false
  }
}
```

Existing Board fields remain. `currentUserRole` is OWNER/MEMBER for explicit
members, including Guests, and null for Workspace-only readers. It is not a new
Board role. Workspace summaries retain `canEdit`, equal to `canWriteBoard`.
Capabilities describe Board operations; Card archive, author-only Comment edits
and last-owner/creator constraints still require their existing entity checks.

Read-only viewers receive no Board membership administration DTOs or invitation
data. Their Activity feed excludes MEMBER entities before counting/pagination.
Existing user/profile allowlists remain. Private avatar downloads continue to
require self access or actual shared Board memberships; visibility alone does
not widen avatar permissions. Presence/comment UI uses safe unknown-profile
fallbacks instead of fetching administrative member data.

Board detail/list and nested read routes, membership reads and visibility changes
return `Cache-Control: no-store`.

| Status | Contract                                                                                                                                            |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | Invalid UUID, unsupported/null visibility, unknown field, invalid pagination                                                                        |
| 401    | Missing, expired or invalidated authentication, existing verification rules                                                                         |
| 403    | Explicit Board MEMBER attempting an OWNER operation                                                                                                 |
| 404    | Missing/inaccessible Board or child, missing explicit membership for a write/member-directory read; identical safe denial for Workspace-only actors |
| 409    | Existing archive/restore, entity state, creator/last-owner conflicts                                                                                |
| 429    | Existing HTTP/room rate limiting                                                                                                                    |

No schema migration is needed: P2-01 already provided the checked visibility
column and PRIVATE default. Creation still forces PRIVATE, ignoring any forged
service-level visibility/role input; HTTP validation rejects such fields.
Legacy IDs, deep links and explicit collaborators are preserved.

## Realtime and cache contract

Only `board:join` and `board:leave` are client commands. They retain their
validation, rate limits and ACKs. Business events remain server-only; forged
client events receive an unsuccessful VALIDATION_FAILED ACK (UNAUTHORIZED when
the socket is inactive), without invoking business services. Joining uses the
same read seam and does not grant any write permission.

Visibility updates hold the Board coordinator queue across their database
transaction and post-commit reconciliation. Workspace remove/leave acquires
affected Board queues in sorted order, retains its Workspace row-lock and
membership transaction, then reconciles each Board. Board member removal checks
the independent Workspace grant. Separate Board grants survive Workspace exit;
remaining Workspace read grants survive explicit Board membership removal.

Joins and Workspace removal snapshots also share a process-local read-grant
queue. This prevents a newly created/visible Board from gaining an untracked
viewer between the snapshot and removal commit. Room rate/pending limits apply
before entering this queue. The current deliberate limit is serialized joins
during membership churn; partition this boundary by Workspace if contention
requires it, preserving the snapshot fence and lock ordering.

Reconciliation establishes every current recipient's read permission, clears
all denied receive grants and Presence entries before emitting any new snapshot,
then evicts every denied tab. Adapter failures disconnect the socket where
possible; application grants still prevent delivery. Database reconciliation
failure fails closed. Publishing occurs after commit, outside the coordinator
queue, through the existing publisher; delivery failure cannot undo REST success.

G1/G2 `presence:sync` stays `{ boardId, userIds }`, with unique sorted IDs and
multi-tab counts. JWT expiry/session invalidation and reconnect checks remain.

| Server event               | Payload                                                            | Consumer behavior                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `board:access-changed`     | `{ boardId }`                                                      | Invalidate Board detail/children, global Board lists and Workspace queries; REST supplies current capabilities                                                 |
| `board:access-revoked`     | `{ boardId }`                                                      | Cancel stale Board reads, clear Board/Card/Comment/Activity/member and avatar caches, clear Workspace aggregates/recents, stop Presence and pending join state |
| `workspace:access-revoked` | `{ workspaceId }`                                                  | Clear every matching session-scoped Workspace resource and directory entry; retain independently authorized Guest Board data                                   |
| `member:removed`           | Existing `{ boardId, userId }`, optional `retainsReadAccess: true` | For the current user, either revoke Board access or immediately clear member profiles and downgrade cached role/capabilities to read-only before resync        |

Revocation accepts case-variant deep-link keys. Join-denial ACKs clear stale
protected caches even if the socket missed the original revocation. Delayed
invalidations cannot revive an access-denial tombstone. Logout/account-switch
session guards remain. Without a connected socket, focus/reconnect and fresh
route loading revalidate REST access; cached capabilities are never credentials.

Access transitions also advance a per-QueryClient/Board revision. Board and Card
mutation cache writers capture that revision before dispatch and discard late
responses from an earlier grant, preventing stale OWNER capabilities or cleared
Card data from being restored. A downgrade clears/cancels Activity pages as well
as member profiles, then refetches the filtered history. The Activity observer
remounts when switching between explicit and Workspace access, so pagination
placeholder data cannot retain administrative history.

Existing Board/Workspace screens accept the nullable-role contract and reuse
their readOnly behavior for Card/Column/Comment editing, drag/drop, restore,
Presence profiles and owner controls. Workspace visibility is labelled accurately.
No frontend page, visibility settings editor or Board Settings redesign is added.

## P2-05 / P2-07 integration and deployment

`BoardVisibilityService.change()` is the visibility policy integration point:
P2-05 must check its Workspace policy in the same transaction, after establishing
the OWNER grant and before saving. No policy CRUD, schema, default permissive
adapter or ADMIN override is introduced here. Board invitations keep the current
OWNER gate; P2-05 adds its policy before the existing add-member write.

Future Board moves must coordinate source/destination access, commit first,
call `reconcileBoard()` while holding affected Board queues, then publish access
change hints. This task does not implement move or Workspace deletion.

The room/Presence registry and ordering queue are process-local. Run one Nest
process owning both REST ACL changes and sockets. Multiple independent writers,
direct SQL ACL changes or independently routed Socket.IO nodes are outside this
deployment contract and need coordinated revocation before scaling. No Redis,
distributed adapter or infrastructure migration is added. Deploy the frontend
and backend contract together because older clients assume a non-null role.

## Verification evidence

The dedicated command `pnpm --filter @kanban/backend test:board-access:database`
reuses the Workspace invitation integration harness, which owns a randomly named
local PostgreSQL Docker container and removes it on exit. It does not load
application/production database credentials. It includes P2-03 membership,
invitation and migration regressions plus P2-04 HTTP actor/visibility/archive,
aggregate privacy, nested-resource, Socket.IO multi-tab, revocation, Guest and
concurrency cases. The pending-write race observes PostgreSQL lock waits and
proves authorization is rechecked after a member removal commits.

Optional `--browser-qa` uses an already installed Playwright package provided by
`PLAYWRIGHT_MODULE_PATH`; no dependency is added. It runs actual Chrome against
the disposable backend and the existing Vite app. `--regressions` also exercises
the existing domain/database/realtime scripts against this isolated server.

Browser artifacts are under
[`board-visibility-access-control`](../../design/screens/implementation/board-visibility-access-control/):
global Boards, Workspace Boards, Board detail and Card permalink in light/dark
at 375/768/1280px. The manifest records page errors and document overflow.

## Verification record (2026-10-29)

| Check                                                         | Result                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                   | Pass.                                                                                                                                                                                                                                                                   |
| `pnpm build`                                                  | Pass. Vite reports the existing large main chunk warning; Node is v22.12.0 while the workspace engine requires >=22.13.0.                                                                                                                                               |
| `pnpm format:check --end-of-line auto` and `git diff --check` | Pass. The repository's strict LF-only Prettier check is not used on this Windows checkout.                                                                                                                                                                              |
| Backend Jest                                                  | 63/64 suites and 633/634 tests passed in the full run. The `board-events` child process hit its 100-second timeout under full-suite load; rerunning that suite alone passed. Combined evidence: 64/64 suites and 634/634 tests passed.                                  |
| Frontend Vitest                                               | 97/98 files and 885/886 tests passed with two workers. The one archived-board drag-grip assertion failed in the full run; rerunning `KanbanBoard.test.tsx` alone passed all 8 tests.                                                                                    |
| PostgreSQL / HTTP / Socket.IO integration                     | Pass: P2-04 visibility and authorization matrix, Workspace membership/invitations, migration, board/card/member/column/comment/activity, realtime and race regressions all reported PASS on a disposable local PostgreSQL container. The harness removed the container. |
| Browser screenshot refresh                                    | Not run: Playwright is not installed or configured through `PLAYWRIGHT_MODULE_PATH`. The 36 existing screenshot artifacts remain available; no claim is made that they reflect the final UI edits.                                                                      |

No branch, commit, push, PR, deployment or other Git decision was made.
