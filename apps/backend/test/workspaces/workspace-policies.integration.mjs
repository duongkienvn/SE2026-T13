import assert from 'node:assert/strict';
import console from 'node:console';
import { verifyMoveMatrix } from './workspace-move-matrix.integration.mjs';

export async function verifyWorkspacePolicies({ source, send, actors }) {
  const createWorkspace = async (name) =>
    (await send('admin', 'post', '/api/workspaces').send({ name }).expect(201))
      .body.data;
  const sourceWorkspace = await createWorkspace('Policy source');
  const destination = await createWorkspace('Policy destination');
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role)
    VALUES ($1,$2,'MEMBER'), ($3,$2,'MEMBER'), ($3,$4,'ADMIN')`,
    [sourceWorkspace.id, actors.member, destination.id, actors.admin2],
  );
  const policiesPath = `/api/workspaces/${destination.id}/policies`;
  const defaults = (await send('member', 'get', policiesPath).expect(200)).body
    .data;
  assert.equal(defaults.boardCreationAdminOnly, false);
  assert.equal(defaults.boardInvitesEnabled, true);
  await send('member', 'patch', policiesPath)
    .send({ boardCreationAdminOnly: true })
    .expect(403);
  await send('admin', 'patch', policiesPath)
    .send({ unknown: true })
    .expect(400);
  await send('admin', 'patch', policiesPath)
    .send({ boardInvitesEnabled: 'false' })
    .expect(400);
  await send('admin', 'patch', policiesPath)
    .send({ boardCreationAdminOnly: true })
    .expect(200);
  await send('member', 'post', '/api/boards')
    .send({ name: 'Denied', workspaceId: destination.id })
    .expect(403);
  const board = (
    await send('admin', 'post', '/api/boards')
      .send({ name: 'Preserved', workspaceId: sourceWorkspace.id })
      .expect(201)
  ).body.data;
  const boardPath = `/api/boards/${board.id}`;
  const column = (
    await send('admin', 'post', `${boardPath}/columns`)
      .send({ name: 'Column' })
      .expect(201)
  ).body.data;
  const card = (
    await send('admin', 'post', `${boardPath}/cards`)
      .send({ title: 'Preserved card', columnId: column.id })
      .expect(201)
  ).body.data;
  const comment = (
    await send('admin', 'post', `${boardPath}/cards/${card.id}/comments`)
      .send({ content: 'Preserved comment' })
      .expect(201)
  ).body.data;
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [board.id, actors.member],
  );
  await send('admin', 'patch', `${boardPath}/visibility`)
    .send({ visibility: 'WORKSPACE_VISIBLE' })
    .expect(200);
  await send('member', 'post', `${boardPath}/move-workspace`)
    .send({ destinationWorkspaceId: destination.id })
    .expect(403);
  await send('admin2', 'post', `${boardPath}/move-workspace`)
    .send({ destinationWorkspaceId: destination.id })
    .expect(404);
  const moves = await Promise.all(
    [1, 2].map(() =>
      send('admin', 'post', `${boardPath}/move-workspace`)
        .send({ destinationWorkspaceId: destination.id })
        .expect(200),
    ),
  );
  const moved = moves[0].body.data;
  assert.equal(moved.id, board.id);
  assert.equal(moved.visibility, 'PRIVATE');
  assert.equal(
    (await send('admin', 'get', `${boardPath}/cards/${card.id}`).expect(200))
      .body.data.id,
    card.id,
  );
  const [preserved] = await source.query(
    'SELECT id FROM comments WHERE id=$1 AND card_id=$2',
    [comment.id, card.id],
  );
  assert.equal(preserved.id, comment.id);
  await send('admin2', 'get', boardPath).expect(404);
  await send('member', 'get', boardPath).expect(200);
  await send('admin', 'post', `${boardPath}/move-workspace`)
    .send({ destinationWorkspaceId: destination.id })
    .expect(200);
  const [audit] = await source.query(
    'SELECT count(*)::int AS count FROM board_workspace_moves WHERE board_id=$1',
    [board.id],
  );
  assert.equal(audit.count, 1);
  await send('admin', 'patch', policiesPath)
    .send({
      boardInvitesEnabled: false,
      boardMembershipChangesEnabled: false,
      boardVisibilityChangesEnabled: false,
    })
    .expect(200);
  const capabilities = (
    await send('admin', 'get', `${boardPath}/policy-capabilities`).expect(200)
  ).body.data;
  assert.deepEqual(capabilities, {
    canInviteMembers: false,
    canChangeMembership: false,
    canChangeVisibility: false,
  });
  await send('admin2', 'get', `${boardPath}/policy-capabilities`).expect(404);
  await send('admin', 'post', `${boardPath}/members`)
    .send({ email: 'outsider@invitation.example.test' })
    .expect(403);
  await send('admin', 'delete', `${boardPath}/members/${actors.member}`).expect(
    403,
  );
  await send('admin', 'patch', `${boardPath}/visibility`)
    .send({ visibility: 'WORKSPACE_VISIBLE' })
    .expect(403);
  await send('admin', 'delete', `/api/workspaces/${destination.id}`)
    .send({ confirmationName: destination.name })
    .expect(409);
  await send('admin', 'delete', `/api/workspaces/${sourceWorkspace.id}`)
    .send({ confirmationName: 'incorrect' })
    .expect(400);
  await send('admin', 'delete', `/api/workspaces/${sourceWorkspace.id}`)
    .send({ confirmationName: sourceWorkspace.name })
    .expect(204);
  const raceWorkspace = await createWorkspace('Create delete race');
  const [created, deleted] = await Promise.all([
    send('admin', 'post', '/api/boards').send({
      name: 'Concurrent Board',
      workspaceId: raceWorkspace.id,
    }),
    send('admin', 'delete', `/api/workspaces/${raceWorkspace.id}`).send({
      confirmationName: raceWorkspace.name,
    }),
  ]);
  assert(
    (created.status === 201 && deleted.status === 409) ||
      (created.status === 404 && deleted.status === 204),
    `Unexpected create/delete results: ${created.status}/${deleted.status}`,
  );
  console.log(
    'PASS: Workspace policy enforcement, move privacy and guarded deletion',
  );
  await verifyMoveMatrix({ source, send, actors });
}
