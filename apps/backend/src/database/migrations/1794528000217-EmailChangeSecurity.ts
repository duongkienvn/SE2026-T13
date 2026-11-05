import { MigrationInterface, QueryRunner } from 'typeorm';

export class EmailChangeSecurity1794528000217 implements MigrationInterface {
  name = 'EmailChangeSecurity1794528000217';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE pending_email_changes (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      token_hash char(64) NOT NULL,
      new_email varchar(254) NOT NULL,
      original_email varchar(254) NOT NULL,
      original_auth_version integer NOT NULL,
      created_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz NULL,
      sent_at timestamptz NULL,
      issuance_attempts timestamptz[] NOT NULL,
      CONSTRAINT "PK_pending_email_changes" PRIMARY KEY (id),
      CONSTRAINT "FK_email_change_user" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT "CK_email_change_hash" CHECK (token_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT "CK_email_change_email" CHECK (new_email = lower(btrim(new_email)) AND original_email = lower(btrim(original_email)) AND length(new_email) BETWEEN 3 AND 254 AND length(original_email) BETWEEN 3 AND 254),
      CONSTRAINT "CK_email_change_version" CHECK (original_auth_version >= 0),
      CONSTRAINT "CK_email_change_dates" CHECK (isfinite(created_at) AND isfinite(expires_at) AND expires_at = created_at + interval '30 minutes' AND (consumed_at IS NULL OR (isfinite(consumed_at) AND consumed_at >= created_at)) AND (sent_at IS NULL OR (isfinite(sent_at) AND sent_at >= created_at))),
      CONSTRAINT "CK_email_change_quota" CHECK (cardinality(issuance_attempts) BETWEEN 1 AND 5 AND array_ndims(issuance_attempts) = 1 AND array_position(issuance_attempts, NULL) IS NULL)
    )`);
    await runner.query(
      'CREATE UNIQUE INDEX "UQ_email_change_user" ON pending_email_changes(user_id)',
    );
    await runner.query(
      'CREATE UNIQUE INDEX "UQ_email_change_hash" ON pending_email_changes(token_hash)',
    );
    await runner.query(
      'CREATE INDEX "IX_email_change_expiry" ON pending_email_changes(expires_at)',
    );
  }
  async down(): Promise<void> {
    throw new Error(
      'Email change security is forward-only. Preserve proofs and rolling issuance history; roll forward or restore a reviewed backup.',
    );
  }
}
