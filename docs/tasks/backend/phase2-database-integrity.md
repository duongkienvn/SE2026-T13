# P2-POL-03 — Phase 2 database integrity and deletion audit

Local audit for [#148](https://github.com/duongkienvn/SE2026-T13/issues/148),
2026-10-31. Scope: WS-01/02/03/04, BD-02 and the issue's B04/QA02/QA03
acceptance criteria. This is synthetic local PostgreSQL evidence, not a
production inventory, deployment or approval to run a production migration.

## Outcome and methodology

No runtime/schema defect requiring a service change or corrective migration was
confirmed. Existing deletion behavior matches the approved lifecycle contracts.
No applied migration, entity, service, REST contract, frontend or production
configuration was changed. The deliverables are executable regression checks,
a reviewed schema inventory and corrections to outdated schema documentation.

The audit compares actual migration SQL, TypeORM entities, service locks and
authorization to the schema produced by compiled migration discovery. Sources:
[schema design](../../architecture/database-design.md),
[foundation runbook](../../deployment/workspace-foundation.md),
[policies/move/deletion](workspace-policies-board-move.md),
[invitation lifecycle](workspace-members-invitations-api.md),
[decline](workspace-invitation-decline.md),
[Workspace Activity](workspace-activity.md) and the
[Workspace UX access rules](../../design/post-mvp/workspace/ux-spec.md).
Older architecture milestones are not interpreted as current feature status.

`test:phase2-integrity:database` owns a disposable PostgreSQL 16.15 Docker
container on an ephemeral loopback port, with synthetic credentials and fake/no
mail transport. It never reads a connection from `.env`. Existing regression
subprocesses receive the container connection explicitly; their random temporary
databases are created only on that server. Cleanup removes the container even
on failure. No production credentials, snapshots, migrations or email are used.

Catalog queries use `pg_constraint`, `pg_class`, `pg_namespace`, `pg_attribute`,
`pg_attrdef`, `pg_indexes` and `pg_trigger`. The
[complete reviewed inventory](phase2-schema-inventory.md) records every column's
type/nullability/default, PK/unique/check/FK definition and name, FK action,
validation/deferrability, indexes and application triggers for eight sensitive
tables. It also inventories every FK into Users, Boards and Workspaces, including
auth and Card references. Tests compare that inventory on every normal run;
`--write-catalog` is an explicit review/update action, not an automatic baseline
acceptance mechanism.

## Findings by severity

| Severity                                     | Finding                                                                                                    | Evidence and disposition                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No P0/P1/P2 runtime defect confirmed         | Fresh/upgrade schemas, constraints and current supported lifecycle operations are consistent               | All 16 compiled migrations execute; fresh/upgrade catalogs match; TypeORM schema builder proposes zero changes; real lifecycle/rollback/race suites pass                                                                                                                                  |
| Low — documentation defect, corrected        | Schema design's foundation-era text said all new FKs were NO ACTION and listed only MVP cascade exceptions | Catalog and WS-04 contract explicitly establish Activity CASCADE/SET NULL; documentation now distinguishes foundation, move audit, quota and Activity                                                                                                                                     |
| Informational — intentional retention        | Historical move Workspace IDs and quota identifiers lack live FKs                                          | Deleting an empty former Workspace preserves the move record; quota survives Workspace deletion and an otherwise unreferenced User deletion; adding cascades/FKs here would change retention or block supported deletion                                                                  |
| Informational — unimplemented product policy | Account hard deletion and a public Board hard-delete flow are not implemented                              | Controllers expose avatar deletion and Board archive/restore, not account/Board deletion. Ownership, membership, Board Activity and move audit references can reject direct SQL deletion. Future account erasure/anonymization and historical retention need an explicit product decision |
| Informational — operational limitation       | SQL-only audit/anti-abuse ledgers rely on the authorized services for semantic values                      | No entity drift exists for these intentionally migration-only tables. Move source/destination, visibility and quota digest/time are written by services, not exposed as arbitrary client-controlled ledger mutations. No speculative CHECK/index/schema change was introduced             |

## FK and deletion-policy audit matrix

Names, referenced columns, nullability and complete definitions are in the
inventory. All audited constraints are validated, immediate and non-deferrable.
Omitted ON DELETE in `pg_get_constraintdef` means PostgreSQL NO ACTION, not
CASCADE. No FK was mechanically weakened or replaced.

| Table / constraint                                                                                                 | Current behavior                                                                                                                                      | Expected behavior                                                                                                | Risk                                           | Finding                                                                                                                                                    | Required action                                     |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `workspaces`: `PK_workspaces`, type/name/icon checks, `UQ_workspaces_personal_creator`, `FK_workspaces_creator`    | UUID PK; one Personal per creator; valid type/nonblank name/icon; creator User NO ACTION; policies have permissive defaults                           | Provision one Personal/ADMIN; do not cascade owned Workspaces on account removal                                 | Owned-data deletion                            | Correct; concurrent provisioning and populated upgrade pass                                                                                                | Retain                                              |
| `workspace_members`: `PK_workspace_members`, `UQ_workspace_members_workspace_user`, role check, Workspace/User FKs | Unique Workspace/User, ADMIN/MEMBER; both FKs NO ACTION                                                                                               | Service removes grants transactionally and protects last ADMIN; no orphan grants                                 | Privilege/reference loss                       | Correct; SQL rejects invalid FK/duplicate/role, services enforce ADMIN/last-admin guards                                                                   | Retain                                              |
| `workspace_invitations`: PK, hash unique, email/role/hash/expiry/send-state checks, Workspace/inviter FKs          | Valid normalized identity/proof metadata; both FKs NO ACTION                                                                                          | No orphan invitation or account cascade; service handles Team deletion explicitly                                | Quota reset or proof lifecycle corruption      | Correct; quota copied before invitation deletion; acceptance/decline/revoke locks and timestamp checks pass                                                | Retain                                              |
| `CK_workspace_invitations_terminal`, `CK_workspace_invitations_declined_at`, `UQ_workspace_invitations_open_email` | At most one consumed/revoked/declined state; bounded consumed/declined times; one open invitation per Workspace/email excluding all terminal outcomes | Preserve historical rows and allow a new open invitation after a terminal state                                  | Duplicate grant/history rewrite                | Correct; exact names used by decline migration exist; populated up/down/up and unsafe rollback checks pass                                                 | Retain applied migrations                           |
| `boards`: `FK_boards_workspace`, `CK_boards_visibility`, NOT NULL Workspace, PRIVATE default                       | Existing Workspace required; PRIVATE/WORKSPACE_VISIBLE only; NO ACTION                                                                                | Keep Board content/IDs; reject deletion of Teams containing any Board, including hidden/archived                 | Unrelated Board/Card loss or access widening   | Correct; SQL FK, bridge/backfill and HTTP ACL matrix pass                                                                                                  | Retain                                              |
| `board_members`: PK, unique Board/User, Board/User FKs                                                             | Board CASCADE; User NO ACTION; explicit OWNER/MEMBER                                                                                                  | Keep Board grants separate from Workspace roles; normal Board archive preserves memberships                      | Guest escalation                               | Correct; Workspace removal does not invent Board grants; Guests have no protected Workspace access                                                         | Retain                                              |
| `board_workspace_moves_pkey`, `board_workspace_moves_board_id_fkey`, `board_workspace_moves_actor_id_fkey`         | UUID PK; Board/User NO ACTION; source/destination UUID snapshots without Workspace FKs; no ORM entity                                                 | Preserve audit and allow deletion of an empty former Workspace; no automatic Board/User hard deletion            | Audit loss or blocked legitimate Team deletion | Correct; isolated named FK rejection tests and source deletion preserve record/Board/Card/members                                                          | Retain; hard-delete policy requires separate design |
| `deleted_workspace_invitation_quota_pkey`, created-at index                                                        | Invitation UUID PK; actor UUID and SHA-256 recipient hash snapshots, no FKs; recent issuance retained across Team deletion                            | Never reset actor/recipient hourly limits through delete/recreate                                                | Anti-abuse bypass                              | Correct; terminal states, parallel deletion, delete/recreate and quota contention pass                                                                     | Retain ledger and service accounting                |
| `FK_workspace_activities_workspace`                                                                                | CASCADE to activity belonging to deleted Workspace                                                                                                    | Approved activity cleanup when an empty Team is deleted                                                          | Unintended history loss                        | Intentional per WS-04; other Workspaces/Board data remain intact                                                                                           | Retain                                              |
| `FK_workspace_activities_board`                                                                                    | Nullable Board FK; CASCADE only Board-linked activity                                                                                                 | Approved Board-linked activity cleanup on a separately authorized hard delete; archive preserves history         | Cross-Workspace cascade                        | Correct; deleting a disposable raw Board preserves general/unrelated activity. Actual move/Board Activity NO ACTION references may still block hard delete | Retain; no new hard-delete API                      |
| `FK_workspace_activities_actor`                                                                                    | Nullable actor User FK, SET NULL                                                                                                                      | Retain an event when otherwise-unreferenced actor is removed; read projection also hides former Workspace actors | Identity leak/history loss                     | Correct; direct actor-only deletion nulls actor without deleting activity                                                                                  | Retain                                              |
| `CK_workspace_activities_type`, `CK_workspace_activities_board`, ordering/Board indexes, move-version trigger      | Allowed event types; move rows require Board+version; other rows forbid them; current Board move version advances on Workspace change                 | No invented prior Activity; only current authorized Board/version appears in feeds                               | Stale/cross-tenant activity                    | Correct; concurrent move versions 1/2, no-op behavior, returning moves, SQL paging/ACL and rollback pass                                                   | Retain                                              |
| Other User/Board inbound FKs                                                                                       | User references mostly NO ACTION; verification/recovery/welcome cleanup CASCADE; Board content ownership follows existing MVP FK graph                | Preserve existing account/content lifecycle rather than invent a cascade policy                                  | Protected-content deletion                     | Inventory matches migrations; account ownership and isolated member/inviter/audit FKs reject physical deletion                                             | Retain; account deletion remains separate scope     |

## Transaction, retention and concurrency evidence

Workspace deletion locks the Workspace, checks current ADMIN and Team status,
checks the exact confirmation name, then rejects **any** remaining Board before
copying quotas and removing invitations/members/Workspace in one transaction.
The last ADMIN cannot leave/demote themselves under existing membership rules;
deleting an empty Team intentionally removes all its grants. Direct SQL deletion
is not an authorization API. Restrictive FKs are an additional reference barrier.

Invitation rows of any state created within one hour are copied to the quota
ledger with their original invitation ID, actor ID, SHA-256 normalized-recipient
digest and creation time. Recent pending, accepted, declined, revoked and expired
rows all count. Hourly checks read live rows and ledger rows in one statement;
moving a row between them is atomic. Actor/recipient advisory transaction locks
serialize competing issuance; Workspace locks serialize deletion/issuance and
terminal responses. Expired ledger rows are ignored by quota queries and pruned
opportunistically on a later Workspace deletion, not by an automatic one-hour
physical deletion job. No raw recipient address is retained in the ledger.

Moves lock the Board and both Workspaces in sorted-ID order; destination
membership/policy is rechecked under the transaction. Board ID, creator, explicit
Board memberships, Card/Column/assignment/comment data and archive rules are
preserved. Changed moves reset visibility to PRIVATE, add a move audit and Board
activity, and record the trigger-assigned move version in destination Activity.
Same-Workspace requests do not add a new move. Realtime reconciliation happens
after commit under the existing coordination boundary.

New independent-pool tests force both actual PostgreSQL lock orders for move vs
destination deletion and invitation reservation vs deletion. The later waiter
can wait behind an earlier queued waiter; the test follows the complete blocking
chain rather than using arbitrary sleeps as evidence. Concurrent moves preserve
the source/destination chain and versions 1/2. Parallel deletions retain four
distinct quota records, the next issuance consumes the fifth recipient slot,
and a further request is denied. Final live Board/member/invitation orphan
queries return zero. Existing suites additionally cover source deletion, Board
create/delete, policy updates, accept vs decline/revoke/reinvite, duplicate
invitations/membership, quota contention and access revocation.

A SQL trigger injected only into the disposable database fails the final Team
DELETE after quota copy and member/invitation cleanup. All those writes and
Activity deletion roll back. A separate test fails the final move Activity write
after Board update, version trigger and move/Board audit writes; all prior writes
roll back, including the version increment. No production trigger is introduced.

## Migration and recovery verification

1. **Fresh:** compile and discover the complete 16-migration chain through the
   application's `databaseOptions()` and TypeORM `runMigrations()` default
   all-migrations transaction. Synchronization and startup migrations remain
   false. A second run is a no-op; ORM schema builder proposes zero changes.
2. **Populated upgrade:** execute actual prior migration subsets, seed synthetic
   Users, Personal/Team Workspaces, ADMIN/member/Guest grants, Workspace-visible
   Board, archived Card with exact positions, assignments, comment, Board Activity
   and pending/consumed/revoked/expired invitations. Apply policies, then decline,
   then Activity through TypeORM history. After policies, seed move/quota ledgers;
   after decline, create actual declined history before upgrading Activity.
   Full JSON comparisons preserve all pre-existing fields/IDs/associations and
   terminal state; only approved additive columns/defaults appear. No previous
   Workspace Activity is fabricated. Final catalog equals fresh install.
3. **Current populated Phase 2:** migration rediscovery is a no-op, preserving
   Team assignments, visibility, declined history, move records and quota. Never
   rerun the legacy backfill against a feature-populated database.
4. **Legacy/failure regression:** existing foundation suite exercises pre-Workspace
   content, old-writer bridge, transaction failure/retry, guardrails and populated
   rollback refusal. Decline/Activity suites verify their guarded rollback; policy
   migration deliberately refuses DOWN. Previously applied files are unchanged.
5. **Synthetic restore rehearsal:** pg_dump custom archive inside the owned
   container, pg_restore with `--exit-on-error --single-transaction --no-owner`
   into another empty isolated database. Compare all public table row counts and
   complete JSON-content fingerprints, catalog and migration history. PostgreSQL
   can reparse varchar IN checks from array-level text casts to equivalent
   per-element casts; the restore comparison normalizes only that representation
   change. Names, literals, operators, FKs and all other catalog fields remain
   compared, and the restored ORM schema diff is empty. This is not evidence for
   production-sized timing, authorized backups or RPO/RTO.

No corrective migration is justified, so no upgrade action is required for this
audit commit. Keep applied history intact, never enable synchronize or replace
NO ACTION with CASCADE to force an operation through. Future schema corrections
must use a reviewed forward migration with legacy-data preconditions. Operators
still need the existing runbook's drained-writer window, verified off-host backup,
restore rehearsal, lock/WAL/capacity measurements and explicit release approval;
do not perform a destructive DOWN on populated policy/decline/Activity history.

## Files and validation

- `apps/backend/test/database/phase2-*.mjs`: owned Docker runner, catalog check,
  populated upgrade, lifecycle/FK/rollback, independent-instance races and
  synthetic backup/restore. Existing test helpers and regression entrypoints are
  reused. `apps/backend/package.json` adds the focused runner command.
- This record and the reviewed catalog are indexed in `docs/tasks/README.md`.
  `docs/architecture/database-design.md` corrects the two outdated FK-policy
  descriptions; no new domain policy is introduced.

| Command / check                                                                                                                                                                                                                             | Result                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @kanban/shared build`                                                                                                                                                                                                        | PASS; consumer prerequisite                                                                                                                                                                                                                                                                                                        |
| `pnpm --filter @kanban/backend test:phase2-integrity:database`                                                                                                                                                                              | PASS on PostgreSQL 16.15: fresh 16-migration chain, reviewed catalog, populated staged upgrade, lifecycle/FK/retention/rollback, independent-pool forced races, synthetic backup/restore; invokes the existing foundation/legacy suite (19 checks), Workspace API/Activity suite and database foundation suite on its owned server |
| `pnpm --filter @kanban/backend test:workspace-members:database`                                                                                                                                                                             | PASS in its separate disposable container: full invitation create/accept/decline/revoke/expiry/reinvite, quota/delete retention/contention, Guest ACL, visibility/archive, source/destination move/deletion, realtime/revocation and role/membership regressions                                                                   |
| `pnpm --filter @kanban/backend test --runTestsByPath test/workspaces/workspaces.service.spec.ts test/workspaces/workspace-activity-writer.spec.ts test/workspaces/workspace-invitation-dispatch.spec.ts test/boards/boards.service.spec.ts` | PASS: 4 suites, 29 tests                                                                                                                                                                                                                                                                                                           |
| `pnpm exec eslint apps/backend/src apps/backend/test apps/backend/scripts`                                                                                                                                                                  | PASS; backend-scoped ESLint                                                                                                                                                                                                                                                                                                        |
| `pnpm --filter @kanban/backend exec tsc --noEmit`                                                                                                                                                                                           | PASS                                                                                                                                                                                                                                                                                                                               |
| Backend build via both PostgreSQL package scripts                                                                                                                                                                                           | PASS (`pnpm --filter @kanban/backend build` / Nest TypeScript compiler)                                                                                                                                                                                                                                                            |
| Changed-file `pnpm exec prettier --check <changed files>`                                                                                                                                                                                   | PASS                                                                                                                                                                                                                                                                                                                               |
| `pnpm format:check`                                                                                                                                                                                                                         | FAIL: 849 untouched files flagged, with zero changed-file warnings. Existing checkout formatting/line-ending failures were left untouched                                                                                                                                                                                          |
| Markdown relative-path checks, `git diff --check`, staged diff check                                                                                                                                                                        | PASS                                                                                                                                                                                                                                                                                                                               |
| Applied migration / application-source diff against base                                                                                                                                                                                    | Empty; no existing migration or runtime implementation modified                                                                                                                                                                                                                                                                    |

Initial new-fixture enum/snapshot assertions and lock-observation assumptions were
corrected before the successful final run; they did not require application or
schema changes. Existing integration output includes intentionally failed
migration negative tests and a pg concurrent-query deprecation warning; suite
exit statuses are successful. This audit does not resolve that dependency
deprecation. The root monorepo test suite was not run, as requested.

No migration/deployment step is needed for this test/documentation-only result.
Unresolved product questions apply only to future account/Board hard deletion
and any stronger audit-retention policy. Production-size restore/timing and
release approval remain operational prerequisites, not claims established here.
