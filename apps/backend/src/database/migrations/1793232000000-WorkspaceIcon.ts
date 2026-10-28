import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkspaceIcon1793232000000 implements MigrationInterface {
  name = 'WorkspaceIcon1793232000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE workspaces ADD COLUMN icon varchar(16),
      ADD CONSTRAINT "CK_workspaces_icon" CHECK (icon IN ('briefcase','users','code','palette','layers'))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE workspaces DROP CONSTRAINT "CK_workspaces_icon", DROP COLUMN icon',
    );
  }
}
