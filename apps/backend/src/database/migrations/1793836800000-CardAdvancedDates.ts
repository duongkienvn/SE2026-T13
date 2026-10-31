import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CardAdvancedDates1793836800000 implements MigrationInterface {
  name = 'CardAdvancedDates1793836800000';
  async up(runner: QueryRunner): Promise<void> {
    // No default/backfill or rewrite of legacy due_date values.
    await runner.query(
      'ALTER TABLE cards ADD COLUMN start_date timestamptz NULL',
    );
    await runner.query(`ALTER TABLE cards ADD CONSTRAINT "CHK_cards_start_date_finite"
      CHECK (start_date IS NULL OR isfinite(start_date))`);
    await runner.query(`ALTER TABLE cards ADD CONSTRAINT "CHK_cards_date_range"
      CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date)`);
    await runner.query(
      'CREATE INDEX "IDX_cards_board_start_date" ON cards (board_id, start_date) WHERE start_date IS NOT NULL',
    );
    await runner.query(
      'CREATE INDEX "IDX_cards_board_due_date" ON cards (board_id, due_date) WHERE due_date IS NOT NULL',
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Card date rollback requires a transaction');
    await runner.query('LOCK TABLE cards IN ACCESS EXCLUSIVE MODE');
    const [row] = await runner.query(
      'SELECT EXISTS (SELECT 1 FROM cards WHERE start_date IS NOT NULL) AS populated',
    );
    if (row.populated)
      throw new Error(
        'Refusing to discard Card start dates; back up and roll forward',
      );
    await runner.query('DROP INDEX "IDX_cards_board_start_date"');
    await runner.query('DROP INDEX "IDX_cards_board_due_date"');
    await runner.query(
      'ALTER TABLE cards DROP CONSTRAINT "CHK_cards_date_range", DROP CONSTRAINT "CHK_cards_start_date_finite", DROP COLUMN start_date',
    );
  }
}
