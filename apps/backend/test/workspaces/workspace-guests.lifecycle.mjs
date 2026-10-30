import assert from 'node:assert/strict';
import console from 'node:console';

export async function verifyGuestLifecycle(ctx) {
  const { source, send, actors, team, root, a, c, visible, join } = ctx;
  const list = async (actor = 'member', path = root) =>
    (await send(actor, 'get', path).expect(200)).body;
  const guest = (result) =>
    result.data.find((row) => row.user.id === actors.guest);
  // Archived rosters remain eligible, including Guests on archived Boards only.
  await send('admin', 'post', `/api/boards/${c.id}/archive`).expect(200);
  assert.equal(
    guest(await list()).boards.find((board) => board.boardId === c.id)
      .isArchived,
    true,
  );
  await send('admin', 'post', `/api/boards/${a.id}/archive`).expect(200);
  assert.equal((await list()).meta.total, 3);
  assert(
    (await list()).data.every((row) =>
      row.boards.every((board) => board.isArchived),
    ),
  );
  await send('admin', 'post', `/api/boards/${a.id}/restore`).expect(200);
  await send('admin', 'post', `/api/boards/${c.id}/restore`).expect(200);

  // Current Workspace membership, not membership in any other Workspace, defines Guest.
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [team.id, actors.guest],
  );
  assert.equal((await list()).meta.total, 2);
  assert.equal(guest(await list()), undefined);
  await send('guest', 'post', `/api/workspaces/${team.id}/leave`).expect(204);
  assert.equal(guest(await list()).visibleBoardCount, 2);
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [team.id, actors.guest],
  );
  await send(
    'admin',
    'delete',
    `/api/workspaces/${team.id}/members/${actors.guest}`,
  ).expect(204);
  assert.equal(guest(await list()).visibleBoardCount, 2);

  await send('admin', 'patch', `/api/boards/${a.id}/members/${actors.guest2}`)
    .send({ role: 'MEMBER' })
    .expect(200);
  assert.equal(
    (await list()).data.find((row) => row.user.id === actors.guest2).boards[0]
      .role,
    'MEMBER',
  );
  await send(
    'admin',
    'delete',
    `/api/boards/${c.id}/members/${actors.guest}`,
  ).expect(204);
  assert.equal(guest(await list()).visibleBoardCount, 1);
  await join(c, 'guest');

  // Downgrade to visibility-only read immediately removes the roster and its counts.
  await send('admin', 'patch', `/api/boards/${a.id}/visibility`)
    .send({ visibility: 'WORKSPACE_VISIBLE' })
    .expect(200);
  await send(
    'admin',
    'delete',
    `/api/boards/${a.id}/members/${actors.member}`,
  ).expect(204);
  await send('member', 'get', `/api/boards/${a.id}`).expect(200);
  await send('member', 'get', `/api/boards/${a.id}/members`).expect(404);
  const downgraded = await list();
  assert.equal(downgraded.meta.total, 1);
  assert.deepEqual(
    guest(downgraded).boards.map((board) => board.boardId),
    [c.id],
  );
  await send('admin', 'patch', `/api/boards/${a.id}/visibility`)
    .send({ visibility: 'PRIVATE' })
    .expect(200);
  await send('member', 'get', `/api/boards/${a.id}`).expect(404);
  assert.deepEqual(await list(), downgraded);
  await join(a, 'member');
  // Visibility toggles do not widen roster access for an actor without explicit membership.
  await send('owner', 'patch', `/api/boards/${visible.id}/visibility`)
    .send({ visibility: 'PRIVATE' })
    .expect(200);
  assert.equal((await list('reader')).meta.total, 0);

  const destination = (
    await send('admin', 'post', '/api/workspaces')
      .send({ name: 'Guest move destination' })
      .expect(201)
  ).body.data;
  for (const actor of ['member', 'guest'])
    await source.query(
      `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
      [destination.id, actors[actor]],
    );
  assert.equal(guest(await list()).visibleBoardCount, 2);
  await send('admin', 'post', `/api/boards/${c.id}/move-workspace`)
    .send({ destinationWorkspaceId: destination.id })
    .expect(200);
  assert.deepEqual(
    guest(await list()).boards.map((board) => board.boardId),
    [a.id],
  );
  const destinationRoot = `/api/workspaces/${destination.id}/guests`;
  assert.equal((await list('member', destinationRoot)).meta.total, 0);
  await send('guest', 'post', `/api/workspaces/${destination.id}/leave`).expect(
    204,
  );
  assert.deepEqual(
    guest(await list('member', destinationRoot)).boards.map(
      (board) => board.boardId,
    ),
    [c.id],
  );

  const personal = (
    await send('admin', 'get', '/api/workspaces/personal').expect(200)
  ).body.data;
  const personalBoard = (
    await send('admin', 'post', '/api/boards')
      .send({ name: 'Personal with Guest' })
      .expect(201)
  ).body.data;
  await join(personalBoard, 'guest2', 'OWNER');
  const personalRoot = `/api/workspaces/${personal.id}/guests`;
  const personalList = await list('admin', personalRoot);
  assert.equal(personalList.meta.total, 1);
  assert.equal(personalList.data[0].user.id, actors.guest2);
  assert.equal(personalList.data[0].boards[0].role, 'OWNER');
  await send('guest2', 'get', personalRoot).expect(404);
  await send('guest2', 'get', `/api/boards/${personalBoard.id}`).expect(200);
  assert(
    !(await list()).data.some((row) =>
      row.boards.some((board) => board.boardId === personalBoard.id),
    ),
  );

  await send('member', 'post', `/api/workspaces/${team.id}/leave`).expect(204);
  await send('member', 'get', root).expect(404);
  await send('member', 'get', `/api/boards/${a.id}/members`).expect(200);
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [team.id, actors.member],
  );
  await send(
    'admin',
    'delete',
    `/api/workspaces/${team.id}/members/${actors.member}`,
  ).expect(204);
  await send('member', 'get', root).expect(404);
  await send('member', 'get', `/api/boards/${a.id}`).expect(200);

  await source.query(
    'UPDATE users SET auth_version=auth_version+1 WHERE id=$1',
    [actors.reader],
  );
  await send('reader', 'get', root).expect(401);
  console.log(
    'PASS: Guest lifecycle across archive/restore, roles, membership join/leave/removal, visibility downgrade, Board moves, Personal/multi-Workspace and invalidated sessions',
  );
}
