import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { verifyLabelRaces } from './labels-races.mjs';
import { verifyLabelRealtime } from './labels-realtime.mjs';

// No dotenv: the caller must explicitly designate a disposable local test server.
assert.equal(process.env.LABEL_DATABASE_TESTS, 'local-only');
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
const database = `kanban_labels_verify_${randomBytes(8).toString('hex')}`;
const admin = new Client({ ...options, user: options.username });
let source,
  app,
  created = false,
  groups = 0;
const pass = (name) => {
  groups++;
  console.log(`PASS: ${name}`);
};
const rejected = (promise, status) =>
  assert.rejects(promise, (error) => error.getStatus?.() === status);

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  source = await new DataSource({ ...options, database }).initialize();
  const allMigrations = source.migrations;
  source.migrations = allMigrations.filter(
    (m) =>
      !m.name.startsWith('BoardCardLabels') &&
      !m.name.startsWith('CardAdvancedDates') &&
      !m.name.startsWith('CardAttachments'),
  );
  await source.runMigrations();
  const [legacyOwner] = await source.query(
    `INSERT INTO users(email,display_name,email_verified_at) VALUES ('legacy@labels.test','Legacy',now()) RETURNING id`,
  );
  const [legacyBoard] = await source.query(
    `INSERT INTO boards(name,created_by_id) VALUES ('Legacy',$1) RETURNING id`,
    [legacyOwner.id],
  );
  const [legacyColumn] = await source.query(
    `INSERT INTO board_columns(board_id,name,position) VALUES ($1,'Keep',100) RETURNING id`,
    [legacyBoard.id],
  );
  const [legacyCard] = await source.query(
    `INSERT INTO cards(board_id,column_id,created_by_id,title,position,is_archived,archived_at) VALUES ($1,$2,$3,'Archived',123.1234567890,true,now()) RETURNING *`,
    [legacyBoard.id, legacyColumn.id, legacyOwner.id],
  );
  await source.query(
    `INSERT INTO comments(card_id,author_id,content) VALUES ($1,$2,'Keep')`,
    [legacyCard.id, legacyOwner.id],
  );
  await source.query(
    `INSERT INTO card_assignees(card_id,user_id) VALUES ($1,$2)`,
    [legacyCard.id, legacyOwner.id],
  );
  const snapshot = async () => {
    const result = {};
    for (const table of [
      'users',
      'boards',
      'board_columns',
      'cards',
      'comments',
      'card_assignees',
      'card_checklists',
      'card_checklist_items',
    ])
      result[table] = await source.query(
        `SELECT to_jsonb(t) - 'start_date' AS row FROM ${table} t ORDER BY id`,
      );
    return result;
  };
  const [legacyChecklist] = await source.query(
    `INSERT INTO card_checklists(card_id,title,position) VALUES ($1,'Keep',100) RETURNING id`,
    [legacyCard.id],
  );
  await source.query(
    `INSERT INTO card_checklist_items(checklist_id,text,is_checked,position) VALUES ($1,'Keep',true,100)`,
    [legacyChecklist.id],
  );
  const before = await snapshot();
  source.migrations = allMigrations;
  assert.equal((await source.runMigrations()).length, 3);
  assert.deepEqual(await snapshot(), before);
  await source.undoLastMigration(); // Empty attachment foundation.
  await source.undoLastMigration(); // Empty Card start-date extension.
  await source.undoLastMigration(); // Empty label tables and their Card composite key only.
  assert.equal((await source.runMigrations()).length, 3);
  assert.deepEqual(await source.runMigrations(), []);
  assert.equal(source.options.synchronize, false);
  assert.equal(source.options.migrationsRun, false);
  const schemaDiff = await source.driver.createSchemaBuilder().log();
  assert.deepEqual(schemaDiff.upQueries, []);
  pass(
    'fresh full chain, populated upgrade preserves archived Card/Comment/assignment data, empty down/up and ORM metadata',
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
  const { LabelsService } = require('../../dist/api/labels/labels.service.js');
  const { CardsService } = require('../../dist/api/cards/cards.service.js');
  const {
    BoardMembersService,
  } = require('../../dist/api/board-members/board-members.service.js');
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
      [`${actor}@labels.test`],
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
      .send({ name: 'Label team' })
      .expect(201)
  ).body.data;
  for (const [actor, role] of [
    ['member', 'MEMBER'],
    ['viewer', 'MEMBER'],
    ['admin', 'ADMIN'],
  ])
    await source.query(
      `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,$3)`,
      [team.id, actors[actor], role],
    );
  const board = (
    await send('owner', 'post', '/api/boards')
      .send({ name: 'Labels', workspaceId: team.id })
      .expect(201)
  ).body.data;
  const foreignBoard = (
    await send('owner', 'post', '/api/boards')
      .send({ name: 'Foreign', workspaceId: team.id })
      .expect(201)
  ).body.data;
  for (const actor of ['member', 'guest'])
    await source.query(
      `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
      [board.id, actors[actor]],
    );
  const column = (
    await send('owner', 'post', `/api/boards/${board.id}/columns`)
      .send({ name: 'Source' })
      .expect(201)
  ).body.data;
  const secondColumn = (
    await send('owner', 'post', `/api/boards/${board.id}/columns`)
      .send({ name: 'Destination' })
      .expect(201)
  ).body.data;
  const createCard = async (title) =>
    (
      await send('owner', 'post', `/api/boards/${board.id}/cards`)
        .send({ title, columnId: column.id })
        .expect(201)
    ).body.data;
  const card = await createCard('Card'),
    secondCard = await createCard('Other');
  const base = `/api/boards/${board.id}/labels`;
  const cardBase = `/api/boards/${board.id}/cards/${card.id}/labels`;
  const service = app.get(LabelsService),
    cards = app.get(CardsService),
    members = app.get(BoardMembersService);
  const ctx = {
    source,
    app,
    send,
    actors,
    tokens,
    board,
    foreignBoard,
    card,
    secondCard,
    column,
    secondColumn,
    base,
    cardBase,
    service,
    cards,
    members,
    pass,
    rejected,
  };
  const create = async (name, color = '#615cf7', actor = 'owner') =>
    (await send(actor, 'post', base).send({ name, color }).expect(201)).body
      .data;
  const bug = await create(' Bug '),
    docs = await create('Docs', '#615CF7', 'member');
  assert.equal(bug.name, 'Bug');
  assert.equal(bug.color, '#615CF7');
  await send('guest', 'post', cardBase).send({ labelId: bug.id }).expect(201);
  await send('member', 'post', cardBase).send({ labelId: docs.id }).expect(201);
  await send('owner', 'post', cardBase).send({ labelId: bug.id }).expect(409);
  await service.assign(actors.owner, board.id, secondCard.id, bug.id);
  await send('owner', 'patch', `${base}/${bug.id}`)
    .send({ name: 'Issue', color: '#ffffff' })
    .expect(200);
  for (const cardId of [card.id, secondCard.id]) {
    const labels = (await service.cardLabels(actors.owner, board.id, cardId))
      .labels;
    assert.equal(labels.find((row) => row.id === bug.id).color, '#FFFFFF');
    assert.equal(labels.find((row) => row.id === bug.id).name, 'Issue');
  }
  const page = await send('owner', 'get', `${base}?page=2&limit=1`).expect(200);
  assert.deepEqual(page.body.meta, {
    page: 2,
    limit: 1,
    total: 2,
    totalPages: 2,
  });
  assert.equal(page.body.data[0].id, bug.id);
  await send('owner', 'patch', `${base}/${docs.id}`)
    .send({ name: 'ISSUE' })
    .expect(409);
  await send('owner', 'post', base)
    .send({ name: 'issue', color: '#000000' })
    .expect(409);
  await send('owner', 'delete', `${cardBase}/${docs.id}`).expect(204);
  await send('owner', 'delete', `${cardBase}/${docs.id}`).expect(404);
  assert.equal(
    (await service.cardLabels(actors.owner, board.id, card.id)).labels.length,
    1,
  );
  pass(
    'all seven real HTTP operations, normalized name/color, multiple labels, deterministic pagination and current metadata across Cards',
  );

  await http.get(base).expect(401);
  for (const actor of ['viewer', 'admin', 'outsider'])
    await send(actor, 'get', base).expect(404);
  await send('owner', 'patch', `/api/boards/${board.id}/visibility`)
    .send({ visibility: 'WORKSPACE_VISIBLE' })
    .expect(200);
  for (const actor of ['viewer', 'admin']) {
    await send(actor, 'get', base).expect(200);
    await send(actor, 'get', cardBase).expect(200);
    await send(actor, 'post', base)
      .send({ name: 'No', color: '#111111' })
      .expect(404);
    await send(actor, 'post', cardBase).send({ labelId: bug.id }).expect(404);
    await send(actor, 'delete', `${base}/${bug.id}`).expect(404);
  }
  await send('outsider', 'get', base).expect(404);
  await send('guest', 'get', base.replace(board.id, foreignBoard.id)).expect(
    404,
  );
  const foreign = (
    await send('owner', 'post', base.replace(board.id, foreignBoard.id))
      .send({ name: 'Issue', color: '#FFFFFF' })
      .expect(201)
  ).body.data;
  await send('owner', 'post', cardBase)
    .send({ labelId: foreign.id })
    .expect(404);
  await send('owner', 'patch', `${base}/${foreign.id}`)
    .send({ name: 'No' })
    .expect(404);
  await send(
    'owner',
    'get',
    cardBase.replace(board.id, foreignBoard.id),
  ).expect(404);
  await rejected(
    service.forCards(actors.owner, board.id, [card.id, legacyCard.id]),
    404,
  );
  for (const body of [
    {},
    { name: null },
    { name: ' ' },
    { color: null },
    { color: 'red' },
    { color: '#FFF' },
    { color: '#11223344' },
    { name: 'Valid', boardId: foreignBoard.id },
    { position: '100' },
  ])
    await send('owner', 'patch', `${base}/${bug.id}`).send(body).expect(400);
  await send('owner', 'get', `${base}?limit=101`).expect(400);
  await send('owner', 'get', `${cardBase}?include=private`).expect(400);
  pass(
    'real Board policy matrix, PRIVATE ADMIN isolation, Workspace-visible reads, Guest scope, same-Board ownership and HTTP validation',
  );

  const constraint = (sql, params, code) =>
    assert.rejects(
      source.query(sql, params),
      (error) => error.driverError?.code === code,
    );
  await constraint(
    `INSERT INTO board_labels(board_id,name,color) VALUES ($1,'iSsUe','#111111')`,
    [board.id],
    '23505',
  );
  await constraint(
    `INSERT INTO board_labels(board_id,name,color) VALUES ($1,' ','#111111')`,
    [board.id],
    '23514',
  );
  await constraint(
    `INSERT INTO board_labels(board_id,name,color) VALUES ($1,'Invalid','#abcdef')`,
    [board.id],
    '23514',
  );
  await constraint(
    `INSERT INTO board_labels(board_id,name,color) VALUES ($1,'Invalid','#FFF')`,
    [board.id],
    '23514',
  );
  await constraint(
    `INSERT INTO card_labels(card_id,label_id,board_id) VALUES ($1,$2,$3)`,
    [card.id, foreign.id, board.id],
    '23503',
  );
  await constraint(
    `INSERT INTO card_labels(card_id,label_id,board_id) VALUES ($1,$2,$3)`,
    [card.id, foreign.id, foreignBoard.id],
    '23503',
  );
  await constraint(
    `INSERT INTO card_labels(card_id,label_id,board_id) VALUES ($1,$2,$3)`,
    [card.id, bug.id, board.id],
    '23505',
  );
  await constraint(
    `UPDATE board_labels SET board_id=$1, name='Moved label' WHERE id=$2`,
    [foreignBoard.id, bug.id],
    '23503',
  );
  const catalog = await source.query(
    `SELECT conname,confdeltype FROM pg_constraint WHERE conname IN ('FK_card_labels_card_board','FK_card_labels_label_board','FK_board_labels_board_id')`,
  );
  assert.equal(catalog.length, 3);
  assert.ok(catalog.every((row) => row.confdeltype === 'c'));
  const indexes = await source.query(
    `SELECT indexname,indexdef FROM pg_indexes WHERE tablename IN ('board_labels','card_labels')`,
  );
  assert.ok(
    indexes.some(
      (row) =>
        row.indexname === 'UQ_board_labels_board_name' &&
        /UNIQUE.*board_id, lower/i.test(row.indexdef),
    ),
  );
  assert.ok(
    indexes.some((row) => row.indexname === 'IDX_card_labels_label_board'),
  );
  await source.undoLastMigration(); // Empty attachment foundation.
  await source.undoLastMigration(); // Empty Card start-date extension.
  await assert.rejects(
    source.undoLastMigration(),
    /Refusing to discard Board label data/,
  );
  await source.runMigrations();
  pass(
    'schema-level normalized uniqueness, strict colors/nonblank names, composite cross-Board rejection, indexes and safe populated down refusal',
  );

  const beforeArchive = await service.cardLabels(
    actors.owner,
    board.id,
    card.id,
  );
  await cards.archive(actors.owner, board.id, card.id);
  assert.deepEqual(
    await service.cardLabels(actors.owner, board.id, card.id),
    beforeArchive,
  );
  await rejected(service.assign(actors.owner, board.id, card.id, docs.id), 409);
  await rejected(
    service.unassign(actors.owner, board.id, card.id, bug.id),
    409,
  );
  await service.update(actors.owner, board.id, bug.id, { color: '#123456' });
  assert.equal(
    (await service.cardLabels(actors.viewer, board.id, card.id)).labels[0]
      .color,
    '#123456',
  );
  await cards.restore(actors.owner, board.id, card.id);
  assert.equal(
    (await service.cardLabels(actors.owner, board.id, card.id)).labels[0].id,
    bug.id,
  );
  await send('owner', 'post', `/api/boards/${board.id}/archive`).expect(200);
  await send('viewer', 'get', base).expect(200);
  await send('viewer', 'get', cardBase).expect(200);
  for (const operation of [
    () =>
      service.create(actors.owner, board.id, { name: 'No', color: '#111111' }),
    () => service.update(actors.owner, board.id, bug.id, { name: 'No' }),
    () => service.remove(actors.owner, board.id, bug.id),
    () => service.assign(actors.owner, board.id, card.id, docs.id),
    () => service.unassign(actors.owner, board.id, card.id, bug.id),
  ])
    await rejected(operation(), 409);
  await send('owner', 'post', `/api/boards/${board.id}/restore`).expect(200);
  await send('owner', 'get', cardBase).expect(200);
  pass(
    'archived Card associations survive restore and remain readable; catalog edits propagate; archived Board blocks every mutation',
  );

  const logged = [],
    originalLog = source.logger.logQuery.bind(source.logger);
  source.logger.logQuery = (sql, ...args) => {
    logged.push(sql);
    originalLog(sql, ...args);
  };
  try {
    const batch = await service.forCards(actors.owner, board.id, [
      card.id,
      secondCard.id,
    ]);
    assert.equal(batch.length, 2);
  } finally {
    source.logger.logQuery = originalLog;
  }
  assert.equal(
    logged.filter((sql) => /FROM "card_labels"/.test(sql)).length,
    1,
  );
  pass(
    'batch Card metadata uses one joined association query, independent of Card count, without N+1',
  );

  await verifyLabelRaces(ctx);
  await verifyLabelRealtime(ctx);
  const kept = await service.create(actors.owner, board.id, {
    name: 'Cascade',
    color: '#112233',
  });
  await service.assign(actors.owner, board.id, secondCard.id, kept.id);
  await source.query('DELETE FROM cards WHERE id=$1', [secondCard.id]);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM card_labels WHERE card_id=$1',
        [secondCard.id],
      )
    )[0].n,
    0,
  );
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM board_labels WHERE id=$1',
        [kept.id],
      )
    )[0].n,
    1,
  );
  await source.query('DELETE FROM boards WHERE id=$1', [foreignBoard.id]);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM board_labels WHERE board_id=$1',
        [foreignBoard.id],
      )
    )[0].n,
    0,
  );
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM board_labels WHERE id=$1',
        [kept.id],
      )
    )[0].n,
    1,
  );
  pass(
    'maintenance Card and Board deletion clean only owned links/catalogs and preserve unrelated labels',
  );
  console.log(`Labels PostgreSQL + HTTP + Socket.IO: ${groups} groups PASS`);
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
