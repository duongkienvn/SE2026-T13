import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Changes future provisioning only; existing/custom names are never updated. */
export class PersonalWorkspaceName1793577600000 implements MigrationInterface {
  name = 'PersonalWorkspaceName1793577600000';

  async up(runner: QueryRunner): Promise<void> {
    await this.replace(runner, 'Kanvexa Workspace');
  }

  async down(runner: QueryRunner): Promise<void> {
    // Revert only the future default. Existing rows keep their names and IDs.
    await this.replace(runner, 'Personal Workspace');
  }

  private async replace(
    runner: QueryRunner,
    defaultName: 'Kanvexa Workspace' | 'Personal Workspace',
  ): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Workspace naming migration requires a transaction');
    await runner.query(`CREATE OR REPLACE FUNCTION public.ensure_personal_workspace(owner_id uuid)
      RETURNS uuid LANGUAGE plpgsql AS $$
      DECLARE workspace_uuid uuid;
      BEGIN
        INSERT INTO public.workspaces (type, name, created_by_id)
          SELECT 'PERSONAL', '${defaultName}', id FROM public.users WHERE id = owner_id
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
  }
}
