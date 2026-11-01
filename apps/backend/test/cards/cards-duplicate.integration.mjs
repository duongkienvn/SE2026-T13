import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';

// No dotenv: the caller must explicitly designate a disposable local test server.
assert.equal(process.env.CARD_DUPLICATE_DATABASE_TESTS, 'local-only');
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
const options = databaseOptions(process.env);
const database = `kanban_duplicate_verify_${randomBytes(8).toString('hex')}`;
const admin = new Client({ ...options, user: options.username });
let source,
  app,
  created = false,
  groups = 0;
const pass = (name) => {
  groups++;
  console.log(`PASS: ${name}`);
};

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  source = await new DataSource({ ...options, database }).initialize();
  await source.runMigrations();

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
    actors = {},
    tokens = {};
  for (const actor of ['owner', 'member', 'guest', 'viewer', 'outsider']) {
    const [user] = await source.query(
      `INSERT INTO users(email,display_name,email_verified_at) VALUES ($1,$1,now()) RETURNING id`,
      [`${actor}@duplicate.test`],
    );
    actors[actor] = user.id;
    tokens[actor] = await jwt.signAsync({ sub: user.id });
  }
  const http = request(app.getHttpServer());
  const send = (actor, method, path) =>
    http[method](path)
      .auth(tokens[actor], { type: 'bearer' })
      .timeout({ deadline: 10000 });
  const team = (
    await send('owner', 'post', '/api/workspaces')
      .send({ name: 'Duplicate team' })
      .expect(201)
  ).body.data;
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [team.id, actors.viewer],
  );
  const createBoard = async (name) =>
    (
      await send('owner', 'post', '/api/boards')
        .send({ name, workspaceId: team.id })
        .expect(201)
    ).body.data;
  const board = await createBoard('Duplicates');
  const foreignBoard = await createBoard('Foreign');
  for (const actor of ['member', 'guest'])
    await source.query(
      `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
      [board.id, actors[actor]],
    );
  const createColumn = async (boardId, name) =>
    (
      await send('owner', 'post', `/api/boards/${boardId}/columns`)
        .send({ name })
        .expect(201)
    ).body.data;
  const column = await createColumn(board.id, 'Source');
  const secondColumn = await createColumn(board.id, 'Destination');
  const foreignColumn = await createColumn(foreignBoard.id, 'Foreign');
  const cardsPath = `/api/boards/${board.id}/cards`;
  const createCard = async (title, extra = {}) =>
    (
      await send('owner', 'post', cardsPath)
        .send({ title, columnId: column.id, ...extra })
        .expect(201)
    ).body.data;
  const card = await createCard('Release plan', {
    description: 'Ship it',
    startDate: '2026-03-08T01:30:00-05:00',
    dueDate: '2026-03-09T03:30:00-04:00',
  });
  const later = await createCard('Later');

  // Associations that must, and must not, be copied.
  const label = (
    await send('owner', 'post', `/api/boards/${board.id}/labels`)
      .send({ name: 'Bug', color: '#E5484D' })
      .expect(201)
  ).body.data;
  const doomed = (
    await send('owner', 'post', `/api/boards/${board.id}/labels`)
      .send({ name: 'Doomed', color: '#615CF7' })
      .expect(201)
  ).body.data;
  for (const labelId of [label.id, doomed.id])
    await send('owner', 'post', `${cardsPath}/${card.id}/labels`)
      .send({ labelId })
      .expect(201);
  const checklistsPath = `${cardsPath}/${card.id}/checklists`;
  const first = (
    await send('owner', 'post', checklistsPath)
      .send({ title: 'First' })
      .expect(201)
  ).body.data;
  const second = (
    await send('owner', 'post', checklistsPath)
      .send({ title: 'Second' })
      .expect(201)
  ).body.data;
  let items;
  for (const text of ['Write', 'Review', 'Ship'])
    items = (
      await send('owner', 'post', `${checklistsPath}/${first.id}/items`)
        .send({ text })
        .expect(201)
    ).body.data.items;
  // Reorder so the source order differs from creation order.
  await send('owner', 'patch', `${checklistsPath}/${second.id}/move`)
    .send({ beforeChecklistId: first.id })
    .expect(200);
  await send(
    'owner',
    'patch',
    `${checklistsPath}/${first.id}/items/${items[2].id}/move`,
  )
    .send({ beforeItemId: items[0].id })
    .expect(200);
  for (const item of items.slice(0, 2))
    await send(
      'owner',
      'patch',
      `${checklistsPath}/${first.id}/items/${item.id}`,
    )
      .send({ isChecked: true })
      .expect(200);
  await send('owner', 'post', `${cardsPath}/${card.id}/assignees`)
    .send({ userId: actors.member })
    .expect(201);
  await send('owner', 'post', `${cardsPath}/${card.id}/comments`)
    .send({ content: 'Private discussion' })
    .expect(201);
  await send('owner', 'post', `${cardsPath}/${card.id}/attachments`)
    .send({ kind: 'URL', url: 'https://example.com/spec' })
    .expect(201);
  const sourceChecklists = (
    await send('owner', 'get', checklistsPath).expect(200)
  ).body.data;
  assert.equal(sourceChecklists.checkedItems, 2);

  const copy = (
    await send('member', 'post', `${cardsPath}/${card.id}/duplicate`)
      .send({})
      .expect(201)
  ).body.data;
  assert.notEqual(copy.id, card.id);
  assert.deepEqual(
    {
      boardId: copy.boardId,
      columnId: copy.columnId,
      createdById: copy.createdById,
      title: copy.title,
      description: copy.description,
      startDate: copy.startDate,
      dueDate: copy.dueDate,
      isArchived: copy.isArchived,
      assignees: copy.assignees,
    },
    {
      boardId: board.id,
      columnId: column.id,
      createdById: actors.member,
      title: 'Release plan',
      description: 'Ship it',
      startDate: '2026-03-08T06:30:00.000Z',
      dueDate: '2026-03-09T07:30:00.000Z',
      isArchived: false,
      assignees: [],
    },
  );
  const active = (await send('owner', 'get', cardsPath).expect(200)).body.data;
  assert.deepEqual(
    active.filter((row) => row.columnId === column.id).map((row) => row.id),
    [card.id, later.id, copy.id],
  );
  const copyLabels = (
    await send('owner', 'get', `${cardsPath}/${copy.id}/labels`).expect(200)
  ).body.data.labels;
  assert.deepEqual(
    copyLabels.map((row) => row.id).sort(),
    [label.id, doomed.id].sort(),
  );
  const copyChecklists = (
    await send('owner', 'get', `${cardsPath}/${copy.id}/checklists`).expect(200)
  ).body.data;
  assert.deepEqual(
    copyChecklists.checklists.map((row) => [
      row.title,
      row.items.map((item) => [item.text, item.isChecked]),
    ]),
    [
      ['Second', []],
      [
        'First',
        [
          ['Ship', false],
          ['Write', false],
          ['Review', false],
        ],
      ],
    ],
  );
  assert.equal(copyChecklists.checkedItems, 0);
  assert.equal(copyChecklists.totalItems, 3);
  const sourceIds = new Set(
    sourceChecklists.checklists.flatMap((row) => [
      row.id,
      ...row.items.map((item) => item.id),
    ]),
  );
  for (const row of copyChecklists.checklists) {
    assert.equal(sourceIds.has(row.id), false);
    for (const item of row.items) assert.equal(sourceIds.has(item.id), false);
  }
  const [counts] = await source.query(
    `SELECT
       (SELECT count(*)::int FROM comments WHERE card_id = $1) AS comments,
       (SELECT count(*)::int FROM card_assignees WHERE card_id = $1) AS assignees,
       (SELECT count(*)::int FROM card_attachments WHERE card_id = $1) AS attachments,
       (SELECT count(*)::int FROM activities WHERE entity_id = $1) AS activities`,
    [copy.id],
  );
  assert.deepEqual(counts, {
    comments: 0,
    assignees: 0,
    attachments: 0,
    activities: 1,
  });
  const [activity] = await source.query(
    `SELECT action_type, actor_id, metadata FROM activities WHERE entity_id = $1`,
    [copy.id],
  );
  assert.deepEqual(activity, {
    action_type: 'CARD_CREATED',
    actor_id: actors.member,
    metadata: null,
  });
  // The source is untouched.
  const after = (await send('owner', 'get', checklistsPath).expect(200)).body
    .data;
  assert.equal(after.checkedItems, 2);
  pass(
    'copies title, description, instants, same-board labels and ordered checklists unchecked with fresh IDs; never assignees, comments, attachments or history',
  );

  const moved = (
    await send('guest', 'post', `${cardsPath}/${card.id}/duplicate`)
      .send({ columnId: secondColumn.id })
      .expect(201)
  ).body.data;
  assert.equal(moved.columnId, secondColumn.id);
  await send('owner', 'post', `${cardsPath}/${card.id}/duplicate`)
    .send({ columnId: foreignColumn.id })
    .expect(404);
  await send('owner', 'post', `${cardsPath}/${card.id}/duplicate`)
    .send({ columnId: 'not-a-uuid' })
    .expect(400);
  await send('owner', 'post', `${cardsPath}/${card.id}/duplicate`)
    .send({ title: 'Injected' })
    .expect(400);
  await send(
    'owner',
    'post',
    `/api/boards/${foreignBoard.id}/cards/${card.id}/duplicate`,
  )
    .send({})
    .expect(404);
  pass(
    'board guest duplicates into another column; foreign columns/cards, invalid IDs and unknown fields are refused',
  );

  const before = (await source.query(`SELECT count(*)::int AS n FROM cards`))[0]
    .n;
  await http.post(`${cardsPath}/${card.id}/duplicate`).send({}).expect(401);
  await send('outsider', 'post', `${cardsPath}/${card.id}/duplicate`)
    .send({})
    .expect(404);
  await send('viewer', 'post', `${cardsPath}/${card.id}/duplicate`)
    .send({})
    .expect(404);
  await send('owner', 'patch', `/api/boards/${board.id}/visibility`)
    .send({ visibility: 'WORKSPACE_VISIBLE' })
    .expect(200);
  await send('viewer', 'get', `${cardsPath}/${card.id}`).expect(200);
  const denied = await send(
    'viewer',
    'post',
    `${cardsPath}/${card.id}/duplicate`,
  ).send({});
  assert.ok([403, 404].includes(denied.status), `viewer got ${denied.status}`);
  await send('owner', 'post', `${cardsPath}/${later.id}/archive`).expect(200);
  const archivedCard = await send(
    'owner',
    'post',
    `${cardsPath}/${later.id}/duplicate`,
  ).send({});
  assert.equal(archivedCard.status, 409);
  assert.equal(archivedCard.body.code, 'CARD_ARCHIVED');
  await send('owner', 'post', `/api/boards/${board.id}/archive`).expect(200);
  const archivedBoard = await send(
    'owner',
    'post',
    `${cardsPath}/${card.id}/duplicate`,
  ).send({});
  assert.equal(archivedBoard.status, 409);
  await send('owner', 'post', `/api/boards/${board.id}/restore`).expect(200);
  assert.equal(
    (await source.query(`SELECT count(*)::int AS n FROM cards`))[0].n,
    before,
  );
  pass(
    'unauthenticated, outsider, PRIVATE and WORKSPACE_VISIBLE read-only viewers, archived Card and archived Board create nothing',
  );

  // Label deletion racing with duplication: the board lock serializes them, so
  // the copy either has the label or it was removed everywhere.
  const races = await Promise.all([
    send('owner', 'post', `${cardsPath}/${card.id}/duplicate`).send({}),
    send('owner', 'delete', `/api/boards/${board.id}/labels/${doomed.id}`),
    send('member', 'post', `${cardsPath}/${card.id}/duplicate`).send({}),
  ]);
  assert.deepEqual(
    races.map((response) => response.status),
    [201, 204, 201],
  );
  const [orphans] = await source.query(
    `SELECT count(*)::int AS n FROM card_labels WHERE label_id = $1`,
    [doomed.id],
  );
  assert.equal(orphans.n, 0);
  const positions = await source.query(
    `SELECT position FROM cards WHERE column_id = $1 AND NOT is_archived`,
    [column.id],
  );
  assert.equal(
    new Set(positions.map((row) => row.position)).size,
    positions.length,
  );
  pass(
    'concurrent duplicates and label deletion serialize: distinct positions, no orphan label links',
  );

  // A failure inside the transaction leaves no partial copy behind.
  const cardsBefore = (
    await source.query(`SELECT count(*)::int AS n FROM cards`)
  )[0].n;
  await source.query(
    `CREATE FUNCTION fail_checklist_copy() RETURNS trigger AS $$
     BEGIN RAISE EXCEPTION 'injected failure'; END $$ LANGUAGE plpgsql`,
  );
  await source.query(
    `CREATE TRIGGER fail_checklist_copy BEFORE INSERT ON card_checklist_items
     FOR EACH ROW EXECUTE FUNCTION fail_checklist_copy()`,
  );
  await send('owner', 'post', `${cardsPath}/${card.id}/duplicate`)
    .send({})
    .expect(500);
  await source.query(
    `DROP TRIGGER fail_checklist_copy ON card_checklist_items`,
  );
  await source.query(`DROP FUNCTION fail_checklist_copy()`);
  assert.equal(
    (await source.query(`SELECT count(*)::int AS n FROM cards`))[0].n,
    cardsBefore,
  );
  pass('a failed checklist copy rolls back the new Card and its labels');

  console.log(`Card duplicate PostgreSQL + HTTP: ${groups} groups PASS`);
} finally {
  try {
    if (app) await app.close();
  } finally {
    if (source?.isInitialized) await source.destroy();
    try {
      if (created) await admin.query(`DROP DATABASE "${database}"`);
    } finally {
      await admin.end();
    }
  }
}
