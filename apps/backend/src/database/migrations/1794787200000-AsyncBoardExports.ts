import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AsyncBoardExports1794787200000 implements MigrationInterface {
  name = 'AsyncBoardExports1794787200000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE board_export_jobs (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL, board_id uuid NOT NULL,
      idempotency_key uuid NOT NULL, format varchar(4) NOT NULL,
      state varchar(9) NOT NULL DEFAULT 'PENDING', attempts integer NOT NULL DEFAULT 0,
      auth_version integer NOT NULL, session_expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
      lease_token uuid, lease_expires_at timestamptz, body bytea,
      CONSTRAINT "PK_board_export_jobs" PRIMARY KEY (id),
      CONSTRAINT "UQ_board_export_jobs_operation" UNIQUE (user_id, idempotency_key),
      CONSTRAINT "FK_board_export_jobs_user" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT "FK_board_export_jobs_board" FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
      CONSTRAINT "CK_board_export_jobs_state" CHECK (state IN ('PENDING','RUNNING','COMPLETED','FAILED') AND format IN ('json','csv') AND attempts BETWEEN 0 AND 3),
      CONSTRAINT "CK_board_export_jobs_lease" CHECK ((state = 'RUNNING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR (state <> 'RUNNING' AND lease_token IS NULL AND lease_expires_at IS NULL)),
      CONSTRAINT "CK_board_export_jobs_bounds" CHECK (isfinite(expires_at) AND expires_at > created_at AND (body IS NULL OR octet_length(body) <= 20971520))
    )`);
    await runner.query(
      'CREATE INDEX "IDX_board_export_jobs_due" ON board_export_jobs (state, expires_at)',
    );
    await runner.query(
      'CREATE INDEX "IDX_board_export_jobs_board" ON board_export_jobs (board_id)',
    );
    await runner.query(`CREATE TRIGGER account_live_reference BEFORE INSERT ON board_export_jobs
      FOR EACH ROW EXECUTE FUNCTION public.require_live_account_reference('user_id')`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('LOCK TABLE board_export_jobs IN ACCESS EXCLUSIVE MODE');
    const [{ populated }] = await runner.query(
      'SELECT EXISTS(SELECT 1 FROM board_export_jobs) AS populated',
    );
    if (populated)
      throw new Error(
        'Async export jobs retain idempotency keys; roll forward while jobs exist',
      );
    await runner.query('DROP TABLE board_export_jobs');
  }
}
