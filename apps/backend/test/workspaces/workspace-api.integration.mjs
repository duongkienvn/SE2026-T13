import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { verifyLifecycle } from './workspace-api.lifecycle.mjs';
import { verifyPrivacy, verifyMemberCounts } from './workspace-api.privacy.mjs';
import { verifyConcurrency } from './workspace-api.concurrency.mjs';
import { verifyWorkspaceActivity } from './workspace-activity.integration.mjs';

// Never load connection credentials from .env; only an explicitly opted-in local server.
assert.equal(process.env.WORKSPACE_DATABASE_TESTS, 'local-only');
assert.ok(
  ['127.0.0.1', 'localhost', '::1'].includes(process.env.DATABASE_HOST),
);
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const request = require('supertest');
const { databaseOptions } = require('../../dist/database/database-options.js');
const options = databaseOptions(process.env);
const admin = new Client({
  host: options.host,
  port: options.port,
  user: options.username,
  password: options.password,
  database: options.database,
  ssl: options.ssl,
});
const name = `kanban_workspace_api_${randomBytes(8).toString('hex')}`;
let source;
let app;
let created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  source = await new DataSource({ ...options, database: name }).initialize();
  // Exercise historical rollback assertions before installing the forward-only
  // extension, then run every API check against the complete current schema.
  const allMigrations = source.migrations;
  source.migrations = allMigrations.filter(
    (migration) =>
      !migration.name.startsWith('NotificationFoundation') &&
      !migration.name.startsWith('CommentMentions') &&
      !migration.name.startsWith('TaskNotificationEmailOutbox') &&
      !migration.name.startsWith('EmailChangeSecurity') &&
      !migration.name.startsWith('AccountDeletion'),
  );
  await source.runMigrations();
  await source.undoLastMigration(); // Empty Board background version extension.
  await source.undoLastMigration(); // Empty Board discovery extension.
  await source.undoLastMigration(); // Empty private-file extension.
  await source.undoLastMigration(); // Empty attachment foundation.
  await source.undoLastMigration(); // Empty Card start-date extension.
  await source.undoLastMigration(); // Empty Board label extension.
  await source.undoLastMigration(); // Empty checklist extension.
  await source.undoLastMigration(); // Future naming default only; no row changes.
  await source.undoLastMigration(); // Empty Workspace activity history.
  await source.undoLastMigration(); // No decline history yet; exercise the policy boundary below.
  await assert.rejects(
    source.undoLastMigration(),
    /Workspace policies require a forward fix/,
  );
  assert.equal((await source.runMigrations()).length, 10);
  source.migrations = allMigrations.filter(
    (m) =>
      !m.name.startsWith('EmailChangeSecurity') &&
      !m.name.startsWith('AccountDeletion'),
  );
  assert.equal((await source.runMigrations()).length, 3);
  await assert.rejects(
    source.undoLastMigration(),
    /Task notification email outbox requires a forward fix/,
  );
  source.migrations = allMigrations.filter(
    (m) => !m.name.startsWith('AccountDeletion'),
  );
  assert.equal((await source.runMigrations()).length, 1);
  await assert.rejects(
    source.undoLastMigration(),
    /Email change security is forward-only/,
  );
  source.migrations = allMigrations;
  assert.equal((await source.runMigrations()).length, 1);
  await assert.rejects(
    source.undoLastMigration(),
    /Account deletion is forward-only/,
  );
  assert.deepEqual(await source.runMigrations(), []);
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries,
    [],
  );
  Object.assign(process.env, {
    DATABASE_NAME: name,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    API_PREFIX: 'api',
    JWT_SECRET: randomBytes(32).toString('hex'),
    RATE_LIMIT_MAX: '10000',
    GOOGLE_CLIENT_ID: '',
    AVATAR_STORAGE_DRIVER: 'disabled',
    MAIL_TRANSPORT: 'fake',
    SWAGGER_ENABLED: 'true',
  });
  const { AppModule } = require('../../dist/app.module.js');
  const {
    configureHttpApplication,
  } = require('../../dist/http-application.js');
  app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  configureHttpApplication(app);
  await app.init();
  assert.equal(app.get(DataSource).options.database, name);
  const actors = {};
  const tokens = {};
  const jwt = app.get(JwtService);
  for (const role of ['admin', 'member', 'guest', 'outsider']) {
    const [user] = await source.query(
      `INSERT INTO users(email,display_name,email_verified_at)
      VALUES ($1,$1,now()) RETURNING id`,
      [`${role}@workspace-api.example.test`],
    );
    actors[role] = user.id;
    tokens[role] = await jwt.signAsync({ sub: user.id });
  }
  const http = request(app.getHttpServer());
  const send = (actor, method, path) =>
    http[method](path).set('Authorization', `Bearer ${tokens[actor]}`);
  const context = {
    source,
    runtimeSource: app.get(DataSource),
    app,
    http,
    jwt,
    actors,
    tokens,
    send,
  };
  await verifyWorkspaceActivity(context);
  await verifyLifecycle(context);
  await verifyPrivacy(context);
  await verifyMemberCounts(context);
  await verifyConcurrency(context);
  console.log(
    'Workspace API PostgreSQL/HTTP lifecycle, ACL, rollback, races and compatibility: PASS',
  );
} finally {
  if (app) await app.close();
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
}
