import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { verifyChecklistRaces } from './checklists-races.mjs';
import { verifyChecklistRealtime } from './checklists-realtime.mjs';

// No dotenv: the caller must explicitly designate a disposable local test server.
assert.equal(process.env.CHECKLIST_DATABASE_TESTS, 'local-only');
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
const database = `kanban_checklists_verify_${randomBytes(8).toString('hex')}`;
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
      !m.name.startsWith('CardChecklists') &&
      !m.name.startsWith('BoardCardLabels'),
  );
  await source.runMigrations();
  const [legacyOwner] = await source.query(
    `INSERT INTO users(email,display_name,email_verified_at) VALUES ('legacy@checklists.test','Legacy',now()) RETURNING id`,
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
    ])
      result[table] = await source.query(
        `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY id`,
      );
    return result;
  };
  const before = await snapshot();
  source.migrations = allMigrations;
  assert.equal((await source.runMigrations()).length, 2);
  assert.deepEqual(await snapshot(), before);
  await source.undoLastMigration(); // Empty Board label extension.
  await source.undoLastMigration(); // Empty checklist tables only.
  assert.equal((await source.runMigrations()).length, 2);
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
  const {
    CardChecklistsService,
  } = require('../../dist/api/cards/card-checklists.service.js');
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
      [`${actor}@checklists.test`],
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
      .send({ name: 'Checklist team' })
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
      .send({ name: 'Checklists', workspaceId: team.id })
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
  const base = `/api/boards/${board.id}/cards/${card.id}/checklists`;
  const service = app.get(CardChecklistsService),
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
    service,
    cards,
    members,
    pass,
    rejected,
  };
  const a = (
    await send('owner', 'post', base).send({ title: '  Release  ' }).expect(201)
  ).body.data;
  const b = (
    await send('member', 'post', base).send({ title: 'Verify' }).expect(201)
  ).body.data;
  assert.equal(a.title, 'Release');
  assert.equal(a.completionPercentage, 0);
  let result = (
    await send('guest', 'post', `${base}/${a.id}/items`)
      .send({ text: '  Ship  ' })
      .expect(201)
  ).body.data;
  const one = result.items[0];
  result = (
    await send('member', 'post', `${base}/${a.id}/items`)
      .send({ text: 'Review' })
      .expect(201)
  ).body.data;
  const two = result.items[1];
  result = (
    await send('owner', 'patch', `${base}/${a.id}/items/${one.id}`)
      .send({ text: 'Shipped', isChecked: true })
      .expect(200)
  ).body.data;
  assert.equal(result.completionPercentage, 50);
  result = (
    await send('owner', 'patch', `${base}/${a.id}/items/${two.id}/move`)
      .send({ beforeItemId: one.id })
      .expect(200)
  ).body.data;
  assert.deepEqual(
    result.items.map((item) => item.id),
    [two.id, one.id],
  );
  await send('owner', 'patch', `${base}/${b.id}/move`)
    .send({ beforeChecklistId: a.id })
    .expect(200);
  await send('owner', 'patch', `${base}/${b.id}`)
    .send({ title: 'Renamed' })
    .expect(200);
  assert.deepEqual(
    (await service.list(actors.owner, board.id, card.id)).checklists.map(
      (row) => row.id,
    ),
    [b.id, a.id],
  );
  await send('owner', 'delete', `${base}/${a.id}/items/${two.id}`).expect(204);
  assert.equal(
    (await send('owner', 'get', `${base}/summary`).expect(200)).body.data
      .completionPercentage,
    100,
  );
  const summaries = await service.summaries(actors.owner, board.id, [
    card.id,
    secondCard.id,
  ]);
  assert.deepEqual(
    summaries.map((row) => [row.checkedItems, row.totalItems]),
    [
      [1, 1],
      [0, 0],
    ],
  );
  assert.equal(
    (
      await source.query(
        `SELECT count(*)::int AS n FROM activities WHERE board_id=$1 AND action_type='CARD_UPDATED'`,
        [board.id],
      )
    )[0].n,
    0,
  );
  pass(
    'all ten real HTTP contracts, OWNER/MEMBER/Guest writes, trimming, deterministic ordering, authoritative progress and scoped summary',
  );

  await http.get(base).expect(401);
  for (const actor of ['viewer', 'admin', 'outsider'])
    await send(actor, 'get', base).expect(404);
  await send('owner', 'patch', `/api/boards/${board.id}/visibility`)
    .send({ visibility: 'WORKSPACE_VISIBLE' })
    .expect(200);
  for (const actor of ['viewer', 'admin']) {
    await send(actor, 'get', base).expect(200);
    await send(actor, 'get', `${base}/summary`).expect(200);
    await send(actor, 'post', base).send({ title: 'No' }).expect(404);
    await send(actor, 'patch', `${base}/${a.id}/items/${one.id}`)
      .send({ isChecked: false })
      .expect(404);
  }
  await send('outsider', 'get', base).expect(404);
  await send('guest', 'get', base.replace(board.id, foreignBoard.id)).expect(
    404,
  );
  await send('owner', 'get', base.replace(board.id, foreignBoard.id)).expect(
    404,
  );
  await send(
    'owner',
    'patch',
    `${base.replace(card.id, secondCard.id)}/${a.id}`,
  )
    .send({ title: 'No' })
    .expect(404);
  await send('owner', 'patch', `${base}/${b.id}/items/${one.id}`)
    .send({ isChecked: false })
    .expect(404);
  await send('owner', 'patch', `${base}/${a.id}/move`)
    .send({ beforeChecklistId: randomUUID() })
    .expect(404);
  for (const body of [
    {},
    { title: null },
    { title: ' ' },
    { title: 'x'.repeat(121) },
    { title: 'No', position: '1' },
  ])
    await send('owner', 'post', base).send(body).expect(400);
  await send('owner', 'patch', `${base}/${a.id}/items/${one.id}`)
    .send({})
    .expect(400);
  await send('owner', 'get', `${base}?unknown=x`).expect(400);
  pass(
    'real SQL access policy: Workspace viewer/admin read only, PRIVATE ADMIN isolation, Board guest scope and foreign-parent validation',
  );

  const contents = (await service.list(actors.owner, board.id, card.id))
    .checklists;
  await send(
    'owner',
    'post',
    `/api/boards/${board.id}/cards/${card.id}/archive`,
  ).expect(200);
  assert.deepEqual(
    (await service.list(actors.owner, board.id, card.id)).checklists,
    contents,
  );
  for (const method of [
    () => service.create(actors.owner, board.id, card.id, { title: 'No' }),
    () =>
      service.updateItem(actors.owner, board.id, card.id, a.id, one.id, {
        isChecked: false,
      }),
    () => service.remove(actors.owner, board.id, card.id, a.id),
  ])
    await rejected(method(), 409);
  await send(
    'owner',
    'post',
    `/api/boards/${board.id}/cards/${card.id}/restore`,
  ).expect(200);
  assert.deepEqual(
    (await service.list(actors.owner, board.id, card.id)).checklists,
    contents,
  );
  await send('owner', 'post', `/api/boards/${board.id}/archive`).expect(200);
  await send('viewer', 'get', base).expect(200);
  await send('owner', 'post', `${base}/${a.id}/items`)
    .send({ text: 'No' })
    .expect(409);
  await send('owner', 'post', `/api/boards/${board.id}/restore`).expect(200);
  assert.deepEqual(
    (await service.list(actors.owner, board.id, card.id)).checklists,
    contents,
  );
  pass(
    'Card and Board archive/read/restore preserve complete checklist contents and positions',
  );

  const constraint = (sql, params, code) =>
    assert.rejects(
      source.query(sql, params),
      (error) => error.driverError?.code === code,
    );
  await constraint(
    `INSERT INTO card_checklists(card_id,title,position) VALUES ($1,' ',300)`,
    [card.id],
    '23514',
  );
  await constraint(
    `INSERT INTO card_checklists(card_id,title,position) VALUES ($1,'No',0)`,
    [card.id],
    '23514',
  );
  await constraint(
    `INSERT INTO card_checklists(card_id,title,position) VALUES ($1,'No',300)`,
    [randomUUID()],
    '23503',
  );
  await constraint(
    `INSERT INTO card_checklists(card_id,title,position) SELECT card_id,'Duplicate',position FROM card_checklists WHERE id=$1`,
    [a.id],
    '23505',
  );
  await constraint(
    `INSERT INTO card_checklist_items(checklist_id,text,position) VALUES ($1,'No',300)`,
    [randomUUID()],
    '23503',
  );
  await constraint(
    `INSERT INTO card_checklist_items(checklist_id,text,position) VALUES ($1,'',300)`,
    [a.id],
    '23514',
  );
  await constraint(
    `INSERT INTO card_checklist_items(checklist_id,text,position) SELECT checklist_id,'Duplicate',position FROM card_checklist_items WHERE id=$1`,
    [one.id],
    '23505',
  );
  const constraints = await source.query(
    `SELECT conname, condeferrable, condeferred FROM pg_constraint WHERE conname IN ('UQ_card_checklists_parent_position','UQ_card_checklist_items_parent_position')`,
  );
  assert.equal(constraints.length, 2);
  assert.ok(constraints.every((row) => row.condeferrable && row.condeferred));
  await source.undoLastMigration(); // Empty Board label extension.
  await assert.rejects(
    source.undoLastMigration(),
    /Refusing to discard checklist data/,
  );
  await source.runMigrations();
  pass(
    'FK/CHECK/positive/unique constraints, deferred rebalance safety and populated rollback refusal',
  );

  await verifyChecklistRaces(ctx);
  await verifyChecklistRealtime(ctx);
  // Hard delete is maintenance-only: verify both cascading levels in this disposable DB.
  const remove = await service.create(actors.owner, board.id, secondCard.id, {
    title: 'Cascade',
  });
  await service.addItem(actors.owner, board.id, secondCard.id, remove.id, {
    text: 'Cascade',
  });
  await source.query('DELETE FROM cards WHERE id=$1', [secondCard.id]);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM card_checklists WHERE card_id=$1',
        [secondCard.id],
      )
    )[0].n,
    0,
  );
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM card_checklist_items WHERE checklist_id=$1',
        [remove.id],
      )
    )[0].n,
    0,
  );
  await service.remove(actors.owner, board.id, card.id, a.id);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM card_checklist_items WHERE checklist_id=$1',
        [a.id],
      )
    )[0].n,
    0,
  );
  pass(
    'checklist delete and maintenance-only Card hard delete cascade without orphan items',
  );
  console.log(`Checklist PostgreSQL + HTTP + Socket.IO: ${groups} groups PASS`);
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
