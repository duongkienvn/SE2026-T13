import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkspaceActivity1793491200000 implements MigrationInterface {
  name = 'WorkspaceActivity1793491200000';

  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Workspace activity migration requires a transaction');
    await runner.query(`CREATE TABLE workspace_activities (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      board_move_version integer,
      workspace_id uuid NOT NULL,
      actor_id uuid,
      event_type varchar(40) NOT NULL,
      board_id uuid,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT "PK_workspace_activities" PRIMARY KEY (id),
      CONSTRAINT "FK_workspace_activities_workspace" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      CONSTRAINT "FK_workspace_activities_actor" FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT "FK_workspace_activities_board" FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
      CONSTRAINT "CK_workspace_activities_type" CHECK (event_type IN ('WORKSPACE_CREATED','WORKSPACE_UPDATED','POLICY_UPDATED','MEMBER_JOINED','MEMBER_ROLE_CHANGED','MEMBER_REMOVED','MEMBER_LEFT','INVITATION_REQUESTED','INVITATION_REVOKED','INVITATION_DECLINED','BOARD_MOVED')),
      CONSTRAINT "CK_workspace_activities_board" CHECK ((event_type = 'BOARD_MOVED' AND board_id IS NOT NULL AND board_move_version IS NOT NULL) OR (event_type <> 'BOARD_MOVED' AND board_id IS NULL AND board_move_version IS NULL))
    )`);
    await runner.query(
      'CREATE INDEX "IDX_workspace_activities_order" ON workspace_activities (workspace_id, created_at DESC, id DESC)',
    );
    await runner.query(
      'CREATE INDEX "IDX_workspace_activities_board" ON workspace_activities (board_id) WHERE board_id IS NOT NULL',
    );
    await runner.query(
      'ALTER TABLE boards ADD COLUMN activity_move_version integer NOT NULL DEFAULT 0',
    );
    await runner.query(`CREATE FUNCTION public.advance_board_activity_move_version() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.activity_move_version := OLD.activity_move_version + 1; RETURN NEW; END $$`);
    await runner.query(`CREATE TRIGGER board_activity_move_version BEFORE UPDATE OF workspace_id ON boards
      FOR EACH ROW WHEN (OLD.workspace_id IS DISTINCT FROM NEW.workspace_id)
      EXECUTE FUNCTION public.advance_board_activity_move_version()`);
    // The legacy Board bridge also calls ensure_personal_workspace directly.
    // An insert trigger is the only shared atomic boundary for both callers.
    await runner.query(`CREATE FUNCTION public.record_personal_workspace_creation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.type = 'PERSONAL' THEN
          INSERT INTO public.workspace_activities (workspace_id, actor_id, event_type)
          VALUES (NEW.id, NEW.created_by_id, 'WORKSPACE_CREATED');
        END IF;
        RETURN NEW;
      END $$`);
    await runner.query(`CREATE TRIGGER workspace_activity_personal_created AFTER INSERT ON workspaces
      FOR EACH ROW EXECUTE FUNCTION public.record_personal_workspace_creation()`);
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Workspace activity migration requires a transaction');
    // Match Board move's lock order before fencing writers and checking history.
    await runner.query(
      'LOCK TABLE boards, workspaces, workspace_activities IN ACCESS EXCLUSIVE MODE',
    );
    const [{ populated }]: { populated: boolean }[] = await runner.query(
      'SELECT EXISTS (SELECT 1 FROM workspace_activities) AS populated',
    );
    if (populated)
      throw new Error(
        'Workspace activity history requires a forward fix or backup restore',
      );
    await runner.query(
      'DROP TRIGGER workspace_activity_personal_created ON workspaces',
    );
    await runner.query(
      'DROP FUNCTION public.record_personal_workspace_creation()',
    );
    await runner.query('DROP TRIGGER board_activity_move_version ON boards');
    await runner.query(
      'DROP FUNCTION public.advance_board_activity_move_version()',
    );
    await runner.query('ALTER TABLE boards DROP COLUMN activity_move_version');
    await runner.query('DROP TABLE workspace_activities');
  }
}
