import { MigrationInterface, QueryRunner } from 'typeorm';

export class PrivateAvatars1793102400103 implements MigrationInterface {
  name = 'PrivateAvatars1793102400103';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "avatar_object_key" varchar, ADD "avatar_revision" integer NOT NULL DEFAULT 0, ADD CONSTRAINT "CK_users_avatar_revision" CHECK ("avatar_revision" >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CK_users_avatar_owner" CHECK ("avatar_object_key" IS NULL OR "avatar_object_key" ~ ('^[a-z0-9/-]+/active/' || "id"::text || '/[0-9a-f-]{36}[.]webp$'))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_users_avatar_object_key" ON "users" ("avatar_object_key") WHERE "avatar_object_key" IS NOT NULL`,
    );
    await queryRunner.query(`CREATE TABLE "avatar_uploads" (
      "id" uuid NOT NULL, "user_id" uuid NOT NULL,
      "pending_key" varchar NOT NULL, "active_key" varchar NOT NULL,
      "content_type" varchar NOT NULL CONSTRAINT "CK_avatar_upload_mime" CHECK ("content_type" IN ('image/jpeg','image/png','image/webp')),
      "file_size" integer NOT NULL CONSTRAINT "CK_avatar_upload_size" CHECK ("file_size" BETWEEN 1 AND 5242880),
      "base_revision" integer NOT NULL CONSTRAINT "CK_avatar_upload_revision" CHECK ("base_revision" >= 0),
      "state" varchar NOT NULL DEFAULT 'pending' CONSTRAINT "CK_avatar_upload_state" CHECK ("state" IN ('pending','processing','completed','rejected')),
      "created_at" timestamptz NOT NULL, "expires_at" timestamptz NOT NULL,
      "next_cleanup_at" timestamptz NOT NULL,
      CONSTRAINT "PK_avatar_uploads" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_avatar_uploads_pending" UNIQUE ("pending_key"),
      CONSTRAINT "UQ_avatar_uploads_active" UNIQUE ("active_key"),
      CONSTRAINT "FK_avatar_uploads_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION,
      CONSTRAINT "CK_avatar_upload_expiry" CHECK ("expires_at" > "created_at")
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_avatar_uploads_user_expiry" ON "avatar_uploads" ("user_id", "expires_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_avatar_uploads_cleanup" ON "avatar_uploads" ("next_cleanup_at")`,
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('LOCK TABLE "users" IN ACCESS EXCLUSIVE MODE');
    const [row] = (await queryRunner.query(
      `SELECT count(*)::int AS count FROM "users" WHERE "avatar_object_key" IS NOT NULL`,
    )) as { count: number }[];
    if (row.count > 0)
      throw new Error(
        'Detach or export private avatars before reverting PrivateAvatars',
      );
    await queryRunner.query(`DROP TABLE "avatar_uploads"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CK_users_avatar_owner", DROP CONSTRAINT "CK_users_avatar_revision", DROP COLUMN "avatar_revision", DROP COLUMN "avatar_object_key"`,
    );
  }
}
