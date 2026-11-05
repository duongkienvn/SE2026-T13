import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { URL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyEmailChangeRaces } from './email-change-races.mjs';
import { verifyEmailChangeQuotaAndFailures } from './email-change-quota.mjs';

assert.equal(process.env.EMAIL_CHANGE_DATABASE_TESTS, 'local-only');
assert.ok(
  ['127.0.0.1', 'localhost', '::1'].includes(process.env.DATABASE_HOST),
);
assert.notEqual(process.env.NODE_ENV, 'production');
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { Client } = require('pg'),
  { DataSource } = require('typeorm'),
  { Test } = require('@nestjs/testing'),
  { ConfigModule } = require('@nestjs/config'),
  { TypeOrmModule } = require('@nestjs/typeorm'),
  { LoggerModule } = require('nestjs-pino'),
  { ThrottlerModule } = require('@nestjs/throttler'),
  { JwtService } = require('@nestjs/jwt');
const request = require('supertest'),
  argon2 = require('argon2');
const { io } = createRequire(
  new URL('../../../frontend/package.json', import.meta.url),
)('socket.io-client');
const { databaseOptions } = require('../../dist/database/database-options.js');
const { validateEnvironment } = require('../../dist/config/environment.js');
const { configureHttpApplication } = require('../../dist/http-application.js');
const { AuthModule } = require('../../dist/api/auth/auth.module.js');
const { UsersModule } = require('../../dist/api/users/users.module.js');
const {
  WorkspaceApiModule,
} = require('../../dist/api/workspaces/workspace-api.module.js');
const { RealtimeModule } = require('../../dist/realtime/realtime.module.js');
const {
  NotificationsModule,
} = require('../../dist/api/notifications/notifications.module.js');
const { AuthService } = require('../../dist/api/auth/auth.service.js');
const {
  GoogleAuthService,
} = require('../../dist/api/auth/google-auth.service.js');
const {
  GoogleTokenVerifier,
} = require('../../dist/api/auth/google-token-verifier.service.js');
const {
  PasswordSecurityService,
} = require('../../dist/api/auth/password-security.service.js');
const {
  EmailVerificationService,
} = require('../../dist/api/auth/email-verification.service.js');
const {
  EmailChangeService,
  emailChangeHash,
} = require('../../dist/api/auth/email-change.service.js');
const {
  EmailChangeReauthenticationService,
} = require('../../dist/api/auth/email-change-reauthentication.service.js');
const {
  EmailChangeMailer,
  FakeEmailChangeMailer,
} = require('../../dist/mail/email-change-mailer.js');
const {
  PasswordRecoveryMailer,
} = require('../../dist/mail/password-recovery-mailer.js');
const { User } = require('../../dist/api/users/entities/user.entity.js');
const {
  PendingEmailChange,
} = require('../../dist/api/auth/entities/pending-email-change.entity.js');
const {
  ApplicationException,
} = require('../../dist/exceptions/application.exception.js');
const {
  RealtimeBroadcastService,
} = require('../../dist/realtime/realtime-broadcast.service.js');
const options = databaseOptions(process.env),
  database = `kanban_email_change_${randomBytes(8).toString('hex')}`;
const admin = new Client({ ...options, user: options.username });
let source,
  app,
  created = false,
  groups = 0,
  sequence = 0;
const sockets = [];
const pass = (label) => {
  groups++;
  console.log(`PASS: ${label}`);
};
const code = (promise, expected) =>
  assert.rejects(promise, (error) => error.getResponse?.().code === expected);
const password = 'LocalPass1!';
async function eventually(check, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  assert.fail(label);
}
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  source = await new DataSource({ ...options, database }).initialize();
  const migrations = source.migrations;
  source.migrations = migrations.filter(
    (migration) => !migration.name.startsWith('EmailChangeSecurity'),
  );
  await source.runMigrations();
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const legacy = await source.getRepository(User).save({
    email: 'legacy@email-change.test',
    displayName: 'Legacy',
    passwordHash: hash,
    emailVerifiedAt: new Date(),
  });
  const [workspace] = await source.query(
    "INSERT INTO workspaces(type,name,created_by_id) VALUES ('TEAM','Keep Workspace',$1) RETURNING id",
    [legacy.id],
  );
  await source.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN')",
    [workspace.id, legacy.id],
  );
  const [board] = await source.query(
    "INSERT INTO boards(name,created_by_id,workspace_id) VALUES ('Keep Board',$1,$2) RETURNING id",
    [legacy.id, workspace.id],
  );
  await source.query(
    "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')",
    [board.id, legacy.id],
  );
  const before = await source.query(
    'SELECT id,email,password_hash,auth_version FROM users ORDER BY id',
  );
  source.migrations = migrations;
  assert.equal((await source.runMigrations()).length, 1);
  assert.deepEqual(
    await source.query(
      'SELECT id,email,password_hash,auth_version FROM users ORDER BY id',
    ),
    before,
  );
  assert.equal(
    (await source.query('SELECT count(*)::int n FROM pending_email_changes'))[0]
      .n,
    0,
  );
  assert.deepEqual(await source.runMigrations(), []);
  await assert.rejects(source.undoLastMigration(), /forward-only/);
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries,
    [],
  );
  assert.equal(source.options.synchronize, false);
  assert.equal(source.options.migrationsRun, false);
  pass(
    'forward migration preserves populated Users/ownership, creates no intents, has zero ORM drift and refuses rollback',
  );
  const environment = validateEnvironment({
    NODE_ENV: 'test',
    DATABASE_HOST: options.host,
    DATABASE_PORT: String(options.port),
    DATABASE_NAME: database,
    DATABASE_USER: options.username,
    DATABASE_PASSWORD: options.password,
    JWT_SECRET: randomBytes(32).toString('hex'),
    PUBLIC_APP_URL: 'http://localhost:5173',
    MAIL_TRANSPORT: 'fake',
    LOG_LEVEL: 'silent',
    SWAGGER_ENABLED: 'true',
    API_PREFIX: 'api',
    GOOGLE_CLIENT_ID: '',
    TASK_NOTIFICATION_JOBS_ENABLED: 'false',
    TASK_NOTIFICATION_EMAIL_ENABLED: 'false',
    AVATAR_STORAGE_DRIVER: 'disabled',
    ATTACHMENT_STORAGE_DRIVER: 'disabled',
  });
  const mailer = new FakeEmailChangeMailer(environment.PUBLIC_APP_URL),
    profiles = new Map();
  const verifiedCalls = [];
  const googleVerifier = {
    verify: async (credential, maxAge) => {
      verifiedCalls.push({ credential, maxAge });
      const profile = profiles.get(credential);
      if (!profile)
        throw new ApplicationException(
          401,
          'INVALID_GOOGLE_CREDENTIAL',
          'Google sign-in could not be verified',
        );
      return profile;
    },
  };
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => environment],
      }),
      LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
      TypeOrmModule.forRoot({ ...options, database }),
      ThrottlerModule.forRoot([{ ttl: 60000, limit: 10000 }]),
      AuthModule,
      UsersModule,
      WorkspaceApiModule,
      NotificationsModule,
      RealtimeModule,
    ],
  })
    .overrideProvider(DataSource)
    .useValue(source)
    .overrideProvider(EmailChangeMailer)
    .useValue(mailer)
    .overrideProvider(GoogleTokenVerifier)
    .useValue(googleVerifier)
    .compile();
  app = module.createNestApplication();
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');
  const http = request(app.getHttpServer()),
    jwt = app.get(JwtService),
    changes = app.get(EmailChangeService),
    reauth = app.get(EmailChangeReauthenticationService),
    auth = app.get(AuthService),
    google = app.get(GoogleAuthService),
    security = app.get(PasswordSecurityService),
    verification = app.get(EmailVerificationService),
    broadcast = app.get(RealtimeBroadcastService);
  const resetMailer = app.get(PasswordRecoveryMailer);
  const session = async (actor) => {
    const current = await source
      .getRepository(User)
      .findOneByOrFail({ id: actor.id });
    return {
      identity: {
        userId: current.id,
        authVersion: current.authVersion,
        expiresAt: Date.now() + 3600000,
      },
      jwt: await jwt.signAsync({
        sub: current.id,
        authVersion: current.authVersion,
      }),
      user: current,
    };
  };
  const tokenFor = (email) => {
    const delivery = mailer.proofs.findLast((item) => item.email === email);
    assert.ok(delivery, 'expected fake proof delivery');
    return new URL(delivery.url).searchParams.get('token');
  };
  const factory = async (kind = 'password', verified = true) => {
    const n = ++sequence;
    const actor = await source.getRepository(User).save({
      email: `user-${n}@email-change.test`,
      displayName: `User ${n}`,
      passwordHash: kind === 'google' ? null : hash,
      emailVerifiedAt: verified ? new Date() : null,
    });
    if (kind !== 'password') {
      const subject = `linked-subject-${actor.id}`;
      await source.query(
        'INSERT INTO google_identities(user_id,google_sub) VALUES ($1,$2)',
        [actor.id, subject],
      );
      profiles.set(`google/${actor.id}`, {
        sub: subject,
        email: actor.email,
        authoritativeEmail: true,
        displayName: actor.displayName,
        avatarUrl: null,
      });
    }
    return actor;
  };
  const issue = async (actor, newEmail, method = 'password') => {
    const current = await session(actor);
    const input = {
      newEmail,
      ...(method === 'google'
        ? { googleCredential: `google/${actor.id}` }
        : { currentPassword: password }),
    };
    const proof = await reauth.verify(current.identity, input);
    await changes.request(proof, newEmail);
    return current;
  };
  const makeOld = async (actor) =>
    source.query(
      "UPDATE pending_email_changes SET created_at=statement_timestamp()-interval '61 seconds',expires_at=statement_timestamp()-interval '61 seconds'+interval '30 minutes' WHERE user_id=$1",
      [actor.id],
    );
  // Both timestamps use the same statement clock, not two wall-clock evaluations.
  const age = async (actor, minutes) =>
    source.query(
      "UPDATE pending_email_changes SET created_at=statement_timestamp()-($2*interval '1 minute'),expires_at=statement_timestamp()-($2*interval '1 minute')+interval '30 minutes' WHERE user_id=$1",
      [actor.id, minutes],
    );
  const connect = async (token, expectFailure = false) =>
    new Promise((resolve, reject) => {
      const socket = io(awaitUrl, {
        transports: ['websocket'],
        reconnection: false,
        auth: { accessToken: token },
      });
      sockets.push(socket);
      socket.once('connect', () =>
        expectFailure
          ? reject(new Error('stale socket connected'))
          : resolve(socket),
      );
      socket.once('connect_error', (error) =>
        expectFailure ? resolve(error) : reject(error),
      );
    });
  const awaitUrl = await app.getUrl();
  const originalSession = await session(legacy),
    other = await factory();
  await source.query(
    "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')",
    [board.id, other.id],
  );
  const oldSocket = await connect(originalSession.jwt),
    otherSocket = await connect((await session(other)).jwt);
  const join = (socket) =>
    new Promise((resolve) =>
      socket.emit('board:join', { boardId: board.id }, resolve),
    );
  assert.equal((await join(oldSocket)).success, true);
  assert.equal((await join(otherSocket)).success, true);
  await security.send(legacy.email);
  const resetProof = new URL(
    resetMailer.deliveries.at(-1).url,
  ).searchParams.get('token');
  await source.query(
    "INSERT INTO email_verification_tokens(user_id,token_hash,created_at,expires_at,window_started_at,attempts) VALUES ($1,$2,now(),now()+interval '1 day',now(),1)",
    [legacy.id, '1'.repeat(64)],
  );
  await issue(legacy, 'new-legacy@email-change.test');
  const invitationProof = randomBytes(32).toString('base64url');
  const [invitation] = await source.query(
    "INSERT INTO workspace_invitations(workspace_id,email,role,token_hash,send_state,expires_at,invited_by_id) VALUES ($1,$2,'MEMBER',$3,'SENT',now()+interval '1 day',$4) RETURNING id,email,token_hash,consumed_at",
    [workspace.id, legacy.email, emailChangeHash(invitationProof), other.id],
  );
  const initial = await source
      .getRepository(PendingEmailChange)
      .findOneByOrFail({ userId: legacy.id }),
    proof = tokenFor('new-legacy@email-change.test');
  assert.equal(initial.tokenHash, emailChangeHash(proof));
  assert.equal(Buffer.from(proof, 'base64url').length, 32);
  assert.equal(initial.expiresAt - initial.createdAt, 30 * 60000);
  assert.equal(initial.originalEmail, legacy.email);
  assert.equal(initial.originalAuthVersion, 0);
  assert.equal(
    (await source.getRepository(User).findOneByOrFail({ id: legacy.id })).email,
    legacy.email,
  );
  const pending = await http
    .get('/api/auth/email-change/pending')
    .auth(originalSession.jwt, { type: 'bearer' });
  assert.equal(pending.status, 200);
  assert.deepEqual(Object.keys(pending.body.data), [
    'maskedNewEmail',
    'issuedAt',
    'expiresAt',
  ]);
  assert.equal(JSON.stringify(pending.body).includes('new-legacy'), false);
  assert.equal(JSON.stringify(pending.body).includes(proof), false);
  assert.equal(
    (
      await http
        .post('/api/auth/email-change/confirm')
        .auth(originalSession.jwt, { type: 'bearer' })
        .send({ token: proof })
    ).status,
    204,
  );
  await eventually(
    () => !oldSocket.connected,
    'old connected socket must be disconnected',
  );
  assert.equal(otherSocket.connected, true);
  const changed = await source
    .getRepository(User)
    .findOneByOrFail({ id: legacy.id });
  assert.equal(changed.id, legacy.id);
  assert.equal(changed.passwordHash, hash);
  assert.equal(changed.email, 'new-legacy@email-change.test');
  assert.equal(changed.authVersion, 1);
  assert.ok(changed.emailVerifiedAt);
  assert.equal(
    (
      await source.query('SELECT created_by_id FROM boards WHERE id=$1', [
        board.id,
      ])
    )[0].created_by_id,
    legacy.id,
  );
  assert.equal(
    (
      await source.query(
        'SELECT role FROM board_members WHERE board_id=$1 AND user_id=$2',
        [board.id, legacy.id],
      )
    )[0].role,
    'OWNER',
  );
  assert.equal(
    (
      await source.query(
        'SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
        [workspace.id, legacy.id],
      )
    )[0].role,
    'ADMIN',
  );
  assert.ok(
    (
      await source.query(
        'SELECT consumed_at FROM password_reset_tokens WHERE user_id=$1',
        [legacy.id],
      )
    )[0].consumed_at,
  );
  assert.ok(
    (
      await source.query(
        'SELECT consumed_at FROM email_verification_tokens WHERE user_id=$1',
        [legacy.id],
      )
    )[0].consumed_at,
  );
  await code(
    security.reset(resetProof, 'NewLocalPass2!'),
    'INVALID_PASSWORD_RESET_TOKEN',
  );
  assert.equal(
    (
      await http
        .get('/api/users/me')
        .auth(originalSession.jwt, { type: 'bearer' })
    ).status,
    401,
  );
  await connect(originalSession.jwt, true);
  await code(
    auth.login({ email: legacy.email, password }),
    'INVALID_CREDENTIALS',
  );
  const login = await auth.login({ email: changed.email, password });
  assert.equal(login.user.id, legacy.id);
  const fresh = await session(changed);
  const refusedInvite = await http
    .post('/api/workspace-invitations/accept')
    .auth(fresh.jwt, { type: 'bearer' })
    .send({ proof: invitationProof });
  assert.equal(refusedInvite.status, 410);
  assert.deepEqual(
    (
      await source.query(
        'SELECT id,email,token_hash,consumed_at FROM workspace_invitations WHERE id=$1',
        [invitation.id],
      )
    )[0],
    invitation,
  );
  assert.equal(
    (
      await http
        .get('/api/auth/email-change/pending')
        .auth(fresh.jwt, { type: 'bearer' })
    ).body.data,
    null,
  );
  await code(
    changes.confirm(fresh.identity, proof),
    'INVALID_EMAIL_CHANGE_TOKEN',
  );
  const alert = mailer.alerts.at(-1);
  assert.equal(alert.email, legacy.email);
  assert.equal(JSON.stringify(alert.message).includes(changed.email), false);
  assert.equal(JSON.stringify(alert.message).includes(proof), false);
  const newSocket = await connect(fresh.jwt);
  let received = 0;
  newSocket.on('notifications:changed', () => received++);
  await broadcast.emitToUser(legacy.id, 'notifications:changed', {});
  await eventually(
    () => received === 1,
    'fresh private recipient receives invalidation',
  );
  await source.query(
    "UPDATE password_reset_tokens SET created_at=now()-interval '61 seconds' WHERE user_id=$1",
    [legacy.id],
  );
  const count = resetMailer.deliveries.length;
  await security.send(legacy.email);
  assert.equal(resetMailer.deliveries.length, count);
  await security.send(changed.email);
  assert.equal(resetMailer.deliveries.at(-1).email, changed.email);
  pass(
    'password reauth + mailbox confirmation preserves UUID/ownership/password, consumes old credentials, revokes JWT/socket sessions and alerts only old mailbox',
  );
  for (const kind of ['google', 'dual']) {
    const actor = await factory(kind),
      current = await session(actor),
      destination = `${kind}-new@email-change.test`;
    const linkedBefore = await source.query(
      'SELECT id,google_sub FROM google_identities WHERE user_id=$1',
      [actor.id],
    );
    await issue(actor, destination, 'google');
    assert.equal(verifiedCalls.at(-1).maxAge, 300);
    await changes.confirm(current.identity, tokenFor(destination));
    assert.deepEqual(
      await source.query(
        'SELECT id,google_sub FROM google_identities WHERE user_id=$1',
        [actor.id],
      ),
      linkedBefore,
    );
    const googleLogin = await google.signIn(`google/${actor.id}`);
    assert.equal(googleLogin.user.id, actor.id);
    assert.equal(googleLogin.user.email, destination);
    if (kind === 'dual') {
      await age(actor, 2);
      await issue(actor, 'dual-password@email-change.test');
      await changes.confirm(
        (await session(actor)).identity,
        tokenFor('dual-password@email-change.test'),
      );
    }
  }
  const unlinked = await factory(),
    linked = await factory('google');
  await code(
    reauth.verify((await session(unlinked)).identity, {
      newEmail: 'x@example.test',
      googleCredential: `google/${linked.id}`,
    }),
    'INVALID_CREDENTIALS',
  );
  profiles.set('wrong-sub', {
    sub: 'another-subject',
    email: linked.email,
    authoritativeEmail: true,
  });
  await code(
    reauth.verify((await session(linked)).identity, {
      newEmail: 'x@example.test',
      googleCredential: 'wrong-sub',
    }),
    'INVALID_CREDENTIALS',
  );
  await code(
    reauth.verify((await session(linked)).identity, {
      newEmail: 'x@example.test',
      googleCredential: 'invalid',
    }),
    'INVALID_GOOGLE_CREDENTIAL',
  );
  pass(
    'Google-only and dual-provider accounts use fresh linked subject, preserve identity and continue Google sign-in after email diverges',
  );
  for (const path of ['request', 'confirm'])
    assert.equal(
      (await http.post('/api/auth/email-change/' + path).send({})).status,
      401,
    );
  const unverified = await factory('password', false),
    unverifiedSession = await session(unverified);
  assert.equal(
    (
      await http
        .get('/api/auth/email-change/pending')
        .auth(unverifiedSession.jwt, { type: 'bearer' })
    ).status,
    401,
  );
  const schema = (await http.get('/api-docs-json')).body;
  for (const [path, method, status] of [
    ['request', 'post', 202],
    ['pending', 'get', 200],
    ['confirm', 'post', 204],
  ])
    assert.ok(
      schema.paths['/api/auth/email-change/' + path][method].responses[
        String(status)
      ],
    );
  // Exercise real HTTP request normalization, generic acknowledgement and provider failure.
  const httpActor = await factory(),
    httpSession = await session(httpActor),
    occupied = await factory(),
    failedMailActor = await factory();
  const originalHttpSend = mailer.sendProof;
  mailer.sendProof = async function (email, ...args) {
    if (email === 'http-failed@email-change.test')
      throw new Error('synthetic provider failure');
    return originalHttpSend.call(this, email, ...args);
  };
  const started = Date.now();
  let results;
  try {
    results = await Promise.all([
      http
        .post('/api/auth/email-change/request')
        .auth(httpSession.jwt, { type: 'bearer' })
        .send({
          newEmail: ' HTTP-New@Email-Change.test ',
          currentPassword: password,
        }),
      http
        .post('/api/auth/email-change/request')
        .auth((await session(occupied)).jwt, { type: 'bearer' })
        .send({ newEmail: other.email, currentPassword: password }),
      http
        .post('/api/auth/email-change/request')
        .auth((await session(failedMailActor)).jwt, { type: 'bearer' })
        .send({
          newEmail: 'http-failed@email-change.test',
          currentPassword: password,
        }),
    ]);
  } finally {
    mailer.sendProof = originalHttpSend;
  }
  assert.ok(Date.now() - started >= 10000);
  for (const response of results) {
    assert.equal(response.status, 202);
    assert.equal(response.body.data, null);
  }
  assert.deepEqual(results[0].body, results[1].body);
  assert.deepEqual(results[0].body, results[2].body);
  assert.ok(
    mailer.proofs.some((item) => item.email === 'http-new@email-change.test'),
  );
  assert.equal(
    mailer.proofs.some((item) => item.email === other.email),
    false,
  );
  const occupiedPending = await http
    .get('/api/auth/email-change/pending')
    .auth((await session(occupied)).jwt, { type: 'bearer' });
  assert.ok(occupiedPending.body.data);
  const providerFailure = await source
    .getRepository(PendingEmailChange)
    .findOneByOrFail({ userId: failedMailActor.id });
  assert.equal(providerFailure.sentAt, null);
  assert.equal(providerFailure.issuanceAttempts.length, 1);
  pass(
    'real JWT/Swagger contracts, unverified rejection, normalization and identical generic 202 for available/occupied targets without an email oracle',
  );
  const context = {
    source,
    app,
    http,
    changes,
    reauth,
    auth,
    google,
    security,
    verification,
    mailer,
    resetMailer,
    profiles,
    factory,
    session,
    issue,
    tokenFor,
    age,
    makeOld,
    code,
    pass,
    password,
    hash,
    eventually,
  };
  await verifyEmailChangeQuotaAndFailures(context);
  await verifyEmailChangeRaces(context);
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries,
    [],
  );
  console.log(`Email change PostgreSQL suite: ${groups} groups passed`);
} finally {
  for (const socket of sockets) socket.disconnect();
  if (app) await app.close();
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
