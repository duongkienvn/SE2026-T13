import { MigrationInterface, QueryRunner } from 'typeorm';

export class WelcomeEmailOutbox1793188800000 implements MigrationInterface {
  name = 'WelcomeEmailOutbox1793188800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Empty by design: existing users, including pending verification, are ineligible.
    await queryRunner.query(`CREATE TABLE "welcome_email_deliveries" (
      "user_id" uuid NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "ready_at" timestamptz,
      "message" jsonb,
      "attempts" integer NOT NULL DEFAULT 0,
      "first_attempt_at" timestamptz,
      "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
      "lease_until" timestamptz,
      "lease_token" uuid,
      "sent_at" timestamptz,
      "stopped_at" timestamptz,
      CONSTRAINT "PK_welcome_email_deliveries" PRIMARY KEY ("user_id"),
      CONSTRAINT "FK_welcome_email_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
      CONSTRAINT "CK_welcome_email_ready" CHECK (("ready_at" IS NULL) = ("message" IS NULL)),
      CONSTRAINT "CK_welcome_email_attempts" CHECK ("attempts" >= 0)
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_welcome_email_pending"
      ON "welcome_email_deliveries" ("next_attempt_at")
      WHERE "ready_at" IS NOT NULL AND "sent_at" IS NULL AND "stopped_at" IS NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Dropping delivery history would let a later re-enrollment resend. Require
    // explicit operational reconciliation instead of silently erasing the ledger.
    // Hold through the migration transaction so signup cannot insert between
    // the emptiness check and DROP. LOCK also refuses nontransactional rollback.
    await queryRunner.query(
      'LOCK TABLE "welcome_email_deliveries" IN ACCESS EXCLUSIVE MODE',
    );
    const [row]: { present: boolean }[] = await queryRunner.query(
      'SELECT EXISTS (SELECT 1 FROM "welcome_email_deliveries") AS present',
    );
    if (row.present)
      throw new Error(
        'Cannot revert welcome email outbox with delivery records; preserve history and roll forward',
      );
    await queryRunner.query('DROP TABLE "welcome_email_deliveries"');
  }
}
