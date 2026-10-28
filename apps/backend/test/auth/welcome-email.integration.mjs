import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';

// Owns one disposable loopback Docker database. Never loads .env or a real provider.
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { ConfigModule, ConfigService } = require('@nestjs/config');
const { TypeOrmModule } = require('@nestjs/typeorm');
const { Test } = require('@nestjs/testing');
const { Logger } = require('@nestjs/common');
const { ThrottlerModule } = require('@nestjs/throttler');
const { LoggerModule } = require('nestjs-pino');
const request = require('supertest');
const { databaseOptions } = require('../../dist/database/database-options.js');
const { validateEnvironment } = require('../../dist/config/environment.js');
const { configureHttpApplication } = require('../../dist/http-application.js');
const { AuthModule } = require('../../dist/api/auth/auth.module.js');
const { AuthService } = require('../../dist/api/auth/auth.service.js');
const {
  GoogleAuthService,
} = require('../../dist/api/auth/google-auth.service.js');
const {
  GoogleTokenVerifier,
} = require('../../dist/api/auth/google-token-verifier.service.js');
const {
  EmailVerificationService,
} = require('../../dist/api/auth/email-verification.service.js');
const {
  WelcomeOnboardingService,
} = require('../../dist/api/auth/welcome-onboarding.service.js');
const {
  FakeWelcomeMailer,
  WelcomeMailer,
} = require('../../dist/mail/welcome-mailer.js');
const {
  FakeVerificationMailer,
  VerificationMailer,
} = require('../../dist/mail/verification-mailer.js');
const name = `kanvexa-welcome-test-${randomBytes(6).toString('hex')}`;
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
const pass = (label) => console.log(`PASS ${++checks}: ${label}`);
const profiles = new Map();
const profile = (key, authoritativeEmail = true) => {
  profiles.set(key, {
    sub: key,
    email: `${key}@example.test`,
    displayName: 'New user',
    avatarUrl: null,
    authoritativeEmail,
  });
  return key;
};
Logger.overrideLogger(false);
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
    'POSTGRES_USER=welcome_test',
    '--env',
    'POSTGRES_DB=welcome_test',
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
    DATABASE_NAME: 'welcome_test',
    DATABASE_USER: 'welcome_test',
    DATABASE_PASSWORD: password,
    JWT_SECRET: randomBytes(32).toString('hex'),
    LOG_LEVEL: 'silent',
  });
  assert.equal(config.MAIL_TRANSPORT, 'fake');
  const options = databaseOptions({
    ...config,
    DATABASE_PORT: port,
    DATABASE_SSL: 'false',
  });
  for (let i = 0; i < 80; i++) {
    try {
      source = await new DataSource(options).initialize();
      break;
    } catch {
      await delay(250);
    }
  }
  assert(source, 'Disposable PostgreSQL must start');
  const migrations = [...source.migrations];
  source.migrations = migrations.filter(
    (migration) => !migration.name.startsWith('WelcomeEmailOutbox'),
  );
  await source.runMigrations();
  await source.query(`INSERT INTO users(email,display_name,email_verified_at) VALUES
    ('legacy@example.test','Legacy',now()),('pending-legacy@example.test','Pending legacy',NULL)`);
  source.migrations = migrations;
  assert.equal((await source.runMigrations()).length, 1);
  const count = async () =>
    (
      await source.query(
        'SELECT count(*)::int AS n FROM welcome_email_deliveries',
      )
    )[0].n;
  assert.equal(await count(), 0);
  await source.undoLastMigration();
  assert.equal((await source.runMigrations()).length, 1);
  const drift = await source.driver.createSchemaBuilder().log();
  assert.deepEqual(
    drift.upQueries.map((q) => q.query),
    [],
  );
  pass(
    'legacy verified/pending accounts are not enrolled; empty down/up and metadata match',
  );

  const verificationMailer = new FakeVerificationMailer();
  const fake = new FakeWelcomeMailer();
  let failRecipient, ambiguousRecipient, gateRecipient, entered, release;
  const mailer = {
    async send(message, key) {
      // Separate connection sees committed User + Personal Workspace + readiness.
      const [visible] = await source.query(
        `SELECT u.email_verified_at, w.id, d.ready_at
      FROM users u JOIN workspaces w ON w.created_by_id=u.id AND w.type='PERSONAL'
      JOIN welcome_email_deliveries d ON d.user_id=u.id WHERE u.email=$1`,
        [message.to],
      );
      assert.ok(visible?.email_verified_at && visible.ready_at && visible.id);
      if (message.to === gateRecipient) {
        entered();
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      if (message.to === failRecipient)
        throw new Error('Synthetic provider rejection');
      await fake.send(message, key);
      if (message.to === ambiguousRecipient)
        throw new Error('Synthetic response lost after acceptance');
    },
  };
  const worker = new WelcomeOnboardingService(
    source,
    mailer,
    new ConfigService(config),
  );
  // Keep this suite deterministic; production bootstrap/timers use this same drain.
  worker.onApplicationBootstrap = () => {};
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        load: [() => config],
      }),
      TypeOrmModule.forRoot(options),
      ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10000 }]),
      LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
      AuthModule,
    ],
  })
    .overrideProvider(WelcomeOnboardingService)
    .useValue(worker)
    .overrideProvider(WelcomeMailer)
    .useValue(mailer)
    .overrideProvider(VerificationMailer)
    .useValue(verificationMailer)
    .overrideProvider(GoogleTokenVerifier)
    .useValue({
      verify: async (credential) => {
        assert(
          profiles.has(credential),
          'Only synthetic Google credentials accepted',
        );
        return profiles.get(credential);
      },
    })
    .compile();
  app = module.createNestApplication({ logger: false });
  configureHttpApplication(app);
  await app.init();
  const http = request(app.getHttpServer());
  const auth = app.get(AuthService);
  const google = app.get(GoogleAuthService);
  const verification = app.get(EmailVerificationService);
  const row = async (email) =>
    (
      await source.query(
        `SELECT d.* FROM welcome_email_deliveries d JOIN users u ON u.id=d.user_id WHERE u.email=$1`,
        [email],
      )
    )[0];
  const user = async (email) =>
    source.getRepository('User').findOneByOrFail({ email });
  const token = () =>
    new URL(verificationMailer.deliveries.at(-1).url).searchParams.get('token');
  const register = async (email) => {
    const input = {
      email,
      displayName: 'Welcome user',
      password: 'Kanvexa@2026-Strong',
    };
    await http.post('/api/auth/register').send(input).expect(201);
    return input;
  };
  const input = await register('email@example.test');
  assert.equal(fake.deliveries.length, 0);
  assert.equal((await row(input.email)).ready_at, null);
  await worker.deliverPending();
  assert.equal(fake.deliveries.length, 0);
  await http
    .post('/api/auth/login')
    .send({ email: input.email, password: input.password })
    .expect(403);
  const value = token();
  const outcomes = await Promise.all([
    http.post('/api/auth/verify-email').send({ token: value }),
    http.post('/api/auth/verify-email').send({ token: value }),
  ]);
  assert.deepEqual(outcomes.map((result) => result.status).sort(), [204, 400]);
  await http.post('/api/auth/verify-email').send({ token: value }).expect(400);
  assert.equal(fake.deliveries.length, 1);
  assert.ok((await row(input.email)).sent_at);
  await auth.login({ email: input.email, password: input.password });
  await worker.deliverPending();
  assert.equal(fake.deliveries.length, 1);
  pass(
    'unverified signup sends verification only; concurrent verification welcomes once after commit; login never resends',
  );

  const key = profile('google-new');
  const concurrent = await Promise.all([
    google.signIn(key),
    google.signIn(key),
  ]);
  assert.equal(concurrent[0].user.id, concurrent[1].user.id);
  assert.equal(fake.deliveries.length, 2);
  await google.signIn(key);
  await google.link(
    (await user(input.email)).id,
    profile('email'),
    input.password,
  );
  await google.link((await user(input.email)).id, 'email', input.password);
  await google.signIn('email');
  assert.equal(fake.deliveries.length, 2);
  pass(
    'concurrent first Google signup welcomes once; existing sign-in and identity linking never resend',
  );

  await assert.rejects(
    google.signIn(profile('unverified-google', false)),
    (error) => error.getStatus() === 403,
  );
  assert.equal(fake.deliveries.length, 2);
  assert.equal((await row('unverified-google@example.test')).ready_at, null);
  await verification.verify(token());
  assert.equal(fake.deliveries.length, 3);
  pass('non-authoritative Google accounts wait for email verification');

  await verification.send('pending-legacy@example.test');
  await verification.verify(token());
  await worker.deliverPending();
  assert.equal(fake.deliveries.length, 3);
  assert.equal(await row('pending-legacy@example.test'), undefined);
  pass(
    'verification of a pre-deployment pending user never creates welcome eligibility',
  );

  // A deferred failure occurs at COMMIT, after User/Workspace/outbox inserts ran.
  await source.query(`CREATE FUNCTION reject_welcome_commit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id AND email LIKE 'rollback-%')
      THEN RAISE EXCEPTION 'Synthetic commit failure'; END IF; RETURN NEW; END $$`);
  await source.query(`CREATE CONSTRAINT TRIGGER reject_welcome_commit AFTER INSERT ON welcome_email_deliveries
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_welcome_commit()`);
  const beforeRollback = await count();
  try {
    await assert.rejects(
      auth.register({ ...input, email: 'rollback-email@example.test' }),
      /Synthetic commit failure/,
    );
    await assert.rejects(
      google.signIn(profile('rollback-google')),
      /Synthetic commit failure/,
    );
  } finally {
    await source.query(
      'DROP TRIGGER reject_welcome_commit ON welcome_email_deliveries',
    );
    await source.query('DROP FUNCTION reject_welcome_commit()');
  }
  assert.equal(
    await source
      .getRepository('User')
      .countBy({ email: 'rollback-email@example.test' }),
    0,
  );
  assert.equal(
    await source
      .getRepository('User')
      .countBy({ email: 'rollback-google@example.test' }),
    0,
  );
  assert.equal(await count(), beforeRollback);
  assert.equal(fake.deliveries.length, 3);
  pass(
    'deferred commit failures roll back local/Google User, Workspace and outbox without sending',
  );

  // Verification itself can roll back after readiness; no mail or consumed token survives.
  await register('verification-rollback@example.test');
  const rollbackToken = token();
  await source.query(`CREATE FUNCTION reject_welcome_ready() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Synthetic ready rollback'; END $$`);
  await source.query(`CREATE TRIGGER reject_welcome_ready AFTER UPDATE ON welcome_email_deliveries
    FOR EACH ROW EXECUTE FUNCTION reject_welcome_ready()`);
  try {
    await assert.rejects(
      verification.verify(rollbackToken),
      /Synthetic ready rollback/,
    );
  } finally {
    await source.query(
      'DROP TRIGGER reject_welcome_ready ON welcome_email_deliveries',
    );
    await source.query('DROP FUNCTION reject_welcome_ready()');
  }
  assert.equal(
    (await user('verification-rollback@example.test')).emailVerifiedAt,
    null,
  );
  assert.equal(
    (await row('verification-rollback@example.test')).ready_at,
    null,
  );
  assert.equal(fake.deliveries.length, 3);
  await verification.verify(rollbackToken);
  assert.equal(fake.deliveries.length, 4);
  pass(
    'verification rollback retains a usable token and unsent eligibility; retry succeeds',
  );

  failRecipient = 'provider-fail@example.test';
  const failedGoogle = await google.signIn(profile('provider-fail'));
  assert.ok(failedGoogle.accessToken);
  assert.equal((await row(failRecipient)).sent_at, null);
  await register('verify-provider-fail@example.test');
  failRecipient = 'verify-provider-fail@example.test';
  await http
    .post('/api/auth/verify-email')
    .send({ token: token() })
    .expect(204);
  assert.ok((await user(failRecipient)).emailVerifiedAt);
  failRecipient = undefined;
  await source.query(`UPDATE welcome_email_deliveries SET next_attempt_at=now()-interval '1 second'
    WHERE sent_at IS NULL AND ready_at IS NOT NULL`);
  // A fresh service instance represents recovery after a process restart.
  const restarted = new WelcomeOnboardingService(
    source,
    mailer,
    new ConfigService(config),
  );
  await restarted.deliverPending();
  assert.equal(fake.deliveries.length, 6);
  pass(
    'provider failures preserve Google login/verification; a restarted worker recovers pending mail',
  );

  ambiguousRecipient = 'ambiguous@example.test';
  await google.signIn(profile('ambiguous'));
  const frozen = (await row(ambiguousRecipient)).message;
  const attemptsBefore = (await row(ambiguousRecipient)).attempts;
  assert.equal(fake.deliveries.length, 7);
  assert.equal((await row(ambiguousRecipient)).sent_at, null);
  await source.query(
    `UPDATE welcome_email_deliveries SET next_attempt_at=now()-interval '1 second' WHERE user_id=$1`,
    [(await user(ambiguousRecipient)).id],
  );
  ambiguousRecipient = undefined;
  const changedConfig = new ConfigService({
    ...config,
    PUBLIC_APP_URL: 'https://changed.example.test',
    MAIL_FROM: 'Changed <changed@example.test>',
  });
  const changedWorker = new WelcomeOnboardingService(
    source,
    mailer,
    changedConfig,
  );
  await changedWorker.deliverPending();
  const recovered = await row('ambiguous@example.test');
  assert.ok(recovered.sent_at);
  assert.equal(recovered.attempts, attemptsBefore + 1);
  assert.deepEqual(recovered.message, frozen);
  assert.equal(fake.deliveries.length, 7);
  pass(
    'ambiguous acceptance reuses identical key/body/sender after configuration changes',
  );

  // Lost success bookkeeping: hold an expired lease, then race independent workers.
  await register('claim-race@example.test');
  const claimUser = await user('claim-race@example.test');
  await source.transaction(async (manager) => {
    claimUser.emailVerifiedAt = new Date();
    await manager.getRepository('User').save(claimUser);
    await worker.ready(manager, claimUser);
  });
  gateRecipient = claimUser.email;
  const enteredPromise = new Promise((resolve) => {
    entered = resolve;
  });
  const sending = restarted.deliverPending(claimUser.id);
  await enteredPromise;
  try {
    await changedWorker.deliverPending(claimUser.id);
    assert.equal((await row(claimUser.email)).attempts, 1);
    // A separate transaction can mutate the User while the provider is blocked.
    await source.transaction(async (manager) => {
      await manager.query("SET LOCAL lock_timeout='500ms'");
      await manager.query('UPDATE users SET display_name=$1 WHERE id=$2', [
        'Concurrent edit',
        claimUser.id,
      ]);
    });
  } finally {
    release();
    await sending;
    gateRecipient = undefined;
  }
  assert.equal(fake.deliveries.length, 8);
  assert.ok((await row(claimUser.email)).sent_at);
  pass(
    'independent workers honor leases; provider calls retain no account transaction locks',
  );

  await register('lease-recovery@example.test');
  const leaseUser = await user('lease-recovery@example.test');
  await source.transaction(async (manager) => {
    leaseUser.emailVerifiedAt = new Date();
    await manager.getRepository('User').save(leaseUser);
    await worker.ready(manager, leaseUser);
  });
  await source.query(
    `UPDATE welcome_email_deliveries SET lease_token=gen_random_uuid(), lease_until=now()-interval '2 minutes',
    first_attempt_at=now()-interval '2 minutes', attempts=1, next_attempt_at=now()-interval '1 minute' WHERE user_id=$1`,
    [leaseUser.id],
  );
  await Promise.all([
    restarted.deliverPending(leaseUser.id),
    changedWorker.deliverPending(leaseUser.id),
  ]);
  assert.equal(fake.deliveries.length, 9);
  assert.equal((await row(leaseUser.email)).attempts, 2);
  pass('expired process leases are reclaimed once under concurrent recovery');

  failRecipient = 'expired@example.test';
  await google.signIn(profile('expired'));
  failRecipient = undefined;
  await source.query(
    `UPDATE welcome_email_deliveries SET first_attempt_at=now()-interval '24 hours',
    next_attempt_at=now()-interval '1 second' WHERE user_id=$1`,
    [(await user('expired@example.test')).id],
  );
  await restarted.deliverPending();
  assert.ok((await row('expired@example.test')).stopped_at);
  assert.equal(fake.deliveries.length, 9);
  await assert.rejects(
    source.undoLastMigration(),
    /Cannot revert welcome email outbox/,
  );
  await assert.rejects(
    source.query('INSERT INTO welcome_email_deliveries(user_id) VALUES($1)', [
      claimUser.id,
    ]),
    (error) => error.code === '23505',
  );
  await assert.rejects(
    source.query(
      'UPDATE welcome_email_deliveries SET attempts=-1 WHERE user_id=$1',
      [claimUser.id],
    ),
    (error) => error.code === '23514',
  );
  pass(
    'old ambiguous attempts stop without resending; populated rollback/duplicate eligibility/invalid attempts are rejected',
  );
  console.log(`${checks} welcome PostgreSQL/HTTP integration checks passed.`);
} finally {
  if (app) await app.close();
  if (source?.isInitialized) await source.destroy();
  if (started) docker('rm', '--force', name);
}
