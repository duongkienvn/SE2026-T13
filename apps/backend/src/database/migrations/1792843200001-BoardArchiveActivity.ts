import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BoardArchiveActivity1792843200001 implements MigrationInterface {
  name = 'BoardArchiveActivity1792843200001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "activities_action_type_enum" ADD VALUE IF NOT EXISTS 'BOARD_ARCHIVED'`,
    );
    await queryRunner.query(
      `ALTER TYPE "activities_action_type_enum" ADD VALUE IF NOT EXISTS 'BOARD_RESTORED'`,
    );
  }

  async down(): Promise<void> {
    throw new Error(
      'PostgreSQL enum values cannot be safely removed after activity rows use them',
    );
  }
}
