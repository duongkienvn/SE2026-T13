import assert from 'node:assert/strict';
import console from 'node:console';
import { randomUUID } from 'node:crypto';

export async function verifyMoveMatrix({ source, send, actors }) {
  const workspace = async (name) =>
    (await send('admin', 'post', '/api/workspaces').send({ name }).expect(201))
      .body.data;
  const board = async (workspaceId, name) =>
    (
      await send('admin', 'post', '/api/boards')
        .send({ name, workspaceId })
        .expect(201)
    ).body.data;
  const move = (actor, id, workspaceId) =>
    send(actor, 'post', `/api/boards/${id}/move-workspace`).send({
      destinationWorkspaceId: workspaceId,
    });

  const origin = await workspace('Move matrix source');
  const destination = await workspace('Move matrix destination');
  const restricted = await workspace('Move matrix restricted');
  const testBoard = await board(origin.id, 'Guest owner board');
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')`,
    [testBoard.id, actors.guest],
  );
  await move('guest', testBoard.id, destination.id).expect(404);
  await move('guest', testBoard.id, randomUUID()).expect(404);
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN')`,
    [origin.id, actors.admin2],
  );
  await send('admin', 'patch', `/api/boards/${testBoard.id}/visibility`)
    .send({ visibility: 'WORKSPACE_VISIBLE' })
    .expect(200);
  await send('admin2', 'get', `/api/boards/${testBoard.id}`).expect(200);
  await move('admin2', testBoard.id, destination.id).expect(404);
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER'),($3,$2,'MEMBER')`,
    [destination.id, actors.guest, restricted.id],
  );
  await send('admin', 'patch', `/api/workspaces/${restricted.id}/policies`)
    .send({ boardCreationAdminOnly: true })
    .expect(200);
  await move('guest', testBoard.id, restricted.id).expect(403);
  const column = (
    await send('admin', 'post', `/api/boards/${testBoard.id}/columns`)
      .send({ name: 'Preserved column' })
      .expect(201)
  ).body.data;
  const card = (
    await send('admin', 'post', `/api/boards/${testBoard.id}/cards`)
      .send({ title: 'Preserved card', columnId: column.id })
      .expect(201)
  ).body.data;
  await send(
    'admin',
    'post',
    `/api/boards/${testBoard.id}/cards/${card.id}/assignees`,
  )
    .send({ userId: actors.guest })
    .expect(201);
  await send(
    'admin',
    'post',
    `/api/boards/${testBoard.id}/cards/${card.id}/comments`,
  )
    .send({ content: 'Preserved comment' })
    .expect(201);
  await send(
    'admin',
    'post',
    `/api/boards/${testBoard.id}/cards/${card.id}/archive`,
  ).expect(200);
  const before = await source.query(
    `SELECT b.created_by_id, b.id AS board_id, c.id AS column_id, c.position AS column_position,
      k.id AS card_id, k.position AS card_position, k.is_archived, k.archived_at,
      (SELECT json_agg(row_to_json(m) ORDER BY m.id) FROM board_members m WHERE m.board_id=b.id) AS members,
      (SELECT json_agg(row_to_json(a) ORDER BY a.id) FROM card_assignees a WHERE a.card_id=k.id) AS assignees,
      (SELECT json_agg(row_to_json(n) ORDER BY n.id) FROM comments n WHERE n.card_id=k.id) AS comments,
      (SELECT json_agg(row_to_json(h) ORDER BY h.id) FROM activities h WHERE h.board_id=b.id) AS activities
    FROM boards b JOIN board_columns c ON c.board_id=b.id JOIN cards k ON k.column_id=c.id WHERE b.id=$1`,
    [testBoard.id],
  );
  await move('guest', testBoard.id, destination.id).expect(200);
  const after = await source.query(
    `SELECT b.created_by_id, b.id AS board_id, c.id AS column_id, c.position AS column_position,
      k.id AS card_id, k.position AS card_position, k.is_archived, k.archived_at,
      (SELECT json_agg(row_to_json(m) ORDER BY m.id) FROM board_members m WHERE m.board_id=b.id) AS members,
      (SELECT json_agg(row_to_json(a) ORDER BY a.id) FROM card_assignees a WHERE a.card_id=k.id) AS assignees,
      (SELECT json_agg(row_to_json(n) ORDER BY n.id) FROM comments n WHERE n.card_id=k.id) AS comments,
      (SELECT json_agg(row_to_json(h) ORDER BY h.id) FROM activities h WHERE h.board_id=b.id) AS activities
    FROM boards b JOIN board_columns c ON c.board_id=b.id JOIN cards k ON k.column_id=c.id WHERE b.id=$1`,
    [testBoard.id],
  );
  const previousActivityIds = new Set(
    before[0].activities.map((activity) => activity.id),
  );
  const addedActivities = after[0].activities.filter(
    (activity) => !previousActivityIds.has(activity.id),
  );
  assert.equal(addedActivities.length, 1);
  assert.equal(addedActivities[0].action_type, 'BOARD_UPDATED');
  after[0].activities = after[0].activities.filter((activity) =>
    previousActivityIds.has(activity.id),
  );
  assert.deepEqual(after, before);
  const [membership] = await source.query(
    'SELECT role FROM board_members WHERE board_id=$1 AND user_id=$2',
    [testBoard.id, actors.guest],
  );
  assert.equal(membership.role, 'OWNER');
  const [sourceMembership] = await source.query(
    'SELECT count(*)::int AS count FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
    [origin.id, actors.guest],
  );
  assert.equal(sourceMembership.count, 0);
  await send('guest', 'get', `/api/boards/${testBoard.id}`).expect(200);
  await send('admin', 'post', `/api/boards/${testBoard.id}/archive`).expect(
    200,
  );
  await move('guest', testBoard.id, origin.id).expect(409);
  await move('guest', testBoard.id, randomUUID()).expect(409);

  const disappearingTarget = await workspace('Membership revoked');
  const revocationBoard = await board(origin.id, 'Destination member removed');
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')`,
    [revocationBoard.id, actors.guest],
  );
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [disappearingTarget.id, actors.guest],
  );
  const [attemptedMove, removed] = await Promise.all([
    move('guest', revocationBoard.id, disappearingTarget.id),
    send(
      'admin',
      'delete',
      `/api/workspaces/${disappearingTarget.id}/members/${actors.guest}`,
    ),
  ]);
  assert.equal(removed.status, 204);
  assert([200, 404].includes(attemptedMove.status));
  const [revoked] = await source.query(
    `SELECT workspace_id FROM boards WHERE id=$1`,
    [revocationBoard.id],
  );
  assert.equal(
    revoked.workspace_id,
    attemptedMove.status === 200 ? disappearingTarget.id : origin.id,
  );
  await move('guest', revocationBoard.id, disappearingTarget.id).expect(404);
  await send('guest', 'get', `/api/boards/${revocationBoard.id}`).expect(200);

  const firstTarget = await workspace('Concurrent move one');
  const secondTarget = await workspace('Concurrent move two');
  const concurrentBoard = await board(origin.id, 'Concurrent moves');
  await Promise.all([
    move('admin', concurrentBoard.id, firstTarget.id).expect(200),
    move('admin', concurrentBoard.id, secondTarget.id).expect(200),
  ]);
  const [concurrentResult] = await source.query(
    `SELECT b.workspace_id, b.visibility, count(m.id)::int AS moves
     FROM boards b JOIN board_workspace_moves m ON m.board_id=b.id
     WHERE b.id=$1 GROUP BY b.id`,
    [concurrentBoard.id],
  );
  assert(
    [firstTarget.id, secondTarget.id].includes(concurrentResult.workspace_id),
  );
  assert.equal(concurrentResult.visibility, 'PRIVATE');
  assert.equal(concurrentResult.moves, 2);

  const deleteTarget = await workspace('Move versus deletion');
  const deleteRaceBoard = await board(origin.id, 'Move delete race');
  const [moveResult, deletion] = await Promise.all([
    move('admin', deleteRaceBoard.id, deleteTarget.id),
    send('admin', 'delete', `/api/workspaces/${deleteTarget.id}`).send({
      confirmationName: deleteTarget.name,
    }),
  ]);
  assert(
    (moveResult.status === 200 && deletion.status === 409) ||
      (moveResult.status === 404 && deletion.status === 204),
    `Unexpected move/delete results: ${moveResult.status}/${deletion.status}`,
  );
  await send('admin', 'get', `/api/boards/${deleteRaceBoard.id}`).expect(200);

  const empty = await workspace('Concurrent policies');
  await Promise.all([
    send('admin', 'patch', `/api/workspaces/${empty.id}/policies`)
      .send({ boardInvitesEnabled: false })
      .expect(200),
    send('admin', 'patch', `/api/workspaces/${empty.id}/policies`)
      .send({ boardMembershipChangesEnabled: false })
      .expect(200),
  ]);
  const policies = (
    await send('admin', 'get', `/api/workspaces/${empty.id}/policies`).expect(
      200,
    )
  ).body.data;
  assert.equal(policies.boardInvitesEnabled, false);
  assert.equal(policies.boardMembershipChangesEnabled, false);
  for (const value of [null, 0, 'true'])
    await send('admin', 'patch', `/api/workspaces/${empty.id}/policies`)
      .send({ boardInvitesEnabled: value })
      .expect(400);

  const personal = (
    await send('admin', 'get', '/api/workspaces/personal').expect(200)
  ).body.data;
  await send('admin', 'delete', `/api/workspaces/${personal.id}`)
    .send({ confirmationName: personal.name })
    .expect(403);
  const hidden = await workspace('Hidden archived board');
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN'),($1,$3,'MEMBER')`,
    [hidden.id, actors.admin2, actors.member],
  );
  const hiddenBoard = await board(hidden.id, 'Hidden secret board');
  await send('admin', 'post', `/api/boards/${hiddenBoard.id}/archive`).expect(
    200,
  );
  const denial = await send('admin2', 'delete', `/api/workspaces/${hidden.id}`)
    .send({ confirmationName: hidden.name })
    .expect(409);
  assert(!JSON.stringify(denial.body).includes(hiddenBoard.id));
  assert(!JSON.stringify(denial.body).includes(hiddenBoard.name));
  await send('member', 'delete', `/api/workspaces/${hidden.id}`)
    .send({ confirmationName: hidden.name })
    .expect(403);
  await send('admin2', 'get', `/api/boards/${hiddenBoard.id}`).expect(404);
  console.log(
    'PASS: Guest OWNER policy, preserved data, policy concurrency and guarded deletion',
  );
}
