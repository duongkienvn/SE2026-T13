import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkspacePolicies1793318400000 implements MigrationInterface {
  name = 'WorkspacePolicies1793318400000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE workspaces
      ADD COLUMN board_creation_admin_only boolean NOT NULL DEFAULT false,
      ADD COLUMN board_invites_enabled boolean NOT NULL DEFAULT true,
      ADD COLUMN board_membership_changes_enabled boolean NOT NULL DEFAULT true,
      ADD COLUMN board_visibility_changes_enabled boolean NOT NULL DEFAULT true`);
    await runner.query(`CREATE TABLE board_workspace_moves (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      board_id uuid NOT NULL REFERENCES boards(id),
      actor_id uuid NOT NULL REFERENCES users(id),
      source_workspace_id uuid NOT NULL,
      destination_workspace_id uuid NOT NULL,
      old_visibility varchar NOT NULL,
      new_visibility varchar NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await runner.query(`CREATE TABLE deleted_workspace_invitation_quota (
      invitation_id uuid PRIMARY KEY,
      actor_id uuid NOT NULL,
      recipient_hash char(64) NOT NULL,
      created_at timestamptz NOT NULL
    )`);
    await runner.query(`CREATE INDEX "IDX_deleted_workspace_invitation_quota_created_at"
      ON deleted_workspace_invitation_quota (created_at)`);
  }

  async down(): Promise<void> {
    throw new Error(
      'Workspace policies require a forward fix; rollback would discard policy settings',
    );
  }
}
