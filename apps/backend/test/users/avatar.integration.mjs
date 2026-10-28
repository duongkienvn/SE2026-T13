// Creates/removes its own container. Ignores .env and never constructs an AWS client.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { ConfigModule } = require('@nestjs/config');
const { APP_GUARD } = require('@nestjs/core');
const { TypeOrmModule } = require('@nestjs/typeorm');
const { ThrottlerModule } = require('@nestjs/throttler');
const { Test } = require('@nestjs/testing');
const { LoggerModule } = require('nestjs-pino');
const sharp = require('sharp');
const request = require('supertest');
const { hash } = require('argon2');
const { databaseOptions } = require('../../dist/database/database-options.js');
const { validateEnvironment } = require('../../dist/config/environment.js');
const { configureHttpApplication } = require('../../dist/http-application.js');
const { UsersModule } = require('../../dist/api/users/users.module.js');
const { AuthService } = require('../../dist/api/auth/auth.service.js');
const {
  HttpThrottlerGuard,
} = require('../../dist/guards/http-throttler.guard.js');
const {
  AvatarService,
} = require('../../dist/api/users/avatars/avatar.service.js');
const {
  AvatarImageService,
} = require('../../dist/api/users/avatars/avatar-image.service.js');
const {
  avatarError,
} = require('../../dist/api/users/avatars/avatar.constants.js');
const {
  AvatarStorage,
} = require('../../dist/api/users/avatars/avatar-storage.js');
const {
  PrivateAvatars1793102400103,
} = require('../../dist/database/migrations/1793102400103-PrivateAvatars.js');
const { User } = require('../../dist/api/users/entities/user.entity.js');
const {
  AvatarUpload,
} = require('../../dist/api/users/entities/avatar-upload.entity.js');

const name = `kanvexa-avatar-test-${randomBytes(6).toString('hex')}`;
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
    'POSTGRES_USER=avatar_test',
    '--env',
    'POSTGRES_DB=avatar_test',
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
    DATABASE_NAME: 'avatar_test',
    DATABASE_USER: 'avatar_test',
    DATABASE_PASSWORD: password,
    JWT_SECRET: randomBytes(32).toString('hex'),
    GOOGLE_CLIENT_ID: '',
    LOG_LEVEL: 'silent',
    AVATAR_STORAGE_DRIVER: 'memory',
    CORS_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173',
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
  const avatarMigration = source.migrations.find(
    (m) => m instanceof PrivateAvatars1793102400103,
  );
  source.migrations = source.migrations.filter((m) => m !== avatarMigration);
  await source.runMigrations();
  const [legacy] =
    await source.query(`INSERT INTO users(email,password_hash,display_name,avatar_url,email_verified_at)
    VALUES('legacy@example.test','preserved-hash','Legacy','https://images.example.test/legacy.jpg',now()) RETURNING *`);
  const [board] = await source.query(
    `INSERT INTO boards(name,created_by_id) VALUES('Private board',$1) RETURNING *`,
    [legacy.id],
  );
  source.migrations.push(avatarMigration);
  assert.equal((await source.runMigrations()).length, 1);
  const [upgraded] = await source.query('SELECT * FROM users WHERE id=$1', [
    legacy.id,
  ]);
  assert.deepEqual(upgraded, {
    ...legacy,
    avatar_object_key: null,
    avatar_revision: 0,
  });
  assert.equal(
    (await source.query('SELECT * FROM boards WHERE id=$1', [board.id]))[0]
      .name,
    'Private board',
  );
  // Exercise this migration explicitly; newer migrations may be applied after it.
  await source.transaction(async (manager) => {
    await avatarMigration.down(manager.queryRunner);
    await avatarMigration.up(manager.queryRunner);
  });
  assert.equal((await source.runMigrations()).length, 0);
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries.map(
      (q) => q.query,
    ),
    [],
    'No entity/schema drift',
  );
  await source.query('CREATE DATABASE avatar_fresh');
  const fresh = await new DataSource({
    ...options,
    database: 'avatar_fresh',
  }).initialize();
  try {
    assert.equal(
      (await fresh.runMigrations()).length,
      source.migrations.length,
    );
  } finally {
    await fresh.destroy();
  }

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        load: [() => config],
      }),
      TypeOrmModule.forRoot(options),
      ThrottlerModule.forRoot([{ ttl: 60_000, limit: 240 }]),
      LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
      UsersModule,
    ],
    providers: [{ provide: APP_GUARD, useClass: HttpThrottlerGuard }],
  }).compile();
  app = module.createNestApplication({ logger: false });
  const signalNames = ['SIGINT', 'SIGTERM'];
  const priorListeners = new Map(
    signalNames.map((signal) => [signal, process.listeners(signal)]),
  );
  configureHttpApplication(app);
  if (process.argv.includes('--serve')) {
    // The QA harness owns shutdown so its DB/container finally block finishes
    // before Nest's production hook re-emits a termination signal.
    for (const signal of signalNames) {
      for (const listener of process.listeners(signal)) {
        if (!priorListeners.get(signal).includes(listener))
          process.removeListener(signal, listener);
      }
    }
  }
  await app.init();
  const avatars = app.get(AvatarService),
    storage = app.get(AvatarStorage),
    auth = app.get(AuthService);
  assert.equal(storage.kind, 'memory');
  const users = source.getRepository(User),
    uploads = source.getRepository(AvatarUpload);
  const passwordHash = await hash('AvatarQA!2026');
  const makeUser = (patch = {}) =>
    users.save(
      users.create({
        email: `${randomUUID()}@example.test`,
        displayName: 'Avatar Tester',
        passwordHash,
        emailVerifiedAt: new Date(),
        avatarUrl: null,
        ...patch,
      }),
    );
  const alice = await makeUser(),
    bob = await makeUser();
  const token = (await auth.issueLoginResponse(alice)).accessToken;
  const bToken = (await auth.issueLoginResponse(bob)).accessToken;
  const png = await sharp({
    create: { width: 700, height: 600, channels: 3, background: '#7c3aed' },
  })
    .png()
    .toBuffer();
  const intent = async (user, body = png, mime = 'image/png') => {
    const current = await users.findOneByOrFail({ id: user.id });
    const target = await avatars.createIntent(user.id, {
      expectedRevision: current.avatarRevision,
      contentType: mime,
      fileSize: body.length,
    });
    await avatars.receiveLocal(user.id, target.uploadId, body, mime);
    return {
      ...target,
      row: await uploads.findOneByOrFail({ id: target.uploadId }),
    };
  };
  const expire = (id) =>
    uploads.update(id, {
      createdAt: new Date(Date.now() - 7200000),
      expiresAt: new Date(Date.now() - 3600000),
      nextCleanupAt: new Date(0),
    });
  const rejectsCode = (promise, code) =>
    assert.rejects(promise, (error) => error.response?.code === code);
  const api = () => request(app.getHttpServer());
  for (const [method, path] of [
    ['post', '/api/users/me/avatar/uploads'],
    ['post', `/api/users/me/avatar/uploads/${randomUUID()}/complete`],
    ['delete', '/api/users/me/avatar'],
    ['get', `/api/users/${alice.id}/avatar/${randomUUID()}`],
    ['post', `/api/users/me/avatar/uploads/${randomUUID()}/file`],
  ]) {
    await api()[method](path).expect(401);
  }
  for (const extra of [
    { userId: bob.id },
    { key: 'arbitrary' },
    { fileSize: 5242881 },
    { contentType: 'image/svg+xml' },
  ]) {
    await api()
      .post('/api/users/me/avatar/uploads')
      .auth(token, { type: 'bearer' })
      .send({
        contentType: 'image/png',
        fileSize: png.length,
        expectedRevision: 0,
        ...extra,
      })
      .expect(400);
  }
  for (const patch of [
    { avatarUrl: 'https://evil.test/key' },
    { avatarObjectKey: 'arbitrary' },
  ]) {
    await api()
      .patch('/api/users/me')
      .auth(token, { type: 'bearer' })
      .send(patch)
      .expect(400);
  }
  const upload = await api()
    .post('/api/users/me/avatar/uploads')
    .auth(token, { type: 'bearer' })
    .send({
      contentType: 'image/png',
      fileSize: png.length,
      expectedRevision: 0,
    })
    .expect(201);
  const id = upload.body.data.uploadId;
  assert.equal(upload.body.data.upload.kind, 'memory');
  await api()
    .post(`/api/users/me/avatar/uploads/${id}/file`)
    .auth(bToken, { type: 'bearer' })
    .attach('file', png, { filename: 'valid.png', contentType: 'image/png' })
    .expect(404);
  await api()
    .post(`/api/users/me/avatar/uploads/${id}/file`)
    .auth(token, { type: 'bearer' })
    .attach('file', png, { filename: 'valid.png', contentType: 'image/png' })
    .expect(204);
  await api()
    .post(`/api/users/me/avatar/uploads/${id}/complete`)
    .auth(bToken, { type: 'bearer' })
    .expect(404);
  const completed = await api()
    .post(`/api/users/me/avatar/uploads/${id}/complete`)
    .auth(token, { type: 'bearer' })
    .expect(200);
  assert.equal(completed.body.data.avatarRevision, 1);
  assert.equal(
    completed.body.data.avatarUrl,
    `/users/${alice.id}/avatar/${id}`,
  );
  assert.equal(
    JSON.stringify(completed.body).includes('avatarObjectKey'),
    false,
  );
  const imagePath = `/api${completed.body.data.avatarUrl}`;
  const ownImage = await api()
    .get(imagePath)
    .auth(token, { type: 'bearer' })
    .expect(200);
  assert.equal(ownImage.headers['content-type'], 'image/webp');
  assert.equal(ownImage.headers['cache-control'], 'private, no-store');
  assert.equal(ownImage.headers['x-content-type-options'], 'nosniff');
  assert.equal((await sharp(ownImage.body).metadata()).width, 512);
  await api().get(imagePath).auth(bToken, { type: 'bearer' }).expect(404);
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'OWNER'),($1,$3,'MEMBER')`,
    [board.id, alice.id, bob.id],
  );
  await api().get(imagePath).auth(bToken, { type: 'bearer' }).expect(200);
  const get = storage.get.bind(storage);
  storage.get = async (...args) => {
    const value = await get(...args);
    await source.query(
      'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
      [board.id, bob.id],
    );
    return value;
  };
  await rejectsCode(avatars.read(bob.id, alice.id, id), 'AVATAR_NOT_FOUND');
  storage.get = get;
  // Pre-PUT 503s can retry the same intent without another upload/quota slot.
  const images = app.get(AvatarImageService);
  for (const phase of ['get', 'normalize']) {
    const retryUser = await makeUser({
      avatarUrl: 'https://images.example.test/preserved.jpg',
    });
    const retry = await intent(retryUser);
    const dependency = phase === 'get' ? storage : images;
    const method = phase === 'get' ? 'get' : 'normalize';
    const original = dependency[method].bind(dependency);
    dependency[method] = async () => {
      throw avatarError(503, 'AVATAR_TEMPORARILY_UNAVAILABLE', 'Try again.');
    };
    try {
      await rejectsCode(
        avatars.complete(retryUser.id, retry.uploadId),
        'AVATAR_TEMPORARILY_UNAVAILABLE',
      );
    } finally {
      dependency[method] = original;
    }
    const pending = await uploads.findOneByOrFail({ id: retry.uploadId });
    assert.equal(pending.state, 'pending');
    assert.equal(pending.expiresAt.getTime(), retry.row.expiresAt.getTime());
    assert.equal(pending.baseRevision, retry.row.baseRevision);
    assert.equal(storage.objects.has(retry.row.pendingKey), true);
    assert.equal(storage.objects.has(retry.row.activeKey), false);
    assert.equal(
      (await users.findOneByOrFail({ id: retryUser.id })).avatarUrl,
      retryUser.avatarUrl,
    );
    assert.equal(
      (await avatars.complete(retryUser.id, retry.uploadId)).avatarRevision,
      1,
    );
    assert.equal(await uploads.countBy({ userId: retryUser.id }), 1);
  }
  await api().get(imagePath).auth(bToken, { type: 'bearer' }).expect(404);
  assert.equal(
    (await avatars.complete(alice.id, id)).avatarRevision,
    1,
    'same completion is idempotent',
  );
  await rejectsCode(
    avatars.complete(alice.id, randomUUID()),
    'AVATAR_UPLOAD_NOT_FOUND',
  );
  const replacement = await intent(alice);
  await avatars.complete(alice.id, replacement.uploadId);
  await rejectsCode(
    avatars.complete(alice.id, id),
    'AVATAR_UPLOAD_UNAVAILABLE',
  );
  await api().get(imagePath).auth(token, { type: 'bearer' }).expect(404);
  await rejectsCode(avatars.remove(alice.id, 1), 'AVATAR_CHANGED');
  const removed = await avatars.remove(alice.id, 2);
  assert.equal(removed.avatarUrl, null);
  assert.equal(
    (await avatars.remove(alice.id, 2)).avatarRevision,
    3,
    'retry removal is idempotent',
  );

  // Real row locks/revisions: replace vs replace, replace vs remove, duplicate complete.
  const racer = await makeUser(),
    a = await intent(racer),
    b = await intent(racer);
  const race = await Promise.allSettled([
    avatars.complete(racer.id, a.uploadId),
    avatars.complete(racer.id, b.uploadId),
  ]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (await users.findOneByOrFail({ id: racer.id })).avatarRevision,
    1,
  );
  const c = await intent(racer);
  const removeRace = await Promise.allSettled([
    avatars.complete(racer.id, c.uploadId),
    avatars.remove(racer.id, 1),
  ]);
  assert.equal(removeRace.filter((r) => r.status === 'fulfilled').length, 1);
  const dupeUser = await makeUser(),
    dupe = await intent(dupeUser);
  const dupes = await Promise.allSettled([
    avatars.complete(dupeUser.id, dupe.uploadId),
    avatars.complete(dupeUser.id, dupe.uploadId),
  ]);
  assert.equal(dupes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (await avatars.complete(dupeUser.id, dupe.uploadId)).avatarRevision,
    1,
  );

  const bad = await makeUser({
    avatarUrl: 'https://images.example.test/old.jpg',
  });
  const broken = await intent(bad, Buffer.from('not PNG'));
  await assert.rejects(avatars.complete(bad.id, broken.uploadId));
  assert.equal(
    (await users.findOneByOrFail({ id: bad.id })).avatarUrl,
    bad.avatarUrl,
  );
  const forged = await intent(bad);
  storage.objects.get(forged.row.pendingKey).contentType = 'image/jpeg';
  await rejectsCode(
    avatars.complete(bad.id, forged.uploadId),
    'AVATAR_MIME_MISMATCH',
  );
  const expired = await intent(bad);
  await expire(expired.uploadId);
  await rejectsCode(
    avatars.complete(bad.id, expired.uploadId),
    'AVATAR_UPLOAD_EXPIRED',
  );
  const missingUser = await makeUser(),
    missing = await intent(missingUser);
  storage.objects.delete(missing.row.pendingKey);
  await rejectsCode(
    avatars.complete(missingUser.id, missing.uploadId),
    'AVATAR_OBJECT_NOT_FOUND',
  );

  // Failure after PUT may leave bytes; durable cleanup, never unsafe eager deletion.
  const failed = await makeUser({
    avatarUrl: 'https://images.example.test/preserved.jpg',
  });
  const failedIntent = await intent(failed),
    put = storage.put.bind(storage);
  storage.put = async (...args) => {
    await put(...args);
    if (args[0] === failedIntent.row.activeKey)
      throw avatarError(
        503,
        'AVATAR_STORAGE_UNAVAILABLE',
        'lost PUT acknowledgement',
      );
  };
  await assert.rejects(avatars.complete(failed.id, failedIntent.uploadId));
  storage.put = put;
  assert.equal(
    (await uploads.findOneByOrFail({ id: failedIntent.uploadId })).state,
    'rejected',
  );
  assert.equal(
    (await users.findOneByOrFail({ id: failed.id })).avatarUrl,
    failed.avatarUrl,
  );
  assert.equal(storage.objects.has(failedIntent.row.activeKey), true);
  await expire(failedIntent.uploadId);
  await avatars.cleanup();
  assert.equal(storage.objects.has(failedIntent.row.activeKey), false);

  const db = app.get(DataSource),
    transaction = db.transaction.bind(db);
  for (const afterCommit of [false, true]) {
    const user = await makeUser(),
      upload = await intent(user);
    let calls = 0;
    db.transaction = async (...args) => {
      calls++;
      if (calls === 2 && !afterCommit)
        throw avatarError(
          503,
          'AVATAR_TEMPORARILY_UNAVAILABLE',
          'DB unavailable before commit',
        );
      const result = await transaction(...args);
      if (calls === 2 && afterCommit)
        throw avatarError(
          503,
          'AVATAR_TEMPORARILY_UNAVAILABLE',
          'lost DB commit acknowledgement',
        );
      return result;
    };
    await assert.rejects(avatars.complete(user.id, upload.uploadId));
    db.transaction = transaction;
    assert.equal(
      (await uploads.findOneByOrFail({ id: upload.uploadId })).state,
      afterCommit ? 'completed' : 'rejected',
    );
    const saved = await users.findOneByOrFail({ id: user.id });
    assert.equal(saved.avatarRevision, afterCommit ? 1 : 0);
    await expire(upload.uploadId);
    await avatars.cleanup();
    assert.equal(storage.objects.has(upload.row.activeKey), afterCommit);
    if (afterCommit)
      assert.equal(
        (await avatars.complete(user.id, upload.uploadId)).avatarRevision,
        1,
      );
  }
  const deletion = await makeUser(),
    abandoned = await intent(deletion);
  await expire(abandoned.uploadId);
  const deleteObject = storage.delete.bind(storage);
  storage.delete = async () => {
    throw new Error('storage offline');
  };
  await avatars.cleanup();
  storage.delete = deleteObject;
  assert.equal(storage.objects.has(abandoned.row.pendingKey), true);
  assert.ok(
    (await uploads.findOneByOrFail({ id: abandoned.uploadId })).nextCleanupAt >
      new Date(),
  );
  await uploads.update(abandoned.uploadId, { nextCleanupAt: new Date(0) });
  await avatars.cleanup();
  assert.equal(storage.objects.has(abandoned.row.pendingKey), false);
  const quota = await makeUser();
  for (let i = 0; i < 3; i++)
    await avatars.createIntent(quota.id, {
      fileSize: png.length,
      contentType: 'image/png',
      expectedRevision: 0,
    });
  await rejectsCode(
    avatars.createIntent(quota.id, {
      fileSize: png.length,
      contentType: 'image/png',
      expectedRevision: 0,
    }),
    'AVATAR_UPLOAD_LIMIT',
  );
  const attempts = await makeUser();
  for (let i = 0; i < 10; i++) {
    const upload = await avatars.createIntent(attempts.id, {
      fileSize: png.length,
      contentType: 'image/png',
      expectedRevision: 0,
    });
    await uploads.update(upload.uploadId, { state: 'rejected' });
  }
  await rejectsCode(
    avatars.createIntent(attempts.id, {
      fileSize: png.length,
      contentType: 'image/png',
      expectedRevision: 0,
    }),
    'AVATAR_RATE_LIMIT',
  );
  const expiryUser = await makeUser(),
    inFlight = await intent(expiryUser);
  storage.get = async (...args) => {
    const value = await get(...args);
    await expire(inFlight.uploadId);
    return value;
  };
  await rejectsCode(
    avatars.complete(expiryUser.id, inFlight.uploadId),
    'AVATAR_UPLOAD_EXPIRED',
  );
  storage.get = get;
  assert.equal(
    (await users.findOneByOrFail({ id: expiryUser.id })).avatarRevision,
    0,
  );
  await avatars.cleanup();
  assert.equal(storage.objects.has(inFlight.row.activeKey), false);
  const isolated = await makeUser(),
    fieldUpdate = await intent(isolated);
  storage.put = async (...args) => {
    await put(...args);
    if (args[0] === fieldUpdate.row.activeKey)
      await users.update(isolated.id, {
        displayName: 'Concurrent Name',
        authVersion: 1,
      });
  };
  const fieldResult = await avatars.complete(isolated.id, fieldUpdate.uploadId);
  storage.put = put;
  assert.equal(fieldResult.displayName, 'Concurrent Name');
  assert.equal(
    (await users.findOneByOrFail({ id: isolated.id })).authVersion,
    1,
  );
  storage.kind = 's3';
  await api()
    .post(`/api/users/me/avatar/uploads/${id}/file`)
    .auth(token, { type: 'bearer' })
    .field('would-fail-multipart-validation', 'guard must run first')
    .expect(404);
  storage.kind = 'disabled';
  await rejectsCode(
    avatars.createIntent(alice.id, {
      contentType: 'image/png',
      fileSize: png.length,
      expectedRevision: 3,
    }),
    'AVATAR_STORAGE_UNAVAILABLE',
  );
  storage.kind = 'memory';
  await api()
    .post('/api/users/me/avatar/uploads')
    .auth(token, { type: 'bearer' })
    .send({
      contentType: 'image/png',
      fileSize: png.length,
      expectedRevision: 3,
    })
    .expect(429);
  for (const sql of [
    `UPDATE users SET avatar_revision=-1 WHERE id='${alice.id}'`,
    `UPDATE users SET avatar_object_key='avatars/v1/active/${bob.id}/${id}.webp' WHERE id='${alice.id}'`,
    `UPDATE avatar_uploads SET file_size=5242881 WHERE id='${id}'`,
  ])
    await assert.rejects(
      source.query(sql),
      (error) => error.driverError?.code === '23514',
    );
  const publicLegacy = await app
    .get(require('../../dist/api/users/users.service.js').UsersService)
    .getCurrentUser(legacy.id);
  assert.equal(publicLegacy.avatarUrl, legacy.avatar_url);
  await assert.rejects(
    source.transaction((manager) => avatarMigration.down(manager.queryRunner)),
    /Detach or export private avatars/,
  );
  console.log(
    'Avatar PostgreSQL PASS: fresh/legacy migration, rollback guard, real JWT/HTTP/decoder, ownership, shared Board revocation, replay, expiry, constraints, concurrent replace/remove, PUT/DB acknowledgement failure, GC retry and current-pointer preservation.',
  );

  if (!process.argv.includes('--serve')) {
    // Run the existing foundation checks only against this explicitly disposable server.
    execFileSync(
      process.execPath,
      ['test/database/database-foundation.integration.mjs'],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          ...Object.fromEntries(
            Object.entries(config).map(([key, value]) => [
              key,
              Array.isArray(value) ? value.join(',') : String(value),
            ]),
          ),
          AVATAR_STORAGE_DRIVER: 'disabled',
        },
      },
    );
  }

  if (process.argv.includes('--serve')) {
    await makeUser({
      email: 'avatar.qa@example.test',
      displayName: 'Avatar QA',
    });
    await app.listen(3001, '127.0.0.1');
    console.log(
      'Isolated QA API: http://127.0.0.1:3001/api; avatar.qa@example.test / AvatarQA!2026 (disposable only). Ctrl+C to stop; after forced termination stop the printed container.',
    );
    console.log(`Disposable QA container: ${name}`);
    await new Promise((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
  }
} finally {
  await app?.close();
  if (source?.isInitialized) await source.destroy();
  if (started) docker('stop', name);
}
