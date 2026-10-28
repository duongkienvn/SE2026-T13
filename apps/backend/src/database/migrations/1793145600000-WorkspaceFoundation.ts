import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Expand plus an old-writer bridge. Backfill/constrain is a separate migration. */
export class WorkspaceFoundation1793145600000 implements MigrationInterface {
  name = 'WorkspaceFoundation1793145600000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE workspaces (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      type varchar NOT NULL,
      name varchar(120) NOT NULL,
      description text,
      created_by_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_workspaces" PRIMARY KEY (id),
      CONSTRAINT "FK_workspaces_creator" FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE NO ACTION,
      CONSTRAINT "CK_workspaces_type" CHECK (type IN ('PERSONAL', 'TEAM')),
      CONSTRAINT "CK_workspaces_name" CHECK (length(btrim(name)) > 0)
    )`);
    await runner.query(`CREATE UNIQUE INDEX "UQ_workspaces_personal_creator"
      ON workspaces(created_by_id) WHERE type = 'PERSONAL'`);
    await runner.query(
      `CREATE INDEX "IDX_workspaces_created_by_id" ON workspaces(created_by_id)`,
    );
    await runner.query(`CREATE TABLE workspace_members (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL,
      user_id uuid NOT NULL,
      role varchar NOT NULL,
      joined_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_workspace_members" PRIMARY KEY (id),
      CONSTRAINT "UQ_workspace_members_workspace_user" UNIQUE (workspace_id, user_id),
      CONSTRAINT "FK_workspace_members_workspace" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE NO ACTION,
      CONSTRAINT "FK_workspace_members_user" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION,
      CONSTRAINT "CK_workspace_members_role" CHECK (role IN ('ADMIN', 'MEMBER'))
    )`);
    await runner.query(
      `CREATE INDEX "IDX_workspace_members_user_id" ON workspace_members(user_id)`,
    );
    await runner.query(
      `CREATE INDEX "IDX_workspace_members_workspace_role" ON workspace_members(workspace_id, role)`,
    );
    await runner.query(`CREATE TABLE workspace_invitations (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL,
      email varchar(320) NOT NULL,
      role varchar NOT NULL,
      token_hash char(64) NOT NULL,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      revoked_at timestamptz,
      invited_by_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_workspace_invitations" PRIMARY KEY (id),
      CONSTRAINT "UQ_workspace_invitations_hash" UNIQUE (token_hash),
      CONSTRAINT "FK_workspace_invitations_workspace" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE NO ACTION,
      CONSTRAINT "FK_workspace_invitations_inviter" FOREIGN KEY (invited_by_id) REFERENCES users(id) ON DELETE NO ACTION,
      CONSTRAINT "CK_workspace_invitations_email" CHECK (email = lower(btrim(email)) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
      CONSTRAINT "CK_workspace_invitations_role" CHECK (role IN ('ADMIN', 'MEMBER')),
      CONSTRAINT "CK_workspace_invitations_hash" CHECK (token_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT "CK_workspace_invitations_expiry" CHECK (expires_at > created_at),
      CONSTRAINT "CK_workspace_invitations_terminal" CHECK (
        (consumed_at IS NULL OR (consumed_at >= created_at AND consumed_at < expires_at)) AND
        (revoked_at IS NULL OR revoked_at >= created_at) AND
        NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL))
    )`);
    await runner.query(
      `CREATE INDEX "IDX_workspace_invitations_workspace_email" ON workspace_invitations(workspace_id, email)`,
    );
    await runner.query(
      `CREATE INDEX "IDX_workspace_invitations_expires_at" ON workspace_invitations(expires_at)`,
    );
    await runner.query(
      `CREATE INDEX "IDX_workspace_invitations_invited_by_id" ON workspace_invitations(invited_by_id)`,
    );
    await runner.query(`ALTER TABLE boards
      ADD COLUMN workspace_id uuid,
      ADD COLUMN visibility varchar NOT NULL DEFAULT 'PRIVATE',
      ADD CONSTRAINT "FK_boards_workspace" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE NO ACTION,
      ADD CONSTRAINT "CK_boards_visibility" CHECK (visibility IN ('PRIVATE', 'WORKSPACE_VISIBLE'))`);
    await runner.query(
      `CREATE INDEX "IDX_boards_workspace_id" ON boards(workspace_id)`,
    );

    // One PostgreSQL primitive for the service, migration and old-binary bridge.
    // Unique-index conflict handling serializes concurrent creators across hosts.
    // This is SECURITY INVOKER, with schema-qualified tables and no dynamic SQL.
    await runner.query(`CREATE FUNCTION public.ensure_personal_workspace(owner_id uuid)
      RETURNS uuid LANGUAGE plpgsql AS $$
      DECLARE workspace_uuid uuid;
      BEGIN
        INSERT INTO public.workspaces (type, name, created_by_id)
          SELECT 'PERSONAL', 'Personal Workspace', id FROM public.users WHERE id = owner_id
          ON CONFLICT (created_by_id) WHERE type = 'PERSONAL'
          DO UPDATE SET created_by_id = EXCLUDED.created_by_id
          RETURNING id INTO workspace_uuid;
        IF workspace_uuid IS NULL THEN
          RAISE EXCEPTION 'Personal Workspace requires an existing user' USING ERRCODE = '23503';
        END IF;
        INSERT INTO public.workspace_members (workspace_id, user_id, role)
          VALUES (workspace_uuid, owner_id, 'ADMIN')
          ON CONFLICT (workspace_id, user_id) DO UPDATE
          SET role = 'ADMIN', updated_at = now()
          WHERE workspace_members.role <> 'ADMIN';
        RETURN workspace_uuid;
      END $$`);
    await runner.query(`CREATE FUNCTION public.bridge_board_workspace()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.workspace_id IS NULL THEN
          NEW.workspace_id := public.ensure_personal_workspace(NEW.created_by_id);
          NEW.visibility := 'PRIVATE';
        END IF;
        RETURN NEW;
      END $$`);
    await runner.query(`CREATE TRIGGER "TR_boards_workspace_bridge"
      BEFORE INSERT OR UPDATE ON boards FOR EACH ROW
      WHEN (NEW.workspace_id IS NULL) EXECUTE FUNCTION public.bridge_board_workspace()`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'LOCK TABLE boards, workspaces, workspace_members, workspace_invitations IN ACCESS EXCLUSIVE MODE',
    );
    const [state]: { unsafe: boolean }[] = await runner.query(`SELECT
      EXISTS(SELECT 1 FROM workspaces) OR
      EXISTS(SELECT 1 FROM workspace_members) OR
      EXISTS(SELECT 1 FROM workspace_invitations) OR
      EXISTS(SELECT 1 FROM boards WHERE workspace_id IS NOT NULL) AS unsafe`);
    if (state.unsafe)
      throw new Error(
        'Cannot discard populated Workspace data. Keep schema and use a compatible application rollback or forward fix.',
      );
    await runner.query('DROP TRIGGER "TR_boards_workspace_bridge" ON boards');
    await runner.query('DROP FUNCTION public.bridge_board_workspace()');
    await runner.query('DROP FUNCTION public.ensure_personal_workspace(uuid)');
    await runner.query(
      'ALTER TABLE boards DROP COLUMN workspace_id, DROP COLUMN visibility',
    );
    await runner.query(
      'DROP TABLE workspace_invitations, workspace_members, workspaces',
    );
  }
}
