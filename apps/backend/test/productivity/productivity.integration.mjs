import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import {
  verifyBoundaries,
  verifyConcurrencyAndScale,
} from './productivity-boundaries.mjs';

// No dotenv or implicit migration target: opt in to an explicitly local test server.
assert.equal(process.env.PRODUCTIVITY_DATABASE_TESTS, 'local-only');
assert.ok(
  ['127.0.0.1', 'localhost', '::1'].includes(process.env.DATABASE_HOST),
);
assert.notEqual(process.env.NODE_ENV, 'production');
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { Test } = require('@nestjs/testing');
const { JwtService } = require('@nestjs/jwt');
const request = require('supertest');
const { databaseOptions } = require('../../dist/database/database-options.js');
const {
  ProductivityService,
} = require('../../dist/api/productivity/productivity.service.js');
const {
  ListTasksDto,
} = require('../../dist/api/productivity/dto/list-tasks.dto.js');
const options = databaseOptions(process.env);
const database = `kanban_productivity_${randomBytes(8).toString('hex')}`;
const admin = new Client({ ...options, user: options.username });
let source,
  app,
  created = false,
  groups = 0;
const pass = (name) => {
  groups++;
  console.log(`PASS: ${name}`);
};
const now = new Date('2026-03-08T12:00:00Z');

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  source = await new DataSource({ ...options, database }).initialize();
  await source.runMigrations();
  assert.equal(source.options.synchronize, false);
  assert.equal(source.options.migrationsRun, false);
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries,
    [],
  );
  Object.assign(process.env, {
    DATABASE_NAME: database,
    NODE_ENV: 'test',
    JWT_SECRET: randomBytes(32).toString('hex'),
    LOG_LEVEL: 'silent',
    API_PREFIX: 'api',
    SWAGGER_ENABLED: 'true',
    RATE_LIMIT_MAX: '10000',
    MAIL_TRANSPORT: 'fake',
    AVATAR_STORAGE_DRIVER: 'disabled',
    GOOGLE_CLIENT_ID: '',
  });
  const { AppModule } = require('../../dist/app.module.js');
  const {
    configureHttpApplication,
  } = require('../../dist/http-application.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(source)
    .compile();
  app = module.createNestApplication();
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');
  const jwt = app.get(JwtService),
    service = app.get(ProductivityService),
    actors = {},
    tokens = {};
  for (const actor of [
    'owner',
    'member',
    'guest',
    'viewer',
    'admin',
    'outsider',
  ]) {
    const [user] = await source.query(
      `INSERT INTO users(email,display_name,email_verified_at) VALUES ($1,$1,now()) RETURNING id`,
      [`${actor}@productivity.test`],
    );
    actors[actor] = user.id;
    tokens[actor] = await jwt.signAsync({ sub: user.id });
  }
  const http = request(app.getHttpServer());
  const send = (actor, method, path) =>
    http[method](path)
      .auth(tokens[actor], { type: 'bearer' })
      .timeout({ deadline: 10000 });
  const tasks = (actor, filters = {}, clock = now) =>
    service.tasks(
      actors[actor],
      Object.assign(new ListTasksDto(), filters),
      clock,
    );
  const home = (actor, clock = now) => service.home(actors[actor], clock);
  const workspace = async (name, type = 'TEAM', owner = actors.owner) =>
    (
      await source.query(
        `INSERT INTO workspaces(type,name,created_by_id) VALUES ($1,$2,$3) RETURNING id`,
        [type, name, owner],
      )
    )[0].id;
  const first = await workspace('First'),
    second = await workspace('Second'),
    personal = await workspace('Personal', 'PERSONAL');
  for (const workspaceId of [first, second, personal])
    await source.query(
      `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN')`,
      [workspaceId, actors.owner],
    );
  for (const actor of ['member', 'viewer', 'admin'])
    await source.query(
      `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,$3)`,
      [first, actors[actor], actor === 'admin' ? 'ADMIN' : 'MEMBER'],
    );
  const board = async (name, workspaceId, visibility = 'PRIVATE') => {
    const [row] = await source.query(
      `INSERT INTO boards(name,created_by_id,workspace_id,visibility) VALUES ($1,$2,$3,$4) RETURNING id`,
      [name, actors.owner, workspaceId, visibility],
    );
    await source.query(
      `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')`,
      [row.id, actors.owner],
    );
    const [column] = await source.query(
      `INSERT INTO board_columns(board_id,name,position) VALUES ($1,'Done',100) RETURNING id`,
      [row.id],
    );
    return { id: row.id, columnId: column.id, workspaceId };
  };
  const alpha = await board('alpha', first),
    beta = await board('Beta', second),
    visible = await board('Visible', first, 'WORKSPACE_VISIBLE'),
    hidden = await board('Confidential', first);
  for (const actor of ['member', 'guest'])
    await source.query(
      `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
      [alpha.id, actors[actor]],
    );
  let position = 0;
  const card = async (
    parent,
    due,
    title = 'Assigned',
    assigned = Object.values(actors),
  ) => {
    const [row] = await source.query(
      `INSERT INTO cards(board_id,column_id,created_by_id,title,position,due_date,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'2026-03-01T12:00:00Z') RETURNING id`,
      [parent.id, parent.columnId, actors.owner, title, ++position * 100, due],
    );
    for (const userId of assigned)
      await source.query(
        'INSERT INTO card_assignees(card_id,user_id) VALUES ($1,$2)',
        [row.id, userId],
      );
    return row.id;
  };
  // Deliberately retained assignments/state without a read grant exercise defense
  // against stale data. These fixtures are not new write/assignment permissions.
  const overdue = await card(alpha, '2026-03-07T23:59:59.999Z', 'Overdue'),
    today = await card(alpha, '2026-03-08T00:00:00Z', 'Earlier today'),
    lastDay = await card(beta, '2026-03-14T23:59:59.999Z', 'Last included day'),
    later = await card(beta, '2026-03-15T00:00:00Z', 'Later'),
    noDue = await card(alpha, null, 'No due'),
    viewerCard = await card(
      visible,
      '2026-03-09T12:00:00Z',
      'Workspace-visible',
    ),
    secret = await card(hidden, null, 'Secret');
  const archivedCard = await card(alpha, null, 'Archived Card');
  await source.query(
    'UPDATE cards SET is_archived=true,archived_at=now() WHERE id=$1',
    [archivedCard],
  );
  const archivedBoard = await board('Archived Board', first);
  await card(archivedBoard, now, 'Archived Board task');
  await source.query(
    'UPDATE boards SET is_archived=true,archived_at=now() WHERE id=$1',
    [archivedBoard.id],
  );

  const expected = {
    owner: 7,
    member: 4,
    guest: 3,
    viewer: 1,
    admin: 1,
    outsider: 0,
  };
  for (const [actor, total] of Object.entries(expected)) {
    const response = await tasks(actor);
    assert.equal(response.meta.total, total, actor);
    assert.equal(new Set(response.data.map((row) => row.id)).size, total);
    assert.equal(
      Object.values(response.groupCounts).reduce((a, b) => a + b, 0),
      total,
    );
    if (actor !== 'owner')
      assert.ok(!JSON.stringify(response).includes('Secret'));
    const discovery = (await send(actor, 'get', '/api/boards').expect(200)).body
      .data;
    const readable = new Set(discovery.map((row) => row.id));
    assert.ok(
      response.data.every((row) => readable.has(row.boardId)),
      actor,
    );
    for (const row of response.data)
      await send(
        actor,
        'get',
        row.permalink.replace('/boards/', '/api/boards/'),
      ).expect(200);
  }
  const all = await tasks('owner');
  assert.deepEqual(
    (await tasks('viewer')).data.map((row) => row.id),
    [viewerCard],
  );
  assert.deepEqual(all.groupCounts, {
    OVERDUE: 1,
    NEXT_7_DAYS: 3,
    LATER: 1,
    NO_DUE_DATE: 2,
  });
  assert.equal(all.data.find((row) => row.id === today).group, 'NEXT_7_DAYS');
  assert.equal(
    all.data.find((row) => row.id === lastDay).workspaceName,
    'Second',
  );
  assert.equal(all.data.find((row) => row.id === later).group, 'LATER');
  assert.equal(
    all.data.find((row) => row.id === noDue).columnId,
    alpha.columnId,
  );
  assert.equal(
    all.data.find((row) => row.id === overdue).permalink,
    `/boards/${alpha.id}/cards/${overdue}`,
  );
  pass(
    'multi-Workspace ACL matrix, discovery/permalink parity, archive eligibility and no Done completion',
  );

  const label = async (parent, name) =>
    (
      await source.query(
        `INSERT INTO board_labels(board_id,name,color) VALUES ($1,$2,'#123456') RETURNING id`,
        [parent.id, name],
      )
    )[0].id;
  const red = await label(alpha, 'Red'),
    blue = await label(alpha, 'Blue'),
    privateLabel = await label(hidden, 'Secret label');
  for (const [cardId, labelId, boardId] of [
    [today, red, alpha.id],
    [today, blue, alpha.id],
    [noDue, blue, alpha.id],
    [secret, privateLabel, hidden.id],
  ])
    await source.query(
      'INSERT INTO card_labels(card_id,label_id,board_id) VALUES ($1,$2,$3)',
      [cardId, labelId, boardId],
    );
  const matched = await tasks('member', { labelIds: [red, blue] });
  assert.equal(matched.meta.total, 2);
  assert.equal(matched.data.find((row) => row.id === today).labels.length, 2);
  assert.deepEqual(Object.keys(matched.data[0].labels[0]).sort(), [
    'color',
    'id',
    'name',
  ]);
  assert.equal(
    (await tasks('admin', { labelIds: [privateLabel] })).meta.total,
    0,
  );
  const scoped = await tasks('owner', {
    workspaceId: first,
    boardId: alpha.id,
    labelIds: [red, blue],
    dueFrom: '2026-03-07T19:00:00-05:00',
    dueTo: '2026-03-08T00:00:00.001Z',
    group: 'NEXT_7_DAYS',
  });
  assert.deepEqual(
    scoped.data.map((row) => row.id),
    [today],
  );
  assert.deepEqual(scoped.groupCounts, {
    OVERDUE: 0,
    NEXT_7_DAYS: 1,
    LATER: 0,
    NO_DUE_DATE: 0,
  });
  assert.equal(
    (await tasks('owner', { workspaceId: first, boardId: beta.id })).meta.total,
    0,
  );
  const missing = await tasks('outsider', { boardId: randomUUID() });
  assert.deepEqual(await tasks('outsider', { boardId: hidden.id }), missing);
  const selected = await tasks('owner', { group: 'LATER' });
  assert.equal(selected.meta.total, 1);
  assert.deepEqual(selected.groupCounts, all.groupCounts);
  for (const group of Object.keys(all.groupCounts))
    assert.equal(
      (await tasks('owner', { group })).meta.total,
      all.groupCounts[group],
    );
  const afterLast = await tasks('owner', { page: 1000000 });
  assert.deepEqual(afterLast.data, []);
  assert.equal(afterLast.meta.total, 7);
  for (const filter of [
    { dueFrom: '2026-03-09T00:00:00Z', dueTo: '2026-03-08T00:00:00Z' },
    { dueFrom: '2026-03-08T07:00:00+07:00', dueTo: '2026-03-08T00:00:00Z' },
    { page: Number.MAX_SAFE_INTEGER, limit: 100 },
  ])
    await assert.rejects(
      tasks('owner', filter),
      (error) => error.getStatus() === 400,
    );
  pass(
    'match-any labels without duplicates, intersecting UTC filters, group counts, inaccessible IDs and large offsets',
  );

  const state = async (actor, parent, starred, viewed) =>
    source.query(
      `INSERT INTO board_user_states(user_id,board_id,is_starred,last_viewed_at) VALUES ($1,$2,$3,$4) ON CONFLICT(user_id,board_id) DO UPDATE SET is_starred=$3,last_viewed_at=$4`,
      [actors[actor], parent.id, starred, viewed],
    );
  for (const actor of Object.keys(actors))
    for (const parent of [alpha, beta, visible, hidden, archivedBoard])
      await state(actor, parent, true, '2026-03-08T08:00:00Z');
  await state('owner', beta, true, null); // A star is not a recorded visit.
  const beforeState = await source.query(
    'SELECT * FROM board_user_states ORDER BY user_id,board_id',
  );
  for (const [actor, total] of Object.entries(expected)) {
    const response = await home(actor);
    assert.equal(response.summary.assignedActiveCount, total);
    assert.equal(
      response.summary.workspaceCount,
      actor === 'owner'
        ? 3
        : ['admin', 'viewer', 'member'].includes(actor)
          ? 1
          : 0,
    );
    const mine = await tasks(actor);
    assert.equal(response.summary.overdueCount, mine.groupCounts.OVERDUE);
    assert.equal(
      response.summary.dueNext7DaysCount,
      mine.groupCounts.NEXT_7_DAYS,
    );
    assert.deepEqual(
      response.upNext.map((row) => row.id),
      mine.data
        .filter((row) => row.dueDate !== null)
        .slice(0, 6)
        .map((row) => row.id),
    );
    const discovery = (
      await send(actor, 'get', '/api/boards?starred=true&limit=100').expect(200)
    ).body.data.map((row) => row.id);
    assert.deepEqual(
      new Set(response.starredBoards.map((row) => row.id)),
      new Set(discovery),
    );
    assert.ok(response.recentBoards.every((row) => row.lastViewedAt !== null));
    assert.ok(
      !response.starredBoards.some((row) => row.id === archivedBoard.id),
    );
  }
  assert.deepEqual(
    await source.query(
      'SELECT * FROM board_user_states ORDER BY user_id,board_id',
    ),
    beforeState,
  );
  assert.ok(
    !(await home('owner')).recentBoards.some((row) => row.id === beta.id),
  );
  assert.deepEqual((await home('outsider')).upNext, []);
  pass(
    'Home summary, membership-only Workspace counts, real stars/visits, no passive visit writes and empty states',
  );

  await source.query(
    'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
    [alpha.id, actors.guest],
  );
  assert.equal((await tasks('guest')).meta.total, 0);
  assert.deepEqual((await home('guest')).starredBoards, []);
  await source.query(
    'DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
    [first, actors.viewer],
  );
  assert.equal((await tasks('viewer')).meta.total, 0);
  assert.equal((await home('viewer')).summary.workspaceCount, 0);
  // Explicit membership survives a separate Workspace grant's removal.
  await source.query(
    'DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
    [first, actors.member],
  );
  assert.equal((await tasks('member')).meta.total, 3);
  assert.equal((await home('member')).summary.workspaceCount, 0);
  await source.query(
    'DELETE FROM card_assignees WHERE card_id=$1 AND user_id=$2',
    [today, actors.owner],
  );
  assert.equal((await tasks('owner')).meta.total, 6);
  await source.query(
    'INSERT INTO card_assignees(card_id,user_id) VALUES ($1,$2)',
    [today, actors.owner],
  );
  // Exercise existing writes as the upstream invalidation source, not new mutations.
  const cardPath = `/api/boards/${alpha.id}/cards/${today}`;
  await send('owner', 'post', `${cardPath}/archive`).expect(200);
  assert.equal((await tasks('owner')).meta.total, 6);
  await send('owner', 'post', `${cardPath}/restore`)
    .send({ columnId: alpha.columnId })
    .expect(200);
  assert.equal((await tasks('owner')).meta.total, 7);
  await send('owner', 'post', `/api/boards/${beta.id}/archive`).expect(200);
  assert.equal((await tasks('owner')).meta.total, 5);
  await send('owner', 'post', `/api/boards/${beta.id}/restore`).expect(200);
  assert.equal((await tasks('owner')).meta.total, 7);
  const disposable = await card(alpha, null, 'Delete fixture', [actors.owner]);
  assert.equal((await tasks('owner')).meta.total, 8);
  await source.query('DELETE FROM cards WHERE id=$1', [disposable]);
  assert.equal((await tasks('owner')).meta.total, 7);
  pass(
    'revoked Board/Workspace grants, independent guest grants, unassignment, delete, existing archive/restore writes',
  );

  for (const path of ['/api/users/me/tasks', '/api/users/me/home']) {
    await http.get(path).expect(401);
    await http
      .get(path)
      .auth(await jwt.signAsync({ sub: actors.owner }, { expiresIn: -1 }), {
        type: 'bearer',
      })
      .expect(401);
    const response = await send('owner', 'get', path).expect(200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.body.success, true);
    assert.ok(!JSON.stringify(response.body).includes('@productivity.test'));
  }
  const page = (
    await send('owner', 'get', '/api/users/me/tasks?limit=2&group=ALL').expect(
      200,
    )
  ).body;
  assert.ok(Array.isArray(page.data));
  assert.ok(page.meta);
  assert.ok(page.groupCounts);
  assert.deepEqual(
    Object.keys(page.data[0]).sort(),
    [
      'id',
      'boardId',
      'workspaceId',
      'title',
      'boardName',
      'workspaceName',
      'columnId',
      'startDate',
      'dueDate',
      'updatedAt',
      'group',
      'permalink',
      'labels',
    ].sort(),
  );
  for (const query of [
    'group=DONE',
    'labelIds=',
    'boardId=bad',
    'userId=other',
    'dueFrom=2026-02-30T00:00:00Z',
    'dueFrom=2026-03-08',
    'dueFrom=2026-03-09T00:00:00Z&dueTo=2026-03-08T00:00:00Z',
    'page=9007199254740991&limit=100',
  ]) {
    const response = await send(
      'owner',
      'get',
      `/api/users/me/tasks?${query}`,
    ).expect(400);
    assert.equal(response.body.code, 'VALIDATION_FAILED');
  }
  const swagger = (await http.get('/api-docs-json').expect(200)).body;
  assert.ok(swagger.paths['/api/users/me/tasks'].get);
  assert.ok(swagger.paths['/api/users/me/home'].get);
  const context = {
    source,
    service,
    tasks,
    home,
    workspace,
    board,
    card,
    actors,
    pass,
    send,
  };
  await verifyBoundaries(context);
  await verifyConcurrencyAndScale(context);
  await source.query(
    'UPDATE users SET auth_version=auth_version+1 WHERE id=$1',
    [actors.owner],
  );
  for (const path of ['/api/users/me/tasks', '/api/users/me/home'])
    await send('owner', 'get', path).expect(401);
  pass(
    'compiled full AppModule JWT/session boundary, no-store, flat envelopes, strict HTTP validation and Swagger',
  );
  console.log(`Productivity PostgreSQL integration: ${groups} groups passed`);
} finally {
  if (app) await app.close();
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${database}"`);
  await admin.end();
}
