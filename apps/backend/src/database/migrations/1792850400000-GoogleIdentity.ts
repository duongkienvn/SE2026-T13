import { MigrationInterface, QueryRunner } from 'typeorm';

export class GoogleIdentity1792850400000 implements MigrationInterface {
  name = 'GoogleIdentity1792850400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL',
    );
    await queryRunner.query(`CREATE TABLE google_identities (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      google_sub varchar(255) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_google_identities" PRIMARY KEY (id),
      CONSTRAINT "UQ_google_identity_sub" UNIQUE (google_sub),
      CONSTRAINT "UQ_google_identity_user" UNIQUE (user_id),
      CONSTRAINT "FK_google_identity_user" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // TypeORM runs migrations transactionally. Lock before checking so a signup
    // cannot introduce data between this guard and the destructive statements.
    await queryRunner.query(
      'LOCK TABLE users, google_identities IN ACCESS EXCLUSIVE MODE',
    );
    const [result]: { unsafe: boolean }[] = await queryRunner.query(`SELECT
      EXISTS(SELECT 1 FROM google_identities) OR
      EXISTS(SELECT 1 FROM users WHERE password_hash IS NULL) AS unsafe`);
    if (result.unsafe)
      throw new Error(
        'Cannot revert Google identity migration while identities or passwordless users exist. Keep the schema and use a compatible application rollback.',
      );
    await queryRunner.query(
      'ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL',
    );
    await queryRunner.query('DROP TABLE google_identities');
  }
}
