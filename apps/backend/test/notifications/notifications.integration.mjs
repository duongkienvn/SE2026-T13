import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { URLSearchParams } from 'node:url';
import { verifyNotificationPersistence } from './notification-persistence-checks.mjs';
import { verifyNotificationContexts } from './notification-context-checks.mjs';
import { verifyNotificationRaces } from './notification-races.mjs';
import { verifyNotificationSockets } from './notification-sockets.mjs';

assert.equal(process.env.NOTIFICATION_DATABASE_TESTS, 'local-only');
assert.ok(
  ['127.0.0.1', 'localhost', '::1'].includes(process.env.DATABASE_HOST),
);
assert.notEqual(process.env.NODE_ENV, 'production');
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { Client } = require('pg'),
  { DataSource } = require('typeorm'),
  { Test } = require('@nestjs/testing'),
  { JwtService } = require('@nestjs/jwt');
const request = require('supertest');
const { databaseOptions } = require('../../dist/database/database-options.js');
const options = databaseOptions(process.env),
  name = `kanban_notifications_${randomBytes(8).toString('hex')}`;
const admin = new Client({ ...options, user: options.username });
let source,
  app,
  created = false,
  groups = 0;
const pass = (label) => {
  groups++;
  console.log(`PASS: ${label}`);
};
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  source = await new DataSource({ ...options, database: name }).initialize();
  const migrations = source.migrations;
  source.migrations = migrations.filter(
    (migration) =>
      !migration.name.startsWith('NotificationFoundation') &&
      !migration.name.startsWith('CommentMentions') &&
      !migration.name.startsWith('AccountDeletion'),
  );
  await source.runMigrations();
  const [legacyUser] = await source.query(
    `INSERT INTO users(email,display_name,email_verified_at) VALUES ('legacy@notifications.test','Legacy',now()) RETURNING id`,
  );
  const [legacyBoard] = await source.query(
    `INSERT INTO boards(name,created_by_id,background_preset) VALUES ('Keep legacy',$1,'forest') RETURNING id,workspace_id`,
    [legacyUser.id],
  );
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')`,
    [legacyBoard.id, legacyUser.id],
  );
  const [legacyColumn] = await source.query(
    `INSERT INTO board_columns(board_id,name,position) VALUES ($1,'Keep',100) RETURNING id`,
    [legacyBoard.id],
  );
  const [legacyCard] = await source.query(
    `INSERT INTO cards(board_id,column_id,created_by_id,title,position,due_date) VALUES ($1,$2,$3,'Keep',100,'2026-01-01T12:00:00Z') RETURNING id`,
    [legacyBoard.id, legacyColumn.id, legacyUser.id],
  );
  await source.query(
    'INSERT INTO card_assignees(card_id,user_id) VALUES ($1,$2)',
    [legacyCard.id, legacyUser.id],
  );
  await source.query(
    'INSERT INTO comments(card_id,author_id,content) VALUES ($1,$2,$3)',
    [legacyCard.id, legacyUser.id, 'Legacy @text'],
  );
  await source.query(
    `INSERT INTO user_preferences(user_id,time_zone) VALUES ($1,'America/New_York')`,
    [legacyUser.id],
  );
  await source.query(
    `INSERT INTO board_user_states(user_id,board_id,is_starred) VALUES ($1,$2,true)`,
    [legacyUser.id, legacyBoard.id],
  );
  const snapshot = async () => {
    const output = {};
    for (const table of [
      'users',
      'boards',
      'board_members',
      'board_columns',
      'cards',
      'card_assignees',
      'comments',
      'workspaces',
      'workspace_members',
      'user_preferences',
      'board_user_states',
    ])
      output[table] = await source.query(
        `SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY 1`,
      );
    return output;
  };
  const before = await snapshot();
  source.migrations = migrations;
  assert.equal((await source.runMigrations()).length, 3);
  assert.equal(
    (
      await source.query('SELECT count(*)::int AS count FROM comment_mentions')
    )[0].count,
    0,
  );
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await source.runMigrations(), []);
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries,
    [],
  );
  await assert.rejects(source.undoLastMigration(), /forward/);
  assert.deepEqual(await snapshot(), before);
  assert.equal(source.options.synchronize, false);
  assert.equal(source.options.migrationsRun, false);
  const fresh = `${name}_fresh`;
  await admin.query(`CREATE DATABASE "${fresh}"`);
  let freshSource;
  try {
    freshSource = await new DataSource({
      ...options,
      database: fresh,
    }).initialize();
    assert.equal((await freshSource.runMigrations()).length, migrations.length);
    assert.deepEqual(
      (await freshSource.driver.createSchemaBuilder().log()).upQueries,
      [],
    );
    assert.equal(
      await freshSource.getRepository('UserNotification').count(),
      0,
    );
  } finally {
    if (freshSource?.isInitialized) await freshSource.destroy();
    await admin.query(`DROP DATABASE "${fresh}"`);
  }
  pass(
    'fresh full chain, populated legacy upgrade preserves existing data, zero ORM drift, idempotent migration and forward-only rollback refusal',
  );
  Object.assign(process.env, {
    DATABASE_NAME: name,
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
  const { AppModule } = require('../../dist/app.module.js'),
    { configureHttpApplication } = require('../../dist/http-application.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(source)
    .compile();
  app = module.createNestApplication();
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');
  const load = (filename) => require(`../../dist/${filename}.js`);
  const { NotificationService } = load(
      'api/notifications/notification.service',
    ),
    { NotificationInboxService } = load(
      'api/notifications/notification-inbox.service',
    ),
    { NotificationPreferencesService } = load(
      'api/notifications/notification-preferences.service',
    ),
    { NotificationInvitationResolvers } = load(
      'api/notifications/notification-invitation-resolvers',
    ),
    { NotificationEventPublisher } = load(
      'realtime/notification-event-publisher.service',
    );
  const producer = app.get(NotificationService),
    inbox = app.get(NotificationInboxService),
    preferences = app.get(NotificationPreferencesService),
    resolvers = app.get(NotificationInvitationResolvers),
    publisher = app.get(NotificationEventPublisher),
    jwt = app.get(JwtService);
  assert.equal(
    await source.getRepository('UserNotification').count(),
    0,
    'app startup must never manufacture notifications',
  );
  const actors = {},
    tokens = {};
  const user = async (name) => {
    const [row] = await source.query(
      `INSERT INTO users(email,display_name,email_verified_at) VALUES ($1,$2,now()) RETURNING id`,
      [`${name}@notifications.test`, name],
    );
    actors[name] = row.id;
    tokens[name] = await jwt.signAsync({ sub: row.id });
    return row.id;
  };
  for (const actor of [
    'owner',
    'member',
    'guest',
    'viewer',
    'admin',
    'outsider',
    'pager',
    'other',
  ])
    await user(actor);
  const http = request(app.getHttpServer());
  const send = (actor, method, path) =>
    http[method](path)
      .auth(tokens[actor], { type: 'bearer' })
      .timeout({ deadline: 15000 });
  const list = async (actor, query = {}) =>
    (
      await send(
        actor,
        'get',
        `/api/notifications?${new URLSearchParams(query)}`,
      ).expect(200)
    ).body;
  const count = async (actor) =>
    (await send(actor, 'get', '/api/notifications/unread-count').expect(200))
      .body.data.count;
  const workspace = async (label) => {
    const [row] = await source.query(
      `INSERT INTO workspaces(type,name,created_by_id) VALUES ('TEAM',$1,$2) RETURNING id`,
      [label, actors.owner],
    );
    await source.query(
      `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN')`,
      [row.id, actors.owner],
    );
    return row.id;
  };
  const board = async (workspaceId, label, visibility = 'PRIVATE') => {
    const [row] = await source.query(
      `INSERT INTO boards(name,workspace_id,created_by_id,visibility) VALUES ($1,$2,$3,$4) RETURNING id`,
      [label, workspaceId, actors.owner, visibility],
    );
    await source.query(
      `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')`,
      [row.id, actors.owner],
    );
    const [column] = await source.query(
      `INSERT INTO board_columns(board_id,name,position) VALUES ($1,'Done',100) RETURNING id`,
      [row.id],
    );
    return { id: row.id, workspaceId, columnId: column.id };
  };
  let position = 0;
  const card = async (parent, title) => {
    const [row] = await source.query(
      `INSERT INTO cards(board_id,column_id,created_by_id,title,position) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [parent.id, parent.columnId, actors.owner, title, ++position * 100],
    );
    return row.id;
  };
  const record = (
    recipient,
    kind,
    context,
    occurrenceKey = randomUUID(),
    actor = 'owner',
  ) =>
    source.transaction((manager) =>
      producer.record(manager, {
        recipientUserId: actors[recipient],
        kind,
        occurrenceKey,
        actorUserId: actors[actor],
        ...context,
      }),
    );
  const context = {
    source,
    app,
    options,
    actors,
    tokens,
    user,
    send,
    list,
    count,
    workspace,
    board,
    card,
    record,
    producer,
    inbox,
    preferences,
    resolvers,
    publisher,
    jwt,
    http,
    load,
    pass,
  };
  await verifyNotificationPersistence(context);
  await verifyNotificationContexts(context);
  await verifyNotificationRaces(context);
  await verifyNotificationSockets(context);
  for (const path of [
    '/api/notifications',
    '/api/notifications/unread-count',
    '/api/users/me/notification-preferences',
  ])
    await http.get(path).expect(401);
  const doc = (await http.get('/api-docs-json').expect(200)).body;
  assert.ok(doc.paths['/api/notifications/{notificationId}/read'].patch);
  assert.ok(doc.paths['/api/users/me/notification-preferences'].patch);
  for (const query of [
    'filter=read',
    'limit=101',
    'page=0',
    'userId=other',
    'page=9007199254740991&limit=100',
  ])
    assert.equal(
      (await send('owner', 'get', `/api/notifications?${query}`).expect(400))
        .body.code,
      'VALIDATION_FAILED',
    );
  assert.equal(
    (await send('owner', 'get', '/api/notifications').expect(200)).headers[
      'cache-control'
    ],
    'no-store',
  );
  pass(
    'compiled full AppModule JWT, serialization, pagination validation, no-store and Swagger contracts',
  );
  console.log(
    `Notification PostgreSQL/HTTP/Socket.IO integration: ${groups} groups passed`,
  );
} finally {
  if (app) await app.close();
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
}
