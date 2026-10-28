import assert from 'node:assert/strict';
import console from 'node:console';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';

// Explicit local test opt-in; deliberately never load a .env file.
assert.equal(process.env.WORKSPACE_DATABASE_TESTS, 'local-only');
assert.ok(
  ['127.0.0.1', 'localhost', '::1'].includes(process.env.DATABASE_HOST),
);
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { databaseOptions } = require('../../dist/database/database-options.js');
const {
  WorkspacesService,
} = require('../../dist/api/workspaces/workspaces.service.js');
const { BoardsService } = require('../../dist/api/boards/boards.service.js');
const {
  BoardAuthorizationService,
} = require('../../dist/api/board-members/board-authorization.service.js');
const {
  LegacyBoardWorkspaces1793145600001: Backfill,
} = require('../../dist/database/migrations/1793145600001-LegacyBoardWorkspaces.js');
const options = databaseOptions(process.env);
const admin = new Client({
  host: options.host,
  port: options.port,
  user: options.username,
  password: options.password,
  database: options.database,
  ssl: options.ssl,
  connectionTimeoutMillis: options.connectTimeoutMS,
});
const databases = [];
let source;
let currentMigrations;
let checks = 0;
const pass = (label) => console.log(`PASS ${++checks}: ${label}`);
const sqlstate = (promise, code) =>
  assert.rejects(
    promise,
    (error) => (error.code ?? error.driverError?.code) === code,
  );
const user = async (email) =>
  (
    await source.query(
      'INSERT INTO users(email, display_name, email_verified_at) VALUES ($1, $1, now()) RETURNING id',
      [email],
    )
  )[0];
async function openDatabase() {
  const name = `kanban_workspace_verify_${randomBytes(8).toString('hex')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  databases.push(name);
  source = await new DataSource({ ...options, database: name }).initialize();
  currentMigrations = [...source.migrations];
  return source;
}
const snapshot = async () => {
  const result = {};
  for (const table of [
    'users',
    'boards',
    'board_members',
    'board_columns',
    'cards',
    'card_assignees',
    'comments',
    'activities',
  ]) {
    result[table] = await source.query(
      `SELECT to_jsonb(t) - 'workspace_id' - 'visibility' AS row FROM ${table} t ORDER BY id`,
    );
  }
  return result;
};

async function inspectConstraints(owner, guest, personalId) {
  await sqlstate(
    source.query(
      `INSERT INTO workspaces(type,name,created_by_id) VALUES ('PERSONAL','Duplicate',$1)`,
      [owner.id],
    ),
    '23505',
  );
  await sqlstate(
    source.query(
      `INSERT INTO workspaces(type,name,created_by_id) VALUES ('OTHER','Bad',$1)`,
      [owner.id],
    ),
    '23514',
  );
  await sqlstate(
    source.query(
      `INSERT INTO workspaces(type,name,created_by_id) VALUES ('TEAM','  ',$1)`,
      [owner.id],
    ),
    '23514',
  );
  await sqlstate(
    source.query(
      `INSERT INTO workspaces(type,name,created_by_id) VALUES ('TEAM','Orphan',$1)`,
      [randomUUID()],
    ),
    '23503',
  );
  await sqlstate(
    source.query(
      `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN')`,
      [personalId, owner.id],
    ),
    '23505',
  );
  await sqlstate(
    source.query(
      `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'OWNER')`,
      [personalId, guest.id],
    ),
    '23514',
  );
  await sqlstate(
    source.query(
      `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
      [randomUUID(), guest.id],
    ),
    '23503',
  );
  await sqlstate(
    source.query(
      `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
      [personalId, randomUUID()],
    ),
    '23503',
  );
  await sqlstate(
    source.query('DELETE FROM workspaces WHERE id=$1', [personalId]),
    '23503',
  );
  await sqlstate(
    source.query('DELETE FROM users WHERE id=$1', [owner.id]),
    '23503',
  );
  await sqlstate(
    source.query(
      `INSERT INTO boards(name,created_by_id,workspace_id) VALUES ('Orphan',$1,$2)`,
      [owner.id, randomUUID()],
    ),
    '23503',
  );
  await sqlstate(
    source.query(
      `INSERT INTO boards(name,created_by_id,workspace_id,visibility) VALUES ('Public',$1,$2,'PUBLIC')`,
      [owner.id, personalId],
    ),
    '23514',
  );
  await sqlstate(
    source.query(
      `INSERT INTO boards(name,created_by_id) VALUES ('Unknown owner',$1)`,
      [randomUUID()],
    ),
    '23503',
  );
  // Bridge repairs NULL even after NOT NULL enforcement, so legacy writers work.
  const [bridge] = await source.query(
    `INSERT INTO boards(name,created_by_id,workspace_id) VALUES ('Explicit null',$1,NULL) RETURNING workspace_id,visibility`,
    [owner.id],
  );
  assert.equal(bridge.workspace_id, personalId);
  assert.equal(bridge.visibility, 'PRIVATE');
  const [team] = await source.query(
    `INSERT INTO workspaces(type,name,created_by_id) VALUES ('TEAM','Team',$1) RETURNING id`,
    [owner.id],
  );
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN'),($1,$3,'MEMBER')`,
    [team.id, owner.id, guest.id],
  );
  const invitation = {
    workspace: team.id,
    email: 'invitee@example.test',
    role: 'MEMBER',
    hash: createHash('sha256').update(randomBytes(32)).digest('hex'),
    inviter: owner.id,
  };
  const invite = (overrides = {}) => {
    const v = { ...invitation, ...overrides };
    return source.query(
      `INSERT INTO workspace_invitations(workspace_id,email,role,token_hash,invited_by_id,created_at,expires_at,consumed_at,revoked_at)
      VALUES ($1,$2,$3,$4,$5,'2026-10-28T00:00:00Z',$6,$7,$8) RETURNING id`,
      [
        v.workspace,
        v.email,
        v.role,
        v.hash,
        v.inviter,
        v.expiry ?? '2026-10-29T00:00:00Z',
        v.consumed ?? null,
        v.revoked ?? null,
      ],
    );
  };
  const [saved] = await invite();
  assert.equal(
    (
      await source
        .getRepository('WorkspaceInvitation')
        .findOneByOrFail({ id: saved.id })
    ).tokenHash,
    undefined,
  );
  await sqlstate(invite(), '23505');
  for (const overrides of [
    { email: 'Mixed@Example.test' },
    { email: ' invitee@example.test' },
    { email: 'no-at-sign' },
    { role: 'OWNER' },
    { hash: 'plaintext' },
    { expiry: '2026-10-27T00:00:00Z' },
    { consumed: '2026-10-27T00:00:00Z' },
    { consumed: '2026-10-29T00:00:00Z' },
    { revoked: '2026-10-27T00:00:00Z' },
    { consumed: '2026-10-28T01:00:00Z', revoked: '2026-10-28T02:00:00Z' },
  ])
    await sqlstate(invite(overrides), '23514');
  await sqlstate(
    invite({ workspace: randomUUID(), hash: 'a'.repeat(64) }),
    '23503',
  );
  await sqlstate(
    invite({ inviter: randomUUID(), hash: 'b'.repeat(64) }),
    '23503',
  );
  pass(
    'PostgreSQL FK/unique/checks; Team roles; invitation hashes, normalized email and terminal metadata; NULL bridge',
  );
}

async function inspectConcurrency() {
  const workspaces = new WorkspacesService(source.getRepository('Workspace'));
  const members = source.getRepository('BoardMember');
  const authorization = new BoardAuthorizationService(members);
  const boards = new BoardsService(
    source.getRepository('Board'),
    members,
    authorization,
    {},
    { publish: async () => {} },
    workspaces,
  );
  const owner = await user('concurrent@example.test');
  assert.equal(await workspaces.findPersonalWorkspace(owner.id), null);
  const [a, b] = await Promise.all([
    workspaces.ensurePersonalWorkspace(owner.id),
    workspaces.ensurePersonalWorkspace(owner.id),
  ]);
  assert.equal(a.id, b.id);
  const before = await source.query(
    'SELECT * FROM workspace_members WHERE workspace_id=$1',
    [a.id],
  );
  await workspaces.ensurePersonalWorkspace(owner.id);
  assert.deepEqual(
    await source.query(
      'SELECT * FROM workspace_members WHERE workspace_id=$1',
      [a.id],
    ),
    before,
  );
  await source.query(
    `UPDATE workspace_members SET role='MEMBER' WHERE workspace_id=$1 AND user_id=$2`,
    [a.id, owner.id],
  );
  await workspaces.ensurePersonalWorkspace(owner.id);
  assert.equal(
    (
      await source.query(
        'SELECT role FROM workspace_members WHERE workspace_id=$1',
        [a.id],
      )
    )[0].role,
    'ADMIN',
  );
  await source.query('DELETE FROM workspace_members WHERE workspace_id=$1', [
    a.id,
  ]);
  await workspaces.ensurePersonalWorkspace(owner.id);
  assert.equal(
    (
      await source.query(
        'SELECT role FROM workspace_members WHERE workspace_id=$1',
        [a.id],
      )
    )[0].role,
    'ADMIN',
  );
  pass(
    'Concurrent provisioning converges; repeat preserves timestamps; missing/demoted owner ADMIN is repaired',
  );

  const first = await user('first-boards@example.test');
  const created = await Promise.all([
    boards.create(first.id, { name: 'First tab' }),
    boards.create(first.id, { name: 'Second tab' }),
  ]);
  const rows = await source.query(
    'SELECT workspace_id,visibility FROM boards WHERE created_by_id=$1',
    [first.id],
  );
  assert.equal(new Set(rows.map((r) => r.workspace_id)).size, 1);
  assert.ok(rows.every((r) => r.visibility === 'PRIVATE'));
  for (const b of created)
    assert.equal(
      await members.countBy({ boardId: b.id, userId: first.id, role: 'OWNER' }),
      1,
    );
  const mixed = await user('mixed-version@example.test');
  await Promise.all([
    boards.create(mixed.id, { name: 'New application' }),
    source.transaction(async (manager) => {
      const [old] = await manager.query(
        `INSERT INTO boards(name,created_by_id) VALUES ('Old application',$1) RETURNING id`,
        [mixed.id],
      );
      await manager.query(
        `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')`,
        [old.id, mixed.id],
      );
    }),
  ]);
  assert.equal(
    (
      await source.query(
        'SELECT count(DISTINCT workspace_id)::int AS n FROM boards WHERE created_by_id=$1',
        [mixed.id],
      )
    )[0].n,
    1,
  );
  pass(
    'Concurrent first Board creation and mixed old/new writers retain one Personal Workspace and Board OWNER grants',
  );

  // Hold an uncommitted unique-index entry, then prove the second request waits.
  const raced = await user('upsert-race@example.test');
  const runner = source.createQueryRunner();
  let pending;
  try {
    await runner.startTransaction();
    const [candidate] = await runner.query(
      `INSERT INTO workspaces(type,name,created_by_id) VALUES ('PERSONAL','Winner',$1) RETURNING id`,
      [raced.id],
    );
    pending = workspaces.ensurePersonalWorkspace(raced.id).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const [state] = await source.query(
        `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%ensure_personal_workspace%') AS waiting`,
      );
      if (state.waiting) {
        waiting = true;
        break;
      }
      await delay(20);
    }
    assert.ok(
      waiting,
      'Ensure must wait for the uncommitted unique-index winner',
    );
    await runner.commitTransaction();
    assert.equal((await pending).value.id, candidate.id);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
    if (pending) await pending;
  }
  pass(
    'Observed real PostgreSQL unique-index conflict wait and upsert convergence',
  );

  const rollback = await user('rollback@example.test');
  await assert.rejects(
    source.transaction(async (manager) => {
      await workspaces.ensurePersonalWorkspace(rollback.id, manager);
      await manager.query('SELECT 1 / 0');
    }),
  );
  assert.equal(await workspaces.findPersonalWorkspace(rollback.id), null);
  // Fail after Board insert but before Board OWNER membership can commit.
  await source.query(
    `CREATE FUNCTION reject_owner_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected OWNER failure'; END $$`,
  );
  await source.query(
    `CREATE TRIGGER reject_owner_fixture BEFORE INSERT ON board_members FOR EACH ROW EXECUTE FUNCTION reject_owner_fixture()`,
  );
  try {
    await assert.rejects(
      boards.create(rollback.id, { name: 'Must roll back' }),
      /Injected OWNER failure/,
    );
  } finally {
    await source.query('DROP TRIGGER reject_owner_fixture ON board_members');
    await source.query('DROP FUNCTION reject_owner_fixture()');
  }
  assert.equal(await workspaces.findPersonalWorkspace(rollback.id), null);
  assert.equal(
    await source.getRepository('Board').countBy({ createdById: rollback.id }),
    0,
  );
  const recovered = await boards.create(rollback.id, { name: 'Recovered' });
  assert.equal(
    await members.countBy({
      boardId: recovered.id,
      userId: rollback.id,
      role: 'OWNER',
    }),
    1,
  );
  pass(
    'Transaction failures roll back Workspace, ADMIN and Board together; retry recovers',
  );
}

async function inspectAuthentication() {
  const { Test } = require('@nestjs/testing');
  const { JwtService } = require('@nestjs/jwt');
  const request = require('supertest');
  const { AuthService } = require('../../dist/api/auth/auth.service.js');
  const {
    GoogleAuthService,
  } = require('../../dist/api/auth/google-auth.service.js');
  const {
    GoogleTokenVerifier,
  } = require('../../dist/api/auth/google-token-verifier.service.js');
  const {
    VerificationMailer,
  } = require('../../dist/mail/verification-mailer.js');
  const service = new WorkspacesService(source.getRepository('Workspace'));
  const assertPersonal = async (userId) => {
    const personal = await service.findPersonalWorkspace(userId);
    assert.ok(personal, 'Account must have Personal Workspace immediately');
    assert.equal(
      await source
        .getRepository('Workspace')
        .countBy({ type: 'PERSONAL', createdById: userId }),
      1,
    );
    assert.equal(
      await source
        .getRepository('WorkspaceMember')
        .countBy({ workspaceId: personal.id, userId, role: 'ADMIN' }),
      1,
    );
    return personal;
  };
  const assertNoContent = async (userId) => {
    assert.equal(
      await source.getRepository('Board').countBy({ createdById: userId }),
      0,
    );
    assert.equal(
      await source.getRepository('Card').countBy({ createdById: userId }),
      0,
    );
    const [columns] = await source.query(
      'SELECT count(*)::int AS n FROM board_columns c JOIN boards b ON b.id=c.board_id WHERE b.created_by_id=$1',
      [userId],
    );
    assert.equal(columns.n, 0);
  };
  const profile = (sub, email) => ({
    sub,
    email,
    displayName: 'Google fixture',
    avatarUrl: null,
    authoritativeEmail: true,
  });
  const profiles = new Map([
    [
      'test-credential',
      profile('workspace-google-fixture', 'workspace-google@gmail.com'),
    ],
    [
      'link-credential',
      profile('workspace-link-fixture', 'workspace-email@example.test'),
    ],
    [
      'failure-credential',
      profile('workspace-failure-fixture', 'workspace-failure@gmail.com'),
    ],
    [
      'concurrent-credential',
      profile('workspace-concurrent-fixture', 'workspace-concurrent@gmail.com'),
    ],
  ]);
  const deliveries = [];
  Object.assign(process.env, {
    DATABASE_NAME: source.options.database,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JWT_SECRET: randomBytes(32).toString('hex'),
    API_PREFIX: 'api',
    GOOGLE_CLIENT_ID: '',
    AVATAR_STORAGE_DRIVER: 'disabled',
  });
  const { AppModule } = require('../../dist/app.module.js');
  const {
    configureHttpApplication,
  } = require('../../dist/http-application.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GoogleTokenVerifier)
    .useValue({
      verify: async (credential) => {
        assert.ok(
          profiles.has(credential),
          'Only explicit fixture proofs are accepted',
        );
        return profiles.get(credential);
      },
    })
    .overrideProvider(VerificationMailer)
    .useValue({
      send: async (email, url) => {
        // This independent pool connection sees committed User + Workspace + ADMIN.
        const account = await source
          .getRepository('User')
          .findOneByOrFail({ email });
        await assertPersonal(account.id);
        deliveries.push({ email, url });
      },
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  try {
    configureHttpApplication(app);
    await app.init();
    const http = request(app.getHttpServer());
    const credentials = {
      email: 'workspace-email@example.test',
      password: 'WorkspaceTest123!',
      displayName: 'Email fixture',
    };
    const registered = await http
      .post('/api/auth/register')
      .send(credentials)
      .expect(201);
    const userId = registered.body.data.id;
    const emailPersonal = await assertPersonal(userId);
    assert.equal(
      (await source.getRepository('User').findOneByOrFail({ id: userId }))
        .emailVerifiedAt,
      null,
    );
    await assertNoContent(userId);
    await http
      .post('/api/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(403);
    await http
      .post('/api/auth/verify-email')
      .send({
        token: new URL(
          deliveries.find((d) => d.email === credentials.email).url,
        ).searchParams.get('token'),
      })
      .expect(204);
    const login = await http
      .post('/api/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);
    const google = await http
      .post('/api/auth/google')
      .send({ credential: 'test-credential' })
      .expect(200);
    const googleId = google.body.data.user.id;
    const googlePersonal = await assertPersonal(googleId);
    await assertNoContent(googleId);
    pass(
      'Email signup before verification and Google signup eagerly commit one Personal Workspace/ADMIN with zero sample Boards/Columns/Cards; mail sees committed data',
    );

    await http.post('/api/auth/register').send(credentials).expect(409);
    await http
      .post('/api/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);
    const returning = await http
      .post('/api/auth/google')
      .send({ credential: 'test-credential' })
      .expect(200);
    assert.equal(returning.body.data.user.id, googleId);
    const personalBeforeLink = await source.query(
      'SELECT * FROM workspaces WHERE created_by_id=$1 ORDER BY id',
      [userId],
    );
    const memberBeforeLink = await source.query(
      'SELECT * FROM workspace_members WHERE user_id=$1 ORDER BY id',
      [userId],
    );
    for (let i = 0; i < 2; i++)
      await http
        .post('/api/auth/google/link')
        .auth(login.body.data.accessToken, { type: 'bearer' })
        .send({ credential: 'link-credential', password: credentials.password })
        .expect(204);
    assert.deepEqual(
      await source.query(
        'SELECT * FROM workspaces WHERE created_by_id=$1 ORDER BY id',
        [userId],
      ),
      personalBeforeLink,
    );
    assert.deepEqual(
      await source.query(
        'SELECT * FROM workspace_members WHERE user_id=$1 ORDER BY id',
        [userId],
      ),
      memberBeforeLink,
    );
    for (const [response, personal] of [
      [login, emailPersonal],
      [google, googlePersonal],
    ]) {
      const { accessToken, user: account } = response.body.data;
      const created = await http
        .post('/api/boards')
        .auth(accessToken, { type: 'bearer' })
        .send({ name: 'Authenticated first Board' })
        .expect(201);
      const [board] = await source.query(
        'SELECT workspace_id,visibility,created_by_id FROM boards WHERE id=$1',
        [created.body.data.id],
      );
      assert.equal(board.workspace_id, personal.id);
      assert.equal(board.created_by_id, account.id);
      assert.equal(board.visibility, 'PRIVATE');
      assert.equal(
        await source.getRepository('BoardMember').countBy({
          boardId: created.body.data.id,
          userId: account.id,
          role: 'OWNER',
        }),
        1,
      );
      assert.equal((await assertPersonal(account.id)).id, personal.id);
      await http
        .post('/api/boards')
        .auth(accessToken, { type: 'bearer' })
        .send({
          name: 'Forged',
          workspaceId: randomUUID(),
          visibility: 'WORKSPACE_VISIBLE',
        })
        .expect(400);
      assert.equal(
        (await app.get(JwtService).verifyAsync(accessToken)).sub,
        account.id,
      );
    }
    pass(
      'Registration retry, repeat email/Google login, idempotent Google linking and first Board reuse the original Workspace without extra memberships',
    );

    const accountState = async () => {
      const state = {};
      for (const table of [
        'users',
        'google_identities',
        'workspaces',
        'workspace_members',
        'email_verification_tokens',
      ])
        state[table] = await source.query(
          'SELECT to_jsonb(t) AS row FROM ' + table + ' t ORDER BY id',
        );
      return state;
    };
    const beforeFailure = await accountState();
    const deliveryCount = deliveries.length;
    await source.query(
      "CREATE FUNCTION fail_signup_workspace() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected Workspace ADMIN failure'; END $$",
    );
    await source.query(
      'CREATE TRIGGER fail_signup_workspace BEFORE INSERT ON workspace_members FOR EACH ROW EXECUTE FUNCTION fail_signup_workspace()',
    );
    const failedEmail = {
      ...credentials,
      email: 'workspace-failure@example.test',
    };
    try {
      await http.post('/api/auth/register').send(failedEmail).expect(500);
      assert.deepEqual(await accountState(), beforeFailure);
      await http
        .post('/api/auth/google')
        .send({ credential: 'failure-credential' })
        .expect(500);
      assert.deepEqual(await accountState(), beforeFailure);
      assert.equal(
        deliveries.length,
        deliveryCount,
        'Failed provisioning must not send verification mail',
      );
    } finally {
      await source.query(
        'DROP TRIGGER fail_signup_workspace ON workspace_members',
      );
      await source.query('DROP FUNCTION fail_signup_workspace()');
    }
    const retryEmail = await http
      .post('/api/auth/register')
      .send(failedEmail)
      .expect(201);
    const retryGoogle = await http
      .post('/api/auth/google')
      .send({ credential: 'failure-credential' })
      .expect(200);
    for (const account of [retryEmail.body.data, retryGoogle.body.data.user]) {
      await assertPersonal(account.id);
      await assertNoContent(account.id);
    }
    pass(
      'Real SQL failure after User/identity/Workspace insertion rolls back all account state and sends no mail; retry safely creates both account types',
    );

    // Exercise database races directly through real services, independent of HTTP quotas.
    const auth = app.get(AuthService);
    const concurrentEmail = {
      ...credentials,
      email: 'workspace-concurrent@example.test',
    };
    const emailResults = await Promise.allSettled([
      auth.register(concurrentEmail),
      auth.register(concurrentEmail),
    ]);
    assert.equal(
      emailResults.filter((r) => r.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      emailResults.find((r) => r.status === 'rejected').reason.getResponse()
        .code,
      'EMAIL_ALREADY_EXISTS',
    );
    const emailAccount = await source
      .getRepository('User')
      .findOneByOrFail({ email: concurrentEmail.email });
    await assertPersonal(emailAccount.id);
    await assertNoContent(emailAccount.id);
    const googleService = app.get(GoogleAuthService);
    const googleResults = await Promise.all([
      googleService.signIn('concurrent-credential'),
      googleService.signIn('concurrent-credential'),
    ]);
    assert.equal(googleResults[0].user.id, googleResults[1].user.id);
    await assertPersonal(googleResults[0].user.id);
    await assertNoContent(googleResults[0].user.id);
    pass(
      'Concurrent email and Google signup commit exactly one account, Personal Workspace and ADMIN',
    );
  } finally {
    await app.close();
  }
}

try {
  await admin.connect();
  await openDatabase();
  assert.equal((await source.runMigrations()).length, 12);
  assert.deepEqual(await source.runMigrations(), []);
  assert.equal(source.entityMetadatas.length, 17);
  const drift = await source.driver.createSchemaBuilder().log();
  assert.deepEqual(
    drift.upQueries.map((q) => q.query),
    [],
    'Entity metadata must match final migrations',
  );
  // Revert the icon, welcome ledger and both Workspace foundation migrations.
  await source.undoLastMigration(); // Workspace icon.
  await source.undoLastMigration(); // Empty welcome ledger.
  await source.undoLastMigration();
  await source.undoLastMigration();
  assert.equal((await source.runMigrations()).length, 4);
  pass(
    'Fresh database, metadata/discovery, no schema drift, empty down/up and migration retry',
  );
  await source.destroy();

  // Default all-migrations mode must roll back expand as well as backfill.
  await openDatabase();
  source.migrations = source.migrations.filter(
    (m) => !m.name.startsWith('WelcomeEmailOutbox'),
  );
  const atomicMigrations = [...source.migrations];
  source.migrations = atomicMigrations.filter(
    (m) =>
      !m.name.startsWith('WorkspaceFoundation') &&
      !m.name.startsWith('LegacyBoardWorkspaces') &&
      !m.name.startsWith('WorkspaceIcon'),
  );
  await source.runMigrations();
  const atomicUser = await user('atomic-upgrade@example.test');
  await source.query(
    `INSERT INTO boards(name,created_by_id) VALUES ('Atomic legacy',$1)`,
    [atomicUser.id],
  );
  const atomicBefore = await snapshot();
  await source.query(
    `CREATE FUNCTION fail_atomic_upgrade() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected atomic upgrade failure'; END $$`,
  );
  await source.query(
    `CREATE TRIGGER fail_atomic_upgrade BEFORE UPDATE ON boards FOR EACH ROW EXECUTE FUNCTION fail_atomic_upgrade()`,
  );
  source.migrations = atomicMigrations;
  await assert.rejects(
    source.runMigrations(),
    /Injected atomic upgrade failure/,
  );
  assert.equal(
    (
      await source.query(
        `SELECT to_regclass('public.workspaces') AS table_name`,
      )
    )[0].table_name,
    null,
  );
  assert.equal(
    (await source.query('SELECT count(*)::int AS n FROM migrations'))[0].n,
    8,
  );
  assert.deepEqual(await snapshot(), atomicBefore);
  await source.query('DROP TRIGGER fail_atomic_upgrade ON boards');
  await source.query('DROP FUNCTION fail_atomic_upgrade()');
  assert.equal((await source.runMigrations()).length, 3);
  assert.deepEqual(await snapshot(), atomicBefore);
  pass(
    'Default all-migrations failure rolls back schema, content and history; two-stage retry recovers',
  );
  await source.destroy();

  await openDatabase();
  source.migrations = source.migrations.filter(
    (m) => !m.name.startsWith('WelcomeEmailOutbox'),
  );
  const migrations = [...source.migrations];
  source.migrations = migrations.filter(
    (m) =>
      !m.name.startsWith('WorkspaceFoundation') &&
      !m.name.startsWith('LegacyBoardWorkspaces') &&
      !m.name.startsWith('WorkspaceIcon'),
  );
  await source.runMigrations();
  const owner = await user('legacy-owner@example.test');
  const guest = await user('legacy-guest@example.test');
  const noBoards = await user('no-boards@example.test');
  const another = await user('another-creator@example.test');
  const boardIds = [];
  for (const [creator, archived] of [
    [owner, true],
    [owner, false],
    [another, false],
  ]) {
    const [b] = await source.query(
      `INSERT INTO boards(name,created_by_id,is_archived,archived_at) VALUES ('Legacy',$1,$2,CASE WHEN $2 THEN '2026-10-25T00:00:00Z'::timestamptz ELSE NULL END) RETURNING id`,
      [creator.id, archived],
    );
    boardIds.push(b.id);
    await source.query(
      `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER'),($1,$3,'MEMBER')`,
      [b.id, creator.id, guest.id],
    );
    const [column] = await source.query(
      `INSERT INTO board_columns(board_id,name,position) VALUES ($1,'Todo',123.1234567890) RETURNING id`,
      [b.id],
    );
    for (const archivedCard of [false, true]) {
      const [card] = await source.query(
        `INSERT INTO cards(board_id,column_id,created_by_id,title,position,is_archived,archived_at) VALUES ($1,$2,$3,'Card',456.1234567890,$4,CASE WHEN $4 THEN now() ELSE NULL END) RETURNING id`,
        [b.id, column.id, creator.id, archivedCard],
      );
      await source.query(
        'INSERT INTO card_assignees(card_id,user_id,assigned_by_id) VALUES ($1,$2,$3)',
        [card.id, guest.id, creator.id],
      );
      await source.query(
        `INSERT INTO comments(card_id,author_id,content) VALUES ($1,$2,'Preserve comment')`,
        [card.id, guest.id],
      );
      await source.query(
        `INSERT INTO activities(board_id,actor_id,action_type,entity_type,entity_id,metadata) VALUES ($1,$2,'CARD_CREATED','CARD',$3,'{"fixture":true}')`,
        [b.id, creator.id, card.id],
      );
    }
  }
  let before = await snapshot();
  source.migrations = migrations.filter(
    (m) =>
      !m.name.startsWith('LegacyBoardWorkspaces') &&
      !m.name.startsWith('WorkspaceIcon'),
  );
  assert.equal((await source.runMigrations()).length, 1);
  assert.deepEqual(await snapshot(), before);
  pass('Expand preserves every legacy field and association before backfill');

  const [oldWriter] = await source.query(
    `INSERT INTO boards(name,created_by_id) VALUES ('During expand',$1) RETURNING workspace_id,visibility`,
    [owner.id],
  );
  assert.ok(oldWriter.workspace_id);
  assert.equal(oldWriter.visibility, 'PRIVATE');
  before = await snapshot();
  const expandWorkspaces = await source.query(
    'SELECT * FROM workspaces ORDER BY id',
  );
  const expandMembers = await source.query(
    'SELECT * FROM workspace_members ORDER BY id',
  );
  pass(
    'Old binary insert during nullable expand receives Personal Workspace and PRIVATE immediately',
  );

  source.migrations = migrations;
  // A real SQL failure occurs after Workspace/ADMIN inserts, during Board update.
  await source.query(
    `CREATE FUNCTION reject_backfill_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected backfill failure'; END $$`,
  );
  await source.query(
    `CREATE TRIGGER reject_backfill_fixture BEFORE UPDATE ON boards FOR EACH ROW EXECUTE FUNCTION reject_backfill_fixture()`,
  );
  await assert.rejects(source.runMigrations(), /Injected backfill failure/);
  assert.deepEqual(
    await source.query('SELECT * FROM workspaces ORDER BY id'),
    expandWorkspaces,
  );
  assert.deepEqual(
    await source.query('SELECT * FROM workspace_members ORDER BY id'),
    expandMembers,
  );
  assert.equal(
    (await source.query('SELECT count(*)::int AS n FROM migrations'))[0].n,
    9,
  );
  assert.deepEqual(await snapshot(), before);
  await source.query('DROP TRIGGER reject_backfill_fixture ON boards');
  await source.query('DROP FUNCTION reject_backfill_fixture()');
  assert.equal((await source.runMigrations()).length, 2);
  assert.deepEqual(await snapshot(), before);
  pass(
    'Backfill failure rolls back data and migration history; retry preserves all legacy JSON records exactly',
  );
  const assignments = await source.query(
    `SELECT b.id,b.workspace_id,b.visibility,w.created_by_id,w.type FROM boards b JOIN workspaces w ON w.id=b.workspace_id ORDER BY b.id`,
  );
  assert.equal(assignments.length, 4);
  for (const row of assignments) {
    assert.equal(row.visibility, 'PRIVATE');
    assert.equal(row.type, 'PERSONAL');
  }
  assert.equal(
    new Set(
      assignments
        .filter((b) => b.created_by_id === owner.id)
        .map((b) => b.workspace_id),
    ).size,
    1,
  );
  assert.equal(
    (
      await source.query(
        `SELECT count(*)::int AS n FROM users u JOIN workspaces w ON w.created_by_id=u.id AND w.type='PERSONAL' JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=u.id AND m.role='ADMIN'`,
      )
    )[0].n,
    4,
  );
  const service = new WorkspacesService(source.getRepository('Workspace'));
  assert.ok(await service.findPersonalWorkspace(noBoards.id));
  const personal = await service.findPersonalWorkspace(owner.id);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
        [personal.id, guest.id],
      )
    )[0].n,
    0,
  );
  const authorization = new BoardAuthorizationService(
    source.getRepository('BoardMember'),
  );
  assert.equal(
    (await authorization.requireMember(guest.id, boardIds[0])).member.role,
    'MEMBER',
  );
  // A Workspace ADMIN lacking explicit Board membership still cannot read it.
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN')`,
    [personal.id, noBoards.id],
  );
  await assert.rejects(
    authorization.requireMember(noBoards.id, boardIds[0]),
    (e) => e.getStatus() === 404,
  );
  await assert.rejects(
    authorization.requireOwner(guest.id, boardIds[0]),
    (e) => e.getStatus() === 403,
  );
  pass(
    'Legacy Board guests retain access with no creator-Workspace membership; Workspace ADMIN has no private Board grant',
  );

  const provisioned = await source.query(
    'SELECT * FROM workspaces ORDER BY id',
  );
  const memberships = await source.query(
    'SELECT * FROM workspace_members ORDER BY id',
  );
  await source.transaction((manager) => new Backfill().up(manager.queryRunner));
  assert.deepEqual(
    await source.query('SELECT * FROM workspaces ORDER BY id'),
    provisioned,
  );
  assert.deepEqual(
    await source.query('SELECT * FROM workspace_members ORDER BY id'),
    memberships,
  );
  assert.deepEqual(await snapshot(), before);
  await source.undoLastMigration(); // Workspace icon.
  await source.undoLastMigration();
  await assert.rejects(
    source.undoLastMigration(),
    /Cannot discard populated Workspace data/,
  );
  assert.equal((await source.runMigrations()).length, 2);
  pass(
    'Supported backfill rerun and constrain down/up are idempotent; destructive down refuses populated data',
  );

  // Prove the migration reports inconsistent preassignment instead of silently fixing it.
  await source.undoLastMigration(); // Workspace icon.
  await source.undoLastMigration();
  await source.query(
    `UPDATE boards SET visibility='WORKSPACE_VISIBLE' WHERE id=$1`,
    [boardIds[1]],
  );
  await assert.rejects(source.runMigrations(), /Inconsistent legacy Board/);
  await source.query(`UPDATE boards SET visibility='PRIVATE' WHERE id=$1`, [
    boardIds[1],
  ]);
  // This fixture intentionally runs with the icon migration reverted.
  const [wrongPersonal] = await source.query(
    "SELECT id FROM workspaces WHERE type='PERSONAL' AND created_by_id=$1",
    [noBoards.id],
  );
  await source.query('UPDATE boards SET workspace_id=$1 WHERE id=$2', [
    wrongPersonal.id,
    boardIds[1],
  ]);
  await assert.rejects(source.runMigrations(), /Inconsistent legacy Board/);
  await source.query('UPDATE boards SET workspace_id=$1 WHERE id=$2', [
    personal.id,
    boardIds[1],
  ]);
  assert.equal((await source.runMigrations()).length, 2);
  pass(
    'Unexpected preassignment/visibility fails closed and explicit remediation permits retry',
  );
  await inspectConstraints(owner, guest, personal.id);
  await inspectConcurrency();
  const [nulls] = await source.query(
    'SELECT count(*)::int AS n FROM boards WHERE workspace_id IS NULL',
  );
  assert.equal(nulls.n, 0);
  const [column] = await source.query(
    `SELECT is_nullable FROM information_schema.columns WHERE table_name='boards' AND column_name='workspace_id'`,
  );
  assert.equal(column.is_nullable, 'NO');
  pass(
    'Final inventory has zero NULL/orphan Boards with physical NOT NULL enforced',
  );
  source.migrations = currentMigrations;
  await source.runMigrations();
  await inspectAuthentication();
  console.log(`Workspace PostgreSQL integration: ${checks} checks PASS`);
} finally {
  if (source?.isInitialized) await source.destroy();
  for (const name of databases) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
}
