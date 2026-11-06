import type { MigrationInterface, QueryRunner } from 'typeorm';

export class StarterBoardOnboarding1794700800000 implements MigrationInterface {
  name = 'StarterBoardOnboarding1794700800000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE starter_board_provisions (
      user_id uuid CONSTRAINT "PK_starter_board_provisions" PRIMARY KEY
        CONSTRAINT "FK_starter_board_provisions_user" REFERENCES users(id) ON DELETE NO ACTION,
      board_id uuid CONSTRAINT "FK_starter_board_provisions_board" REFERENCES boards(id) ON DELETE SET NULL,
      template_version integer NOT NULL,
      baseline_hash varchar(64) NOT NULL,
      CONSTRAINT "UQ_starter_board_provisions_board" UNIQUE(board_id),
      CONSTRAINT "CK_starter_board_provisions_version" CHECK (template_version > 0),
      CONSTRAINT "CK_starter_board_provisions_hash" CHECK (baseline_hash ~ '^[0-9a-f]{64}$')
    )`);
    await runner.query(`CREATE TRIGGER account_live_reference BEFORE INSERT ON starter_board_provisions
      FOR EACH ROW EXECUTE FUNCTION public.require_live_account_reference('user_id')`);
  }
  async down(runner: QueryRunner): Promise<void> {
    const [{ exists }]: { exists: boolean }[] = await runner.query(
      'SELECT EXISTS(SELECT 1 FROM starter_board_provisions) AS exists',
    );
    if (exists)
      throw new Error(
        'Starter Board enrollment must be retained once used; roll forward instead.',
      );
    await runner.query('DROP TABLE starter_board_provisions');
  }
}
