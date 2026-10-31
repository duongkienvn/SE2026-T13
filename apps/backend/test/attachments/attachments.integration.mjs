import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { verifyAttachmentRaces } from './attachments-races.mjs';
import { verifyAttachmentRealtime } from './attachments-realtime.mjs';

// No dotenv: the caller must explicitly designate a disposable local test server.
assert.equal(process.env.ATTACHMENTS_DATABASE_TESTS, 'local-only');
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
const database = `kanban_attachments_verify_${randomBytes(8).toString('hex')}`;
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
    (m) => !m.name.startsWith('CardAttachments'),
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
  const create = (actor = 'owner', suffix = 'doc', key) => {
    const operation = send(actor, 'post', attachments);
    if (key) operation.set('Idempotency-Key', key);
    return operation.send({
      kind: 'URL',
      url: `HTTPS://Example.com:443/${suffix}`,
    });
  };
  // Only syntax is evaluated: even an unresolvable target must persist without DNS/HTTPS I/O.
  const https = require('node:https'),
    dns = require('node:dns');
  const originals = {
    request: https.request,
    get: https.get,
    resolve: dns.resolve,
    lookup: dns.lookup,
    fetch: globalThis.fetch,
  };
  let outbound = 0;
  const forbidden = () => {
    outbound++;
    throw new Error('Unexpected external target I/O');
  };
  let first;
  try {
    https.request = forbidden;
    https.get = forbidden;
    dns.resolve = forbidden;
    dns.lookup = forbidden;
    globalThis.fetch = forbidden;
    first = (
      await send('member', 'post', attachments)
        .send({
          kind: 'URL',
          url: 'https://must-not-resolve.invalid/doc',
          displayName: 'Document',
        })
        .expect(201)
    ).body.data;
    for (const url of [
      'http://example.com',
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///tmp/file',
      'https://user:pass@example.com',
      'https://example.com/%0a',
      'https://example.com/\\evil',
    ])
      await send('owner', 'post', attachments)
        .send({ kind: 'URL', url })
        .expect(400);
    assert.equal(outbound, 0);
  } finally {
    https.request = originals.request;
    https.get = originals.get;
    dns.resolve = originals.resolve;
    dns.lookup = originals.lookup;
    globalThis.fetch = originals.fetch;
  }
  assert.equal(first.uploaderId, actors.member);
  assert.deepEqual(
    Object.keys(first).sort(),
    [
      'id',
      'boardId',
      'cardId',
      'uploaderId',
      'kind',
      'state',
      'displayName',
      'url',
      'originalFilename',
      'mimeType',
      'byteSize',
      'revision',
      'createdAt',
      'updatedAt',
    ].sort(),
  );
  await http.get(attachments).expect(401);
  for (const extra of [
    { storageKey: 'secret' },
    { pendingKey: 'secret' },
    { uploaderId: actors.owner },
    { boardId: foreignBoard.id },
    { state: 'ACTIVE' },
    { byteSize: 1 },
    { mimeType: 'text/plain' },
  ])
    await send('owner', 'post', attachments)
      .send({ kind: 'URL', url: 'https://example.com', ...extra })
      .expect(400);
  const fileDisabled = await send('owner', 'post', attachments)
    .send({ kind: 'FILE' })
    .expect(503);
  assert.equal(fileDisabled.body.code, 'ATTACHMENT_FILES_NOT_AVAILABLE');
  assert.doesNotMatch(
    JSON.stringify(fileDisabled.body),
    /pendingKey|storageKey|signed|credential/,
  );
  pass(
    'real JWT HTTP URL CRUD rejects unsafe URLs/private fields without DNS, HTTPS or fetch calls and reports files unavailable',
  );

  for (const actor of ['viewer', 'admin', 'outsider'])
    await send(actor, 'get', attachments).expect(404);
  await send('owner', 'patch', `/api/boards/${board.id}/visibility`)
    .send({ visibility: 'WORKSPACE_VISIBLE' })
    .expect(200);
  for (const actor of ['owner', 'member', 'guest', 'viewer', 'admin'])
    await send(actor, 'get', attachments).expect(200);
  for (const actor of ['viewer', 'admin', 'outsider']) {
    await create(actor).expect(404);
    await send(actor, 'patch', `${attachments}/${first.id}`)
      .send({ expectedRevision: 1, displayName: 'Denied' })
      .expect(404);
    await send(actor, 'delete', `${attachments}/${first.id}`).expect(404);
  }
  await send('guest', 'get', `/api/workspaces/${team.id}/members`).expect(404);
  await send(
    'owner',
    'get',
    attachments.replace(card.id, secondCard.id) + '/' + first.id,
  ).expect(404);
  await send(
    'owner',
    'get',
    attachments.replace(board.id, foreignBoard.id),
  ).expect(404);
  await send(
    'guest',
    'get',
    attachments.replace(board.id, foreignBoard.id),
  ).expect(404);
  pass(
    'OWNER/MEMBER/Guest, Workspace read-only, PRIVATE Admin exclusion and cross-Board/Card resource isolation',
  );

  const key = randomUUID();
  const original = (await create('owner', 'replay', key).expect(201)).body.data;
  assert.deepEqual(
    (await create('owner', 'replay', key).expect(201)).body.data,
    original,
  );
  await create('owner', 'different', key).expect(409);
  const edited = (
    await send('guest', 'patch', `${attachments}/${original.id}`)
      .send({ expectedRevision: 1, displayName: 'Renamed' })
      .expect(200)
  ).body.data;
  assert.equal(edited.revision, 2);
  await send('owner', 'patch', `${attachments}/${original.id}`)
    .send({ expectedRevision: 1, displayName: 'Stale' })
    .expect(409);
  const noop = (
    await send('owner', 'patch', `${attachments}/${original.id}`)
      .send({ expectedRevision: 2, url: original.url })
      .expect(200)
  ).body.data;
  assert.equal(noop.revision, 2);
  await send(
    'member',
    'delete',
    `${attachments}/${original.id}?expectedRevision=1`,
  ).expect(409);
  await send(
    'member',
    'delete',
    `${attachments}/${original.id}?expectedRevision=2`,
  ).expect(204);
  await send('owner', 'delete', `${attachments}/${original.id}`).expect(204);
  await create('owner', 'replay', key).expect(409);
  await send('owner', 'get', `${attachments}/${original.id}`).expect(404);
  pass(
    'normalized idempotency, optimistic revisions, partial edits, no-ops, safe tombstones and repeat removal',
  );

  const insertFile = async (
    parent,
    state = 'PENDING',
    bytes = 1024,
    expired = false,
  ) => {
    const id = randomUUID();
    await source.query(
      `INSERT INTO card_attachments(id,card_id,board_id,uploader_id,kind,state,display_name,original_filename,pending_key,storage_key,requested_mime_type,reserved_bytes,expires_at,created_at,mime_type,byte_size,verified_at)
      VALUES ($1::uuid,$2,$3,$4,'FILE',$5::varchar,'Private file','notes.txt','attachments/v1/pending/'||$1::text,'attachments/v1/active/'||$1::text,'text/plain',$6,now()+($7::int)*interval '1 minute',now()-interval '1 hour',CASE WHEN $5::varchar='ACTIVE' THEN 'text/plain' END,CASE WHEN $5::varchar='ACTIVE' THEN $6::bigint END,CASE WHEN $5::varchar='ACTIVE' THEN now() END)`,
      [
        id,
        parent.id,
        parent.boardId ?? board.id,
        actors.owner,
        state,
        bytes,
        expired ? -30 : 15,
      ],
    );
    return id;
  };
  const pending = await insertFile(card, 'PENDING', 1024, true),
    verified = await insertFile(card, 'ACTIVE', 2048);
  const list = (await send('viewer', 'get', attachments).expect(200)).body.data;
  assert.ok(!list.some((row) => row.id === pending));
  assert.ok(list.some((row) => row.id === verified));
  assert.doesNotMatch(
    JSON.stringify(list),
    /pendingKey|storageKey|expiresAt|reservedBytes|requestHash|requestedMimeType/,
  );
  await send('owner', 'get', `${attachments}/${pending}`).expect(404);
  await send('member', 'delete', `${attachments}/${pending}`).expect(404);
  await send('owner', 'get', `${attachments}/${pending}/file`).expect(404);
  await send('viewer', 'get', `${attachments}/${verified}/file`).expect(503);
  await send('owner', 'patch', `${attachments}/${verified}`)
    .send({ expectedRevision: 1, displayName: 'No files' })
    .expect(503);
  await send('owner', 'delete', `${attachments}/${verified}`).expect(503);
  let usage = await attachmentQuotaUsage(source.manager, board.id, card.id);
  assert.equal(usage.boardFileBytes, 3072n);
  await source.query(
    "UPDATE card_attachments SET state='EXPIRED',revision=revision+1 WHERE id=$1",
    [pending],
  );
  usage = await attachmentQuotaUsage(source.manager, board.id, card.id);
  assert.equal(usage.boardFileBytes, 2048n);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM card_attachment_cleanup_jobs WHERE attachment_id=$1',
        [pending],
      )
    )[0].n,
    2,
  );
  pass(
    'pending metadata is hidden, expired intents reserve until transition, verified file metadata is safe and transfer remains unavailable',
  );

  const constraint = async (sql, params, code = '23514') =>
    assert.rejects(
      source.query(sql, params),
      (e) => e.driverError?.code === code || e.code === code,
    );
  await constraint(
    "INSERT INTO card_attachments(card_id,board_id,uploader_id,kind,state,display_name,url) VALUES ($1,$2,$3,'URL','ACTIVE','Bad','https://example.com')",
    [card.id, foreignBoard.id, actors.owner],
    '23503',
  );
  for (const [kind, state, url] of [
    ['URL', 'PENDING', 'https://example.com'],
    ['URL', 'ACTIVE', 'http://example.com'],
    ['URL', 'ACTIVE', 'https://user:pass@example.com'],
    ['FILE', 'ACTIVE', null],
    ['BAD', 'ACTIVE', 'https://example.com'],
  ])
    await constraint(
      "INSERT INTO card_attachments(card_id,board_id,uploader_id,kind,state,display_name,url) VALUES ($1,$2,$3,$4,$5,'Bad',$6)",
      [card.id, board.id, actors.owner, kind, state, url],
    );
  await constraint('UPDATE card_attachments SET url=$2 WHERE id=$1', [
    first.id,
    'https://example.com/no-revision',
  ]);
  await constraint(
    'UPDATE card_attachments SET board_id=$2,revision=revision+1 WHERE id=$1',
    [first.id, foreignBoard.id],
  );
  await constraint(
    "UPDATE card_attachments SET state='ACTIVE',revision=revision+1 WHERE id=$1",
    [pending],
  );
  const freshPending = await insertFile(secondCard);
  await constraint(
    "UPDATE card_attachments SET state='ACTIVE',revision=revision+1 WHERE id=$1",
    [freshPending],
  );
  await constraint(
    "INSERT INTO card_attachments(card_id,board_id,uploader_id,kind,state,display_name,url,idempotency_key,request_hash) SELECT card_id,board_id,uploader_id,kind,'ACTIVE',display_name,url,idempotency_key,request_hash FROM card_attachments WHERE id=$1",
    [original.id],
    '23505',
  );
  const indices = (
    await source.query(
      "SELECT indexname FROM pg_indexes WHERE tablename='card_attachments'",
    )
  ).map((row) => row.indexname);
  for (const name of [
    'IDX_card_attachments_active_page',
    'IDX_card_attachments_board_state',
    'UQ_card_attachments_idempotency',
    'UQ_card_attachments_pending_key',
    'UQ_card_attachments_storage_key',
  ])
    assert.ok(indices.includes(name));
  await assert.rejects(
    source.undoLastMigration(),
    /Refusing to discard attachment metadata or cleanup obligations/,
  );
  pass(
    'native composite FK, lifecycle/shape/revision/idempotency constraints, scoped indexes and populated rollback refusal',
  );

  const pageCard = await createCard('Pagination');
  await source.query(
    `INSERT INTO card_attachments(card_id,board_id,uploader_id,kind,state,display_name,url,created_at) SELECT $1,$2,$3,'URL','ACTIVE','Page','https://example.com/'||i,'2026-01-01T00:00:00Z' FROM generate_series(1,5) i`,
    [pageCard.id, board.id, actors.owner],
  );
  const pageBase = attachments.replace(card.id, pageCard.id);
  const ids = [];
  for (let page = 1; page <= 3; page++) {
    const result = await send(
      'viewer',
      'get',
      pageBase + `?page=${page}&limit=2`,
    ).expect(200);
    assert.equal(result.body.meta.total, 5);
    ids.push(...result.body.data.map((row) => row.id));
  }
  assert.equal(new Set(ids).size, 5);
  assert.deepEqual(ids, [...ids].sort().reverse());
  const logQuery = source.logger.logQuery.bind(source.logger),
    selects = [];
  source.logger.logQuery = (query, ...args) => {
    if (/SELECT/i.test(query) && query.includes('card_attachments'))
      selects.push(query);
    return logQuery(query, ...args);
  };
  try {
    await send('viewer', 'get', pageBase + '?limit=2').expect(200);
  } finally {
    source.logger.logQuery = logQuery;
  }
  assert.ok(
    selects.length <= 2,
    `Expected bounded page/count queries, got ${selects.length}`,
  );
  for (const query of [
    'state=PENDING',
    'limit=101',
    'page=0',
    'page=9007199254740991&limit=100',
  ])
    await send('owner', 'get', pageBase + '?' + query).expect(400);
  pass(
    'stable tied-timestamp pagination, exact totals, strict query allowlists and bounded queries without N+1',
  );

  const beforeArchive = await source.query(
    'SELECT * FROM card_attachments WHERE card_id=$1 ORDER BY id',
    [card.id],
  );
  await cards.archive(actors.owner, board.id, card.id);
  await send('viewer', 'get', attachments).expect(200);
  await create().expect(409);
  await send('owner', 'delete', `${attachments}/${first.id}`).expect(409);
  await cards.restore(actors.owner, board.id, card.id);
  await send('owner', 'post', `/api/boards/${board.id}/archive`).expect(200);
  await send('viewer', 'get', attachments).expect(200);
  await create().expect(409);
  await send('owner', 'post', `/api/boards/${board.id}/restore`).expect(200);
  await cards.move(actors.owner, board.id, card.id, {
    columnId: secondColumn.id,
    beforeCardId: null,
  });
  assert.deepEqual(
    await source.query(
      'SELECT * FROM card_attachments WHERE card_id=$1 ORDER BY id',
      [card.id],
    ),
    beforeArchive,
  );
  pass(
    'Card/Board archive and restore retain every lifecycle record; column moves preserve association and readers',
  );

  await verifyAttachmentRaces(ctx);
  const destination = (
    await send('owner', 'post', '/api/workspaces')
      .send({ name: 'Destination' })
      .expect(201)
  ).body.data;
  const beforeMove = await source.query(
    'SELECT * FROM card_attachments WHERE card_id=$1 ORDER BY id',
    [card.id],
  );
  await send('owner', 'post', `/api/boards/${board.id}/move-workspace`)
    .send({ destinationWorkspaceId: destination.id })
    .expect(200);
  await send('viewer', 'get', attachments).expect(404);
  await send('guest', 'get', attachments).expect(200);
  assert.deepEqual(
    await source.query(
      'SELECT * FROM card_attachments WHERE card_id=$1 ORDER BY id',
      [card.id],
    ),
    beforeMove,
  );
  await send('owner', 'post', `/api/boards/${board.id}/move-workspace`)
    .send({ destinationWorkspaceId: team.id })
    .expect(200);
  await send('owner', 'patch', `/api/boards/${board.id}/visibility`)
    .send({ visibility: 'WORKSPACE_VISIBLE' })
    .expect(200);
  pass(
    'Board Move preserves attachment ownership and content while removing old Workspace-only read access',
  );
  await verifyAttachmentRealtime(ctx);

  const [orphanCard] = await source.query(
    'INSERT INTO board_columns(board_id,name,position) VALUES ($1,$2,100) RETURNING id',
    [foreignBoard.id, 'Cleanup'],
  );
  const [cascadeCard] = await source.query(
    'INSERT INTO cards(board_id,column_id,created_by_id,title,position) VALUES ($1,$2,$3,$4,100) RETURNING id,board_id AS "boardId"',
    [foreignBoard.id, orphanCard.id, actors.owner, 'Cleanup'],
  );
  const cascade = await insertFile(cascadeCard, 'ACTIVE');
  await source.query('DELETE FROM boards WHERE id=$1', [foreignBoard.id]);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM card_attachments WHERE id=$1',
        [cascade],
      )
    )[0].n,
    0,
  );
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM card_attachment_cleanup_jobs WHERE attachment_id=$1',
        [cascade],
      )
    )[0].n,
    2,
  );
  const jobs = await source.query(
    'SELECT * FROM card_attachment_cleanup_jobs WHERE attachment_id=$1',
    [cascade],
  );
  assert.ok(
    jobs.every(
      (row) =>
        row.not_before >= row.created_at &&
        row.next_attempt_at >= row.not_before,
    ),
  );
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries,
    [],
  );
  pass(
    'Board/Card cascading deletion retains both private-object cleanup obligations and final schema has zero ORM drift',
  );
  console.log(`Card attachments PostgreSQL suite: ${groups} groups passed`);
} finally {
  if (app) await app.close();
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
