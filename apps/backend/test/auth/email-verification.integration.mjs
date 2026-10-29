import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { setTimeout, clearTimeout } from 'node:timers';
import { URL } from 'node:url';

// Owns a disposable Docker PostgreSQL instance; never loads the repository .env.
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { Client } = require('pg');
const { JwtService } = require('@nestjs/jwt');
const { ConfigService } = require('@nestjs/config');
const { Test } = require('@nestjs/testing');
const request = require('supertest');
const { io } = createRequire(
  new URL('../../../frontend/package.json', import.meta.url),
)('socket.io-client');
const { databaseOptions } = require('../../dist/database/database-options.js');
const {
  InitialDatabaseFoundation1791763200000: Initial,
} = require('../../dist/database/migrations/1791763200000-InitialDatabaseFoundation.js');
const { User } = require('../../dist/api/users/entities/user.entity.js');
const {
  EmailVerificationToken: Token,
} = require('../../dist/api/auth/entities/email-verification-token.entity.js');
const {
  EmailVerificationService,
  verificationHash,
} = require('../../dist/api/auth/email-verification.service.js');
const {
  VerificationMailer,
  FakeVerificationMailer,
} = require('../../dist/mail/verification-mailer.js');
const { FakeWelcomeMailer } = require('../../dist/mail/welcome-mailer.js');
const {
  WelcomeOnboardingService,
} = require('../../dist/api/auth/welcome-onboarding.service.js');
const {
  JWT_ISSUER,
  JWT_AUDIENCE,
} = require('../../dist/api/auth/constants/auth.constants.js');
const name = `kanvexa-k2-test-${randomBytes(6).toString('hex')}`;
const secret = randomBytes(32).toString('hex');
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    env: { ...process.env, POSTGRES_PASSWORD: secret },
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
let source,
  app,
  fresh,
  started = false,
  checks = 0;
const sockets = [];
const check = (label) => {
  checks++;
  console.log(`PASS: ${label}`);
};
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
    'POSTGRES_USER=k2',
    '--env',
    'POSTGRES_DB=k2_test',
    'postgres:16.15-alpine3.24',
  );
  started = true;
  const port = docker(
    'inspect',
    '--format',
    '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
    name,
  );
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_HOST: '127.0.0.1',
    DATABASE_PORT: port,
    DATABASE_NAME: 'k2_test',
    DATABASE_USER: 'k2',
    DATABASE_PASSWORD: secret,
    DATABASE_SSL: 'false',
    DATABASE_POOL_SIZE: '10',
    JWT_SECRET: randomBytes(32).toString('hex'),
    PUBLIC_APP_URL: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    SWAGGER_ENABLED: 'true',
    API_PREFIX: 'api',
    CORS_ORIGINS: 'http://localhost:5173',
    RATE_LIMIT_MAX: '10000',
  });
  let ready = false;
  for (let attempt = 0; attempt < 80 && !ready; attempt++) {
    const client = new Client({
      host: '127.0.0.1',
      port: Number(port),
      user: 'k2',
      password: secret,
      database: 'k2_test',
      connectionTimeoutMillis: 500,
    });
    try {
      await client.connect();
      ready = true;
    } catch {
      await delay(250);
    } finally {
      await client.end();
    }
  }
  assert(ready, 'Disposable PostgreSQL did not become ready');
  const options = databaseOptions(process.env);
  source = await new DataSource({
    ...options,
    entities: [],
    migrations: [Initial],
  }).initialize();
  await source.runMigrations();
  const legacy = randomUUID();
  await source.query(
    'INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4)',
    [legacy, 'legacy@example.test', 'legacy-hash', 'Legacy'],
  );
  const [board] = await source.query(
    'INSERT INTO boards(name,created_by_id) VALUES($1,$2) RETURNING id',
    ['Preserved board', legacy],
  );
  const [column] = await source.query(
    'INSERT INTO board_columns(board_id,name,position) VALUES($1,$2,1) RETURNING id',
    [board.id, 'To do'],
  );
  await source.query(
    'INSERT INTO cards(board_id,column_id,created_by_id,title,position) VALUES($1,$2,$3,$4,1)',
    [board.id, column.id, legacy, 'Preserved card'],
  );
  const signer = new JwtService({
    secret: process.env.JWT_SECRET,
    signOptions: {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: 3600,
    },
  });
  const legacyJwt = await signer.signAsync({ sub: legacy });
  await source.destroy();
  source = await new DataSource(options).initialize();
  assert.equal(
    (await source.runMigrations()).length,
    source.migrations.length - 1,
  );
  assert(
    (await source.getRepository(User).findOneByOrFail({ id: legacy }))
      .emailVerifiedAt,
  );
  assert.equal(
    (await source.query('SELECT count(*)::int AS count FROM cards'))[0].count,
    1,
  );
  assert.equal(
    (await source.query('SELECT count(*)::int AS count FROM boards'))[0].count,
    1,
  );
  assert.equal((await source.runMigrations()).length, 0);
  check(
    'legacy backfill preserves users, boards/cards and migration idempotency',
  );

  await source.query('CREATE DATABASE k2_fresh');
  fresh = await new DataSource({
    ...options,
    database: 'k2_fresh',
  }).initialize();
  // Exercise this historical rollback boundary before the irreversible P2-05 migration.
  fresh.migrations = fresh.migrations.filter(
    (migration) => !migration.name.startsWith('WorkspacePolicies'),
  );
  assert.equal((await fresh.runMigrations()).length, fresh.migrations.length);
  await fresh.query(
    "INSERT INTO users(email,password_hash,display_name) VALUES('fresh@example.test','test-hash','Fresh')",
  );
  assert.equal(
    (await fresh.query('SELECT email_verified_at FROM users'))[0]
      .email_verified_at,
    null,
  );
  await fresh.undoLastMigration();
  await fresh.undoLastMigration();
  assert.equal(
    (await fresh.query('SELECT count(*)::int AS count FROM users'))[0].count,
    1,
  );
  await fresh.runMigrations();
  await fresh.destroy();
  check(
    'fresh migration defaults null; isolated revert/rerun preserves accounts',
  );

  const mailer = new FakeVerificationMailer();
  const config = new ConfigService({
    PUBLIC_APP_URL: 'http://localhost:5173',
    MAIL_FROM: 'Kanvexa <no-reply@example.test>',
  });
  const welcome = new WelcomeOnboardingService(
    source,
    new FakeWelcomeMailer(),
    config,
  );
  const verification = new EmailVerificationService(
    source,
    mailer,
    config,
    welcome,
  );
  const { AppModule } = require('../../dist/app.module.js');
  const {
    configureHttpApplication,
  } = require('../../dist/http-application.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(VerificationMailer)
    .useValue(mailer)
    .compile();
  app = module.createNestApplication({ logger: false });
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');
  const http = request(app.getHttpServer());
  await http
    .get('/api/users/me')
    .set('Authorization', `Bearer ${legacyJwt}`)
    .expect(200);
  check('JWT issued before migration still authenticates the legacy account');

  const input = {
    email: 'new@example.test',
    password: `Aa1!${randomBytes(16).toString('hex')}`,
    displayName: 'New User',
  };
  const registered = await http
    .post('/api/auth/register')
    .send(input)
    .expect(201);
  assert(!('accessToken' in registered.body.data));
  const user = await source
    .getRepository(User)
    .findOneByOrFail({ email: input.email });
  assert.equal(user.emailVerifiedAt, null);
  const [personal] = await source.query(
    `SELECT w.id, m.role FROM workspaces w
    JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=w.created_by_id
    WHERE w.type='PERSONAL' AND w.created_by_id=$1`,
    [user.id],
  );
  assert.ok(
    personal,
    'Unverified signup must already have its Personal Workspace',
  );
  assert.equal(personal.role, 'ADMIN');
  assert.equal(
    await source.getRepository('Board').countBy({ createdById: user.id }),
    0,
  );
  assert(user.passwordHash.startsWith('$argon2id$'));
  const token = () =>
    new URL(mailer.deliveries.at(-1).url).searchParams.get('token');
  let current = token();
  const row = await source
    .getRepository(Token)
    .findOneByOrFail({ userId: user.id });
  assert.equal(row.tokenHash, verificationHash(current));
  assert(!JSON.stringify(row).includes(current));
  assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), 86_400_000);
  check(
    'registration hashes password/token, expires in 24 hours, returns no JWT',
  );

  await http.post('/api/auth/login').send(input).expect(400); // extra field rejected
  const credentials = { email: input.email, password: input.password };
  const unverifiedLogin = await http
    .post('/api/auth/login')
    .send(credentials)
    .expect(403);
  assert.equal(unverifiedLogin.body.code, 'EMAIL_NOT_VERIFIED');
  assert(!('accessToken' in (unverifiedLogin.body.data ?? {})));
  await http
    .post('/api/auth/login')
    .send({ ...credentials, password: 'incorrect' })
    .expect(401);
  const signed = await signer.signAsync({ sub: user.id });
  await http
    .get('/api/users/me')
    .set('Authorization', `Bearer ${signed}`)
    .expect(401);
  check(
    'unverified login and signed REST JWT are blocked; wrong password stays generic',
  );

  async function socketAttempt(accessToken, accepted, existing) {
    const socket =
      existing ??
      io(await app.getUrl(), {
        autoConnect: false,
        forceNew: true,
        reconnection: false,
        transports: ['websocket'],
        auth: { accessToken },
      });
    if (!existing) sockets.push(socket);
    socket.auth = { accessToken };
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Socket test timed out')),
        3000,
      );
      socket.once(accepted ? 'connect' : 'connect_error', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once(accepted ? 'connect_error' : 'connect', () => {
        clearTimeout(timer);
        reject(new Error('Unexpected socket authentication result'));
      });
      socket.connect();
    });
    socket.removeAllListeners();
    socket.disconnect();
    return socket;
  }
  const reconnect = await socketAttempt(signed, false);
  await socketAttempt(signed, false, reconnect);
  check('Socket.IO handshake and reconnect reject a signed unverified JWT');

  await http
    .post('/api/auth/verify-email')
    .send({ token: 'malformed' })
    .expect(400);
  await assert.rejects(
    verification.verify(randomBytes(32).toString('base64url')),
  );
  const outcomes = await Promise.allSettled([
    verification.verify(current),
    verification.verify(current),
  ]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
    1,
  );
  await assert.rejects(verification.verify(current));
  assert(
    (await source.getRepository(Token).findOneByOrFail({ userId: user.id }))
      .consumedAt,
  );
  await http.post('/api/auth/login').send(credentials).expect(200);
  await http
    .get('/api/users/me')
    .set('Authorization', `Bearer ${signed}`)
    .expect(200);
  await socketAttempt(signed, true, reconnect);
  check(
    'concurrent verify consumes once; verified login, REST and reconnect work',
  );

  const pending = await source.getRepository(User).save(
    source.getRepository(User).create({
      email: 'rotate@example.test',
      passwordHash: 'test-hash',
      displayName: 'Rotate',
      emailVerifiedAt: null,
    }),
  );
  await verification.send(pending.email);
  const old = token();
  const expireCooldown = () =>
    source.query(
      "UPDATE email_verification_tokens SET created_at = now() - interval '61 seconds' WHERE user_id=$1",
      [pending.id],
    );
  const before = mailer.deliveries.length;
  await Promise.all(
    Array.from({ length: 8 }, () => verification.send(pending.email)),
  );
  assert.equal(mailer.deliveries.length, before);
  await expireCooldown();
  await Promise.all(
    Array.from({ length: 8 }, () => verification.send(pending.email)),
  );
  assert.equal(mailer.deliveries.length, before + 1);
  current = token();
  await assert.rejects(verification.verify(old));
  check(
    'parallel resends enforce cooldown and atomically invalidate the old hash',
  );

  await source.query(
    "UPDATE email_verification_tokens SET expires_at = now() - interval '1 second' WHERE user_id=$1",
    [pending.id],
  );
  await assert.rejects(verification.verify(current));
  await expireCooldown();
  await verification.send(pending.email);
  current = token();
  await expireCooldown();
  const raced = await Promise.allSettled([
    verification.send(pending.email),
    verification.verify(current),
  ]);
  const afterRace = await source
    .getRepository(User)
    .findOneByOrFail({ id: pending.id });
  const afterToken = await source
    .getRepository(Token)
    .findOneByOrFail({ userId: pending.id });
  if (afterRace.emailVerifiedAt) assert(afterToken.consumedAt);
  else {
    assert.equal(raced[1].status, 'rejected');
    await verification.verify(token());
  }
  check(
    'expired links fail; concurrent verify/resend has one serializable outcome',
  );

  let failSend = true;
  const failing = new EmailVerificationService(
    source,
    {
      async send(email, url) {
        if (failSend) throw new Error('simulated provider timeout');
        await mailer.send(email, url);
      },
    },
    config,
    welcome,
  );
  const recover = await source.getRepository(User).save(
    source.getRepository(User).create({
      email: 'recover@example.test',
      passwordHash: 'test-hash',
      displayName: 'Recovery',
      emailVerifiedAt: null,
    }),
  );
  await assert.rejects(
    failing.send(recover.email, true),
    (error) => error.getStatus() === 503,
  );
  assert.equal(
    await source.getRepository(User).countBy({ email: recover.email }),
    1,
  );
  const failed = await source
    .getRepository(Token)
    .findOneByOrFail({ userId: recover.id });
  assert.equal(failed.sentAt, null);
  await source.query(
    "UPDATE email_verification_tokens SET created_at = now() - interval '61 seconds' WHERE user_id=$1",
    [recover.id],
  );
  failSend = false;
  await failing.send(recover.email, true);
  await verification.verify(token());
  check(
    'provider timeout preserves pending account; resend recovers without duplicate user',
  );

  const savedSend = mailer.send.bind(mailer);
  mailer.send = async () => {
    throw new Error('simulated provider rejection');
  };
  try {
    const failedRegistration = await http
      .post('/api/auth/register')
      .send({ ...input, email: 'registration-failed@example.test' })
      .expect(503);
    assert.equal(failedRegistration.body.code, 'MAIL_DELIVERY_UNAVAILABLE');
    assert.equal(
      await source
        .getRepository(User)
        .countBy({ email: 'registration-failed@example.test' }),
      1,
    );
  } finally {
    mailer.send = savedSend;
  }
  check(
    'HTTP registration reports provider rejection while preserving one recoverable account',
  );

  const inFlightUser = await source.getRepository(User).save(
    source.getRepository(User).create({
      email: 'inflight@example.test',
      passwordHash: 'test-hash',
      displayName: 'In flight',
      emailVerifiedAt: null,
    }),
  );
  let entered, release, inFlightUrl;
  const enteredPromise = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const inFlightService = new EmailVerificationService(
    source,
    {
      async send(_email, url) {
        inFlightUrl = url;
        entered();
        await gate;
      },
    },
    config,
    welcome,
  );
  const sending = inFlightService.send(inFlightUser.email);
  await enteredPromise;
  try {
    const value = new URL(inFlightUrl).searchParams.get('token');
    await Promise.race([
      verification.verify(value),
      delay(2000).then(() => {
        throw new Error('Mail call retained a database lock');
      }),
    ]);
  } finally {
    release();
    await sending;
  }
  check(
    'verification completes while provider call is pending: no row lock spans delivery',
  );

  const quota = await source.getRepository(User).save(
    source.getRepository(User).create({
      email: 'quota@example.test',
      passwordHash: 'test-hash',
      displayName: 'Quota',
      emailVerifiedAt: null,
    }),
  );
  for (let i = 0; i < 7; i++) {
    await verification.send(quota.email);
    await source.query(
      "UPDATE email_verification_tokens SET created_at=now()-interval '61 seconds' WHERE user_id=$1",
      [quota.id],
    );
  }
  assert.equal(
    (await source.getRepository(Token).findOneByOrFail({ userId: quota.id }))
      .attempts,
    5,
  );
  await source.query(
    "UPDATE email_verification_tokens SET window_started_at=now()-interval '61 minutes' WHERE user_id=$1",
    [quota.id],
  );
  await verification.send(quota.email);
  assert.equal(
    (await source.getRepository(Token).findOneByOrFail({ userId: quota.id }))
      .attempts,
    1,
  );
  check('per-user database-backed quota caps issuance at five per hour');

  const generic = await Promise.all(
    ['unknown@example.test', 'legacy@example.test', quota.email].map(
      async (email) =>
        (
          await http
            .post('/api/auth/resend-verification')
            .send({ email })
            .expect(202)
        ).body,
    ),
  );
  assert(
    generic.every(
      (body) => body.message === generic[0].message && body.data === null,
    ),
  );
  assert.equal(
    await source.getRepository(Token).countBy({ userId: legacy }),
    0,
  );
  await http
    .post('/api/auth/verify-email')
    .send({ token: token() })
    .expect(204);
  check(
    'unknown, verified and throttled pending accounts receive identical conditional response',
  );

  assert(process.env.npm_execpath, 'Run this integration suite through pnpm');
  execFileSync(
    process.execPath,
    [process.env.npm_execpath, '--filter', '@kanban/backend', 'migration:show'],
    { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  check('migration:show succeeds against the disposable local database');
  execFileSync(
    process.execPath,
    ['test/database/database-foundation.integration.mjs'],
    { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  check(
    'existing database foundation suite passes with all current migrations and entity metadata',
  );
  console.log(`${checks} PostgreSQL/HTTP/Socket.IO integration checks passed.`);
} finally {
  for (const socket of sockets) socket.close();
  if (app) await app.close();
  if (fresh?.isInitialized) await fresh.destroy();
  if (source?.isInitialized) await source.destroy();
  if (started) docker('rm', '--force', name);
}
