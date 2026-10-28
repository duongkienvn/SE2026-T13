# Workspace foundation migration runbook

Scope: [Issue #110](https://github.com/duongkienvn/SE2026-T13/issues/110),
[schema and handoff](../tasks/backend/workspace-data-foundation.md).
This is an operator plan. No production database, AWS, release, or CI/CD operation
was performed during implementation. Local synthetic PostgreSQL tests demonstrate
correctness; production-sized timing and backup restoration remain release gates.

## Compatibility and release order

Use the existing single-instance maintenance deployment from
[production.md](production.md) and [cicd.md](cicd.md). Two ordered migrations implement
expand → bridge → backfill → verify → constrain. A separate release is not required
for the approved maintenance path. Do not interpret this as a zero-downtime plan.

| Step                             | Database / application state                                     | Compatibility and gate                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Rehearse                      | Current schema and current app                                   | Restore an authorized anonymized snapshot on an isolated server. Inventory, test both app versions, measure locks/WAL/runtime. Approve backup, RPO/RTO, capacity and window.                                                                                                                                                                                                                                                                              |
| 1. Drain                         | Stop frontend/backend and all other writers; PostgreSQL stays up | Hold existing deployment lock; finish/terminate in-flight app transactions through normal shutdown. Verify no jobs/other replicas write. Take and verify the protected off-host backup.                                                                                                                                                                                                                                                                   |
| 2. Expand                        | `WorkspaceFoundation1793145600000`                               | Adds three tables, nullable `boards.workspace_id`, FK/index, PRIVATE default/check, provisioning function and BEFORE INSERT/UPDATE bridge atomically. Compatible with the previous Board writer: omitted/NULL workspace becomes creator Personal + ADMIN before the Board insert, within that writer's transaction. Existing NULL rows are transitional only until step 3.                                                                                |
| 3. Backfill + verify + constrain | `LegacyBoardWorkspaces1793145600001`                             | Requires active transaction; sets local lock timeout 5s, takes ACCESS EXCLUSIVE on boards. Rejects inconsistent creators/preassigned workspaces/visibility; provisions all existing users, including zero-Board users; assigns NULL Board workspaces by creator; validates owner ADMIN and every Board mapping/PRIVATE; SET NOT NULL before releasing lock.                                                                                               |
| 4. Switch app                    | Both migrations committed; no pending migrations                 | Run postchecks and compare the protected inventory before reopening traffic. Start the new application: explicit service writes Personal Workspace + ADMIN + PRIVATE Board + OWNER in one transaction. Email signup commits User + Personal Workspace + ADMIN before verification mail; Google signup commits Workspace + ADMIN with User/identity. Returning login/link does not provision. Board creation reuses the existing Workspace through ensure. |
| 5. Observe / app rollback        | Keep both schema migrations and bridge                           | Previous app can still insert Boards without a workspace column, including after NOT NULL. Its transaction also rolls back bridge-created Workspace/ADMIN on failure. A rollback to a lazy-signup application would lose the eager-signup guarantee and requires an explicit product decision; prefer an eager-aware forward fix. Otherwise review auth/avatar compatibility. No Workspace access is granted through this bridge.                         |

The normal TypeORM CLI uses its default **all-migrations transaction**. In that
case steps 2 and 3 commit together: old writers cannot observe half-installed
schema. An in-flight legacy insert finishes before DDL gets its table lock or
waits and then uses the bridge after commit. The supported release still drains
writers to avoid application timeouts and unbounded lock contention. Do not start
the new app between expansion and backfill: its entity assumes the final schema.
Do not use `--transaction none`, synchronization, migration history edits, or
unreviewed partial-migration commands. If future operators choose a separate
expand-only release, ship and rehearse a reviewed migration artifact containing
only that stage before executing it; the ordinary CLI runs **all** pending files.

No invitation/Team/visibility API may start writing before this foundation is
verified. Once Team moves or visibility changes are enabled, replaying the legacy
backfill is outside its supported pre-feature state and fails closed; leave the
applied migration history intact and use a scoped forward migration.

## Locks, capacity and rehearsal gates

New-table indexes are ordinary transactional CREATE INDEX operations. The Board
index/FK and ALTER TABLE acquire table locks; the legacy migration intentionally
holds ACCESS EXCLUSIVE throughout backfill/validation/NOT NULL. This blocks Board
reads and writes and can delay dependent operations. User/Workspace upserts take
row locks. Cost grows with Users/Boards and WAL; there is no online batching or
CONCURRENTLY index claim here. Both migrations must run transactionally.

On the isolated production-sized copy, record migration elapsed time, maximum
lock waits, affected row counts, WAL/disk growth and health recovery time. Include
archived data, dense ordering and Board guests. Set an approved statement timeout
and lock timeout for the entire migration connection, in addition to the legacy
migration's 5s lock timeout. If the measured window is unacceptable, stop release
approval and design a separately reviewed batched rollout. Do not remove integrity
checks or expand maintenance time without an operator decision.

## Pre-migration inventory and anomaly checks

These are read-only SQL templates for an authorized operator on the explicitly
selected database. Store results securely beside the backup, never in Git. Run
while writers are drained so pre/post comparisons describe the same dataset.

```sql
SELECT current_database(), version();
SELECT id, timestamp, name FROM migrations ORDER BY id;
SELECT 'users' AS table_name, count(*) FROM users
UNION ALL SELECT 'boards', count(*) FROM boards
UNION ALL SELECT 'board_members', count(*) FROM board_members
UNION ALL SELECT 'board_columns', count(*) FROM board_columns
UNION ALL SELECT 'cards', count(*) FROM cards
UNION ALL SELECT 'card_assignees', count(*) FROM card_assignees
UNION ALL SELECT 'comments', count(*) FROM comments
UNION ALL SELECT 'activities', count(*) FROM activities;
SELECT is_archived, count(*) FROM boards GROUP BY is_archived;
SELECT is_archived, count(*) FROM cards GROUP BY is_archived;
SELECT role, count(*) FROM board_members GROUP BY role;
SELECT count(*) AS invalid_creators
FROM boards b LEFT JOIN users u ON u.id=b.created_by_id WHERE u.id IS NULL;
SELECT count(*) AS inconsistent_creator_grants
FROM boards b LEFT JOIN board_members m
  ON m.board_id=b.id AND m.user_id=b.created_by_id
WHERE m.id IS NULL OR m.role <> 'OWNER';
SELECT count(*) AS cross_board_cards
FROM cards c JOIN board_columns col ON col.id=c.column_id
WHERE c.board_id <> col.board_id;
SELECT count(*) AS stale_assignments
FROM card_assignees a JOIN cards c ON c.id=a.card_id
LEFT JOIN board_members m ON m.board_id=c.board_id AND m.user_id=a.user_id
WHERE m.id IS NULL;
```

Zero is required for anomaly queries before approval. Migration validates its
creator/scope assumptions; the broader checks catch historical anomalies that
must not be silently fixed by the migration. Investigate any unexpected results
and approve remediation separately. No UUID is hardcoded in the migrations.

For exact content evidence, export ordered JSON rows privately for each of the
eight legacy tables while stopped, then compare byte-for-byte after migration.
Use PostgreSQL COPY-to-STDOUT and binary-safe shell redirection, matching the
backup runbook. Example query for Boards after migration:

```sql
SELECT to_jsonb(b) - 'workspace_id' - 'visibility' AS legacy_row
FROM boards b ORDER BY id;
```

Before migration use `SELECT to_jsonb(b) AS legacy_row FROM boards b ORDER BY id`.
For the other tables use the full row ordered by `id` in both inventories. This
preserves exact numeric positions and microsecond timestamps. Never select raw
password/token data into shared reports; inventory files contain confidential
data, including the User snapshot, and require backup-grade protection. Use counts
and equality results in the release record. The local suite compares full JSON
rows in memory and writes no dumps/artifacts into the repository.

## Post-migration verification

```sql
SELECT id, timestamp, name FROM migrations ORDER BY id;
SELECT count(*) AS null_or_orphan_boards
FROM boards b LEFT JOIN workspaces w ON w.id=b.workspace_id WHERE w.id IS NULL;
SELECT count(*) AS wrong_legacy_mapping
FROM boards b JOIN workspaces w ON w.id=b.workspace_id
WHERE w.type <> 'PERSONAL' OR w.created_by_id <> b.created_by_id;
SELECT visibility, count(*) FROM boards GROUP BY visibility;
SELECT count(*) AS missing_personal_or_admin
FROM users u LEFT JOIN workspaces w ON w.created_by_id=u.id AND w.type='PERSONAL'
LEFT JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=u.id
WHERE w.id IS NULL OR m.id IS NULL OR m.role <> 'ADMIN';
SELECT created_by_id, count(*) FROM workspaces WHERE type='PERSONAL'
GROUP BY created_by_id HAVING count(*) > 1;
SELECT count(*) AS unexpected_workspace_grants
FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id
WHERE w.type='PERSONAL' AND m.user_id <> w.created_by_id;
SELECT is_nullable FROM information_schema.columns
WHERE table_schema='public' AND table_name='boards' AND column_name='workspace_id';
SELECT conname, convalidated FROM pg_constraint
WHERE conrelid IN ('boards'::regclass,'workspaces'::regclass,
  'workspace_members'::regclass,'workspace_invitations'::regclass);
SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND tablename IN
  ('boards','workspaces','workspace_members','workspace_invitations');
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid='boards'::regclass AND tgname='TR_boards_workspace_bridge';
```

Before downstream features write data: anomaly counts zero, duplicate query empty,
all Boards PRIVATE, nullable `NO`, constraints validated and bridge enabled `O`.
Compare legacy counts and exact snapshots; creator/Board member roles, columns,
Cards, assignments, comments, activities, archive timestamps and positions must
be identical. After later Team/permission features, creator-mapping and
owner-only-grant checks are no longer general Workspace invariants; use their
approved rules instead of replaying this pre-feature audit blindly.

Verify through authorized app sessions: existing guest opens their shared Board
and Card permalink but cannot access Workspace data; a Workspace ADMIN lacking
Board membership gets no private Board REST/socket access; Board OWNER/MEMBER
operations, archive/restore, comments and realtime/presence still work. Check
new-account/first-Board provisioning, logout/reconnect and session invalidation.

## Backup, restore rehearsal and recovery

Before release approval, use the existing protected `pg_dump -Fc` and off-host
checksum procedure in [production.md](production.md#backup-and-recovery). Verify
archive listing, encryption/access controls and available disk; a backup on the
same Docker volume is insufficient. No infrastructure is created by this task.

Restore the backup into a **new isolated database/server**, with outbound email,
Google and object-storage writes disabled. Use `pg_restore --exit-on-error
--single-transaction --no-owner`; check inventory, auth and representative Board/
Card access before running migrations. Rehearse the upgrade and both application
versions, injected failure/retry, postchecks and a second restore into another
empty database. Record duration, RPO/RTO and operator sign-off. Local synthetic
tests are not evidence that an actual production backup is restorable.

On failure, keep traffic stopped. Default all-migrations transaction rolls back
the new schema/backfill and migration rows together. With a separately approved
per-migration transaction mode, expand may remain committed while failed backfill
and its history roll back; the bridge remains compatible with old Board writers,
but do not reopen until the operator has checked the actual state. Inspect
migration history, locks and inventory before retry. Resolve anomalies explicitly;
never fake history, skip rows or add grants to force success.

Prefer a reviewed forward fix or compatible **application-only rollback** while
retaining the schema and trigger. Legacy migration down only drops NOT NULL;
assignments/content/grants stay. Foundation down takes exclusive locks and
refuses if any Workspace/member/invitation/Board assignment exists. It is safe
only for an empty foundation, not a live migrated database. The provisioning
function also supports the new service, so trigger/function removal requires a
future reviewed migration after all old writers and rollback candidates retire.

If an approved restore is necessary, stop all writers, preserve the failed DB for
investigation, verify the selected checksum and restore into a new empty DB using
the existing runbook. Select a compatible app/schema pair, validate before
reopening and explicitly account for writes after the backup. Never overwrite
the only source DB or claim live schema rollback is lossless.
