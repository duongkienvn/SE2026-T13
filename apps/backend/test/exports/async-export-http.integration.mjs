import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
assert.equal(process.env.EXPORT_DATABASE_TESTS, 'local-only');
assert.equal(process.env.DATABASE_HOST, '127.0.0.1');
assert.equal(process.env.DATABASE_PORT, '55454');
assert.equal(process.env.DATABASE_NAME, 'vt054_test');
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
  BoardExportService,
} = require('../../dist/api/exports/board-export.service.js');
const options = databaseOptions(process.env);
const admin = new Client({ ...options, user: options.username });
const database = `vt054_http_${randomBytes(8).toString('hex')}`;
let source,
  app,
  created = false,
  release,
  groups = 0;
const pass = (label) => {
  groups++;
  console.log(`PASS ${label}`);
};
const privacy = (response) => {
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(response.headers.pragma, 'no-cache');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
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
    ATTACHMENT_STORAGE_DRIVER: 'disabled',
    GOOGLE_CLIENT_ID: '',
    TASK_NOTIFICATION_EMAIL_ENABLED: 'false',
    TASK_NOTIFICATION_JOBS_ENABLED: 'false',
    CORS_ORIGINS: process.env.VT054_BROWSER_URL || 'http://localhost:5173',
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
  await app.listen(
    Number(process.env.VT054_BROWSER_HTTP_PORT || 0),
    '127.0.0.1',
  );
  const http = request(app.getHttpServer()),
    jwt = app.get(JwtService);
  const users = {},
    tokens = {};
  for (const name of ['owner', 'other', 'member', 'outsider', 'unverified']) {
    [users[name]] = await source.query(
      'INSERT INTO users(email,display_name,email_verified_at) VALUES ($1,$2,$3) RETURNING *',
      [
        `${name}@vt054-http.test`,
        name,
        name === 'unverified' ? null : new Date(),
      ],
    );
    tokens[name] = await jwt.signAsync({ sub: users[name].id });
  }
  const [workspace] = await source.query(
    "INSERT INTO workspaces(type,name,created_by_id) VALUES ('TEAM','HTTP export',$1) RETURNING id",
    [users.owner.id],
  );
  const [board] = await source.query(
    "INSERT INTO boards(name,created_by_id,workspace_id) VALUES ('HTTP export',$1,$2) RETURNING id",
    [users.owner.id, workspace.id],
  );
  for (const name of ['owner', 'other', 'member'])
    await source.query(
      'INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,$3)',
      [board.id, users[name].id, name === 'member' ? 'MEMBER' : 'OWNER'],
    );
  const route = `/api/boards/${board.id}/export-jobs`;
  const send = (method, path, who = 'owner') =>
    http[method](path)
      .auth(tokens[who], { type: 'bearer' })
      .timeout({ deadline: 15000 });
  const start = (
    key = randomUUID(),
    who = 'owner',
    body = { format: 'json' },
  ) => send('post', route, who).set('Idempotency-Key', key).send(body);
  const poll = async (id, state = 'COMPLETED') => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const response = await send('get', `${route}/${id}`).expect(200);
      privacy(response);
      if (response.body.state === state) return response.body;
      assert.notEqual(
        response.body.state,
        state === 'FAILED' ? 'COMPLETED' : 'FAILED',
        JSON.stringify(response.body),
      );
      await delay(20);
    }
    assert.fail(`Job did not reach ${state} within observation deadline`);
  };
  const boards = app.get(BoardExportService),
    original = boards.create.bind(boards);
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  boards.create = async (...args) => {
    calls++;
    await gate;
    return original(...args);
  };
  const key = randomUUID();
  const accepted = await start(key).expect(202);
  privacy(accepted);
  const id = accepted.body.id;
  assert.match(
    id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.deepEqual(
    Object.keys(accepted.body).sort(),
    [
      'id',
      'state',
      'format',
      'attempts',
      'expiresAt',
      'progress',
      'error',
    ].sort(),
  );
  const replay = await start(key).expect(202);
  assert.equal(replay.body.id, id);
  await send('get', `${route}/${id}/download`).expect(409);
  release();
  await poll(id);
  const file = await send('get', `${route}/${id}/download`).expect(200);
  privacy(file);
  assert.equal(file.body.board.id, board.id);
  assert.match(file.headers['content-disposition'], /attachment/);
  assert.equal(calls, 1);
  pass(
    'TC01/02/08/09: JWT HTTP acknowledgement before gated work; actual scheduler, same-key replay, progress and real JSON download',
  );
  boards.create = original;
  const conflicted = await start(key, 'owner', { format: 'csv' }).expect(409);
  privacy(conflicted);
  for (const body of [
    { format: 'zip' },
    { format: null },
    { format: 'json', userId: users.other.id },
  ])
    privacy(await start(randomUUID(), 'owner', body).expect(400));
  privacy(await start('invalid-key').expect(400));
  privacy(await send('post', route).send({ format: 'json' }).expect(400));
  privacy(await send('get', `${route}/not-a-uuid`).expect(400));
  pass(
    'TC04/05: payload conflict, malformed key/body/id and validation privacy',
  );
  for (const who of ['member', 'outsider', 'unverified']) {
    const status = who === 'member' ? 403 : who === 'outsider' ? 404 : 401;
    privacy(await start(randomUUID(), who).expect(status));
  }
  privacy(await http.post(route).send({ format: 'json' }).expect(401));
  privacy(await send('get', `${route}/${id}`, 'other').expect(404));
  privacy(await send('get', `${route}/${id}/download`, 'other').expect(404));
  pass(
    'TC06/07: real JWT, verified identity, owner gate and private job isolation',
  );
  boards.create = async () => {
    throw new Error('SELECT internal secret-password');
  };
  const fail = await start().expect(202);
  await poll(fail.body.id, 'FAILED');
  const failed = await send('get', `${route}/${fail.body.id}`).expect(200);
  assert.equal(failed.body.error, 'EXPORT_FAILED');
  assert.ok(!JSON.stringify(failed.body).includes('secret-password'));
  boards.create = original;
  const retried = await send('post', `${route}/${fail.body.id}/retry`)
    .send()
    .expect(202);
  assert.equal(retried.body.id, fail.body.id);
  await poll(fail.body.id);
  assert.equal(
    (await send('get', `${route}/${fail.body.id}`)).body.attempts,
    2,
  );
  pass(
    'TC10: scheduler failure sanitized and explicit retry completes using same job',
  );
  if (process.env.VT054_BROWSER_URL) {
    const { browserJourney } = await import('./async-export.browser.mjs');
    await browserJourney({
      backendUrl: await app.getUrl(),
      token: tokens.owner,
      boardId: board.id,
      boards,
    });
  }
  if (process.env.VT054_LOAD === '1') {
    const { runExportLoad } = await import('./async-export-load.mjs');
    await runExportLoad({
      baseUrl: await app.getUrl(),
      token: tokens.owner,
      boardId: board.id,
      source,
    });
  }
  await source.query(
    "UPDATE board_members SET role='MEMBER' WHERE board_id=$1 AND user_id=$2",
    [board.id, users.owner.id],
  );
  privacy(await send('get', `${route}/${id}/download`).expect(403));
  await source.query(
    "UPDATE board_members SET role='OWNER' WHERE board_id=$1 AND user_id=$2",
    [board.id, users.owner.id],
  );
  await source.query(
    'UPDATE users SET auth_version=auth_version+1 WHERE id=$1',
    [users.owner.id],
  );
  privacy(await send('get', `${route}/${id}`).expect(401));
  pass('TC13: download rechecks current owner and JWT session invalidation');
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries,
    [],
  );
  console.log(
    `Async export real JWT HTTP/worker suite: ${groups} groups passed`,
  );
} finally {
  release?.();
  if (app) await app.close();
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
