# Workspace policies, Board move and deletion (P2-05)

This record describes the working-tree implementation, not a deployment. It
extends WS-01, WS-03 and BD-02; Workspace roles and Board roles remain separate.

## API and policy decisions

`GET /api/workspaces/:workspaceId/policies` is available to Workspace members.
`PATCH` is ADMIN-only, rejects unknown fields and accepts these boolean fields:

| Field                           | Default | Effect when changed                                                            |
| ------------------------------- | ------- | ------------------------------------------------------------------------------ |
| `boardCreationAdminOnly`        | `false` | When true, only Workspace ADMIN may create or move a Board into the Workspace. |
| `boardInvitesEnabled`           | `true`  | When false, Board OWNER cannot add Board members.                              |
| `boardMembershipChangesEnabled` | `true`  | When false, Board OWNER cannot change roles or remove Board members.           |
| `boardVisibilityChangesEnabled` | `true`  | When false, Board OWNER cannot change visibility.                              |

Policies never grant Board access. Response fields `canManagePolicies` and
`canCreateBoards` are actor-specific; existing Workspace responses also return
`canCreateBoards`. Workspace membership and invitation management remain ADMIN
only, and Personal Workspaces cannot receive team invitations.

`GET /api/boards/:boardId/policy-capabilities` returns actor-specific
`canInviteMembers`, `canChangeMembership` and `canChangeVisibility` to a
Board reader, including Guest OWNERs who cannot read Workspace settings. The
Board response `capabilities.canManageMembers` is true when an active OWNER may
invite or change membership. The separate policy-capabilities response separates
those operations; clients must handle 403 if policy changes after the snapshot.

`POST /api/boards/:boardId/move-workspace` takes
`{ "destinationWorkspaceId": "<uuid>" }`. An active Board's explicit OWNER
must be a destination Workspace member allowed to create Boards. A move resets
visibility to `PRIVATE`, retains explicit Board memberships and Board-owned
data, and reconciles active Board room grants after commit. A same-Workspace
request is a no-op after authorization. Workspace invitations are scoped to
their Workspace, not a Board, and are not reassigned. The audit table stores
source, destination, actor and old/new visibility without exposing those fields
in Workspace responses; the Board activity records an update.

The authenticated session maintains a Socket.IO connection even without an open
Board. Affected users receive an identifier-free access-change hint, clear
protected snapshots and refetch them through REST. Lost Board room grants and
Presence are reconciled before broadcasts. Reconnection also revalidates cached
access. Unsaved card drafts are kept in session memory during revalidation and
cleared on Board access loss, discard, close or session change.

`DELETE /api/workspaces/:workspaceId` takes
`{ "confirmationName": "<exact current name>" }` and requires an authenticated
Workspace ADMIN. The user selected JWT plus exact-name confirmation for V1,
including Google-only accounts. Personal Workspaces and Teams with any active
or archived Board are rejected. An empty Team's invitation and membership rows
are removed transactionally; Workspace members receive access revocation.
Recent invitation issuance counts survive deletion in a short-lived quota
ledger; recipient addresses are hashed. Deletion during email dispatch makes
the proof unavailable and the invitation request returns 409.
Errors are 400 for invalid input, 403 for denied actions, 404 for inaccessible
resources, and 409 for invalid resource state. Clients must handle revocation
and refresh access-dependent cached data.

## Rollout and recovery

The additive migration gives existing Workspaces permissive defaults and creates
the move audit and deleted-invitation quota tables. Take a verified database backup, rehearse on a staging-like
snapshot with production-sized data and check lock duration before deployment.
Deploy only after integration and concurrency coverage passes. The migration
deliberately refuses DOWN because dropping policy settings or audit history
would lose data; restore from backup or use a reviewed forward fix. No production
migration or deployment is authorized by this task.

Board, Workspace member and invitation entities are the current
Workspace-scoped references found in the entity inventory. Workspace invitations
do not reference Boards. New Workspace-scoped Board assets must be audited
before extending move behavior.

## Local verification and remaining work

The disposable PostgreSQL regression suite passed on Node 24, including policy
enforcement, move access and data preservation, Guest OWNER, concurrent moves,
membership and deletion races, invitation quotas, Socket.IO/Presence, migration
upgrade and existing Board/Card/auth regressions. The upgrade fixture preserves
representative legacy data; a production-sized staging rehearsal and verified
backup remain deployment steps and have not been performed locally.
