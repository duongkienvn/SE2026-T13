import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive retention boundary. Existing UUIDs, FKs and collaborative rows survive. */
export class AccountDeletion1794614400218 implements MigrationInterface {
  name = 'AccountDeletion1794614400218';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE users ADD COLUMN deleted_at timestamptz,
      ADD CONSTRAINT "CK_users_deleted_identity" CHECK (
        deleted_at IS NULL OR (display_name = 'Deleted user'
        AND email = 'deleted+' || id::text || '@users.invalid'
        AND password_hash IS NULL AND email_verified_at IS NULL
        AND avatar_url IS NULL AND avatar_object_key IS NULL))`);
    await runner.query(`CREATE FUNCTION public.guard_user_tombstone() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF OLD.deleted_at IS NOT NULL AND (
          NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.auth_version < OLD.auth_version
        ) THEN RAISE EXCEPTION 'Deleted identity is irreversible' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
      END $$`);
    await runner.query(`CREATE TRIGGER guard_user_tombstone BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION public.guard_user_tombstone()`);
  }

  async down(): Promise<void> {
    throw new Error(
      'Account deletion is forward-only. Retain tombstones and revocations; roll forward with a reviewed migration.',
    );
  }
}
