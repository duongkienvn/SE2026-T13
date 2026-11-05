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
    // A live grant/private row must not arrive after deletion enumerated dependencies.
    // SHARE (unlike FK KEY SHARE) conflicts with the deletion's User UPDATE lock.
    // Historical references are deliberately not checked on ordinary updates.
    await runner.query(`CREATE FUNCTION public.require_live_account_reference() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE account_id uuid; field_name text; erased timestamptz;
      BEGIN
        FOREACH field_name IN ARRAY TG_ARGV LOOP
          account_id := (to_jsonb(NEW)->>field_name)::uuid;
          IF account_id IS NULL THEN CONTINUE; END IF;
          SELECT deleted_at INTO erased FROM public.users WHERE id=account_id FOR SHARE;
          IF NOT FOUND OR erased IS NOT NULL THEN
            RAISE EXCEPTION 'Account is unavailable' USING ERRCODE='23503';
          END IF;
        END LOOP;
        RETURN NEW;
      END $$`);
    for (const [table, fields] of [
      ['workspaces', ['created_by_id']],
      ['boards', ['created_by_id']],
      ['board_members', ['user_id']],
      ['workspace_members', ['user_id']],
      ['card_assignees', ['user_id']],
      ['workspace_invitations', ['invited_by_id']],
      ['google_identities', ['user_id']],
      ['email_verification_tokens', ['user_id']],
      ['password_reset_tokens', ['user_id']],
      ['pending_email_changes', ['user_id']],
      ['user_preferences', ['user_id']],
      ['notification_preferences', ['user_id']],
      ['user_notifications', ['recipient_user_id']],
      ['task_notification_email_outbox', ['recipient_user_id']],
      ['welcome_email_deliveries', ['user_id']],
      ['board_user_states', ['user_id']],
      ['avatar_uploads', ['user_id']],
    ] as const) {
      const event = [
        'board_members',
        'workspace_members',
        'card_assignees',
      ].includes(table)
        ? 'INSERT OR UPDATE'
        : 'INSERT';
      await runner.query(`CREATE TRIGGER account_live_reference BEFORE ${event} ON ${table}
        FOR EACH ROW EXECUTE FUNCTION public.require_live_account_reference(${fields.map((field) => `'${field}'`).join(',')})`);
    }
  }

  async down(): Promise<void> {
    throw new Error(
      'Account deletion is forward-only. Retain tombstones and revocations; roll forward with a reviewed migration.',
    );
  }
}
