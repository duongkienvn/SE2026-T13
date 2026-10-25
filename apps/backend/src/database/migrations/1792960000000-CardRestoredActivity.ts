import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CardRestoredActivity1792960000000 implements MigrationInterface {
  name = 'CardRestoredActivity1792960000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TYPE "activities_action_type_enum" ADD VALUE IF NOT EXISTS 'CARD_RESTORED'`,
    );
  }

  down(): Promise<void> {
    // PostgreSQL cannot drop one enum value safely; retain the additive value on rollback.
    return Promise.resolve();
  }
}
