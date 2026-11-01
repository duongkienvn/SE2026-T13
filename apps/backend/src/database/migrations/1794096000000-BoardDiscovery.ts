import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BoardDiscovery1794096000000 implements MigrationInterface {
  name = 'BoardDiscovery1794096000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER TABLE boards ADD COLUMN background_preset varchar(32) NOT NULL DEFAULT 'blue', ADD CONSTRAINT "CHK_boards_background_preset" CHECK (background_preset IN ('blue','indigo','violet','rose','orange','amber','green','teal','mountains','forest','coast','lake'))`,
    );
    await runner.query(`CREATE TABLE board_user_states (
      user_id uuid NOT NULL CONSTRAINT "FK_board_user_states_user" REFERENCES users(id) ON DELETE CASCADE,
      board_id uuid NOT NULL CONSTRAINT "FK_board_user_states_board" REFERENCES boards(id) ON DELETE CASCADE,
      is_starred boolean NOT NULL DEFAULT false,
      last_viewed_at timestamptz,
      CONSTRAINT "PK_board_user_states" PRIMARY KEY (user_id, board_id),
      CONSTRAINT "CHK_board_user_states_viewed" CHECK (last_viewed_at IS NULL OR isfinite(last_viewed_at))
    )`);
    await runner.query(
      `CREATE INDEX "IDX_board_user_states_board" ON board_user_states(board_id)`,
    );
    await runner.query(
      `CREATE INDEX "IDX_board_user_states_recent" ON board_user_states(user_id, last_viewed_at DESC, board_id DESC) WHERE last_viewed_at IS NOT NULL`,
    );
    await runner.query(
      `CREATE INDEX "IDX_board_user_states_starred" ON board_user_states(user_id, board_id) WHERE is_starred`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    const [{ has_data }]: { has_data: boolean }[] = await runner.query(
      `SELECT EXISTS(SELECT 1 FROM board_user_states) OR EXISTS(SELECT 1 FROM boards WHERE background_preset <> 'blue') AS has_data`,
    );
    if (has_data)
      throw new Error(
        'Board discovery state must be preserved; roll forward instead',
      );
    await runner.query('DROP TABLE board_user_states');
    await runner.query(
      'ALTER TABLE boards DROP CONSTRAINT "CHK_boards_background_preset", DROP COLUMN background_preset',
    );
  }
}
