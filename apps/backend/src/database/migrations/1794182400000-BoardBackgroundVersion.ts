import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BoardBackgroundVersion1794182400000 implements MigrationInterface {
  name = 'BoardBackgroundVersion1794182400000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE boards ADD COLUMN background_version integer NOT NULL DEFAULT 0',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const [{ has_changes }]: { has_changes: boolean }[] = await runner.query(
      'SELECT EXISTS(SELECT 1 FROM boards WHERE background_version <> 0) AS has_changes',
    );
    if (has_changes)
      throw new Error(
        'Background versions must be preserved; roll forward instead',
      );
    await runner.query('ALTER TABLE boards DROP COLUMN background_version');
  }
}
