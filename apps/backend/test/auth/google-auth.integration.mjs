import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

// Isolated PostgreSQL and explicit config; never reads .env or contacts Google/mail.
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { ConfigModule, ConfigService } = require('@nestjs/config');
const { TypeOrmModule } = require('@nestjs/typeorm');
const { Test } = require('@nestjs/testing');
const { LoggerModule } = require('nestjs-pino');
const argon2 = require('argon2');
const request = require('supertest');
const { databaseOptions } = require('../../dist/database/database-options.js');
const { validateEnvironment } = require('../../dist/config/environment.js');
const { configureHttpApplication } = require('../../dist/http-application.js');
const { AuthModule } = require('../../dist/api/auth/auth.module.js');
const { UsersModule } = require('../../dist/api/users/users.module.js');
const { AuthService } = require('../../dist/api/auth/auth.service.js');
const {
  GoogleAuthService,
} = require('../../dist/api/auth/google-auth.service.js');
const {
  GoogleTokenVerifier,
} = require('../../dist/api/auth/google-token-verifier.service.js');
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
const { User } = require('../../dist/api/users/entities/user.entity.js');

const name = `kanvexa-google-test-${randomBytes(6).toString('hex')}`;
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
const check = (label) => {
  checks++;
  console.log(`PASS: ${label}`);
};
const rejectCode = (promise, code) =>
  assert.rejects(promise, (error) => error.getResponse?.().code === code);
const profiles = new Map();
let duringVerify;
const verifier = {
  verify: async (credential) => {
    if (duringVerify) {
      const work = duringVerify;
      duringVerify = undefined;
      await work();
    }
    assert(
      profiles.has(credential),
      'Only explicit mocked test credentials are allowed',
    );
    return { ...profiles.get(credential) };
  },
};
const profile = (key, email, authoritativeEmail = true, sub = key) => {
  profiles.set(key, {
    sub,
    email,
    authoritativeEmail,
    displayName: 'Google User',
    avatarUrl: null,
  });
  return key;
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
    'POSTGRES_USER=google_test',
    '--env',
    'POSTGRES_DB=google_test',
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
    DATABASE_NAME: 'google_test',
    DATABASE_USER: 'google_test',
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
  for (let i = 0; i < 80; i++) {
    try {
      source = await new DataSource({
        ...options,
        migrations: [Initial, Email],
      }).initialize();
      break;
    } catch {
      await delay(250);
    }
  }
  assert(source, 'Disposable PostgreSQL must start');
  await source.runMigrations();
  const hash = await argon2.hash('legacy', { type: argon2.argon2id });
  const [legacy] = await source.query(
    `INSERT INTO users(email,password_hash,display_name,email_verified_at)
    VALUES('legacy@example.com',$1,'Legacy',now()) RETURNING id`,
    [hash],
  );
  await source.query(
    `INSERT INTO boards(name,created_by_id) VALUES('Preserved board',$1)`,
    [legacy.id],
  );
  await source.destroy();
  source = await new DataSource(options).initialize();
  assert.equal((await source.runMigrations()).length, 1);
  assert.equal(
    (
      await source.query('SELECT password_hash FROM users WHERE id=$1', [
        legacy.id,
      ])
    )[0].password_hash,
    hash,
  );
  await source.undoLastMigration();
  assert.equal(
    (
      await source.query(
        `SELECT is_nullable FROM information_schema.columns WHERE table_name='users' AND column_name='password_hash'`,
      )
    )[0].is_nullable,
    'NO',
  );
  await source.runMigrations();
  assert.equal((await source.runMigrations()).length, 0);
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries.map(
      (q) => q.query,
    ),
    [],
    'No entity/migration schema drift',
  );
  check(
    'upgrade/backward-compatible empty rollback/rerun preserve legacy hash and board',
  );

  const mailer = new FakeVerificationMailer();
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        load: [() => config],
      }),
      TypeOrmModule.forRoot(options),
      LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
      AuthModule,
      UsersModule,
    ],
  })
    .overrideProvider(GoogleTokenVerifier)
    .useValue(verifier)
    .overrideProvider(VerificationMailer)
    .useValue(mailer)
    .compile();
  app = module.createNestApplication({ logger: false });
  configureHttpApplication(app);
  await app.init();
  const service = app.get(GoogleAuthService);
  const auth = app.get(AuthService);
  const http = request(app.getHttpServer());
  const legacyLogin = await auth.login({
    email: 'legacy@example.com',
    password: 'legacy',
  });
  const countUsers = async () =>
    (await source.query('SELECT count(*)::int AS n FROM users'))[0].n;
  const local = async (email, verified = true) =>
    source.getRepository(User).save({
      email,
      passwordHash: hash,
      displayName: 'Local',
      avatarUrl: null,
      emailVerifiedAt: verified ? new Date() : null,
    });

  const newKey = profile('new-google', 'new@gmail.com');
  const first = await service.signIn(newKey);
  const firstUser = await source
    .getRepository(User)
    .findOneByOrFail({ id: first.user.id });
  assert.equal(firstUser.passwordHash, null);
  assert(firstUser.emailVerifiedAt);
  assert.deepEqual(await service.linkedProviders(first.user.id), {
    googleLinked: true,
    hasPassword: false,
  });
  await rejectCode(
    auth.login({ email: firstUser.email, password: 'legacy' }),
    'INVALID_CREDENTIALS',
  );
  await http
    .get('/api/users/me')
    .set('Authorization', `Bearer ${first.accessToken}`)
    .expect(200);
  await http
    .get('/api/users/me')
    .set('Authorization', 'Bearer google-id-token')
    .expect(401);
  check(
    'Google-only creation issues Kanvexa JWT; NULL password cannot login; Google token cannot authorize REST',
  );

  await local('changed@gmail.com');
  profiles.get(newKey).email = 'changed@gmail.com';
  profiles.get(newKey).displayName = 'Changed externally';
  const returning = await service.signIn(newKey);
  assert.equal(returning.user.id, first.user.id);
  assert.equal(returning.user.email, 'new@gmail.com');
  assert.equal(returning.user.displayName, 'Google User');
  check(
    'returning sub ignores changed Google email/profile even when new email belongs to another user',
  );

  for (const verified of [true, false]) {
    const email = `collision-${verified}@example.com`;
    await local(email, verified);
    const before = await countUsers();
    await rejectCode(
      service.signIn(profile(`collision-${verified}`, email)),
      'ACCOUNT_LINK_REQUIRED',
    );
    assert.equal(await countUsers(), before);
  }
  check(
    'verified and unverified local collisions never auto-link or create a session/user',
  );

  const legacyKey = profile('legacy-google', 'legacy@example.com', false);
  await rejectCode(
    service.link(legacy.id, legacyKey, 'wrong'),
    'INVALID_CREDENTIALS',
  );
  await rejectCode(
    service.link(
      legacy.id,
      profile('wrong-email', 'attacker@gmail.com'),
      'legacy',
    ),
    'GOOGLE_ACCOUNT_CONFLICT',
  );
  await service.link(legacy.id, legacyKey, 'legacy');
  await service.link(legacy.id, legacyKey, 'legacy');
  assert.equal((await service.signIn(legacyKey)).user.id, legacy.id);
  assert.equal(
    (await auth.login({ email: 'legacy@example.com', password: 'legacy' })).user
      .id,
    legacy.id,
  );
  assert.deepEqual(await service.linkedProviders(legacy.id), {
    googleLinked: true,
    hasPassword: true,
  });
  assert.equal(
    (
      await source.query('SELECT password_hash FROM users WHERE id=$1', [
        legacy.id,
      ])
    )[0].password_hash,
    hash,
  );
  await http
    .get('/api/users/me')
    .set('Authorization', `Bearer ${legacyLogin.accessToken}`)
    .expect(200);
  check(
    'explicit password reauth/link is idempotent, accepts locally verified third-party email, preserves weak legacy password and JWT',
  );

  await rejectCode(
    service.link(
      legacy.id,
      profile('second-sub', 'legacy@example.com'),
      'legacy',
    ),
    'GOOGLE_ACCOUNT_CONFLICT',
  );
  const victim = await local('victim@example.com');
  await rejectCode(
    service.link(
      victim.id,
      profile('steal', victim.email, true, 'legacy-google'),
      'legacy',
    ),
    'GOOGLE_ACCOUNT_CONFLICT',
  );
  await rejectCode(
    service.link(first.user.id, newKey, 'legacy'),
    'INVALID_CREDENTIALS',
  );
  const unverified = await local('unverified@example.com', false);
  await rejectCode(
    service.link(
      unverified.id,
      profile('unverified-link', unverified.email),
      'legacy',
    ),
    'INVALID_CREDENTIALS',
  );
  check(
    'second provider, identity transfer, passwordless and unverified linking fail closed',
  );

  const pendingKey = profile('third-party', 'third@example.com', false);
  await rejectCode(service.signIn(pendingKey), 'EMAIL_NOT_VERIFIED');
  const pending = await source
    .getRepository(User)
    .findOneByOrFail({ email: 'third@example.com' });
  assert.equal(pending.emailVerifiedAt, null);
  assert.equal(pending.passwordHash, null);
  const deliveries = mailer.deliveries.length;
  await rejectCode(service.signIn(pendingKey), 'EMAIL_NOT_VERIFIED');
  assert.equal(mailer.deliveries.length, deliveries);
  const token = new URL(mailer.deliveries.at(-1).url).searchParams.get('token');
  await http.post('/api/auth/verify-email').send({ token }).expect(204);
  assert.equal((await service.signIn(pendingKey)).user.id, pending.id);
  check(
    'third-party email requires K2 verification with cooldown; verified account then signs in with Google',
  );

  const raceKey = profile('race-signup', 'race@gmail.com');
  const concurrent = await Promise.all(
    Array.from({ length: 6 }, () => service.signIn(raceKey)),
  );
  assert.equal(new Set(concurrent.map((r) => r.user.id)).size, 1);
  assert.equal(
    (
      await source.query(
        `SELECT count(*)::int AS n FROM users WHERE email='race@gmail.com'`,
      )
    )[0].n,
    1,
  );
  const sameEmailResults = await Promise.allSettled(
    ['a', 'b', 'c'].map((key) =>
      service.signIn(profile(`same-email-${key}`, 'same@gmail.com')),
    ),
  );
  assert.equal(
    sameEmailResults.filter((r) => r.status === 'fulfilled').length,
    1,
  );
  for (const result of sameEmailResults.filter((r) => r.status === 'rejected'))
    assert.equal(result.reason.getResponse().code, 'ACCOUNT_LINK_REQUIRED');
  check(
    'parallel same-sub and different-sub/same-email signup creates exactly one user/identity',
  );

  const raceLocal = await local('link-race@example.com');
  const linkA = profile('link-race-a', raceLocal.email);
  const linkB = profile('link-race-b', raceLocal.email);
  const links = await Promise.allSettled([
    service.link(raceLocal.id, linkA, 'legacy'),
    service.link(raceLocal.id, linkB, 'legacy'),
  ]);
  assert.equal(links.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    links.find((r) => r.status === 'rejected').reason.getResponse().code,
    'GOOGLE_ACCOUNT_CONFLICT',
  );
  const sameLinkLocal = await local('same-link@example.com');
  const sameLink = profile('same-link', sameLinkLocal.email);
  await Promise.all(
    Array.from({ length: 4 }, () =>
      service.link(sameLinkLocal.id, sameLink, 'legacy'),
    ),
  );
  check(
    'parallel competing link subjects have one winner; parallel same link is idempotent',
  );

  const signupLinkUser = await local('signup-link@example.com');
  const signupLinkKey = profile('signup-link', signupLinkUser.email);
  const signupLink = await Promise.allSettled([
    service.signIn(signupLinkKey),
    service.link(signupLinkUser.id, signupLinkKey, 'legacy'),
  ]);
  assert.equal(signupLink[1].status, 'fulfilled');
  if (signupLink[0].status === 'fulfilled')
    assert.equal(signupLink[0].value.user.id, signupLinkUser.id);
  else
    assert.equal(
      signupLink[0].reason.getResponse().code,
      'ACCOUNT_LINK_REQUIRED',
    );
  const registerRaceKey = profile('local-race', 'local-race@gmail.com');
  await Promise.allSettled([
    service.signIn(registerRaceKey),
    auth.register({
      email: 'local-race@gmail.com',
      password: 'Kanvexa@2026',
      displayName: 'Local Race',
    }),
  ]);
  assert.equal(
    (
      await source.query(
        `SELECT count(*)::int AS n FROM users WHERE email='local-race@gmail.com'`,
      )
    )[0].n,
    1,
  );
  check(
    'signup versus linking/local registration preserves single ownership and unique email',
  );

  const changedPasswordUser = await local('password-race@example.com');
  duringVerify = () =>
    source.query('UPDATE users SET password_hash=$1 WHERE id=$2', [
      hash + 'changed',
      changedPasswordUser.id,
    ]);
  await rejectCode(
    service.link(
      changedPasswordUser.id,
      profile('password-race', changedPasswordUser.email),
      'legacy',
    ),
    'INVALID_CREDENTIALS',
  );
  const beforeFailure = await countUsers();
  await assert.rejects(
    service.signIn(
      profile('broken-identity', 'atomic@gmail.com', true, 'x'.repeat(256)),
    ),
  );
  assert.equal(await countUsers(), beforeFailure);
  check(
    'hash changes invalidate password proof; failed identity insertion rolls back user creation',
  );

  await assert.rejects(
    source.query('DELETE FROM users WHERE id=$1', [first.user.id]),
    (e) => e.code === '23503',
  );
  await assert.rejects(
    source.undoLastMigration(),
    /Cannot revert Google identity/,
  );
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM boards WHERE created_by_id=$1',
        [legacy.id],
      )
    )[0].n,
    1,
  );
  assert(
    (
      await source.query('SELECT id FROM google_identities WHERE user_id=$1', [
        first.user.id,
      ])
    ).length,
  );
  assert.equal((await source.runMigrations()).length, 0);
  check(
    'FK prevents silent identity deletion; rollback refuses without losing users/identities/business data',
  );

  const swagger = await http.get('/api-docs-json').expect(200);
  for (const path of [
    '/api/auth/google',
    '/api/auth/google/link',
    '/api/auth/linked-providers',
  ])
    assert(swagger.body.paths[path]);
  console.log(
    `Google auth PostgreSQL verification: ${checks} checks passed (Google verifier mocked; no live OAuth).`,
  );
} finally {
  await app?.close();
  if (source?.isInitialized) await source.destroy();
  if (started) docker('stop', name);
}
