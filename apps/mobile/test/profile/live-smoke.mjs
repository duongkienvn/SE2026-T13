// Explicitly local-only: owns a disposable PostgreSQL container, fake mailbox,
// ephemeral Nest listener and in-memory credential store. Never reads .env/AWS.
import assert from 'node:assert/strict';
import { Blob } from 'node:buffer';
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
import { createProfileApi } from '../../src/features/profile/api.ts';
import { createAvatarApi } from '../../src/features/profile/avatar-api.ts';
import { transferAvatar } from '../../src/features/profile/avatar.ts';
import { profileCommands } from '../../src/features/profile/mutations.ts';
import { createEmailChangeApi } from '../../src/features/profile/email-change.ts';

assert.notEqual(process.env.NODE_ENV, 'production');
const { AbortController, FormData, fetch } = globalThis;
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
const sharp = require('sharp');
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

const name = `kanvexa-mob37-${randomBytes(6).toString('hex')}`;
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
const rejected = (promise, status) =>
  assert.rejects(promise, (error) => error.status === status);
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
    'POSTGRES_USER=mob37_test',
    '--env',
    'POSTGRES_DB=mob37_test',
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
    DATABASE_NAME: 'mob37_test',
    DATABASE_USER: 'mob37_test',
    DATABASE_PASSWORD: databasePassword,
    DATABASE_SSL: 'false',
    JWT_SECRET: randomBytes(32).toString('hex'),
    PUBLIC_APP_URL: 'https://web.mob37.test',
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
  const password = 'Mob37LocalProof!2026';
  const users = source.getRepository(User),
    auth = app.get(AuthService);
  const passwordHash = await hash(password);
  const alice = await users.save(
    users.create({
      email: 'alice@mob37.test',
      displayName: 'Profile Tester',
      passwordHash,
      emailVerifiedAt: new Date(),
    }),
  );
  const bob = await users.save(
    users.create({
      email: 'bob@mob37.test',
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
    profile = createProfileApi(data.api, identity),
    avatars = createAvatarApi(data.api, identity),
    commands = profileCommands(data, identity);
  const first = await profile.get(signal());
  assert.equal(first.avatarRevision, 0);
  await commands.run('name', (api, abort) =>
    api.patch('  Native Profile  ', abort),
  );
  assert.equal(manager.getSnapshot().user.displayName, 'Native Profile');
  await rejected(async () => profile.patch('X', signal()), 400);
  console.log(
    'PASS: authenticated strict profile GET/PATCH, validation, server ACK and session metadata',
  );
  const bytes = await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#615cf7' },
  })
    .png()
    .toBuffer();
  const photo = {
    uri: 'file:///test-only/photo.png',
    filename: 'photo.png',
    contentType: 'image/png',
    fileSize: bytes.length,
    dispose() {},
  };
  const ports = {
    now: Date.now,
    externalFetch: fetch,
    multipart: (_file, fields) => ({
      kind: 'native-upload',
      createBody() {
        const body = new FormData();
        for (const [key, value] of Object.entries(fields))
          body.append(key, value);
        body.append(
          'file',
          new Blob([bytes], { type: 'image/png' }),
          'photo.png',
        );
        return body;
      },
    }),
  };
  async function upload(revision) {
    const intent = await avatars.intent(photo, revision, signal());
    assert.equal(intent.upload.kind, 'memory');
    await transferAvatar(avatars, intent, photo, ports, signal(), () =>
      data.assertCurrent(identity),
    );
    return commands.run('photo', (_api, abort) =>
      avatars.complete(intent.uploadId, abort),
    );
  }
  const uploaded = await upload(0);
  assert.equal(uploaded.avatarRevision, 1);
  const privateImage = await avatars.read(uploaded.avatarUrl, signal());
  assert.equal(privateImage.contentType, 'image/webp');
  assert.ok(
    privateImage.bytes.byteLength > 0 &&
      privateImage.bytes.byteLength <= 1048576,
  );
  const denied = await fetch(`${await app.getUrl()}/api${uploaded.avatarUrl}`, {
    headers: { Authorization: `Bearer ${other.accessToken}` },
  });
  assert.equal(denied.status, 404);
  await rejected(avatars.intent(photo, 0, signal()), 409);
  const replaced = await upload(1);
  assert.equal(replaced.avatarRevision, 2);
  await rejected(avatars.read(uploaded.avatarUrl, signal()), 404);
  const removed = await commands.run('remove', (_api, abort) =>
    avatars.remove(2, abort),
  );
  assert.equal(removed.avatarRevision, 3);
  assert.equal(removed.avatarUrl, null);
  console.log(
    'PASS: real multipart intent/transfer/complete, private bounded WebP GET, outsider denial, CAS conflict, replacement and removal',
  );
  const changes = createEmailChangeApi(data.api, identity);
  assert.deepEqual(await changes.providers(signal()), {
    hasPassword: true,
    googleLinked: false,
  });
  await rejected(
    changes.request(
      { newEmail: 'new@mob37.test', currentPassword: 'wrong' },
      alice.email,
      signal(),
    ),
    403,
  );
  assert.equal(manager.getSnapshot().status, 'authenticated');
  assert.equal(
    await changes.request(
      { newEmail: 'new@mob37.test', currentPassword: password },
      alice.email,
      signal(),
    ),
    null,
  );
  const pending = await changes.pending(signal());
  assert.equal(pending.maskedNewEmail, 'n***@m***');
  assert.equal('newEmail' in pending, false);
  assert.equal('token' in pending, false);
  const delivery = mailer.proofs.at(-1);
  assert.ok(delivery);
  const link = new URL(delivery.url);
  assert.equal(link.origin, config.PUBLIC_APP_URL);
  assert.equal(link.pathname, '/confirm-email-change');
  // Simulates the existing Web client, not a mobile token handler.
  const confirmed = await fetch(
    `${await app.getUrl()}/api/auth/email-change/confirm`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${login.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: link.searchParams.get('token') }),
    },
  );
  assert.equal(confirmed.status, 204);
  await rejected(profile.get(signal()), 401);
  assert.equal(manager.getSnapshot().status, 'unauthenticated');
  await delay(0);
  assert.equal(stored.size, 0);
  assert.equal(
    data.queryClient.getQueriesData({ queryKey: queryKeys.private }).length,
    0,
  );
  assert.equal(
    (await users.findOneByOrFail({ id: alice.id })).email,
    'new@mob37.test',
  );
  console.log(
    'PASS: real password proof, generic 202, masked pending, trusted Web confirmation, revoked mobile JWT and protected-cache/credential cleanup',
  );
} finally {
  data?.dispose();
  manager?.dispose();
  await app?.close();
  if (source?.isInitialized) await source.destroy();
  if (started) docker('rm', '--force', name);
}
