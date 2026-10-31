import { verifyPrivateFileCleanup } from './private-files-cleanup.mjs';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';

// No dotenv: the caller must explicitly designate a disposable local test server.
assert.equal(process.env.PRIVATE_FILE_DATABASE_TESTS, 'local-only');
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
const database = `kanban_private_files_verify_${randomBytes(8).toString('hex')}`;
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
  const allMigrations = source.migrations;
  source.migrations = allMigrations.filter(
    (m) => !m.name.startsWith('PrivateCardFiles'),
  );
  await source.runMigrations();
  const [legacyOwner] = await source.query(
    `INSERT INTO users(email,display_name,email_verified_at) VALUES ('legacy@attachments.test','Legacy',now()) RETURNING id`,
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
  await source.query(
    "UPDATE cards SET start_date=due_date-interval '1 hour' WHERE id=$1",
    [legacyActive.id],
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
        `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY id`,
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
    (await source.query('SELECT count(*)::int AS n FROM card_attachments'))[0]
      .n,
    0,
  );
  await source.undoLastMigration(); // Empty attachment tables; legacy Card values remain.
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
    ATTACHMENT_STORAGE_DRIVER: 'disabled',
    GOOGLE_CLIENT_ID: '',
  });
  const { AppModule } = require('../../dist/app.module.js');
  const {
    configureHttpApplication,
  } = require('../../dist/http-application.js');
  const { CardsService } = require('../../dist/api/cards/cards.service.js');
  const {
    BoardMembersService,
  } = require('../../dist/api/board-members/board-members.service.js');
  const {
    AttachmentStorage,
  } = require('../../dist/api/cards/attachments/attachment-storage.js');
  const {
    MemoryAttachmentStorage,
  } = require('../../dist/api/cards/attachments/attachment-storage-drivers.js');
  const {
    CardAttachmentFilesService,
  } = require('../../dist/api/cards/card-attachment-files.service.js');
  const { getStorageToken } = require('@nestjs/throttler');
  const storage = new MemoryAttachmentStorage();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(source)
    .overrideProvider(AttachmentStorage)
    .useValue(storage)
    .overrideProvider(getStorageToken())
    .useValue({
      increment: async () => ({
        totalHits: 1,
        timeToExpire: 60,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
    })
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
      [`${actor}@attachments.test`],
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
      .send({ name: 'Attachment team' })
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
      .send({ name: 'Attachments', workspaceId: team.id })
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
  const {
    CardAttachmentsService,
  } = require('../../dist/api/cards/card-attachments.service.js');
  const {
    attachmentQuotaUsage,
  } = require('../../dist/api/cards/attachments/attachment-policy.js');
  const service = app.get(CardAttachmentsService),
    cards = app.get(CardsService),
    members = app.get(BoardMembersService);
  const attachments = `${cardBase}/attachments`;
  const ctx = {
    source,
    app,
    service,
    cards,
    members,
    send,
    actors,
    tokens,
    board,
    foreignBoard,
    card,
    secondCard,
    secondColumn,
    column,
    cardBase,
    attachments,
    createCard,
    pass,
  };
  const files = app.get(CardAttachmentFilesService);
  Object.assign(ctx, { files, storage, attachmentQuotaUsage });
  const actor = (name = 'owner') => ({
    userId: actors[name],
    authVersion: 0,
    expiresAt: Date.now() + 3600_000,
  });
  ctx.actor = actor;
  const input = {
    filename: 'résumé.txt',
    contentType: 'text/plain',
    fileSize: 5,
  };
  const begin = async (data = input, name = 'owner', key = randomUUID()) =>
    (
      await send(name, 'post', attachments + '/uploads')
        .set('Idempotency-Key', key)
        .send(data)
        .expect(201)
    ).body.data;
  const transfer = (
    intent,
    body = Buffer.from('hello'),
    name = 'owner',
    mime = 'text/plain',
  ) =>
    send(name, 'post', intent.upload.url).attach('file', body, {
      filename: 'test.txt',
      contentType: mime,
    });
  const finish = (intent, name = 'owner') =>
    send(
      name,
      'post',
      attachments + `/uploads/${intent.uploadId}/complete`,
    ).send({});
  const key = randomUUID(),
    intent = await begin(input, 'owner', key);
  assert.equal(intent.state, 'PENDING');
  assert.equal(intent.upload.kind, 'memory');
  assert.ok(Date.parse(intent.upload.expiresAt) <= Date.now() + 60_000);
  assert.equal((await begin(input, 'owner', key)).uploadId, intent.uploadId);
  assert.deepEqual(
    (await send('owner', 'get', attachments).expect(200)).body.data,
    [],
  );
  await send(
    'owner',
    'get',
    attachments + '/' + intent.uploadId + '/file',
  ).expect(404);
  await finish(intent, 'member').expect(404);
  await finish(intent).expect(409);
  await transfer(intent).expect(204);
  let active = (await finish(intent).expect(200)).body.data;
  assert.equal(active.state, 'ACTIVE');
  assert.equal(active.byteSize, 5);
  assert.equal(active.kind, 'FILE');
  assert.doesNotMatch(
    JSON.stringify(active),
    /storageKey|pendingKey|contentSha256|verificationToken|reservedBytes|declaredBytes/,
  );
  assert.deepEqual((await finish(intent).expect(200)).body.data, active);
  const replay = await begin(input, 'owner', key);
  assert.equal(replay.state, 'ACTIVE');
  assert.equal(replay.upload, null);
  const downloaded = await send(
    'member',
    'get',
    attachments + '/' + active.id + '/file',
  ).expect(200);
  assert.equal(downloaded.text, 'hello');
  assert.equal(downloaded.headers['cache-control'], 'private, no-store');
  assert.equal(downloaded.headers['x-content-type-options'], 'nosniff');
  assert.match(
    downloaded.headers['content-disposition'],
    /^attachment;.*filename\*=/,
  );
  await send('owner', 'patch', `/api/boards/${board.id}/visibility`)
    .send({ visibility: 'WORKSPACE_VISIBLE' })
    .expect(200);
  await send('viewer', 'get', attachments + '/' + active.id + '/file').expect(
    200,
  );
  await send('viewer', 'post', attachments + '/uploads')
    .send(input)
    .expect(404);
  await send('viewer', 'delete', attachments + '/' + active.id).expect(404);
  await send('outsider', 'get', attachments + '/' + active.id + '/file').expect(
    404,
  );
  await send(
    'owner',
    'get',
    attachments.replace(card.id, secondCard.id) + '/' + active.id + '/file',
  ).expect(404);
  await send('owner', 'patch', `/api/boards/${board.id}/visibility`)
    .send({ visibility: 'PRIVATE' })
    .expect(200);
  await send('admin', 'get', attachments + '/' + active.id + '/file').expect(
    404,
  );
  await cards.archive(actors.owner, board.id, card.id);
  await send('guest', 'get', attachments + '/' + active.id + '/file').expect(
    200,
  );
  await send('owner', 'delete', attachments + '/' + active.id).expect(409);
  await cards.restore(actors.owner, board.id, card.id);
  await send('guest', 'patch', attachments + '/' + active.id)
    .send({ expectedRevision: active.revision, displayName: 'Notes' })
    .expect(200);
  await send('guest', 'delete', attachments + '/' + active.id).expect(204);
  await send('owner', 'delete', attachments + '/' + active.id).expect(204);
  await send('owner', 'get', attachments + '/' + active.id + '/file').expect(
    404,
  );
  await finish(intent).expect(409);
  pass(
    'real Nest/JWT upload, private transfer, verification, idempotent activation, listing, authenticated headers/download, archive and deletion',
  );

  const sharp = require('sharp');
  const png = await sharp({
    create: { width: 16, height: 16, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  const image = await begin(
    { filename: 'photo.png', contentType: 'image/png', fileSize: png.length },
    'member',
  );
  await transfer(image, png, 'member', 'image/png').expect(204);
  active = (await finish(image, 'member').expect(200)).body.data;
  const raster = await send(
    'guest',
    'get',
    attachments + '/' + active.id + '/file',
  ).expect(200);
  assert.match(raster.headers['content-disposition'], /^inline;/);
  assert.equal(raster.headers['content-type'], 'image/png');
  assert.equal((await sharp(raster.body).metadata()).format, 'png');
  const record = (
    await source.query(
      'SELECT declared_bytes,reserved_bytes,content_sha256 FROM card_attachments WHERE id=$1',
      [active.id],
    )
  )[0];
  assert.equal(Number(record.reserved_bytes), 10 * 1024 * 1024);
  assert.equal(Number(record.declared_bytes), png.length);
  assert.match(record.content_sha256, /^[0-9a-f]{64}$/);
  pass(
    'raster bytes are decoded/normalized under prospective reservation and served inline with immutable verified digest',
  );
  for (const payload of [
    { filename: 'x.svg', contentType: 'image/svg+xml', fileSize: 5 },
    { filename: '../x.txt', contentType: 'text/plain', fileSize: 5 },
    {
      filename: 'x.txt',
      contentType: 'text/plain',
      fileSize: 10 * 1024 * 1024 + 1,
    },
    { ...input, storageKey: 'secret' },
  ]) {
    const response = await send('owner', 'post', attachments + '/uploads').send(
      payload,
    );
    assert.ok([400, 413, 415].includes(response.status));
  }
  const bad = await begin({
    filename: 'bad.txt',
    contentType: 'text/plain',
    fileSize: 6,
  });
  await transfer(bad, Buffer.from('<html>')).expect(204);
  await finish(bad).expect(415);
  assert.equal(
    (
      await source.query('SELECT state FROM card_attachments WHERE id=$1', [
        bad.uploadId,
      ])
    )[0].state,
    'FAILED',
  );
  await send('owner', 'get', attachments + '/' + bad.uploadId + '/file').expect(
    404,
  );
  const canceled = await begin();
  await send(
    'member',
    'delete',
    attachments + '/uploads/' + canceled.uploadId,
  ).expect(404);
  await send(
    'owner',
    'delete',
    attachments + '/uploads/' + canceled.uploadId,
  ).expect(204);
  await send(
    'owner',
    'delete',
    attachments + '/uploads/' + canceled.uploadId,
  ).expect(204);
  await finish(canceled).expect(409);
  await send('owner', 'post', canceled.upload.url)
    .attach('file', Buffer.from('hello'), {
      filename: 'test.txt',
      contentType: 'text/plain',
    })
    .expect(409);
  pass(
    'unsafe metadata/content and terminal intent replay never become public; owner cancellation is idempotent',
  );

  Object.assign(ctx, { begin, transfer, finish, input, activeFile: active });
  await verifyPrivateFileCleanup(ctx);
  // Additional race and realtime assertions follow.
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries,
    [],
  );
  console.log(`Private files PostgreSQL suite: ${groups} groups passed`);
} finally {
  if (app) await app.close();
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
