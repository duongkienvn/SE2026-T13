import assert from 'node:assert/strict';

export async function verifyPrivacy(ctx) {
  const { source, send, actors, team } = ctx;
  const hidden = await send('member', 'post', '/api/boards')
    .send({ name: 'Hidden Secret', workspaceId: team.id })
    .expect(201);
  const hiddenId = hidden.body.data.id;
  const empty = await send(
    'admin',
    'get',
    `/api/workspaces/${team.id}/boards?search=Secret`,
  ).expect(200);
  assert.deepEqual(empty.body.data, []);
  assert.equal(empty.body.meta.total, 0);
  const overview = await send(
    'admin',
    'get',
    `/api/workspaces/${team.id}/overview`,
  ).expect(200);
  assert.equal(overview.body.data.visibleBoardCount, 0);
  assert.equal(overview.body.data.memberCount, 2);
  assert.deepEqual(overview.body.data.recentBoards, []);
  const memberOverview = await send(
    'member',
    'get',
    `/api/workspaces/${team.id}/overview`,
  ).expect(200);
  assert.equal(memberOverview.body.data.memberCount, null);
  assert.equal(memberOverview.body.data.visibleBoardCount, 1);
  await send('admin', 'get', `/api/boards/${hiddenId}`).expect(404);
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [hiddenId, actors.guest],
  );
  await send('guest', 'get', `/api/boards/${hiddenId}`).expect(200);
  const guestList = await send('guest', 'get', '/api/workspaces').expect(200);
  assert.ok(!guestList.body.data.some((w) => w.id === team.id));
  for (const suffix of ['', '/boards', '/overview'])
    await send('guest', 'get', `/api/workspaces/${team.id}${suffix}`).expect(
      404,
    );
  const ids = [];
  for (const name of [
    'Alpha',
    'Beta',
    'literal%_\\',
    'Gamma',
    'Delta',
    'Epsilon',
  ]) {
    const response = await send('admin', 'post', '/api/boards')
      .send({ name, workspaceId: team.id })
      .expect(201);
    ids.push(response.body.data.id);
    assert.equal(response.body.data.currentUserRole, 'OWNER');
    const board = await source
      .getRepository('Board')
      .findOneByOrFail({ id: response.body.data.id });
    assert.equal(board.visibility, 'PRIVATE');
    assert.equal(board.workspaceId, team.id);
  }
  await source.query(
    `UPDATE boards SET updated_at='2026-01-01T00:00:00Z' WHERE workspace_id=$1`,
    [team.id],
  );
  const page1 = await send(
    'admin',
    'get',
    `/api/workspaces/${team.id}/boards?limit=2`,
  ).expect(200);
  const page2 = await send(
    'admin',
    'get',
    `/api/workspaces/${team.id}/boards?limit=2&page=2`,
  ).expect(200);
  const page3 = await send(
    'admin',
    'get',
    `/api/workspaces/${team.id}/boards?limit=2&page=3`,
  ).expect(200);
  assert.equal(page1.body.meta.total, 6);
  assert.deepEqual(
    [...page1.body.data, ...page2.body.data, ...page3.body.data].map(
      (b) => b.id,
    ),
    [...ids].sort().reverse(),
  );
  assert.ok(!JSON.stringify(page1.body).includes(hiddenId));
  for (const board of page1.body.data) {
    assert.equal(board.members, undefined);
    assert.equal(board.presence, undefined);
    assert.equal(board.canEdit, true);
  }
  const literal = await send(
    'admin',
    'get',
    `/api/workspaces/${team.id}/boards?search=${encodeURIComponent('%_\\')}`,
  ).expect(200);
  assert.equal(literal.body.meta.total, 1);
  assert.equal(literal.body.data[0].name, 'literal%_\\');
  const searched = await send(
    'admin',
    'get',
    `/api/workspaces/${team.id}/boards?search=ALPHA&sort=name`,
  ).expect(200);
  assert.equal(searched.body.meta.total, 1);
  assert.equal(searched.body.data[0].name, 'Alpha');
  const farPage = await send(
    'admin',
    'get',
    `/api/workspaces/${team.id}/boards?page=100`,
  ).expect(200);
  assert.deepEqual(farPage.body.data, []);
  assert.equal(farPage.body.meta.total, 6);
  await send('admin', 'post', `/api/boards/${ids[0]}/archive`).expect(200);
  const archived = await send(
    'admin',
    'get',
    `/api/workspaces/${team.id}/boards?status=archived`,
  ).expect(200);
  assert.equal(archived.body.meta.total, 1);
  assert.equal(archived.body.data[0].canEdit, false);
  const totals = await send(
    'admin',
    'get',
    `/api/workspaces/${team.id}/overview`,
  ).expect(200);
  assert.equal(totals.body.data.visibleBoardCount, 6);
  assert.equal(totals.body.data.activeBoardCount, 5);
  assert.equal(totals.body.data.archivedBoardCount, 1);
  assert.equal(totals.body.data.recentBoards.length, 5);
  assert.ok(!JSON.stringify(totals.body).includes(hiddenId));
  await send('admin', 'post', `/api/boards/${ids[0]}/restore`).expect(200);
  const column = await send('admin', 'post', `/api/boards/${ids[0]}/columns`)
    .send({ name: 'Todo' })
    .expect(201);
  const card = await send('admin', 'post', `/api/boards/${ids[0]}/cards`)
    .send({ title: 'Permalink', columnId: column.body.data.id })
    .expect(201);
  await send(
    'admin',
    'get',
    `/api/boards/${ids[0]}/cards/${card.body.data.id}`,
  ).expect(200);
  await source.query(
    `UPDATE boards SET visibility='WORKSPACE_VISIBLE' WHERE id=$1`,
    [hiddenId],
  );
  const workspaceVisible = await send(
    'admin',
    'get',
    `/api/workspaces/${team.id}/boards?search=Secret`,
  ).expect(200);
  assert.equal(workspaceVisible.body.meta.total, 1);
  assert.equal(workspaceVisible.body.data[0].id, hiddenId);
  assert.equal(workspaceVisible.body.data[0].currentUserRole, null);
  assert.equal(workspaceVisible.body.data[0].canEdit, false);
  await source.query(
    'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
    [hiddenId, actors.guest],
  );
  await send('guest', 'get', `/api/boards/${hiddenId}`).expect(404);
  await source.query(
    'DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
    [team.id, actors.member],
  );
  await send('member', 'get', `/api/workspaces/${team.id}/overview`).expect(
    404,
  );
  await send('member', 'post', '/api/boards')
    .send({ name: 'Revoked', workspaceId: team.id })
    .expect(404);
  await send('member', 'get', `/api/boards/${hiddenId}`).expect(200);
}
