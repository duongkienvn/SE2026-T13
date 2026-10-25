import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { checkPreferencesHttp } from './user-preferences-checks.mjs';

const require = createRequire(import.meta.url);
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { ConfigModule } = require('@nestjs/config');
const { TypeOrmModule } = require('@nestjs/typeorm');
const { ThrottlerModule } = require('@nestjs/throttler');
const { Test } = require('@nestjs/testing');
const { LoggerModule } = require('nestjs-pino');
const { databaseOptions } = require('../../dist/database/database-options.js');
const { validateEnvironment } = require('../../dist/config/environment.js');
const { configureHttpApplication } = require('../../dist/http-application.js');
const { UsersModule } = require('../../dist/api/users/users.module.js');
const { AuthService } = require('../../dist/api/auth/auth.service.js');
const {
  UserPreferencesService,
} = require('../../dist/api/users/user-preferences.service.js');
const {
  VerificationMailer,
  FakeVerificationMailer,
} = require('../../dist/mail/verification-mailer.js');
const {
  InitialDatabaseFoundation1791763200000: Initial,
} = require('../../dist/database/migrations/1791763200000-InitialDatabaseFoundation.js');
const {
  EmailVerification1792843200000: Email,
} = require('../../dist/database/migrations/1792843200000-EmailVerification.js');
const {
  BoardArchiveActivity1792843200001: Archive,
} = require('../../dist/database/migrations/1792843200001-BoardArchiveActivity.js');
const {
  GoogleIdentity1792850400000: Google,
} = require('../../dist/database/migrations/1792850400000-GoogleIdentity.js');
const {
  PasswordRecoverySecurity1792922400093: Recovery,
} = require('../../dist/database/migrations/1792922400093-PasswordRecoverySecurity.js');

const name = `kanvexa-preferences-test-${randomBytes(6).toString('hex')}`;
const password = randomBytes(32).toString('hex');
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    env: { ...process.env, POSTGRES_PASSWORD: password },
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
let source,
  app,
  started = false;
try {
  docker(
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--publish',
    '127.0.0.1::5432',
    '--env',
    'POSTGRES_PASSWORD',
    '--env',
    'POSTGRES_USER=preferences_test',
    '--env',
    'POSTGRES_DB=preferences_test',
    'postgres:16.15-alpine3.24',
  );
  started = true;
  const port = docker(
    'inspect',
    '--format',
    '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
    name,
  );
  const config = validateEnvironment({
    NODE_ENV: 'test',
    DATABASE_HOST: '127.0.0.1',
    DATABASE_PORT: port,
    DATABASE_NAME: 'preferences_test',
    DATABASE_USER: 'preferences_test',
    DATABASE_PASSWORD: password,
    JWT_SECRET: randomBytes(32).toString('hex'),
    GOOGLE_CLIENT_ID: '',
    LOG_LEVEL: 'silent',
  });
  const options = databaseOptions({
    ...config,
    DATABASE_PORT: port,
    DATABASE_SSL: 'false',
  });
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      source = await new DataSource({
        ...options,
        migrations: [Initial, Email, Archive, Google, Recovery],
      }).initialize();
      break;
    } catch (error) {
      if (attempt === 79) throw error;
      await delay(250);
    }
  }
  await source.runMigrations();
  const [legacy] =
    await source.query(`INSERT INTO users(email,password_hash,display_name,email_verified_at)
    VALUES('legacy@example.test','preserved-hash','Legacy',now()) RETURNING *`);
  await source.query(
    `INSERT INTO google_identities(user_id,google_sub) VALUES($1,'preserved-sub')`,
    [legacy.id],
  );
  await source.query(
    `INSERT INTO boards(name,created_by_id) VALUES('Preserved board',$1)`,
    [legacy.id],
  );
  const before = await source.query('SELECT * FROM users ORDER BY id');
  const boardsBefore = await source.query('SELECT * FROM boards ORDER BY id');
  const identitiesBefore = await source.query(
    'SELECT * FROM google_identities ORDER BY id',
  );
  await source.destroy();
  source = await new DataSource(options).initialize();
  assert.equal((await source.runMigrations()).length, 1);
  assert.deepEqual(
    await source.query('SELECT * FROM users ORDER BY id'),
    before,
  );
  assert.deepEqual(
    await source.query('SELECT * FROM boards ORDER BY id'),
    boardsBefore,
  );
  assert.deepEqual(
    await source.query('SELECT * FROM google_identities ORDER BY id'),
    identitiesBefore,
  );
  await source.undoLastMigration();
  assert.equal((await source.runMigrations()).length, 1);
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries.map(
      (q) => q.query,
    ),
    [],
    'No schema drift',
  );

  // A second empty database proves the full migration chain on a fresh install.
  await source.query('CREATE DATABASE preferences_fresh');
  const fresh = await new DataSource({
    ...options,
    database: 'preferences_fresh',
  }).initialize();
  try {
    assert.equal(
      (await fresh.runMigrations()).length,
      source.migrations.length,
    );
    assert.equal(
      (await fresh.query('SELECT count(*)::int AS n FROM user_preferences'))[0]
        .n,
      0,
    );
  } finally {
    await fresh.destroy();
  }

  const createApp = async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [() => config],
        }),
        TypeOrmModule.forRoot(options),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
        LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
        UsersModule,
      ],
    })
      .overrideProvider(VerificationMailer)
      .useValue(new FakeVerificationMailer())
      .compile();
    const application = module.createNestApplication({ logger: false });
    configureHttpApplication(application);
    await application.init();
    return application;
  };
  app = await createApp();
  await checkPreferencesHttp({ app, source, legacy, require });
  const saved = await app.get(UserPreferencesService).get(legacy.id);
  await app.close();
  app = await createApp();
  assert.deepEqual(
    await app.get(UserPreferencesService).get(legacy.id),
    saved,
    'Preferences survive a fresh Nest instance',
  );
  const auth = app.get(AuthService);
  const token = (
    await auth.issueLoginResponse(
      await source.getRepository('users').findOneByOrFail({ id: legacy.id }),
    )
  ).accessToken;
  const response = await require('supertest')(app.getHttpServer())
    .get('/api/users/me/preferences')
    .auth(token, { type: 'bearer' })
    .expect(200);
  assert.deepEqual(response.body.data, { ...saved });
  await assert.rejects(
    source.undoLastMigration(),
    /Cannot revert user preferences/,
  );
  assert.deepEqual(await app.get(UserPreferencesService).get(legacy.id), saved);
  console.log(
    'Preferences PostgreSQL: migration, rollback guard, constraints, concurrency, HTTP, isolation and restart PASS',
  );
} finally {
  await app?.close();
  if (source?.isInitialized) await source.destroy();
  if (started) docker('stop', name);
}
