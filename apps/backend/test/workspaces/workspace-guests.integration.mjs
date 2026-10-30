import assert from 'node:assert/strict';
import console from 'node:console';
import { randomUUID } from 'node:crypto';

export async function createGuestFixture(base) {
  const { source, jwt, http } = base;
  const actors = {},
    tokens = {};
  for (const [key, displayName] of Object.entries({
    admin: 'Directory admin',
    member: 'Directory member',
    reader: 'Directory reader',
    owner: 'Hidden Board creator',
    guest: 'Alpha Guest',
    guest2: 'Same Guest',
    guest3: 'Same Guest',
    hidden: 'Hidden Guest',
    outsider: 'Directory outsider',
  })) {
    const [user] = await source.query(
      `INSERT INTO users(email,display_name,email_verified_at) VALUES ($1,$2,now()) RETURNING id`,
      [`${key}-${randomUUID()}@guests.example.test`, displayName],
    );
    actors[key] = user.id;
    tokens[key] = await jwt.signAsync({ sub: user.id });
  }
  const send = (actor, method, path) =>
    http[method](path).set('Authorization', `Bearer ${tokens[actor]}`);
  const team = (
    await send('admin', 'post', '/api/workspaces')
      .send({ name: 'Guest directory' })
      .expect(201)
  ).body.data;
  for (const key of ['member', 'reader', 'owner'])
    await source.query(
      `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
      [team.id, actors[key]],
    );
  const create = async (actor, name) =>
    (
      await send(actor, 'post', '/api/boards')
        .send({ workspaceId: team.id, name })
        .expect(201)
    ).body.data;
  const a = await create('admin', 'A eligible');
  const b = await create('owner', 'B hidden private');
  const c = await create('admin', 'C eligible');
  const visible = await create('owner', 'D visibility only');
  await send('owner', 'patch', `/api/boards/${visible.id}/visibility`)
    .send({ visibility: 'WORKSPACE_VISIBLE' })
    .expect(200);
  const join = (board, key, role = 'MEMBER') =>
    source.query(
      `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,$3)`,
      [board.id, actors[key], role],
    );
  for (const board of [a, c]) {
    await join(board, 'member');
    await join(board, 'guest');
  }
  await join(a, 'guest2', 'OWNER');
  await join(a, 'guest3');
  await join(b, 'guest');
  await join(b, 'hidden');
  await join(visible, 'hidden');
  const root = `/api/workspaces/${team.id}/guests`;
  return { ...base, actors, tokens, send, team, a, b, c, visible, root, join };
}

export async function verifyWorkspaceGuests(base) {
  const ctx = await createGuestFixture(base);
  const { source, send, http, actors, root, team, a, b, c, visible } = ctx;
  await http.get(root).expect(401);
  for (const actor of ['guest', 'hidden', 'outsider']) {
    const denied = await send(actor, 'get', root).expect(404);
    assert.equal(denied.body.code, 'NOT_FOUND');
    assert.equal(denied.body.message, 'Workspace not found');
    assert(!JSON.stringify(denied.body).includes('Hidden Guest'));
  }
  const missing = await send(
    'member',
    'get',
    `/api/workspaces/${randomUUID()}/guests`,
  ).expect(404);
  assert.equal(missing.body.message, 'Workspace not found');
  await send('member', 'get', '/api/workspaces/invalid/guests').expect(400);
  for (const query of [
    'page=0',
    'page=1.5',
    'page=1000001',
    'limit=101',
    'limit=0',
    `search=${'a'.repeat(121)}`,
    'search=a&search=b',
    'sort=email',
    'role=GUEST',
    'status=active',
  ])
    await send('member', 'get', `${root}?${query}`).expect(400);

  // Workspace ADMIN and MEMBER share the same explicit-roster boundary.
  for (const actor of ['admin', 'member']) {
    const result = await send(actor, 'get', root).expect(200);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.deepEqual(result.body.meta, {
      page: 1,
      limit: 20,
      total: 3,
      totalPages: 1,
    });
    assert.equal(result.body.data.length, 3);
    const guest = result.body.data.find((row) => row.user.id === actors.guest);
    assert.equal(guest.visibleBoardCount, 2);
    assert.deepEqual(
      guest.boards,
      [a, c].map((board) => ({
        boardId: board.id,
        name: board.name,
        role: 'MEMBER',
        isArchived: false,
      })),
    );
    assert.equal(
      result.body.data.find((row) => row.user.id === actors.guest2).boards[0]
        .role,
      'OWNER',
    );
    assert.deepEqual(Object.keys(guest).sort(), [
      'boards',
      'user',
      'visibleBoardCount',
    ]);
    assert.deepEqual(Object.keys(guest.user).sort(), [
      'avatarUrl',
      'displayName',
      'id',
    ]);
    const wire = JSON.stringify(result.body);
    for (const secret of [
      b.id,
      b.name,
      visible.id,
      visible.name,
      actors.hidden,
      'Hidden Guest',
      'email',
      'passwordHash',
      'avatarObjectKey',
      'authVersion',
    ])
      assert(!wire.includes(secret), secret);
    const hiddenSearch = await send(
      actor,
      'get',
      `${root}?search=Hidden`,
    ).expect(200);
    assert.equal(hiddenSearch.body.meta.total, 0);
    assert.deepEqual(hiddenSearch.body.data, []);
  }
  await send('reader', 'get', `/api/boards/${visible.id}`).expect(200);
  await send('reader', 'get', `/api/boards/${visible.id}/members`).expect(404);
  for (const actor of ['reader', 'owner']) {
    const result = await send(actor, 'get', root).expect(200);
    assert.equal(result.body.meta.total, actor === 'reader' ? 0 : 2);
  }
  await source.query(
    `UPDATE workspace_members SET role='ADMIN' WHERE workspace_id=$1 AND user_id=$2`,
    [team.id, actors.reader],
  );
  const adminOnly = await send('reader', 'get', root).expect(200);
  assert.deepEqual(adminOnly.body.data, []);
  assert.equal(adminOnly.body.meta.total, 0);

  const expectedOrder = [
    actors.guest,
    ...[actors.guest2, actors.guest3].sort(),
  ];
  for (let page = 1; page <= 3; page++) {
    const result = await send(
      'member',
      'get',
      `${root}?limit=1&page=${page}`,
    ).expect(200);
    assert.deepEqual(
      result.body.data.map((row) => row.user.id),
      [expectedOrder[page - 1]],
    );
    assert.equal(result.body.meta.total, 3);
    assert.equal(result.body.meta.totalPages, 3);
  }
  const beyond = await send(
    'member',
    'get',
    `${root}?page=1000000&limit=100`,
  ).expect(200);
  assert.deepEqual(beyond.body.data, []);
  assert.equal(beyond.body.meta.total, 3);
  const searched = await send(
    'member',
    'get',
    `${root}?search=%20sAmE%20&limit=1`,
  ).expect(200);
  assert.equal(searched.body.meta.total, 2);
  assert.equal(
    searched.body.data[0].user.id,
    [actors.guest2, actors.guest3].sort()[0],
  );
  const [email] = await source.query('SELECT email FROM users WHERE id=$1', [
    actors.guest,
  ]);
  assert.equal(
    (
      await send(
        'member',
        'get',
        `${root}?search=${encodeURIComponent(email.email)}`,
      ).expect(200)
    ).body.meta.total,
    0,
  );
  for (const literal of ['%', '_', '\\', "' OR 1=1 --"]) {
    await source.query('UPDATE users SET display_name=$1 WHERE id=$2', [
      `Literal ${literal} Guest`,
      actors.guest2,
    ]);
    const result = await send(
      'member',
      'get',
      `${root}?search=${encodeURIComponent(literal)}`,
    ).expect(200);
    assert.deepEqual(
      result.body.data.map((row) => row.user.id),
      [actors.guest2],
    );
    assert.equal(result.body.meta.total, 1);
  }
  await source.query(
    `UPDATE users SET display_name='Same Guest', avatar_url='https://example.test/legacy.webp' WHERE id=$1`,
    [actors.guest2],
  );
  const objectId = randomUUID();
  await source.query('UPDATE users SET avatar_object_key=$1 WHERE id=$2', [
    `avatars/active/${actors.guest}/${objectId}.webp`,
    actors.guest,
  ]);
  const avatars = (await send('member', 'get', root).expect(200)).body.data;
  assert.equal(
    avatars.find((row) => row.user.id === actors.guest).user.avatarUrl,
    `/users/${actors.guest}/avatar/${objectId}`,
  );
  assert.equal(
    avatars.find((row) => row.user.id === actors.guest2).user.avatarUrl,
    'https://example.test/legacy.webp',
  );
  const swagger = (await http.get('/api-docs-json').expect(200)).body;
  const operation = swagger.paths['/api/workspaces/{workspaceId}/guests'].get;
  assert(operation.responses['200']);
  assert(operation.responses['404']);
  assert(operation.security.length);
  assert.deepEqual(
    Object.keys(
      swagger.components.schemas.WorkspaceGuestUserDto.properties,
    ).sort(),
    ['avatarUrl', 'displayName', 'id'],
  );
  assert.deepEqual(
    Object.keys(
      swagger.components.schemas.WorkspaceGuestBoardDto.properties,
    ).sort(),
    ['boardId', 'isArchived', 'name', 'role'],
  );
  const queryParams = operation.parameters.filter((p) => p.in === 'query');
  assert.deepEqual(queryParams.map((p) => p.name).sort(), [
    'limit',
    'page',
    'search',
  ]);
  assert.equal(queryParams.find((p) => p.name === 'limit').schema.maximum, 100);
  // Capture SQL without logging parameter values: query count is independent of Guest count.
  const runtime = base.app.get(source.constructor);
  const logger = runtime.logger;
  const logQuery = logger.logQuery;
  const statements = [];
  logger.logQuery = (sql) => statements.push(sql);
  try {
    await send('member', 'get', `${root}?limit=1`).expect(200);
    const small = statements.length;
    statements.length = 0;
    await send('member', 'get', `${root}?limit=100`).expect(200);
    // TypeORM may omit COUNT when a complete first page already proves the total.
    assert(statements.length <= small, 'No SQL per Guest');
    const userQueries = statements.filter((sql) =>
      /FROM "users" "user"/.test(sql),
    ).length;
    assert(userQueries >= 1 && userQueries <= 2);
    assert.equal(
      statements.filter((sql) => /FROM "board_members" "guest"/.test(sql))
        .length,
      userQueries + 1,
    );
    for (const sql of statements.filter((sql) =>
      /FROM "board_members" "guest"/.test(sql),
    )) {
      assert(sql.includes('"actor"."user_id"'));
      assert(sql.includes('NOT EXISTS'));
    }
  } finally {
    logger.logQuery = logQuery;
  }
  console.log(
    'PASS: Guest directory HTTP/Swagger/allowlists, explicit roster ACL, distinct paging/search/counts, avatars and bounded SQL',
  );
  return ctx;
}
