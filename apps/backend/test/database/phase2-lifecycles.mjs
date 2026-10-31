import assert from 'node:assert/strict';
import console from 'node:console';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { verifyPhase2Races } from './phase2-races.mjs';

const require = createRequire(import.meta.url);
const {
  WorkspacesService,
} = require('../../dist/api/workspaces/workspaces.service.js');
const {
  WorkspaceApiService,
} = require('../../dist/api/workspaces/workspace-api.service.js');
const {
  WorkspaceDeletionService,
} = require('../../dist/api/workspaces/workspace-deletion.service.js');
const {
  WorkspaceMembersService,
} = require('../../dist/api/workspaces/workspace-members.service.js');
const {
  WorkspaceInvitationIssuanceService,
} = require('../../dist/api/workspaces/workspace-invitation-issuance.service.js');
const {
  WorkspaceInvitationsService,
} = require('../../dist/api/workspaces/workspace-invitations.service.js');
const {
  BoardMoveService,
} = require('../../dist/api/boards/board-move.service.js');
const { BoardsService } = require('../../dist/api/boards/boards.service.js');
const {
  BoardAuthorizationService,
} = require('../../dist/api/board-members/board-authorization.service.js');
const {
  ActivityWriterService,
} = require('../../dist/api/activities/activity-writer.service.js');
const {
  BoardRoomCoordinator,
} = require('../../dist/realtime/board-room-coordinator.service.js');
const {
  BoardPresenceService,
} = require('../../dist/realtime/board-presence.service.js');

/** Independent coordinators let race tests prove PostgreSQL's boundaries. */
export function phase2Services(source) {
  const repository = source.getRepository('Workspace');
  const foundation = new WorkspacesService(repository);
  const authorization = new BoardAuthorizationService(
    source.getRepository('BoardMember'),
  );
  const coordinator = new BoardRoomCoordinator(new BoardPresenceService());
  const events = { publish: async () => undefined };
  const activities = new ActivityWriterService();
  return {
    foundation,
    authorization,
    api: new WorkspaceApiService(repository, foundation),
    deletion: new WorkspaceDeletionService(repository, foundation, coordinator),
    members: new WorkspaceMembersService(
      repository,
      foundation,
      authorization,
      coordinator,
    ),
    invitations: new WorkspaceInvitationsService(repository, foundation),
    // UNAVAILABLE is the existing no-provider state: no real messages or proof capture.
    issuance: new WorkspaceInvitationIssuanceService(repository, foundation),
    move: new BoardMoveService(
      source.getRepository('Board'),
      authorization,
      foundation,
      coordinator,
      events,
      activities,
    ),
    boards: new BoardsService(
      source.getRepository('Board'),
      source.getRepository('BoardMember'),
      authorization,
      activities,
      events,
      foundation,
    ),
  };
}
export const status = (code) => (error) => error.getStatus?.() === code;
export const sqlstate = (code, constraint) => (error) =>
  error.code === code && (!constraint || error.constraint === constraint);
export async function phase2User(source, name) {
  return (
    await source.query(
      'INSERT INTO users(email,display_name,email_verified_at) VALUES ($1,$1,now()) RETURNING id,email',
      [`${name}@integrity.example.test`],
    )
  )[0];
}

export async function verifyPhase2Lifecycles(source) {
  const services = phase2Services(source);
  const owner = await phase2User(source, 'lifecycle-owner');
  const guest = await phase2User(source, 'lifecycle-guest');
  const team = (name) => services.api.create(owner.id, { name });
  const origin = await team('Historical origin');
  const destination = await team('Historical destination');
  const board = await services.boards.create(owner.id, {
    name: 'Protected Board',
    workspaceId: origin.id,
  });
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [board.id, guest.id],
  );
  const [column] = await source.query(
    `INSERT INTO board_columns(board_id,name,position) VALUES ($1,'Preserved',100) RETURNING id`,
    [board.id],
  );
  const [card] = await source.query(
    `INSERT INTO cards(board_id,column_id,created_by_id,title,position) VALUES ($1,$2,$3,'Preserved card',100) RETURNING id`,
    [board.id, column.id, owner.id],
  );
  const snapshot = () =>
    source.query(
      `SELECT to_jsonb(c) AS card,to_jsonb(col) AS column,
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM board_members m WHERE m.board_id=c.board_id) AS members
    FROM cards c JOIN board_columns col ON col.id=c.column_id WHERE c.id=$1`,
      [card.id],
    );
  const before = await snapshot();
  await services.move.move(owner.id, board.id, destination.id);
  await services.deletion.remove(owner.id, origin.id, origin.name);
  assert.deepEqual(await snapshot(), before);
  const [history] = await source.query(
    'SELECT * FROM board_workspace_moves WHERE board_id=$1',
    [board.id],
  );
  assert.equal(history.source_workspace_id, origin.id);
  assert.equal(history.destination_workspace_id, destination.id);
  assert.equal(
    (await source.query('SELECT id FROM workspaces WHERE id=$1', [origin.id]))
      .length,
    0,
  );
  await assert.rejects(
    services.deletion.remove(owner.id, destination.id, destination.name),
    status(409),
  );
  await services.boards.archive(owner.id, board.id);
  await assert.rejects(
    services.deletion.remove(owner.id, destination.id, destination.name),
    status(409),
  );
  await assert.rejects(
    services.move.move(owner.id, board.id, destination.id),
    status(409),
  );
  const personal = await services.foundation.ensurePersonalWorkspace(owner.id);
  await assert.rejects(
    services.deletion.remove(owner.id, personal.id, personal.name),
    status(403),
  );
  await assert.rejects(
    services.members.leave(owner.id, destination.id),
    status(409),
  );

  // Isolate each historical FK rather than relying on whichever other FK fails first.
  const actor = await phase2User(source, 'historical-actor');
  const [rawBoard] = await source.query(
    `INSERT INTO boards(name,created_by_id,workspace_id) VALUES ('Audit-only Board',$1,$2) RETURNING id`,
    [owner.id, destination.id],
  );
  await source.query(
    `INSERT INTO board_workspace_moves(board_id,actor_id,source_workspace_id,destination_workspace_id,old_visibility,new_visibility)
    VALUES ($1,$2,$3,$4,'PRIVATE','PRIVATE')`,
    [rawBoard.id, actor.id, randomUUID(), destination.id],
  );
  await assert.rejects(
    source.query('DELETE FROM boards WHERE id=$1', [rawBoard.id]),
    sqlstate('23503', 'board_workspace_moves_board_id_fkey'),
  );
  await assert.rejects(
    source.query('DELETE FROM users WHERE id=$1', [actor.id]),
    sqlstate('23503', 'board_workspace_moves_actor_id_fkey'),
  );
  const membershipOnly = await phase2User(source, 'membership-only');
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [destination.id, membershipOnly.id],
  );
  await assert.rejects(
    source.query('DELETE FROM users WHERE id=$1', [membershipOnly.id]),
    sqlstate('23503', 'FK_workspace_members_user'),
  );
  const boardMemberOnly = await phase2User(source, 'board-member-only');
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [board.id, boardMemberOnly.id],
  );
  await assert.rejects(
    source.query('DELETE FROM users WHERE id=$1', [boardMemberOnly.id]),
    sqlstate('23503', 'FK_board_members_user_id'),
  );
  await assert.rejects(
    source.query('DELETE FROM users WHERE id=$1', [owner.id]),
    sqlstate('23503'),
  );

  const activityActor = await phase2User(source, 'activity-only');
  const [activity] = await source.query(
    `INSERT INTO workspace_activities(workspace_id,actor_id,event_type) VALUES ($1,$2,'WORKSPACE_UPDATED') RETURNING id`,
    [destination.id, activityActor.id],
  );
  await source.query('DELETE FROM users WHERE id=$1', [activityActor.id]);
  assert.equal(
    (
      await source.query(
        'SELECT actor_id FROM workspace_activities WHERE id=$1',
        [activity.id],
      )
    )[0].actor_id,
    null,
  );
  const quotaActor = await phase2User(source, 'quota-only');
  const quotaId = randomUUID();
  await source.query(
    `INSERT INTO deleted_workspace_invitation_quota(invitation_id,actor_id,recipient_hash,created_at) VALUES ($1,$2,repeat('b',64),now())`,
    [quotaId, quotaActor.id],
  );
  await source.query('DELETE FROM users WHERE id=$1', [quotaActor.id]);
  assert.equal(
    (
      await source.query(
        'SELECT actor_id FROM deleted_workspace_invitation_quota WHERE invitation_id=$1',
        [quotaId],
      )
    )[0].actor_id,
    quotaActor.id,
  );

  // Activity cascades are narrow: raw Board deletion clears only its Board-linked
  // activity, preserving general activity, other Workspaces and quota/move ledgers.
  const [disposableBoard] = await source.query(
    `INSERT INTO boards(name,created_by_id,workspace_id) VALUES ('Disposable',$1,$2) RETURNING id`,
    [owner.id, destination.id],
  );
  await source.query(
    `INSERT INTO workspace_activities(workspace_id,actor_id,event_type,board_id,board_move_version)
    VALUES ($1,$2,'BOARD_MOVED',$3,0)`,
    [destination.id, owner.id, disposableBoard.id],
  );
  const generalBefore = await source.query(
    'SELECT id FROM workspace_activities WHERE board_id IS NULL ORDER BY id',
  );
  await source.query('DELETE FROM boards WHERE id=$1', [disposableBoard.id]);
  assert.deepEqual(
    await source.query(
      'SELECT id FROM workspace_activities WHERE board_id IS NULL ORDER BY id',
    ),
    generalBefore,
  );
  assert.equal(
    (
      await source.query(
        'SELECT id FROM workspace_activities WHERE board_id=$1',
        [disposableBoard.id],
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await source.query('SELECT id FROM board_workspace_moves WHERE id=$1', [
        history.id,
      ])
    ).length,
    1,
  );

  const unrelatedBefore = await snapshot();
  const disposable = await team('Terminal invitations');
  const invitationIds = [];
  for (const state of [
    'pending',
    'accepted',
    'declined',
    'revoked',
    'expired',
  ]) {
    const [invitation] = await source.query(
      `INSERT INTO workspace_invitations(workspace_id,email,role,token_hash,invited_by_id,created_at,expires_at,consumed_at,declined_at,revoked_at)
      VALUES ($1,$2,'MEMBER',$3,$4,now()-interval '30 minutes',CASE WHEN $5='expired' THEN now()-interval '1 minute' ELSE now()+interval '1 day' END,
      CASE WHEN $5='accepted' THEN now()-interval '2 minutes' END,CASE WHEN $5='declined' THEN now()-interval '2 minutes' END,CASE WHEN $5='revoked' THEN now()-interval '2 minutes' END) RETURNING id`,
      [
        disposable.id,
        `terminal-${state}@example.test`,
        randomBytes(32).toString('hex'),
        owner.id,
        state,
      ],
    );
    invitationIds.push(invitation.id);
  }
  // A lone inviter reference blocks account deletion, independently of ownership.
  const inviter = await phase2User(source, 'inviter-only');
  await source.query(
    'UPDATE workspace_invitations SET invited_by_id=$1 WHERE id=$2',
    [inviter.id, invitationIds[0]],
  );
  await assert.rejects(
    source.query('DELETE FROM users WHERE id=$1', [inviter.id]),
    sqlstate('23503', 'FK_workspace_invitations_inviter'),
  );
  const outsider = await phase2User(source, 'outsider');
  await assert.rejects(
    services.deletion.remove(outsider.id, disposable.id, disposable.name),
    status(404),
  );
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [disposable.id, guest.id],
  );
  await assert.rejects(
    services.deletion.remove(guest.id, disposable.id, disposable.name),
    status(403),
  );

  // Inject a SQL failure at the final DELETE, after ledger copy and grant cleanup.
  await source.query(
    `CREATE FUNCTION public.integrity_abort_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic deletion rollback'; END $$`,
  );
  await source.query(
    `CREATE TRIGGER integrity_abort_delete BEFORE DELETE ON workspaces FOR EACH ROW WHEN (OLD.id='${disposable.id}'::uuid) EXECUTE FUNCTION public.integrity_abort_delete()`,
  );
  const retainedBefore = await source.query(
    'SELECT * FROM workspace_activities WHERE workspace_id=$1 ORDER BY id',
    [disposable.id],
  );
  try {
    await assert.rejects(
      services.deletion.remove(owner.id, disposable.id, disposable.name),
      /synthetic deletion rollback/,
    );
  } finally {
    await source.query('DROP TRIGGER integrity_abort_delete ON workspaces');
    await source.query('DROP FUNCTION public.integrity_abort_delete()');
  }
  assert.equal(
    (
      await source.query(
        'SELECT id FROM workspace_invitations WHERE workspace_id=$1',
        [disposable.id],
      )
    ).length,
    5,
  );
  assert.equal(
    (
      await source.query(
        'SELECT id FROM workspace_members WHERE workspace_id=$1',
        [disposable.id],
      )
    ).length,
    2,
  );
  assert.equal(
    (
      await source.query(
        'SELECT invitation_id FROM deleted_workspace_invitation_quota WHERE invitation_id=ANY($1::uuid[])',
        [invitationIds],
      )
    ).length,
    0,
  );
  assert.deepEqual(
    await source.query(
      'SELECT * FROM workspace_activities WHERE workspace_id=$1 ORDER BY id',
      [disposable.id],
    ),
    retainedBefore,
  );
  await services.deletion.remove(owner.id, disposable.id, disposable.name);
  assert.equal(
    (
      await source.query(
        'SELECT id FROM workspace_invitations WHERE workspace_id=$1',
        [disposable.id],
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await source.query(
        'SELECT id FROM workspace_members WHERE workspace_id=$1',
        [disposable.id],
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await source.query(
        'SELECT id FROM workspace_activities WHERE workspace_id=$1',
        [disposable.id],
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await source.query(
        'SELECT invitation_id FROM deleted_workspace_invitation_quota WHERE invitation_id=ANY($1::uuid[])',
        [invitationIds],
      )
    ).length,
    5,
  );
  assert.deepEqual(
    await snapshot(),
    unrelatedBefore,
    'Unrelated Board/Card/membership data unchanged',
  );
  console.log(
    'PASS: intentional historical/no-FK retention; isolated User/Board FK restrictions; activity cascades/actor nulling; all invitation terminal states retained as quota; late deletion failure rolls back ledger/grants/activity',
  );
  await verifyPhase2Races(source, phase2Services, owner);
}
