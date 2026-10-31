import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { verifyDateRaces } from './dates-races.mjs';
import { verifyDateRealtime } from './dates-realtime.mjs';

// No dotenv: the caller must explicitly designate a disposable local test server.
assert.equal(process.env.CARD_DATES_DATABASE_TESTS, 'local-only');
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
const {
  databaseOptions,
} = require('../../../dist/database/database-options.js');
const options = databaseOptions(process.env);
const database = `kanban_dates_verify_${randomBytes(8).toString('hex')}`;
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
    (m) => !m.name.startsWith('CardAdvancedDates'),
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
    `INSERT INTO cards(board_id,column_id,created_by_id,title,position,is_archived,archived_at,due_date) VALUES ($1,$2,$3,'Archived',123.1234567890,true,now(),'2026-01-01T00:00:00+07:00') RETURNING *`,
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
  const [legacyActive] = await source.query(
    `INSERT INTO cards(board_id,column_id,created_by_id,title,position,due_date) VALUES ($1,$2,$3,'Legacy fractional deadline',200,'2000-02-29T12:34:56.123456Z') RETURNING id`,
    [legacyBoard.id, legacyColumn.id, legacyOwner.id],
  );
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')`,
    [legacyBoard.id, legacyOwner.id],
  );
  const legacyEpoch = async () =>
    source.query(
      'SELECT id,extract(epoch FROM due_date)::text AS epoch FROM cards ORDER BY id',
    );
  const beforeEpoch = await legacyEpoch();
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
  assert.equal((await source.runMigrations()).length, 1);
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await legacyEpoch(), beforeEpoch);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM cards WHERE start_date IS NOT NULL',
      )
    )[0].n,
    0,
  );
  await source.undoLastMigration(); // Empty start_date column; legacy due_date values remain.
  assert.equal((await source.runMigrations()).length, 1);
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
  const { AppModule } = require('../../../dist/app.module.js');
  const {
    configureHttpApplication,
  } = require('../../../dist/http-application.js');
  const { CardsService } = require('../../../dist/api/cards/cards.service.js');
  const {
    BoardMembersService,
  } = require('../../../dist/api/board-members/board-members.service.js');
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
  const base = `/api/boards/${board.id}/cards`;
  const cardBase = `${base}/${card.id}`;
  const service = app.get(CardsService),
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
  const start = '2026-03-08T01:30:00-05:00',
    due = '2026-03-08T03:30:00-04:00';
  const {
    UserPreferencesService,
  } = require('../../../dist/api/users/user-preferences.service.js');
  const { deriveCardDueStatus } = require('@kanban/shared');
  const legacy = await service.get(
    legacyOwner.id,
    legacyBoard.id,
    legacyCard.id,
  );
  assert.equal(legacy.startDate, null);
  assert.equal(legacy.dueDate, '2025-12-31T17:00:00.000Z');
  await service.update(legacyOwner.id, legacyBoard.id, legacyActive.id, {
    title: 'Unrelated edit',
  });
  assert.deepEqual(
    await legacyEpoch(),
    [
      ...beforeEpoch,
      ...(await source.query(
        'SELECT id,extract(epoch FROM due_date)::text AS epoch FROM cards WHERE id IN ($1,$2) ORDER BY id',
        [card.id, secondCard.id],
      )),
    ].sort((a, b) => a.id.localeCompare(b.id)),
  );
  pass(
    'legacy UTC offsets, leap-day fractional timestamps and archived data stay exact after upgrade and unrelated writes',
  );

  for (const dates of [
    {},
    { startDate: start },
    { dueDate: due },
    { startDate: start, dueDate: due },
    { startDate: due, dueDate: due },
  ]) {
    const result = (
      await send('owner', 'post', base)
        .send({ columnId: column.id, title: 'Dates', ...dates })
        .expect(201)
    ).body.data;
    assert.equal(
      result.startDate,
      dates.startDate ? new Date(dates.startDate).toISOString() : null,
    );
    assert.equal(
      result.dueDate,
      dates.dueDate ? new Date(dates.dueDate).toISOString() : null,
    );
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(await service.get(actors.owner, board.id, result.id)),
      ),
      result,
    );
    assert.equal(
      (
        await service.list(actors.owner, board.id, { page: 1, limit: 100 })
      ).data.find((row) => row.id === result.id).startDate,
      result.startDate,
    );
  }
  const dates = (
    await send('member', 'patch', cardBase)
      .send({ startDate: start, dueDate: due })
      .expect(200)
  ).body.data;
  assert.equal(dates.startDate, '2026-03-08T06:30:00.000Z');
  assert.equal(dates.dueDate, '2026-03-08T07:30:00.000Z');
  for (const input of [
    { startDate: '2026-03-08T08:00Z', title: 'Invalid edit' },
    { dueDate: '2026-03-08T05:00Z' },
  ])
    assert.equal(
      (await send('owner', 'patch', cardBase).send(input).expect(400)).body
        .code,
      'CARD_DATE_RANGE_INVALID',
    );
  assert.equal(
    (await service.get(actors.owner, board.id, card.id)).title,
    'Card',
  );
  await send('owner', 'patch', cardBase)
    .send({ startDate: '2026-04-01T00:00Z', dueDate: '2026-04-02T00:00Z' })
    .expect(200);
  assert.equal(
    (
      await send('owner', 'patch', cardBase)
        .send({ startDate: null })
        .expect(200)
    ).body.data.dueDate,
    '2026-04-02T00:00:00.000Z',
  );
  await send('owner', 'patch', cardBase)
    .send({ startDate: null, dueDate: null })
    .expect(200);
  await send('guest', 'patch', cardBase)
    .send({ startDate: start, dueDate: due })
    .expect(200);
  pass(
    'create/read/list/partial update/clear for empty, one-sided, equal and DST-crossing ranges; persisted counterpart validates atomically',
  );

  const snapshotDates = () =>
    source.query('SELECT start_date,due_date FROM cards WHERE id=$1', [
      card.id,
    ]);
  const beforePreferences = await snapshotDates();
  const preferences = app.get(UserPreferencesService);
  await preferences.update(actors.owner, { timeZone: 'America/New_York' });
  await preferences.update(actors.owner, { timeZone: 'Asia/Ho_Chi_Minh' });
  assert.deepEqual(await snapshotDates(), beforePreferences);
  assert.equal(
    deriveCardDueStatus(due, '2026-03-08T06:30:00Z', 'America/New_York'),
    'DUE_TODAY',
  );
  for (const input of [
    { startDate: '2026-03-08' },
    { dueDate: '2026-03-08T02:30:00' },
    { startDate: '2026-02-30T00:00Z' },
    { dueDate: '2026-01-01T24:00Z' },
    { startDate: '2026-01-01T00:00+24:00' },
    { isAllDay: true },
    { timeZone: 'America/New_York' },
    { dueStatus: 'OVERDUE' },
  ])
    await send('owner', 'patch', cardBase).send(input).expect(400);
  const [metadata] = await source.query(
    `SELECT is_nullable,data_type,column_default FROM information_schema.columns WHERE table_name='cards' AND column_name='start_date'`,
  );
  assert.deepEqual(metadata, {
    is_nullable: 'YES',
    data_type: 'timestamp with time zone',
    column_default: null,
  });
  const indexes = await source.query(
    `SELECT indexname,indexdef FROM pg_indexes WHERE tablename='cards' AND indexname IN ('IDX_cards_board_start_date','IDX_cards_board_due_date')`,
  );
  assert.equal(indexes.length, 2);
  assert.ok(
    indexes.every(
      (index) =>
        index.indexdef.includes('board_id') &&
        index.indexdef.includes('IS NOT NULL'),
    ),
  );
  await assert.rejects(
    source.query(
      `UPDATE cards SET start_date=due_date+interval '1 millisecond' WHERE id=$1`,
      [card.id],
    ),
    (error) => error.driverError?.code === '23514',
  );
  await assert.rejects(
    source.query(`UPDATE cards SET start_date='infinity' WHERE id=$1`, [
      card.id,
    ]),
    (error) => error.driverError?.code === '23514',
  );
  await assert.rejects(
    source.undoLastMigration(),
    /Refusing to discard Card start dates/,
  );
  pass(
    'preferences never mutate stored instants; malformed/civil inputs fail; nullability, Board/time indexes, range/finite checks and safe down refusal hold',
  );

  for (const actor of ['viewer', 'admin', 'outsider'])
    await send(actor, 'get', cardBase).expect(404);
  await send('owner', 'patch', `/api/boards/${board.id}/visibility`)
    .send({ visibility: 'WORKSPACE_VISIBLE' })
    .expect(200);
  for (const actor of ['viewer', 'admin']) {
    await send(actor, 'get', cardBase).expect(200);
    await send(actor, 'patch', cardBase).send({ startDate: null }).expect(404);
  }
  await send('outsider', 'get', cardBase).expect(404);
  await send(
    'guest',
    'get',
    cardBase.replace(board.id, foreignBoard.id),
  ).expect(404);
  await send('owner', 'patch', cardBase.replace(board.id, foreignBoard.id))
    .send({ startDate: null })
    .expect(404);
  await http.get(cardBase).expect(401);
  const beforeArchive = await snapshotDates();
  await service.archive(actors.owner, board.id, card.id);
  await send('viewer', 'get', cardBase).expect(200);
  await send('owner', 'patch', cardBase).send({ startDate: null }).expect(409);
  assert.equal(
    (
      await service.list(actors.owner, board.id, {
        page: 1,
        limit: 100,
        status: 'archived',
      })
    ).data.find((row) => row.id === card.id).startDate,
    dates.startDate,
  );
  await service.restore(actors.owner, board.id, card.id);
  assert.deepEqual(await snapshotDates(), beforeArchive);
  await send('owner', 'post', `/api/boards/${board.id}/archive`).expect(200);
  await send('viewer', 'get', cardBase).expect(200);
  await send('owner', 'patch', cardBase).send({ dueDate: null }).expect(409);
  await send('owner', 'post', `/api/boards/${board.id}/restore`).expect(200);
  assert.deepEqual(await snapshotDates(), beforeArchive);
  pass(
    'PRIVATE/Workspace-visible/Guest/outsider authorization and archived Card/Board lifecycle retain both dates',
  );

  await verifyDateRaces(ctx);
  await verifyDateRealtime(ctx);
  console.log(
    `Advanced Card dates PostgreSQL + HTTP + Socket.IO: ${groups} groups PASS`,
  );
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
