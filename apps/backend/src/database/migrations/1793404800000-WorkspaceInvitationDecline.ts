import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkspaceInvitationDecline1793404800000 implements MigrationInterface {
  name = 'WorkspaceInvitationDecline1793404800000';

  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Workspace migrations require a transaction');
    await runner.query(`SET LOCAL lock_timeout = '5s'`);
    await runner.query(
      'LOCK TABLE workspace_invitations IN ACCESS EXCLUSIVE MODE',
    );
    await runner.query(`ALTER TABLE workspace_invitations
      ADD declined_at timestamptz NULL,
      DROP CONSTRAINT "CK_workspace_invitations_terminal",
      ADD CONSTRAINT "CK_workspace_invitations_terminal" CHECK (
        (consumed_at IS NULL OR (consumed_at >= created_at AND consumed_at < expires_at)) AND
        (revoked_at IS NULL OR revoked_at >= created_at) AND
        num_nonnulls(consumed_at, revoked_at, declined_at) <= 1),
      ADD CONSTRAINT "CK_workspace_invitations_declined_at" CHECK (
        declined_at IS NULL OR (declined_at >= created_at AND declined_at < expires_at))`);
    await runner.query('DROP INDEX "UQ_workspace_invitations_open_email"');
    await runner.query(`CREATE UNIQUE INDEX "UQ_workspace_invitations_open_email"
      ON workspace_invitations(workspace_id, email)
      WHERE consumed_at IS NULL AND revoked_at IS NULL AND declined_at IS NULL`);
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Workspace migrations require a transaction');
    await runner.query(`SET LOCAL lock_timeout = '5s'`);
    await runner.query(
      'LOCK TABLE workspace_invitations IN ACCESS EXCLUSIVE MODE',
    );
    const [row]: { declined: boolean }[] = await runner.query(
      'SELECT EXISTS(SELECT 1 FROM workspace_invitations WHERE declined_at IS NOT NULL) AS declined',
    );
    if (row.declined)
      throw new Error(
        'Cannot discard invitation decline history; use a forward fix',
      );
    await runner.query('DROP INDEX "UQ_workspace_invitations_open_email"');
    await runner.query(`ALTER TABLE workspace_invitations
      DROP CONSTRAINT "CK_workspace_invitations_declined_at",
      DROP CONSTRAINT "CK_workspace_invitations_terminal",
      ADD CONSTRAINT "CK_workspace_invitations_terminal" CHECK (
        (consumed_at IS NULL OR (consumed_at >= created_at AND consumed_at < expires_at)) AND
        (revoked_at IS NULL OR revoked_at >= created_at) AND
        NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL)),
      DROP COLUMN declined_at`);
    await runner.query(`CREATE UNIQUE INDEX "UQ_workspace_invitations_open_email"
      ON workspace_invitations(workspace_id, email) WHERE consumed_at IS NULL AND revoked_at IS NULL`);
  }
}
