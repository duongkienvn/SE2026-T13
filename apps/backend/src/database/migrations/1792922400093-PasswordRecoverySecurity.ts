import { MigrationInterface, QueryRunner } from 'typeorm';

export class PasswordRecoverySecurity1792922400093 implements MigrationInterface {
  name = 'PasswordRecoverySecurity1792922400093';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'ALTER TABLE users ADD COLUMN auth_version integer NOT NULL DEFAULT 0',
    );
    await runner.query(`CREATE TABLE password_reset_tokens (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      token_hash char(64) NOT NULL,
      created_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz NULL,
      sent_at timestamptz NULL,
      window_started_at timestamptz NOT NULL,
      attempts integer NOT NULL,
      CONSTRAINT "PK_password_reset_tokens" PRIMARY KEY (id),
      CONSTRAINT "FK_password_reset_user" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    await runner.query(
      'CREATE UNIQUE INDEX "UQ_password_reset_user" ON password_reset_tokens(user_id)',
    );
    await runner.query(
      'CREATE UNIQUE INDEX "UQ_password_reset_hash" ON password_reset_tokens(token_hash)',
    );
    await runner.query(
      'CREATE INDEX "IX_password_reset_expiry" ON password_reset_tokens(expires_at)',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'LOCK TABLE users, password_reset_tokens IN ACCESS EXCLUSIVE MODE',
    );
    const [state]: { unsafe: boolean }[] = await runner.query(`SELECT
      EXISTS(SELECT 1 FROM password_reset_tokens) OR
      EXISTS(SELECT 1 FROM users WHERE auth_version <> 0) AS unsafe`);
    if (state.unsafe)
      throw new Error(
        'Cannot discard recovery proofs or credential revocation history. Keep this schema and roll back only to an auth-version-aware application.',
      );
    await runner.query('DROP TABLE password_reset_tokens');
    await runner.query('ALTER TABLE users DROP COLUMN auth_version');
  }
}
