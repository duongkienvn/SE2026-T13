import assert from 'node:assert/strict';
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyDeletionAcceptance } from './account-deletion.acceptance.mjs';
import { verifyDeletionRaces } from './account-deletion.races.mjs';

// Own the PostgreSQL server and synthetic credentials. Never read .env or use AWS/mail.
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { TypeOrmModule } = require('@nestjs/typeorm');
const { LoggerModule } = require('nestjs-pino');
const { ThrottlerModule } = require('@nestjs/throttler');
const { APP_GUARD } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const request = require('supertest');
const argon2 = require('argon2');
const { io } = createRequire(
  new URL('../../../frontend/package.json', import.meta.url),
)('socket.io-client');
const { databaseOptions } = require('../../dist/database/database-options.js');
const { validateEnvironment } = require('../../dist/config/environment.js');
const { configureHttpApplication } = require('../../dist/http-application.js');
const {
  HttpThrottlerGuard,
} = require('../../dist/guards/http-throttler.guard.js');
const { AuthModule } = require('../../dist/api/auth/auth.module.js');
const { UsersModule } = require('../../dist/api/users/users.module.js');
const {
  WorkspaceApiModule,
} = require('../../dist/api/workspaces/workspace-api.module.js');
const { BoardsModule } = require('../../dist/api/boards/boards.module.js');
const { CardsModule } = require('../../dist/api/cards/cards.module.js');
const {
  CommentsModule,
} = require('../../dist/api/comments/comments.module.js');
const {
  ActivitiesModule,
} = require('../../dist/api/activities/activities.module.js');
const {
  NotificationsModule,
} = require('../../dist/api/notifications/notifications.module.js');
const { RealtimeModule } = require('../../dist/realtime/realtime.module.js');
const {
  GoogleTokenVerifier,
} = require('../../dist/api/auth/google-token-verifier.service.js');
const { AuthService } = require('../../dist/api/auth/auth.service.js');
const {
  AccountDeletionService,
} = require('../../dist/api/users/account-deletion/account-deletion.service.js');
const {
  AccountDeletionReauthenticationService,
} = require('../../dist/api/users/account-deletion/account-deletion-reauthentication.service.js');
const { User } = require('../../dist/api/users/entities/user.entity.js');
const {
  ApplicationException,
} = require('../../dist/exceptions/application.exception.js');

const container = `kanvexa-deletion-test-${randomBytes(6).toString('hex')}`;
const secret = randomBytes(32).toString('hex');
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    env: { ...process.env, POSTGRES_PASSWORD: secret },
  }).trim();
let source,
  app,
  started = false,
  sequence = 0,
  groups = 0;
const sockets = [];
const password = 'LocalPass1!';
const pass = (label) => {
  groups++;
  console.log(`PASS: ${label}`);
};
async function eventually(check, label) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(15);
  }
  assert.fail(label);
}
try {
  docker(
    'run',
    '--detach',
    '--rm',
    '--name',
    container,
    '--publish',
    '127.0.0.1::5432',
    '--env',
    'POSTGRES_PASSWORD',
    '--env',
    'POSTGRES_USER=deletion_test',
    '--env',
    'POSTGRES_DB=deletion_test',
    'postgres:16.15-alpine3.24',
  );
  started = true;
  const port = docker(
    'inspect',
    '--format',
    '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
    container,
  );
  Object.assign(process.env, {
    DATABASE_HOST: '127.0.0.1',
    DATABASE_PORT: port,
    DATABASE_USER: 'deletion_test',
    DATABASE_PASSWORD: secret,
    DATABASE_NAME: 'deletion_test',
    DATABASE_SSL: 'false',
    NODE_ENV: 'test',
    MAIL_TRANSPORT: 'fake',
    EMAIL_CHANGE_DATABASE_TESTS: 'local-only',
    NOTIFICATION_DATABASE_TESTS: 'local-only',
    WORKSPACE_DATABASE_TESTS: 'local-only',
    ATTACHMENTS_DATABASE_TESTS: 'local-only',
    PRIVATE_FILE_DATABASE_TESTS: 'local-only',
    EXPORT_DATABASE_TESTS: 'local-only',
    GOOGLE_CLIENT_ID: '',
    AVATAR_STORAGE_DRIVER: 'disabled',
    ATTACHMENT_STORAGE_DRIVER: 'disabled',
    TASK_NOTIFICATION_JOBS_ENABLED: 'false',
    TASK_NOTIFICATION_EMAIL_ENABLED: 'false',
    PUBLIC_APP_URL: 'http://localhost:5173',
    JWT_SECRET: randomBytes(32).toString('hex'),
    LOG_LEVEL: 'silent',
    RATE_LIMIT_MAX: '10000',
  });
  const options = databaseOptions(process.env);
  for (let n = 0; ; n++) {
    try {
      source = await new DataSource(options).initialize();
      break;
    } catch (error) {
      if (n >= 80) throw error;
      await delay(250);
    }
  }
  const migrations = source.migrations;
  source.migrations = migrations.filter(
    (m) =>
      !m.name.startsWith('AccountDeletion') &&
      !m.name.startsWith('StarterBoardOnboarding'),
  );
  await source.runMigrations();
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const [legacy] = await source.query(
    "INSERT INTO users(email,display_name,password_hash,email_verified_at) VALUES ('legacy@deletion.test','Legacy',$1,now()) RETURNING *",
    [hash],
  );
  await source.query('SELECT ensure_personal_workspace($1)', [legacy.id]);
  const before = await source.query('SELECT * FROM users');
  const fks =
    await source.query(`SELECT conrelid::regclass::text AS source,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE contype='f' AND conrelid::regclass::text <> 'starter_board_provisions' ORDER BY conname`);
  source.migrations = migrations;
  assert.equal((await source.runMigrations()).length, 2);
  assert.deepEqual(
    await source.query('SELECT id,email,display_name,password_hash FROM users'),
    before.map(({ id, email, display_name, password_hash }) => ({
      id,
      email,
      display_name,
      password_hash,
    })),
  );
  assert.equal(
    (await source.query('SELECT deleted_at FROM users'))[0].deleted_at,
    null,
  );
  assert.deepEqual(
    await source.query(
      `SELECT conrelid::regclass::text AS source,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype='f' AND conrelid::regclass::text <> 'starter_board_provisions' ORDER BY conname`,
    ),
    fks,
  );
  assert.deepEqual(await source.runMigrations(), []);
  await assert.rejects(
    migrations.find((m) => m.name.startsWith('AccountDeletion')).down(),
    /forward-only/,
  );
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries,
    [],
  );
  assert.equal(source.options.synchronize, false);
  assert.equal(source.options.migrationsRun, false);
  console.log(
    'Reviewed User FK inventory:',
    fks
      .filter((fk) => fk.definition.includes('REFERENCES users('))
      .map(({ source, definition }) => `${source}: ${definition}`)
      .join('\n'),
  );
  pass(
    `full ${migrations.length}-migration chain/populated upgrade/unchanged FK graph/zero ORM drift/rollback refusal`,
  );

  const environment = validateEnvironment({
    ...process.env,
    SWAGGER_ENABLED: 'true',
    AVATAR_STORAGE_DRIVER: 'memory',
    TRUST_PROXY_HOPS: '1',
  });
  const profiles = new Map();
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => environment],
      }),
      LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
      TypeOrmModule.forRoot(options),
      ThrottlerModule.forRoot([{ ttl: 60000, limit: 10000 }]),
      AuthModule,
      UsersModule,
      WorkspaceApiModule,
      BoardsModule,
      CardsModule,
      CommentsModule,
      ActivitiesModule,
      NotificationsModule,
      RealtimeModule,
    ],
    providers: [{ provide: APP_GUARD, useClass: HttpThrottlerGuard }],
  })
    .overrideProvider(DataSource)
    .useValue(source)
    .overrideProvider(GoogleTokenVerifier)
    .useValue({
      verify: async (credential, maxAge) => {
        assert.ok(maxAge === undefined || maxAge === 300);
        if (!profiles.has(credential))
          throw new ApplicationException(
            401,
            'INVALID_GOOGLE_CREDENTIAL',
            'Google sign-in could not be verified',
          );
        return profiles.get(credential);
      },
    })
    .compile();
  app = module.createNestApplication();
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');
  const http = request(app.getHttpServer()),
    jwt = app.get(JwtService),
    auth = app.get(AuthService);
  const deletion = app.get(AccountDeletionService),
    reauth = app.get(AccountDeletionReauthenticationService);
  const session = async (user) => {
    const row = await source
      .getRepository(User)
      .findOneByOrFail({ id: user.id });
    return {
      identity: {
        userId: row.id,
        authVersion: row.authVersion,
        expiresAt: Date.now() + 3600000,
      },
      jwt: await jwt.signAsync({ sub: row.id, authVersion: row.authVersion }),
    };
  };
  const factory = async (kind = 'password', verified = true) => {
    const user = await source.getRepository(User).save({
      email: `user-${++sequence}@deletion.test`,
      displayName: `Private Name ${sequence}`,
      passwordHash: kind === 'google' ? null : hash,
      emailVerifiedAt: verified ? new Date() : null,
      avatarUrl: 'https://example.test/private-avatar',
    });
    await source.query('SELECT ensure_personal_workspace($1)', [user.id]);
    if (kind !== 'password') {
      const profile = {
        sub: `sub-${user.id}`,
        email: user.email,
        authoritativeEmail: true,
        displayName: user.displayName,
        avatarUrl: null,
      };
      profiles.set(`google/${user.id}`, profile);
      await source.query(
        'INSERT INTO google_identities(user_id,google_sub) VALUES ($1,$2)',
        [user.id, profile.sub],
      );
    }
    return user;
  };
  const proof = async (user, method = 'password') =>
    reauth.verify((await session(user)).identity, {
      confirmation: 'DELETE',
      ...(method === 'google'
        ? { googleCredential: `google/${user.id}` }
        : { currentPassword: password }),
    });
  const close = async (user, method = 'password') =>
    deletion.delete(await proof(user, method));
  let requestSequence = 0;
  const remove = async (
    user,
    input = { confirmation: 'DELETE', currentPassword: password },
    token,
  ) =>
    http
      .delete('/api/users/me')
      .set('X-Forwarded-For', `192.0.2.${++requestSequence}`)
      .set('Authorization', `Bearer ${token ?? (await session(user)).jwt}`)
      .send(input);
  const team = async (user, alternate) => {
    const [w] = await source.query(
      "INSERT INTO workspaces(type,name,created_by_id) VALUES ('TEAM','Shared Team',$1) RETURNING id",
      [user.id],
    );
    await source.query(
      "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN')",
      [w.id, user.id],
    );
    if (alternate)
      await source.query(
        "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN')",
        [w.id, alternate.id],
      );
    return w;
  };
  const board = async (user, workspace, alternate, archived = false) => {
    const [b] = await source.query(
      "INSERT INTO boards(name,created_by_id,workspace_id,is_archived) VALUES ('Shared Board',$1,$2,$3) RETURNING id",
      [user.id, workspace.id, archived],
    );
    await source.query(
      "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')",
      [b.id, user.id],
    );
    if (alternate)
      await source.query(
        "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')",
        [b.id, alternate.id],
      );
    return b;
  };
  const connect = (token, failure = false) =>
    new Promise((resolve, reject) => {
      const socket = io(
        app.getHttpServer().address() &&
          `http://127.0.0.1:${app.getHttpServer().address().port}`,
        {
          transports: ['websocket'],
          reconnection: false,
          auth: { accessToken: token },
          timeout: 5000,
        },
      );
      sockets.push(socket);
      socket.once('connect', () =>
        failure
          ? reject(new Error('revoked socket connected'))
          : resolve(socket),
      );
      socket.once('connect_error', (error) =>
        failure ? resolve(error) : reject(error),
      );
    });
  const ctx = {
    source,
    app,
    http,
    auth,
    deletion,
    reauth,
    password,
    hash,
    profiles,
    factory,
    session,
    proof,
    close,
    remove,
    team,
    board,
    connect,
    eventually,
    pass,
    User,
  };
  if (
    !process.argv.includes('--regressions-only') &&
    !process.argv.includes('--realtime-only')
  ) {
    await verifyDeletionAcceptance(ctx);
    await verifyDeletionRaces(ctx);
    console.log(
      `PASS: ${groups} account deletion PostgreSQL/Nest/Socket.IO acceptance groups`,
    );
  }
  if (
    process.argv.includes('--regressions') ||
    process.argv.includes('--regressions-only')
  ) {
    const regressionFiles = [
      'database/database-foundation',
      'auth/email-change',
      'auth/password-security',
      'auth/google-auth',
      'auth/email-verification',
      'users/user-preferences',
      'users/avatar',
      'boards/boards',
      'workspaces/workspace-api',
      'board-members/board-members',
      'cards/cards',
      'comments/comments',
      'activities/activities',
      'auth/welcome-email',
      'notifications/notifications',
      'notifications/task-notifications',
      'attachments/private-files',
      'attachments/attachments',
      'exports/exports',
    ];
    const resume = process.argv
      .find((arg) => arg.startsWith('--from-regression='))
      ?.slice('--from-regression='.length);
    const start = resume ? regressionFiles.indexOf(resume) : 0;
    assert.ok(start >= 0, 'Unknown regression resume point');
    for (const file of regressionFiles.slice(start)) {
      execFileSync(process.execPath, [`test/${file}.integration.mjs`], {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        stdio: 'inherit',
        env: process.env,
        timeout: 300000,
      });
      console.log(`PASS: regression ${file}`);
    }
  }
  if (
    process.argv.includes('--regressions') ||
    process.argv.includes('--realtime-only')
  ) {
    for (const file of [
      'realtime/realtime',
      'realtime/board-events/board-events',
    ]) {
      execFileSync(
        process.execPath,
        ['-r', 'ts-node/register', `test/${file}.integration.mjs`],
        {
          cwd: fileURLToPath(new URL('../../', import.meta.url)),
          stdio: 'inherit',
          env: process.env,
          timeout: 300000,
        },
      );
      console.log(`PASS: regression ${file}`);
    }
  }
} finally {
  for (const socket of sockets) socket.disconnect();
  if (app) await app.close();
  if (source?.isInitialized) await source.destroy();
  if (started) docker('rm', '--force', container);
}
