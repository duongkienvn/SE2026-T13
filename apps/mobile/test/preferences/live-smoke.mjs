// Explicitly local-only: owns a disposable PostgreSQL container, fake mailbox,
// ephemeral Nest listener and in-memory credential store. Never reads .env/AWS.
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { createHttpClient } from '../../src/infrastructure/api/client.ts';
import { createCredentialStore } from '../../src/infrastructure/auth/credential-store.ts';
import { createSessionManager } from '../../src/infrastructure/auth/session-manager.ts';
import { createTransportSessionApi } from '../../src/infrastructure/auth/session-api.ts';
import {
  systemClock,
  systemTimers,
} from '../../src/infrastructure/auth/clock.ts';
import { createMobileDataLayer } from '../../src/infrastructure/query/data-layer.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { preferencesApi } from '../../src/features/preferences/api.ts';
import { preferencesCommands } from '../../src/features/preferences/commands.ts';
import {
  formatInstantDate,
  formatTimeIn,
} from '../../../frontend/src/features/settings/format.ts';
import { describeCardDate } from '../../src/features/cards/metadata/dates.ts';

assert.notEqual(process.env.NODE_ENV, 'production');
const { AbortController, fetch } = globalThis;
const require = createRequire(
  new URL('../../../backend/package.json', import.meta.url),
);
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { ConfigModule } = require('@nestjs/config');
const { TypeOrmModule } = require('@nestjs/typeorm');
const { ThrottlerModule } = require('@nestjs/throttler');
const { Test } = require('@nestjs/testing');
const { LoggerModule } = require('nestjs-pino');
const { hash } = require('argon2');
const { databaseOptions } = require('./dist/database/database-options.js');
const { validateEnvironment } = require('./dist/config/environment.js');
const { configureHttpApplication } = require('./dist/http-application.js');
const { UsersModule } = require('./dist/api/users/users.module.js');
const { AuthModule } = require('./dist/api/auth/auth.module.js');
const { AuthService } = require('./dist/api/auth/auth.service.js');
const { User } = require('./dist/api/users/entities/user.entity.js');
const {
  EmailChangeMailer,
  FakeEmailChangeMailer,
} = require('./dist/mail/email-change-mailer.js');

const name = `kanvexa-mob38-${randomBytes(6).toString('hex')}`;
const databasePassword = randomBytes(32).toString('hex');
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    env: { ...process.env, POSTGRES_PASSWORD: databasePassword },
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
let source,
  app,
  manager,
  data,
  started = false;
const signal = () => new AbortController().signal;
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
    'POSTGRES_USER=mob38_test',
    '--env',
    'POSTGRES_DB=mob38_test',
    'postgres:16-alpine',
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
    DATABASE_NAME: 'mob38_test',
    DATABASE_USER: 'mob38_test',
    DATABASE_PASSWORD: databasePassword,
    DATABASE_SSL: 'false',
    JWT_SECRET: randomBytes(32).toString('hex'),
    PUBLIC_APP_URL: 'https://web.mob38.test',
    MAIL_TRANSPORT: 'fake',
    GOOGLE_CLIENT_ID: '',
    LOG_LEVEL: 'silent',
    AVATAR_STORAGE_DRIVER: 'memory',
    ATTACHMENT_STORAGE_DRIVER: 'disabled',
    TASK_NOTIFICATION_JOBS_ENABLED: 'false',
    TASK_NOTIFICATION_EMAIL_ENABLED: 'false',
  });
  const options = databaseOptions({
    ...config,
    DATABASE_PORT: port,
    DATABASE_SSL: 'false',
  });
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      source = await new DataSource(options).initialize();
      break;
    } catch (error) {
      if (attempt === 79) throw error;
      await delay(250);
    }
  }
  await source.runMigrations();
  const mailer = new FakeEmailChangeMailer(config.PUBLIC_APP_URL);
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        load: [() => config],
      }),
      TypeOrmModule.forRoot(options),
      ThrottlerModule.forRoot([{ ttl: 60000, limit: 10000 }]),
      LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
      UsersModule,
      AuthModule,
    ],
  })
    .overrideProvider(DataSource)
    .useValue(source)
    .overrideProvider(EmailChangeMailer)
    .useValue(mailer)
    .compile();
  app = module.createNestApplication({ logger: false });
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');
  const password = 'Mob38LocalProof!2026';
  const users = source.getRepository(User),
    auth = app.get(AuthService);
  const passwordHash = await hash(password);
  const alice = await users.save(
    users.create({
      email: 'alice@mob38.test',
      displayName: 'Preference Tester',
      passwordHash,
      emailVerifiedAt: new Date(),
    }),
  );
  const bob = await users.save(
    users.create({
      email: 'bob@mob38.test',
      displayName: 'Other Tester',
      passwordHash,
      emailVerifiedAt: new Date(),
    }),
  );
  const login = await auth.issueLoginResponse(alice),
    other = await auth.issueLoginResponse(bob);
  const transport = createHttpClient({
    baseUrl: new URL(`${await app.getUrl()}/api`),
    allowInsecureLocal: true,
    fetch,
  });
  const stored = new Map();
  manager = createSessionManager({
    api: createTransportSessionApi(transport),
    clock: systemClock,
    timers: systemTimers,
    store: createCredentialStore({
      getItemAsync: async (key) => stored.get(key) ?? null,
      setItemAsync: async (key, value) => {
        stored.set(key, value);
      },
      deleteItemAsync: async (key) => {
        stored.delete(key);
      },
    }),
  });
  data = createMobileDataLayer(manager, transport);
  assert.equal((await manager.establishSession(login)).ok, true);
  const identity = data.getIdentity(),
    api = preferencesApi(data.api, identity),
    commands = preferencesCommands(data, identity);
  const defaults = {
    theme: 'system',
    timeZone: 'UTC',
    dateFormat: 'YYYY-MM-DD',
    weekStartsOn: 'monday',
  };
  assert.deepEqual(await api.get(signal()), defaults);
  assert.equal(
    (await source.query('SELECT count(*)::int AS n FROM user_preferences'))[0]
      .n,
    0,
  );
  const web = async (patch, token = login.accessToken) => {
    const response = await fetch(
      `${await app.getUrl()}/api/users/me/preferences`,
      {
        method: patch === undefined ? 'GET' : 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        ...(patch === undefined ? {} : { body: JSON.stringify(patch) }),
      },
    );
    return { status: response.status, body: await response.json() };
  };
  for (const invalid of [
    {},
    { theme: null },
    { theme: 'blue' },
    { language: 'en' },
    { timeZone: '+07:00' },
    { timeZone: 'GMT+7' },
    { weekStartsOn: 'saturday' },
  ])
    assert.equal((await web(invalid)).status, 400);
  await commands.chooseTheme('dark');
  assert.equal(commands.getSnapshot().saved, true);
  assert.deepEqual((await web()).body.data, { ...defaults, theme: 'dark' });
  await web({ timeZone: 'America/New_York', dateFormat: 'DD/MM/YYYY' });
  assert.deepEqual(await commands.refresh(), {
    ...defaults,
    theme: 'dark',
    timeZone: 'America/New_York',
    dateFormat: 'DD/MM/YYYY',
  });
  // Two independent clients change disjoint leaves. Both survive server row locking.
  await Promise.all([
    commands.save({ weekStartsOn: 'sunday' }),
    web({ theme: 'light' }),
  ]);
  const confirmed = await commands.refresh();
  assert.deepEqual(confirmed, {
    theme: 'light',
    timeZone: 'America/New_York',
    dateFormat: 'DD/MM/YYYY',
    weekStartsOn: 'sunday',
  });
  for (const instant of [
    '2024-02-29T00:30:00Z',
    '2026-03-08T06:30:00Z',
    '2026-03-08T07:30:00Z',
    '2026-11-01T05:30:00Z',
    '2026-11-01T06:30:00Z',
    '2026-12-31T23:30:00Z',
  ])
    assert.equal(
      describeCardDate(instant, confirmed).short,
      `${formatInstantDate(new Date(instant), confirmed.dateFormat, confirmed.timeZone)} · ${formatTimeIn(new Date(instant), confirmed.timeZone)}`,
    );
  assert.deepEqual(
    (await web(undefined, other.accessToken)).body.data,
    defaults,
  );
  assert.equal((await web(undefined, 'invalid')).status, 401);
  assert.deepEqual(
    data.queryClient.getQueryData(queryKeys.datePreferences(identity)),
    confirmed,
  );
  await manager.establishSession(other);
  assert.equal(
    data.queryClient.getQueryData(queryKeys.datePreferences(identity)),
    undefined,
  );
  assert.deepEqual(
    await preferencesApi(data.api, data.getIdentity()).get(signal()),
    defaults,
  );
  await assert.rejects(
    api.get(signal()),
    (error) => error.kind === 'session-changed',
  );
  console.log(
    'PASS: real Nest/PostgreSQL defaults without insert, strict validation, sparse native/Web writes, concurrent fields, authoritative revalidation, DST/date parity and session isolation',
  );
} finally {
  data?.dispose();
  manager?.dispose();
  await app?.close();
  if (source?.isInitialized) await source.destroy();
  if (started) docker('rm', '--force', name);
}
