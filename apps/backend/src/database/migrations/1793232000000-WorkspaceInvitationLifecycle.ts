import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkspaceInvitationLifecycle1793232000000 implements MigrationInterface {
  name = 'WorkspaceInvitationLifecycle1793232000000';

  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Workspace migrations require a transaction');
    await runner.query(`SET LOCAL lock_timeout = '5s'`);
    await runner.query(
      `LOCK TABLE workspace_invitations IN ACCESS EXCLUSIVE MODE`,
    );
    const [row]: { duplicates: boolean }[] = await runner.query(`SELECT EXISTS(
      SELECT 1 FROM workspace_invitations WHERE consumed_at IS NULL AND revoked_at IS NULL
      GROUP BY workspace_id, email HAVING count(*) > 1) AS duplicates`);
    if (row.duplicates)
      throw new Error(
        'Duplicate open invitations require explicit remediation before migration',
      );
    await runner.query(`ALTER TABLE workspace_invitations ADD send_state varchar(16) NOT NULL DEFAULT 'UNAVAILABLE',
      ADD CONSTRAINT "CK_workspace_invitations_send_state" CHECK
      (send_state IN ('UNAVAILABLE', 'DISPATCHING', 'SENT', 'FAILED', 'UNKNOWN'))`);
    await runner.query(`CREATE UNIQUE INDEX "UQ_workspace_invitations_open_email"
      ON workspace_invitations(workspace_id, email) WHERE consumed_at IS NULL AND revoked_at IS NULL`);
    await runner.query(
      'CREATE INDEX "IDX_workspace_invitations_created_at" ON workspace_invitations(created_at)',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Workspace migrations require a transaction');
    await runner.query('DROP INDEX "UQ_workspace_invitations_open_email"');
    await runner.query('DROP INDEX "IDX_workspace_invitations_created_at"');
    await runner.query(
      'ALTER TABLE workspace_invitations DROP CONSTRAINT "CK_workspace_invitations_send_state", DROP COLUMN send_state',
    );
  }
}
