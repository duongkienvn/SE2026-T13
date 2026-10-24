import { MigrationInterface, QueryRunner } from 'typeorm';

export class EmailVerification1792843200000 implements MigrationInterface {
  name = 'EmailVerification1792843200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ NULL`,
    );
    // Only users present at migration time are grandfathered in; no default.
    await queryRunner.query(
      `UPDATE users SET email_verified_at = CURRENT_TIMESTAMP`,
    );
    await queryRunner.query(`CREATE TABLE email_verification_tokens (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      token_hash char(64) NOT NULL,
      created_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz NULL,
      sent_at timestamptz NULL,
      window_started_at timestamptz NOT NULL,
      attempts integer NOT NULL,
      CONSTRAINT "PK_email_verification_tokens" PRIMARY KEY (id),
      CONSTRAINT "FK_email_verification_user" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_email_verification_user" ON email_verification_tokens(user_id)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_email_verification_hash" ON email_verification_tokens(token_hash)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE email_verification_tokens`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN email_verified_at`);
  }
}
