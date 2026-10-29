import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyMembers } from './workspace-members.lifecycle.mjs';
import { verifyInvitations } from './workspace-invitations.lifecycle.mjs';
import { verifyInvitationRaces } from './workspace-invitations.concurrency.mjs';
import { verifyInvitationMigration } from './workspace-invitations.migration.mjs';
import { verifyQuotaContention } from './workspace-invitations.quotas.mjs';
import { verifyBoardAccess } from '../boards/board-access.matrix.mjs';
import { verifyBoardAccessRealtime } from '../boards/board-access.realtime.mjs';
import {
  verifyBoardMemberWriteRace,
  verifyWorkspaceSnapshotRace,
} from '../boards/board-access.concurrency.mjs';
import { verifyBoardAccessBrowser } from '../boards/board-access.browser.mjs';
import { verifyInvitationMailDelivery } from './workspace-invitation-mail.integration.mjs';
import { verifyWorkspacePolicies } from './workspace-policies.integration.mjs';
import { verifyDeletedWorkspaceInvitations } from './workspace-deletion-invitations.integration.mjs';
import {
  verifyDispatchLease,
  verifyAcceptRemoval,
} from './workspace-invitations.boundaries.mjs';

// Own disposable local PostgreSQL, never credentials or migrations from the application DB.
const require = createRequire(import.meta.url);
if (process.argv.includes('--regressions'))
  assert(
    process.env.npm_execpath,
    'Run regressions through pnpm test:workspace-members:database --regressions',
  );
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { Test } = require('@nestjs/testing');
const { getRepositoryToken } = require('@nestjs/typeorm');
const { JwtService } = require('@nestjs/jwt');
const request = require('supertest');
const { databaseOptions } = require('../../dist/database/database-options.js');
const {
  Workspace,
} = require('../../dist/api/workspaces/entities/workspace.entity.js');
const {
  WorkspacesService,
} = require('../../dist/api/workspaces/workspaces.service.js');
const {
  WorkspaceInvitationIssuanceService: Issuance,
} = require('../../dist/api/workspaces/workspace-invitation-issuance.service.js');
const container = `kanvexa-invitations-test-${randomBytes(6).toString('hex')}`;
const password = randomBytes(32).toString('hex');
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    env: { ...process.env, POSTGRES_PASSWORD: password },
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
const captured = [];
const fake = {
  send: async (payload) => {
    captured.push(payload);
    return 'SENT';
  },
};
let source,
  app,
  started = false;
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
    'POSTGRES_USER=invitation_test',
    '--env',
    'POSTGRES_DB=invitation_test',
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
    DATABASE_NAME: 'invitation_test',
    DATABASE_USER: 'invitation_test',
    DATABASE_PASSWORD: password,
    DATABASE_SSL: 'false',
    NODE_ENV: 'test',
    API_PREFIX: 'api',
    LOG_LEVEL: 'silent',
    GOOGLE_CLIENT_ID: '',
    JWT_SECRET: randomBytes(32).toString('hex'),
    MAIL_TRANSPORT: 'fake',
    WORKSPACE_INVITATION_ACCEPT_PATH: '',
    AVATAR_STORAGE_DRIVER: 'disabled',
    SWAGGER_ENABLED: 'true',
    RATE_LIMIT_MAX: '10000',
    WORKSPACE_DATABASE_TESTS: 'local-only',
  });
  const options = databaseOptions(process.env);
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      source = await new DataSource(options).initialize();
      break;
    } catch (error) {
      if (attempt === 79) throw error;
      await delay(250);
    }
  }
  assert(source);
  await verifyInvitationMigration(source);
  const { AppModule } = require('../../dist/app.module.js');
  const {
    configureHttpApplication,
  } = require('../../dist/http-application.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Issuance)
    .useFactory({
      factory: (repository, foundation) =>
        new Issuance(repository, foundation, fake),
      inject: [getRepositoryToken(Workspace), WorkspacesService],
    })
    .compile();
  app = module.createNestApplication({ logger: false });
  configureHttpApplication(app);
  await app.init();
  assert.equal(app.get(DataSource).options.database, 'invitation_test');
  const http = request(app.getHttpServer());
  const actors = {},
    tokens = {};
  const jwt = app.get(JwtService);
  for (const role of [
    'admin',
    'admin2',
    'member',
    'guest',
    'outsider',
    'unverified',
    'google',
  ]) {
    const [user] = await source.query(
      `INSERT INTO users(email,display_name,email_verified_at)
      VALUES ($1,$2::varchar,CASE WHEN $2::varchar = 'unverified' THEN NULL ELSE now() END) RETURNING *`,
      [`${role}@invitation.example.test`, role],
    );
    actors[role] = user.id;
    tokens[role] = await jwt.signAsync({ sub: user.id });
  }
  await source.query(
    `INSERT INTO google_identities(user_id,google_sub) VALUES ($1,'invitation-google-sub')`,
    [actors.google],
  );
  const send = (actor, method, path) =>
    http[method](path).set('Authorization', `Bearer ${tokens[actor]}`);
  const context = {
    source,
    app,
    http,
    actors,
    tokens,
    jwt,
    send,
    captured,
    fake,
  };
  await verifyMembers(context);
  await verifyInvitations(context);
  await verifyInvitationRaces(context);
  await verifyQuotaContention(context);
  await verifyDispatchLease(context);
  await verifyAcceptRemoval(context);
  await verifyBoardAccess(context);
  await verifyWorkspacePolicies(context);
  await verifyDeletedWorkspaceInvitations(context);
  await verifyBoardAccessRealtime(context);
  await verifyBoardMemberWriteRace(context);
  await verifyWorkspaceSnapshotRace(context);
  if (process.argv.includes('--browser-qa'))
    await verifyBoardAccessBrowser(context);
  console.log(
    'PASS: P2-04 Board ACL actor/visibility/archive matrix, nested REST, aggregates, Socket.IO, revocation and races',
  );
  await verifyInvitationMailDelivery({
    source,
    AppModule,
    configureHttpApplication,
  });
  const swagger = await http.get('/api-docs-json').expect(200);
  for (const [path, method, status] of [
    ['/api/workspaces/{workspaceId}/members', 'get', '200'],
    ['/api/workspaces/{workspaceId}/members/{userId}', 'delete', '204'],
    ['/api/workspaces/{workspaceId}/invitations', 'post', '202'],
    ['/api/workspace-invitations/accept', 'post', '200'],
  ])
    assert(swagger.body.paths[path][method].responses[status]);
  // Default rollout gate preserves UNAVAILABLE until a working destination is configured.
  const unwiredModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const unwiredApp = unwiredModule.createNestApplication({ logger: false });
  try {
    configureHttpApplication(unwiredApp);
    await unwiredApp.init();
    const unavailable = await request(unwiredApp.getHttpServer())
      .post(`/api/workspaces/${context.team.id}/invitations`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ email: 'default-port@example.test' })
      .expect(202);
    assert.equal(unavailable.body.data.sendState, 'UNAVAILABLE');
    assert.equal(unavailable.body.data.status, 'PENDING');
    assert(
      !captured.some(
        (payload) => payload.invitationId === unavailable.body.data.id,
      ),
    );
    for (let attempt = 0; attempt < 20; attempt++) {
      const rejected = await request(unwiredApp.getHttpServer())
        .post('/api/workspace-invitations/accept')
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({ proof: 'a'.repeat(43) })
        .expect(410);
      assert.equal(rejected.body.code, 'INVALID_WORKSPACE_INVITATION');
    }
    const limited = await request(unwiredApp.getHttpServer())
      .post('/api/workspace-invitations/accept')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ proof: 'a'.repeat(43) })
      .expect(429);
    assert.equal(limited.body.code, 'TOO_MANY_REQUESTS');
  } finally {
    await unwiredApp.close();
  }
  console.log(
    'PASS: Workspace members/invitations PostgreSQL, REST, privacy, security, migration and concurrency',
  );
  if (process.argv.includes('--regressions')) {
    for (const path of [
      'test/workspaces/workspaces.integration.mjs',
      'test/workspaces/workspace-api.integration.mjs',
      'test/database/database-foundation.integration.mjs',
      'test/boards/boards.integration.mjs',
      'test/board-members/board-members.integration.mjs',
      'test/cards/cards.integration.mjs',
      'test/columns/columns.integration.mjs',
      'test/comments/comments.integration.mjs',
      'test/activities/activities.integration.mjs',
      'test/auth/email-verification.integration.mjs',
      'test/auth/google-auth.integration.mjs',
      'test/realtime/realtime.integration.mjs',
      'test/realtime/board-events/board-events.integration.mjs',
    ]) {
      console.log(`Regression: ${path}`);
      execFileSync(process.execPath, ['-r', 'ts-node/register', path], {
        env: process.env,
        stdio: 'inherit',
        timeout: 180000,
      });
    }
  }
} finally {
  if (app) await app.close();
  if (source?.isInitialized) await source.destroy();
  if (started) docker('rm', '--force', container);
}
