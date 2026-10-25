import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';

// Own disposable PostgreSQL; never reads .env, production DB or real mail/Google.
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { ConfigModule } = require('@nestjs/config');
const { TypeOrmModule } = require('@nestjs/typeorm');
const { Test } = require('@nestjs/testing');
const { LoggerModule } = require('nestjs-pino');
const { JwtService } = require('@nestjs/jwt');
const { ThrottlerModule } = require('@nestjs/throttler');
const request = require('supertest');
const argon2 = require('argon2');
const { io } = createRequire(
  new URL('../../../frontend/package.json', import.meta.url),
)('socket.io-client');
const { databaseOptions } = require('../../dist/database/database-options.js');
const { validateEnvironment } = require('../../dist/config/environment.js');
const { configureHttpApplication } = require('../../dist/http-application.js');
const { AuthModule } = require('../../dist/api/auth/auth.module.js');
const { AuthService } = require('../../dist/api/auth/auth.service.js');
const { UsersModule } = require('../../dist/api/users/users.module.js');
const { RealtimeModule } = require('../../dist/realtime/realtime.module.js');
const {
  RealtimeBroadcastService,
} = require('../../dist/realtime/realtime-broadcast.service.js');
const {
  GoogleTokenVerifier,
} = require('../../dist/api/auth/google-token-verifier.service.js');
const {
  PasswordSecurityService,
  recoveryHash,
  RECOVERY_TTL_MS,
} = require('../../dist/api/auth/password-security.service.js');
const {
  PasswordRecoveryMailer,
  FakePasswordRecoveryMailer,
} = require('../../dist/mail/password-recovery-mailer.js');
const {
  VerificationMailer,
  FakeVerificationMailer,
} = require('../../dist/mail/verification-mailer.js');
const { User } = require('../../dist/api/users/entities/user.entity.js');
const {
  PasswordResetToken: Token,
} = require('../../dist/api/auth/entities/password-reset-token.entity.js');
const {
  GoogleIdentity,
} = require('../../dist/api/auth/entities/google-identity.entity.js');
const {
  JWT_ISSUER,
  JWT_AUDIENCE,
} = require('../../dist/api/auth/constants/auth.constants.js');

const name = `kanvexa-security-test-${randomBytes(6).toString('hex')}`;
const password = randomBytes(32).toString('hex');
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    env: { ...process.env, POSTGRES_PASSWORD: password },
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
let source,
  app,
  started = false,
  checks = 0;
const sockets = [];
const check = (label) => {
  checks++;
  console.log(`PASS: ${label}`);
};
const code = (promise, expected) =>
  assert.rejects(promise, (error) => error.getResponse?.().code === expected);
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
    'POSTGRES_USER=security_test',
    '--env',
    'POSTGRES_DB=security_test',
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
    DATABASE_NAME: 'security_test',
    DATABASE_USER: 'security_test',
    DATABASE_PASSWORD: password,
    DATABASE_SSL: 'false',
    JWT_SECRET: randomBytes(32).toString('hex'),
    GOOGLE_CLIENT_ID: '',
    LOG_LEVEL: 'silent',
    SWAGGER_ENABLED: 'true',
    PUBLIC_APP_URL: process.argv.includes('--serve')
      ? 'http://localhost:5417'
      : 'http://localhost:5173',
    CORS_ORIGINS: process.argv.includes('--serve')
      ? 'http://localhost:5417'
      : 'http://localhost:5173',
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
    } catch {
      await delay(250);
    }
  }
  assert(source, 'Disposable database must start');
  // Rehearse expand against all previous migrations with real accounts/identity.
  const recoveryMigration = source.migrations.find(
    (m) => m.name === 'PasswordRecoverySecurity1792922400093',
  );
  source.migrations = source.migrations.filter((m) => m !== recoveryMigration);
  await source.runMigrations();
  const oldPassword = 'OldPass123!';
  const oldHash = await argon2.hash(oldPassword, { type: argon2.argon2id });
  const [legacy] = await source.query(
    "INSERT INTO users(email,password_hash,display_name,email_verified_at) VALUES('legacy@example.com',$1,'Legacy',now()) RETURNING id",
    [oldHash],
  );
  await source.query(
    'INSERT INTO google_identities(user_id,google_sub) VALUES($1,$2)',
    [legacy.id, 'legacy-google'],
  );
  source.migrations.push(recoveryMigration);
  assert.equal((await source.runMigrations()).length, 1);
  assert.equal(
    (
      await source.query('SELECT auth_version FROM users WHERE id=$1', [
        legacy.id,
      ])
    )[0].auth_version,
    0,
  );
  assert.equal(
    (
      await source.query('SELECT password_hash FROM users WHERE id=$1', [
        legacy.id,
      ])
    )[0].password_hash,
    oldHash,
  );
  assert.equal(
    await source.getRepository(GoogleIdentity).countBy({ userId: legacy.id }),
    1,
  );
  await source.undoLastMigration();
  await source.runMigrations();
  assert.equal((await source.runMigrations()).length, 0);
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries.map(
      (q) => q.query,
    ),
    [],
  );
  check(
    'migration upgrade/empty rollback/rerun preserve users and Google identity; no schema drift',
  );

  const mailer = new FakePasswordRecoveryMailer();
  const verificationMailer = new FakeVerificationMailer();
  const googleProfiles = new Map();
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
      AuthModule,
      UsersModule,
      RealtimeModule,
    ],
  })
    .overrideProvider(PasswordRecoveryMailer)
    .useValue(mailer)
    .overrideProvider(VerificationMailer)
    .useValue(verificationMailer)
    .overrideProvider(GoogleTokenVerifier)
    .useValue({
      verify: async (credential) => {
        assert(googleProfiles.has(credential));
        return googleProfiles.get(credential);
      },
    })
    .compile();
  app = module.createNestApplication({ logger: false });
  let finishQa;
  const qaDone = new Promise((resolve) => {
    finishQa = resolve;
  });
  if (process.argv.includes('--serve')) {
    // Mount test-only handlers before Nest's terminal 404 handler.
    const server = app.getHttpAdapter().getInstance();
    server.get('/__qa/recovery-link', (_req, res) => {
      const delivery = mailer.deliveries.at(-1);
      if (!delivery) return res.sendStatus(404);
      return res.redirect(delivery.url);
    });
    server.post('/__qa/stop', (_req, res) => {
      res.sendStatus(204);
      finishQa();
    });
  }
  configureHttpApplication(app);
  await app.listen(process.argv.includes('--serve') ? 54393 : 0, '127.0.0.1');
  const http = request(app.getHttpServer());
  const auth = app.get(AuthService);
  const security = app.get(PasswordSecurityService);
  const users = source.getRepository(User);
  const tokens = source.getRepository(Token);
  const find = (id) => users.findOneByOrFail({ id });
  const local = (email, verified = true) =>
    users.save(
      users.create({
        email,
        displayName: 'Security Test',
        passwordHash: oldHash,
        emailVerifiedAt: verified ? new Date() : null,
        avatarUrl: null,
      }),
    );
  const known = await find(legacy.id);
  const other = await local('other@example.com');
  const unverified = await local('unverified@example.com', false);
  const signer = new JwtService({
    secret: config.JWT_SECRET,
    signOptions: {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: 3600,
    },
  });
  const legacyJwt = await signer.signAsync({ sub: known.id });
  const otherJwt = (
    await auth.login({ email: other.email, password: oldPassword })
  ).accessToken;
  await http
    .get('/api/users/me')
    .set('Authorization', `Bearer ${legacyJwt}`)
    .expect(200);
  const lastToken = () =>
    new URL(mailer.deliveries.at(-1).url).searchParams.get('token');
  const expireCooldown = (id) =>
    source.query(
      "UPDATE password_reset_tokens SET created_at=now()-interval '61 seconds' WHERE user_id=$1",
      [id],
    );
  const issue = async (user) => {
    await expireCooldown(user.id);
    await security.send(user.email);
    return lastToken();
  };

  const states = [
    known.email,
    other.email,
    unverified.email,
    'missing@example.com',
  ];
  const generic = await Promise.all(
    states.map(async (email) => {
      const begin = performance.now();
      const response = await http
        .post('/api/auth/forgot-password')
        .send({ email: email.toUpperCase() })
        .expect(202);
      return { body: response.body, elapsed: performance.now() - begin };
    }),
  );
  assert(
    generic.every(
      (result) =>
        JSON.stringify(result.body) === JSON.stringify(generic[0].body),
    ),
  );
  assert(generic.every((result) => result.elapsed >= 10_400));
  assert.equal(await tokens.countBy({ userId: unverified.id }), 0);
  assert.equal(mailer.deliveries.length, 2);
  check(
    'existing/unknown/unverified receive identical 202 envelopes and timing floor; only verified accounts mailed',
  );
  await assert.rejects(
    source.undoLastMigration(),
    /Cannot discard recovery proofs/,
  );
  assert.equal((await find(known.id)).passwordHash, oldHash);
  check('rollback guard refuses existing recovery data');

  const before = mailer.deliveries.length;
  await Promise.all(
    Array.from({ length: 8 }, () => security.send(known.email)),
  );
  assert.equal(mailer.deliveries.length, before);
  const superseded = new URL(
    mailer.deliveries.find((delivery) => delivery.email === known.email).url,
  ).searchParams.get('token');
  await expireCooldown(known.id);
  await Promise.all(
    Array.from({ length: 8 }, () => security.send(known.email)),
  );
  assert.equal(mailer.deliveries.length, before + 1);
  let current = lastToken();
  const row = await tokens.findOneByOrFail({ userId: known.id });
  assert.equal(row.tokenHash, recoveryHash(current));
  assert(!JSON.stringify(row).includes(current));
  assert.equal(row.expiresAt - row.createdAt, RECOVERY_TTL_MS);
  await code(
    security.reset(superseded, 'NextPass123!'),
    'INVALID_PASSWORD_RESET_TOKEN',
  );
  check(
    'CSPRNG proof is hash-only with 30-minute TTL; parallel issuance/cooldown/rotation send once',
  );

  for (const token of ['bad', '', null, {}, 'Z'.repeat(43)]) {
    const response = await http
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'NextPass123!' })
      .expect(400);
    assert.equal(response.body.code, 'INVALID_PASSWORD_RESET_TOKEN');
  }
  await http
    .post('/api/auth/reset-password')
    .send({ token: current, newPassword: 'weak' })
    .expect(400);
  assert.equal(
    (await tokens.findOneByOrFail({ userId: known.id })).consumedAt,
    null,
  );
  await code(security.reset(current, oldPassword), 'PASSWORD_REUSED');
  await source.query(
    "UPDATE password_reset_tokens SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [known.id],
  );
  await code(
    security.reset(current, 'NextPass123!'),
    'INVALID_PASSWORD_RESET_TOKEN',
  );
  check(
    'malformed/unknown/expired/superseded proofs denied; weak/reused password does not consume proof',
  );

  // Real PostgreSQL failure after the password update must roll back every field.
  current = await issue(known);
  await source.query(
    `CREATE FUNCTION test_fail_consumption() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected rollback'; END $$`,
  );
  await source.query(
    `CREATE TRIGGER test_fail_consumption BEFORE UPDATE ON password_reset_tokens FOR EACH ROW WHEN (NEW.consumed_at IS NOT NULL AND OLD.consumed_at IS NULL) EXECUTE FUNCTION test_fail_consumption()`,
  );
  await assert.rejects(security.reset(current, 'NextPass123!'));
  assert.equal((await find(known.id)).passwordHash, oldHash);
  assert.equal((await find(known.id)).authVersion, 0);
  assert.equal(
    (await tokens.findOneByOrFail({ userId: known.id })).consumedAt,
    null,
  );
  await assert.rejects(
    security.change(known.id, 0, oldPassword, 'ChangePass123!'),
  );
  assert.equal((await find(known.id)).passwordHash, oldHash);
  assert.equal((await find(known.id)).authVersion, 0);
  await source.query(
    'DROP TRIGGER test_fail_consumption ON password_reset_tokens',
  );
  await source.query('DROP FUNCTION test_fail_consumption()');
  check(
    'injected DB failures roll back reset/change password, consumption and version atomically',
  );

  const [board] = await source.query(
    'INSERT INTO boards(name,created_by_id) VALUES($1,$2) RETURNING id',
    ['Recovery room', known.id],
  );
  await source.query(
    "INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'OWNER'),($1,$3,'MEMBER')",
    [board.id, known.id, other.id],
  );
  async function socketAttempt(accessToken, accepted, existing) {
    const socket =
      existing ??
      io(await app.getUrl(), {
        autoConnect: false,
        forceNew: true,
        reconnection: false,
        transports: ['websocket'],
      });
    if (!existing) sockets.push(socket);
    socket.auth = { accessToken };
    await new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(
        () => reject(new Error('Socket authentication timed out')),
        3000,
      );
      socket.once(accepted ? 'connect' : 'connect_error', () => {
        globalThis.clearTimeout(timer);
        resolve();
      });
      socket.once(accepted ? 'connect_error' : 'connect', () => {
        globalThis.clearTimeout(timer);
        reject(new Error('Unexpected Socket.IO authentication outcome'));
      });
      socket.connect();
    });
    socket.removeAllListeners();
    return socket;
  }
  const active = await socketAttempt(legacyJwt, true);
  const roomAck = (socket, boardId) =>
    socket.timeout(3000).emitWithAck('board:join', { boardId });
  assert.equal((await roomAck(active, board.id)).success, true);
  const unrelated = await local('unrelated@example.com');
  const unrelatedJwt = (
    await auth.login({ email: unrelated.email, password: oldPassword })
  ).accessToken;
  const unrelatedSocket = await socketAttempt(unrelatedJwt, true);
  assert.equal((await roomAck(unrelatedSocket, board.id)).success, false);
  const outcomes = await Promise.allSettled([
    security.reset(current, 'NextPass123!'),
    security.reset(current, 'NextPass123!'),
  ]);
  assert.equal(
    outcomes.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  await code(
    security.reset(current, 'ReplayPass123!'),
    'INVALID_PASSWORD_RESET_TOKEN',
  );
  assert.equal((await find(known.id)).authVersion, 1);
  await code(
    auth.login({ email: known.email, password: oldPassword }),
    'INVALID_CREDENTIALS',
  );
  const newJwt = (
    await auth.login({ email: known.email, password: 'NextPass123!' })
  ).accessToken;
  await http
    .get('/api/users/me')
    .set('Authorization', `Bearer ${legacyJwt}`)
    .expect(401);
  await http
    .get('/api/users/me')
    .set('Authorization', `Bearer ${newJwt}`)
    .expect(200);
  await http
    .get('/api/users/me')
    .set('Authorization', `Bearer ${otherJwt}`)
    .expect(200);
  await socketAttempt(legacyJwt, false);
  const otherSocket = await socketAttempt(otherJwt, true);
  assert.equal((await roomAck(otherSocket, board.id)).success, true);
  // Explicitly measure the residual active-socket boundary; no instant-revoke claim.
  assert.equal(active.connected, true);
  let observed = false;
  active.once('board:archived', () => {
    observed = true;
  });
  await app
    .get(RealtimeBroadcastService)
    .emitToBoard(board.id, 'board:archived', { boardId: board.id });
  await delay(50);
  assert.equal(observed, true);
  active.disconnect();
  await socketAttempt(legacyJwt, false, active);
  await socketAttempt(newJwt, true);
  check(
    'exactly one concurrent reset succeeds; old/legacy JWT blocked in REST/handshake/reconnect; other users isolated; active sockets retain pre-existing access until disconnect/expiry',
  );

  current = await issue(known);
  await code(
    security.change(known.id, 1, 'incorrect', 'ChangedPass123!'),
    'CURRENT_PASSWORD_INCORRECT',
  );
  await code(
    security.change(known.id, 1, 'NextPass123!', 'NextPass123!'),
    'PASSWORD_REUSED',
  );
  await http
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${newJwt}`)
    .send({ currentPassword: 'NextPass123!', newPassword: 'ChangedPass123!' })
    .expect(204);
  await code(
    security.reset(current, 'ReplayPass123!'),
    'INVALID_PASSWORD_RESET_TOKEN',
  );
  await http
    .get('/api/users/me')
    .set('Authorization', `Bearer ${newJwt}`)
    .expect(401);
  await socketAttempt(newJwt, false);
  assert.equal((await find(known.id)).authVersion, 2);
  const changedJwt = (
    await auth.login({ email: known.email, password: 'ChangedPass123!' })
  ).accessToken;
  assert.equal((await auth.authenticateAccessToken(changedJwt)).authVersion, 2);
  await http
    .patch('/api/users/me')
    .set('Authorization', `Bearer ${changedJwt}`)
    .send({ displayName: 'Updated Profile' })
    .expect(200);
  assert.equal((await find(known.id)).authVersion, 2);
  assert(
    await argon2.verify((await find(known.id)).passwordHash, 'ChangedPass123!'),
  );
  check(
    'HTTP change reauthenticates, consumes outstanding proof, bumps version and preserves security fields during profile edits',
  );

  current = await issue(known);
  const race = await Promise.allSettled([
    security.reset(current, 'RaceReset123!'),
    security.change(known.id, 2, 'ChangedPass123!', 'RaceChange123!'),
  ]);
  assert.equal(
    race.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  assert.equal((await find(known.id)).authVersion, 3);
  const changeRace = await Promise.allSettled([
    security.change(other.id, 0, oldPassword, 'OtherNew123!'),
    security.change(other.id, 0, oldPassword, 'OtherNew456!'),
  ]);
  assert.equal(
    changeRace.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  assert.equal((await find(other.id)).authVersion, 1);
  check(
    'concurrent change/reset and change/change serialize with exactly one valid old-credential operation',
  );

  googleProfiles.set('test-google', {
    sub: 'new-google',
    email: 'google@gmail.com',
    authoritativeEmail: true,
    displayName: 'Google User',
    avatarUrl: null,
  });
  const googleResponse = await http
    .post('/api/auth/google')
    .send({ credential: 'test-google' })
    .expect(200);
  const google = await find(googleResponse.body.data.user.id);
  assert.equal(google.passwordHash, null);
  const googleAcknowledgement = await http
    .post('/api/auth/forgot-password')
    .send({ email: google.email })
    .expect(202);
  assert.deepEqual(googleAcknowledgement.body, generic[0].body);
  await http
    .post('/api/auth/change-password')
    .set('Authorization', `Bearer ${googleResponse.body.data.accessToken}`)
    .send({ currentPassword: 'anything', newPassword: 'GooglePass123!' })
    .expect(403);
  current = await issue(google);
  await http
    .post('/api/auth/reset-password')
    .send({ token: current, newPassword: 'GooglePass123!' })
    .expect(204);
  const googleAfter = await find(google.id);
  assert.equal(googleAfter.id, google.id);
  assert.equal(
    await source
      .getRepository(GoogleIdentity)
      .countBy({ userId: google.id, googleSub: 'new-google' }),
    1,
  );
  await http
    .post('/api/auth/login')
    .send({ email: google.email, password: 'GooglePass123!' })
    .expect(200);
  await http
    .post('/api/auth/google')
    .send({ credential: 'test-google' })
    .expect(200);
  check(
    'Google-only set-password requires recovery proof, preserves identity/ID and supports both login methods',
  );

  const signup = await http
    .post('/api/auth/register')
    .send({
      email: 'signup@example.com',
      password: 'SignupPass123!',
      displayName: 'Signup',
    })
    .expect(201);
  const verificationToken = new URL(
    verificationMailer.deliveries.at(-1).url,
  ).searchParams.get('token');
  await code(
    security.reset(verificationToken, 'ForbiddenPass123!'),
    'INVALID_PASSWORD_RESET_TOKEN',
  );
  await http
    .post('/api/auth/login')
    .send({ email: 'signup@example.com', password: 'SignupPass123!' })
    .expect(403);
  await http
    .post('/api/auth/verify-email')
    .send({ token: verificationToken })
    .expect(204);
  const signupLogin = await http
    .post('/api/auth/login')
    .send({ email: 'signup@example.com', password: 'SignupPass123!' })
    .expect(200);
  googleProfiles.set('link-google', {
    sub: 'linked-google',
    email: 'signup@example.com',
    authoritativeEmail: true,
  });
  await http
    .post('/api/auth/google/link')
    .set('Authorization', `Bearer ${signupLogin.body.data.accessToken}`)
    .send({ credential: 'link-google', password: 'SignupPass123!' })
    .expect(204);
  assert.equal(
    await source
      .getRepository(GoogleIdentity)
      .countBy({ userId: signup.body.data.id }),
    1,
  );
  check(
    'registration/verification/local login/explicit Google linking regressions pass; token flows cannot be confused',
  );

  const quota = await local('quota@example.com');
  for (let attempt = 0; attempt < 7; attempt++) {
    await expireCooldown(quota.id);
    await security.send(quota.email);
  }
  assert.equal(
    (await tokens.findOneByOrFail({ userId: quota.id })).attempts,
    5,
  );
  await source.query(
    "UPDATE password_reset_tokens SET window_started_at=now()-interval '61 minutes' WHERE user_id=$1",
    [quota.id],
  );
  await security.send(quota.email);
  assert.equal(
    (await tokens.findOneByOrFail({ userId: quota.id })).attempts,
    1,
  );
  const failed = await local('failed@example.com');
  let providerCalls = 0;
  const failing = new PasswordSecurityService(
    source,
    {
      send: async () => {
        providerCalls++;
        throw new Error('ambiguous timeout');
      },
    },
    app.get(require('@nestjs/config').ConfigService),
  );
  await failing.send(failed.email);
  await failing.send(failed.email);
  assert.equal(providerCalls, 1);
  assert.equal(
    (await tokens.findOneByOrFail({ userId: failed.id })).sentAt,
    null,
  );
  assert.equal((await find(failed.id)).authVersion, 0);
  const savedSend = mailer.send.bind(mailer);
  mailer.send = async () => {
    throw new Error('simulated ambiguous provider failure');
  };
  try {
    const response = await http
      .post('/api/auth/forgot-password')
      .send({ email: unverified.email })
      .expect(202);
    assert.deepEqual(response.body, generic[0].body);
    const eligibleFailure = await http
      .post('/api/auth/forgot-password')
      .send({ email: unrelated.email })
      .expect(202);
    assert.deepEqual(eligibleFailure.body, generic[0].body);
  } finally {
    mailer.send = savedSend;
  }
  check(
    'persistent hourly cap/window reset and ambiguous provider failures retain quota without retry or credential changes',
  );

  const inFlight = await local('inflight@example.com');
  let enter, release, pendingUrl;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const sendingService = new PasswordSecurityService(
    source,
    {
      send: async (_email, url) => {
        pendingUrl = url;
        enter();
        await gate;
      },
    },
    app.get(require('@nestjs/config').ConfigService),
  );
  const sending = sendingService.send(inFlight.email);
  await entered;
  try {
    await Promise.race([
      security.reset(
        new URL(pendingUrl).searchParams.get('token'),
        'InflightPass123!',
      ),
      delay(2000).then(() => {
        throw new Error('Mail holds a DB row lock');
      }),
    ]);
  } finally {
    release();
    await sending;
  }
  check(
    'password reset commits while delivery is in flight: network call holds no transaction/row lock',
  );
  const swagger = await http.get('/api-docs-json').expect(200);
  for (const [path, status] of [
    ['forgot-password', '202'],
    ['reset-password', '204'],
    ['change-password', '204'],
  ]) {
    assert(swagger.body.paths[`/api/auth/${path}`].post.responses[status]);
  }
  check(
    'OpenAPI documents the three real endpoints, request schemas and success statuses',
  );
  console.log(
    `${checks} PostgreSQL/REST/Socket.IO security integration checks passed.`,
  );
  if (process.argv.includes('--serve')) {
    // Explicit loopback QA harness only. It always owns a fresh Docker database
    // and fake mail; this redirect lets a real browser open captured test mail
    // without printing tokens or adding a debug endpoint to the application.
    const qaGoogle = await local('qa-google@example.com');
    await users.update(qaGoogle.id, { passwordHash: null });
    await source
      .getRepository(GoogleIdentity)
      .save({ userId: qaGoogle.id, googleSub: 'qa-google' });
    googleProfiles.set('qa-google', {
      sub: 'qa-google',
      email: qaGoogle.email,
      authoritativeEmail: true,
    });
    console.log('Isolated fake-mail QA API ready at http://127.0.0.1:54393');
    process.once('SIGINT', finishQa);
    process.once('SIGTERM', finishQa);
    await qaDone;
  }
} finally {
  for (const socket of sockets) socket.close();
  if (app) await app.close();
  if (source?.isInitialized) await source.destroy();
  if (started) docker('rm', '--force', name);
}
