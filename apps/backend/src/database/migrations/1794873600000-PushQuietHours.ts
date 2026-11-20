import type { MigrationInterface, QueryRunner } from 'typeorm';
export class PushQuietHours1794873600000 implements MigrationInterface {
  name = 'PushQuietHours1794873600000';
  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TABLE user_push_schedules (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      enabled boolean NOT NULL DEFAULT false,
      start_local varchar(5) NOT NULL DEFAULT '22:00',
      end_local varchar(5) NOT NULL DEFAULT '07:00',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CHK_push_schedule_start" CHECK (start_local ~ '^([01][0-9]|2[0-3]):(00|15|30|45)$'),
      CONSTRAINT "CHK_push_schedule_end" CHECK (end_local ~ '^([01][0-9]|2[0-3]):(00|15|30|45)$'),
      CONSTRAINT "CHK_push_schedule_range" CHECK (NOT enabled OR start_local <> end_local)
    )`);
  }
  async down(): Promise<void> {
    throw new Error('Push quiet hours requires a forward fix');
  }
}
