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
  assert.equal(memberOverview.body.data.memberCount, 2);
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

export async function verifyMemberCounts({
  source,
  runtimeSource,
  send,
  actors,
}) {
  const created = await send('admin', 'post', '/api/workspaces')
    .send({ name: 'Count summaries' })
    .expect(201);
  const workspaceId = created.body.data.id;
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [workspaceId, actors.member],
  );
  const createBoard = async (actor, name) =>
    (
      await send(actor, 'post', '/api/boards')
        .send({ name, workspaceId })
        .expect(201)
    ).body.data;
  const alpha = await createBoard('admin', 'Counts Alpha');
  const beta = await createBoard('member', 'Counts Beta');
  const hidden = await createBoard('member', 'Counts Hidden');
  const delta = await createBoard('admin', 'Counts Delta');
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER'),($1,$3,'MEMBER'),($4,$2,'MEMBER')`,
    [alpha.id, actors.guest, actors.member, beta.id],
  );
  for (const id of [beta.id, delta.id])
    await source.query(
      `UPDATE boards SET visibility='WORKSPACE_VISIBLE' WHERE id=$1`,
      [id],
    );
  const overview = async (actor, id = workspaceId) =>
    (await send(actor, 'get', `/api/workspaces/${id}/overview`).expect(200))
      .body.data;
  const list = async (actor, query = '', id = workspaceId) =>
    (
      await send(actor, 'get', `/api/workspaces/${id}/boards${query}`).expect(
        200,
      )
    ).body;
  for (const actor of ['admin', 'member']) {
    const result = await overview(actor);
    assert.equal(result.memberCount, 2); // Board-only guest is not a Workspace member.
    const counts = new Map(
      result.recentBoards.map((board) => [board.id, board.memberCount]),
    );
    assert.equal(counts.get(alpha.id), 3); // Explicit OWNER and MEMBER have the same roster entitlement.
    assert.equal(counts.get(beta.id), actor === 'member' ? 2 : null);
    assert.equal(counts.get(delta.id), actor === 'admin' ? 1 : null);
    assert.equal(counts.has(hidden.id), actor === 'member');
    for (const board of (await list(actor)).data) {
      assert.equal(board.memberCount, counts.get(board.id));
      assert.equal(board.members, undefined);
      assert.equal(board.email, undefined);
    }
  }
  for (const actor of ['guest', 'outsider'])
    for (const suffix of ['/overview', '/boards', '/members'])
      await send(
        actor,
        'get',
        `/api/workspaces/${workspaceId}${suffix}`,
      ).expect(404);
  await send('guest', 'get', `/api/boards/${alpha.id}/members`).expect(200);
  const direct = await send('admin', 'get', `/api/boards/${alpha.id}`).expect(
    200,
  );
  assert.equal(Object.hasOwn(direct.body.data, 'memberCount'), false);
  await send('member', 'post', `/api/boards/${beta.id}/archive`).expect(200);
  assert.equal(
    (await list('admin', '?status=archived')).data[0].memberCount,
    null,
  );
  assert.equal(
    (await list('member', '?status=archived')).data[0].memberCount,
    2,
  );
  assert.equal(
    (await overview('member')).recentBoards.find(
      (board) => board.id === beta.id,
    ).memberCount,
    2,
  );
  await send('member', 'post', `/api/boards/${beta.id}/restore`).expect(200);
  await send(
    'member',
    'delete',
    `/api/boards/${beta.id}/members/${actors.guest}`,
  ).expect(204);
  assert.equal((await list('member', '?search=Beta')).data[0].memberCount, 1);
  await send('member', 'post', `/api/boards/${beta.id}/members`)
    .send({ email: 'guest@workspace-api.example.test' })
    .expect(201);
  assert.equal((await list('member', '?search=Beta')).data[0].memberCount, 2);
  await send(
    'admin',
    'patch',
    `/api/workspaces/${workspaceId}/members/${actors.member}`,
  )
    .send({ role: 'ADMIN' })
    .expect(200);
  assert.equal((await overview('member')).memberCount, 2);
  assert.equal(
    (await list('member', '?search=Delta')).data[0].memberCount,
    null,
  );

  // Same REPEATABLE READ snapshot for actor joins, Board totals and Workspace totals.
  for (const adding of [true, false]) {
    let pending = true;
    const subscriber = {
      afterLoad: async (_entity, event) => {
        if (!pending || event.metadata.name !== 'Board') return;
        pending = false;
        await source.transaction(async (manager) => {
          if (adding) {
            await manager.query(
              `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
              [alpha.id, actors.outsider],
            );
            await manager.query(
              `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
              [workspaceId, actors.outsider],
            );
          } else {
            await manager.query(
              'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
              [alpha.id, actors.outsider],
            );
            await manager.query(
              'DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
              [workspaceId, actors.outsider],
            );
          }
        });
      },
    };
    runtimeSource.subscribers.push(subscriber);
    let snapshot;
    try {
      snapshot = await overview('admin');
    } finally {
      runtimeSource.subscribers.splice(
        runtimeSource.subscribers.indexOf(subscriber),
        1,
      );
    }
    assert.equal(snapshot.memberCount, adding ? 2 : 3);
    assert.equal(
      snapshot.recentBoards.find((board) => board.id === alpha.id).memberCount,
      adding ? 3 : 4,
    );
    const next = await overview('admin');
    assert.equal(next.memberCount, adding ? 3 : 2);
    assert.equal(
      next.recentBoards.find((board) => board.id === alpha.id).memberCount,
      adding ? 4 : 3,
    );
  }

  // Bounded aggregation: exactly one summary query for one or eight returned Boards.
  for (let index = 0; index < 8; index++)
    await createBoard('admin', `Batch ${index}`);
  for (const limit of [1, 8]) {
    const statements = [];
    const logger = runtimeSource.logger;
    const previous = logger.logQuery;
    logger.logQuery = function (sql, parameters, runner) {
      statements.push({ sql, parameters });
      return previous.call(this, sql, parameters, runner);
    };
    let result;
    try {
      result = await list('admin', `?search=Batch&sort=name&limit=${limit}`);
    } finally {
      logger.logQuery = previous;
    }
    assert.equal(result.meta.total, 8);
    assert.equal(result.data.length, limit);
    assert.deepEqual(
      result.data.map((board) => board.name),
      Array.from({ length: limit }, (_, index) => `Batch ${index}`),
    );
    assert.ok(result.data.every((board) => board.memberCount === 1));
    const aggregates = statements.filter(({ sql }) =>
      sql.includes('AS "memberCount"'),
    );
    assert.equal(aggregates.length, 1);
    assert.deepEqual(
      [...aggregates[0].parameters].sort(),
      result.data.map((board) => board.id).sort(),
    );
  }

  const destination = (
    await send('admin', 'post', '/api/workspaces')
      .send({ name: 'Count destination' })
      .expect(201)
  ).body.data;
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [delta.id, actors.guest],
  );
  assert.equal((await list('admin', '?search=Delta')).data[0].memberCount, 2);
  await send('admin', 'post', `/api/boards/${delta.id}/move-workspace`)
    .send({ destinationWorkspaceId: destination.id })
    .expect(200);
  assert.equal((await list('admin', '?search=Delta')).meta.total, 0);
  const moved = (await list('admin', '', destination.id)).data[0];
  assert.equal(moved.id, delta.id);
  assert.equal(moved.visibility, 'PRIVATE');
  assert.equal(moved.memberCount, 2);
  assert.equal((await overview('admin', destination.id)).memberCount, 1);
  await send(
    'member',
    'get',
    `/api/workspaces/${destination.id}/overview`,
  ).expect(404);
  const personalBoard = (
    await send('admin', 'post', '/api/boards')
      .send({ name: 'Personal counts' })
      .expect(201)
  ).body.data;
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [personalBoard.id, actors.guest],
  );
  const personal = await overview('admin', personalBoard.workspaceId);
  assert.equal(personal.memberCount, 1);
  assert.equal(
    personal.recentBoards.find((board) => board.id === personalBoard.id)
      .memberCount,
    2,
  );
  await send(
    'guest',
    'get',
    `/api/workspaces/${personalBoard.workspaceId}/overview`,
  ).expect(404);
  await send(
    'admin',
    'delete',
    `/api/workspaces/${workspaceId}/members/${actors.member}`,
  ).expect(204);
  assert.equal((await overview('admin')).memberCount, 1);
  await send('member', 'get', `/api/workspaces/${workspaceId}/overview`).expect(
    404,
  );
}
