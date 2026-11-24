// Explicitly local-only: owns a disposable PostgreSQL container, fake mailbox,
// ephemeral Nest listener and in-memory credential store. Never reads .env/AWS.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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
import { preferencesApi } from '../../src/features/preferences/api.ts';
import { downloadExport } from '../../src/features/exports/model.ts';
import { blockerDestination } from '../../src/features/account-deletion/blockers.ts';
import { deletionCommands } from '../../src/features/account-deletion/commands.ts';
assert.notEqual(process.env.NODE_ENV, 'production');
const { fetch, AbortController } = globalThis;
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
const {
  GoogleTokenVerifier,
} = require('./dist/api/auth/google-token-verifier.service.js');
const googleProfiles = new Map();
const { hash } = require('argon2');
const { databaseOptions } = require('./dist/database/database-options.js');
const { validateEnvironment } = require('./dist/config/environment.js');
const { configureHttpApplication } = require('./dist/http-application.js');
const { UsersModule } = require('./dist/api/users/users.module.js');
const { BoardsModule } = require('./dist/api/boards/boards.module.js');
const { ExportsModule } = require('./dist/api/exports/exports.module.js');
const {
  WorkspaceApiModule,
} = require('./dist/api/workspaces/workspace-api.module.js');
const { AuthModule } = require('./dist/api/auth/auth.module.js');
const { AuthService } = require('./dist/api/auth/auth.service.js');
const { User } = require('./dist/api/users/entities/user.entity.js');
const {
  EmailChangeMailer,
  FakeEmailChangeMailer,
} = require('./dist/mail/email-change-mailer.js');

const name = `kanvexa-mob41-${randomBytes(6).toString('hex')}`;
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
    'POSTGRES_USER=mob41_test',
    '--env',
    'POSTGRES_DB=mob41_test',
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
    DATABASE_NAME: 'mob41_test',
    DATABASE_USER: 'mob41_test',
    DATABASE_PASSWORD: databasePassword,
    DATABASE_SSL: 'false',
    JWT_SECRET: randomBytes(32).toString('hex'),
    PUBLIC_APP_URL: 'https://web.mob41.test',
    MAIL_TRANSPORT: 'fake',
    GOOGLE_CLIENT_ID: '123456-local-only.apps.googleusercontent.com',
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
      BoardsModule,
      ExportsModule,
      WorkspaceApiModule,
    ],
  })
    .overrideProvider(DataSource)
    .useValue(source)
    .overrideProvider(EmailChangeMailer)
    .useValue(mailer)
    .overrideProvider(GoogleTokenVerifier)
    .useValue({
      verify: async (token, maxAge) => {
        assert.equal(maxAge, 300);
        assert.ok(googleProfiles.has(token));
        return googleProfiles.get(token);
      },
    })
    .compile();
  app = module.createNestApplication({ logger: false });
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');
  const password = 'Mob41LocalProof!2026';
  const users = source.getRepository(User),
    auth = app.get(AuthService);
  const passwordHash = await hash(password);
  const alice = await users.save(
    users.create({
      email: 'alice@mob41.test',
      displayName: 'Profile Tester',
      passwordHash,
      emailVerifiedAt: new Date(),
    }),
  );
  const bob = await users.save(
    users.create({
      email: 'bob@mob41.test',
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
    commands = deletionCommands(data, manager, identity);
  const signal = () => new AbortController().signal;
  const profile = await createProfileApi(data.api, identity).patch(
    'Native Settings Tester',
    signal(),
  );
  data.adoptUser(identity, profile);
  const prefs = await preferencesApi(data.api, identity).patch(
    {
      theme: 'dark',
      timeZone: 'America/New_York',
      dateFormat: 'DD/MM/YYYY',
      weekStartsOn: 'sunday',
    },
    signal(),
  );
  assert.equal(prefs.theme, 'dark');
  assert.equal(prefs.timeZone, 'America/New_York');
  const accountExport = await downloadExport(
    data.api,
    identity,
    { kind: 'account' },
    signal(),
  );
  assert.ok(accountExport.bytes.length > 0);
  assert.equal(accountExport.mimeType, 'application/json');
  console.log(
    'PASS: combined native Profile, Appearance/Regional Preferences, Security status and Account JSON export remain compatible',
  );
  const input = { confirmation: 'DELETE', method: 'password', password };
  await commands.refresh();
  assert.deepEqual(commands.getSnapshot().providers, {
    hasPassword: true,
    googleLinked: false,
  });
  await commands.submit({ ...input, password: 'WrongLocalProof!' }, null);
  assert.match(commands.getSnapshot().error, /password is incorrect/);
  assert.ok(data.getIdentity());
  console.log(
    'PASS: real native provider contract and definite 403 proof rejection retain session',
  );
  const [personal] = await source.query(
    'SELECT ensure_personal_workspace($1) id',
    [alice.id],
  );
  const [team] = await source.query(
    "INSERT INTO workspaces(type,name,created_by_id) VALUES ('TEAM','Local team',$1) RETURNING id",
    [alice.id],
  );
  await source.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN')",
    [team.id, alice.id],
  );
  const [board] = await source.query(
    "INSERT INTO boards(name,created_by_id,workspace_id,is_archived) VALUES ('Local archived board',$1,$2,true) RETURNING id",
    [alice.id, personal.id],
  );
  await source.query(
    "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')",
    [board.id, alice.id],
  );
  await commands.submit(input, null);
  assert.deepEqual(
    new Set(commands.getSnapshot().blockers.map((b) => b.type)),
    new Set([
      'PERSONAL_WORKSPACE_HAS_BOARDS',
      'BOARD_REQUIRES_ANOTHER_OWNER',
      'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN',
    ]),
  );
  assert.equal(
    commands
      .getSnapshot()
      .blockers.find((b) => b.type === 'PERSONAL_WORKSPACE_HAS_BOARDS')
      .resources[0].name,
    'Local archived board',
  );
  assert.equal(stored.size, 0);
  assert.ok(data.getIdentity());
  assert.equal(
    await blockerDestination(
      data,
      identity,
      'PERSONAL_WORKSPACE_HAS_BOARDS',
      board.id,
      signal(),
    ),
    `/boards/${board.id}/settings`,
  );
  assert.equal(
    await blockerDestination(
      data,
      identity,
      'BOARD_REQUIRES_ANOTHER_OWNER',
      board.id,
      signal(),
    ),
    `/boards/${board.id}/settings`,
  );
  assert.equal(
    await blockerDestination(
      data,
      identity,
      'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN',
      team.id,
      signal(),
    ),
    `/workspaces/${team.id}/members`,
  );
  const boardExport = await downloadExport(
    data.api,
    identity,
    { kind: 'board', boardId: board.id, format: 'csv' },
    signal(),
  );
  assert.ok(boardExport.bytes.length > 0);
  assert.equal(boardExport.mimeType, 'text/csv');
  console.log(
    'PASS: real 409 projection includes all three blockers and archived resource summaries; no automatic retry',
  );
  await source.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN')",
    [team.id, bob.id],
  );
  await source.query(
    "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')",
    [board.id, bob.id],
  );
  await source.query('UPDATE boards SET workspace_id=$1 WHERE id=$2', [
    team.id,
    board.id,
  ]);
  data.queryClient.setQueryData(
    [...queryKeys.scope(identity), 'search', 'private'],
    { private: 'local-only' },
  );
  await commands.submit(input, null);
  assert.equal(manager.getSnapshot().reason, 'account-deleted');
  assert.equal(stored.size, 0);
  assert.equal(
    data.queryClient.getQueriesData({ queryKey: queryKeys.private }).length,
    0,
  );
  assert.equal(
    (await users.findOneByOrFail({ id: alice.id })).displayName,
    'Deleted user',
  );
  assert.equal(
    (
      await source.query('SELECT count(*)::int n FROM boards WHERE id=$1', [
        board.id,
      ])
    )[0].n,
    1,
  );
  const revoked = await fetch(`${await app.getUrl()}/api/users/me`, {
    headers: { Authorization: `Bearer ${login.accessToken}` },
  });
  assert.equal(revoked.status, 401);
  console.log(
    'PASS: native deliberate 204 teardown, revoked bearer, empty credential/cache, retained shared board and Deleted user identity',
  );
  // Use a synthetic verifier and a fresh native proof, never a real Google account.
  await source.query('DELETE FROM boards WHERE id=$1', [board.id]);
  await source.query(
    'DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
    [team.id, bob.id],
  );
  const googleProfile = {
    sub: 'mob41-local-google',
    email: bob.email,
    authoritativeEmail: true,
    displayName: bob.displayName,
    avatarUrl: null,
  };
  await source.query(
    'INSERT INTO google_identities(user_id,google_sub) VALUES ($1,$2)',
    [bob.id, googleProfile.sub],
  );
  const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ aud: '123456-local-only.apps.googleusercontent.com', iss: 'https://accounts.google.com' })).toString('base64url')}.local`;
  googleProfiles.set(token, googleProfile);
  assert.equal((await manager.establishSession(other)).ok, true);
  const googleCommands = deletionCommands(data, manager, data.getIdentity());
  let resets = 0;
  await googleCommands.submit(
    { confirmation: 'DELETE', method: 'google', password: '' },
    {
      webClientId: '123456-local-only.apps.googleusercontent.com',
      requestIdToken: async () => ({ kind: 'token', idToken: token }),
      reset: async () => {
        resets++;
      },
    },
  );
  assert.equal(resets, 2);
  assert.equal(manager.getSnapshot().reason, 'account-deleted');
  assert.ok((await users.findOneByOrFail({ id: bob.id })).deletedAt);
  console.log(
    'PASS: fresh linked Google proof uses the five-minute backend verification contract with no login exchange',
  );
} finally {
  data?.dispose();
  manager?.dispose();
  await app?.close();
  if (source?.isInitialized) await source.destroy();
  if (started) docker('rm', '--force', name);
}
