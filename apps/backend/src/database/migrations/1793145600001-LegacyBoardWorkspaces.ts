import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Run with writers drained; keep the bridge across application cutover. */
export class LegacyBoardWorkspaces1793145600001 implements MigrationInterface {
  name = 'LegacyBoardWorkspaces1793145600001';

  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Workspace migrations require a transaction');
    await runner.query(`SET LOCAL lock_timeout = '5s'`);
    // Blocks legacy inserts through verification + NOT NULL. No unlocked gap.
    await runner.query('LOCK TABLE boards IN ACCESS EXCLUSIVE MODE');
    const [before]: { inconsistent: boolean }[] = await runner.query(`SELECT
      EXISTS(SELECT 1 FROM boards b LEFT JOIN users u ON u.id = b.created_by_id WHERE u.id IS NULL) OR
      EXISTS(SELECT 1 FROM boards b LEFT JOIN workspaces w ON w.id = b.workspace_id
        WHERE b.visibility <> 'PRIVATE' OR (b.workspace_id IS NOT NULL AND
          (w.id IS NULL OR w.type <> 'PERSONAL' OR w.created_by_id <> b.created_by_id)))
      AS inconsistent`);
    if (before.inconsistent)
      throw new Error(
        'Inconsistent legacy Board creator, workspace or visibility. Remediate explicitly before retrying.',
      );

    // Includes users with no Boards. Never derive Workspace grants from Board members.
    await runner.query(
      'SELECT public.ensure_personal_workspace(id) FROM users ORDER BY id',
    );
    await runner.query(`UPDATE boards b SET workspace_id = w.id, visibility = 'PRIVATE'
      FROM workspaces w WHERE w.type = 'PERSONAL' AND w.created_by_id = b.created_by_id
      AND b.workspace_id IS NULL`);
    const [after]: { inconsistent: boolean }[] = await runner.query(`SELECT
      EXISTS(SELECT 1 FROM boards b LEFT JOIN workspaces w ON w.id = b.workspace_id
        WHERE w.id IS NULL OR w.type <> 'PERSONAL' OR w.created_by_id <> b.created_by_id
          OR b.visibility <> 'PRIVATE') OR
      EXISTS(SELECT 1 FROM users u LEFT JOIN workspaces w ON w.created_by_id = u.id AND w.type = 'PERSONAL'
        LEFT JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = u.id
        WHERE w.id IS NULL OR m.id IS NULL OR m.role <> 'ADMIN') AS inconsistent`);
    if (after.inconsistent)
      throw new Error(
        'Workspace backfill verification failed; transaction must roll back',
      );
    await runner.query(
      'ALTER TABLE boards ALTER COLUMN workspace_id SET NOT NULL',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Workspace migrations require a transaction');
    // Never destroy assignments, membership, history or content during rollback.
    // The expand migration's bridge still fills missing IDs for old writers.
    await runner.query(
      'ALTER TABLE boards ALTER COLUMN workspace_id DROP NOT NULL',
    );
  }
}
