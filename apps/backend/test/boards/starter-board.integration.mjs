import assert from 'node:assert/strict';
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

// Own the entire PostgreSQL target. No dotenv, AWS, production accounts or mail.
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { Test } = require('@nestjs/testing');
const { ConfigModule } = require('@nestjs/config');
const { TypeOrmModule } = require('@nestjs/typeorm');
const { LoggerModule } = require('nestjs-pino');
const { JwtService } = require('@nestjs/jwt');
const { ThrottlerModule } = require('@nestjs/throttler');
const request = require('supertest');
const { databaseOptions } = require('../../dist/database/database-options.js');
const { validateEnvironment } = require('../../dist/config/environment.js');
const { configureHttpApplication } = require('../../dist/http-application.js');
const { AuthModule } = require('../../dist/api/auth/auth.module.js');
const { UsersModule } = require('../../dist/api/users/users.module.js');
const { BoardsModule } = require('../../dist/api/boards/boards.module.js');
const { CardsModule } = require('../../dist/api/cards/cards.module.js');
const {
  WorkspaceApiModule,
} = require('../../dist/api/workspaces/workspace-api.module.js');
const { AuthService } = require('../../dist/api/auth/auth.service.js');
const {
  GoogleAuthService,
} = require('../../dist/api/auth/google-auth.service.js');
const {
  GoogleTokenVerifier,
} = require('../../dist/api/auth/google-token-verifier.service.js');
const {
  StarterBoardProvisioningService,
} = require('../../dist/api/boards/starter-board-provisioning.service.js');
const {
  StarterBoardRemovalService,
} = require('../../dist/api/boards/starter-board-removal.service.js');
const {
  WorkspacesService,
} = require('../../dist/api/workspaces/workspaces.service.js');
const { User } = require('../../dist/api/users/entities/user.entity.js');
const {
  STARTER_COLUMNS,
  STARTER_LABELS,
} = require('../../dist/api/boards/starter-board-template.js');
const container = `kanvexa-starter-test-${randomBytes(6).toString('hex')}`;
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
const pass = (label) => {
  groups++;
  console.log(`PASS: ${label}`);
};
const password = 'LocalPass1!';
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
    'POSTGRES_USER=starter_test',
    '--env',
    'POSTGRES_DB=starter_test',
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
    DATABASE_USER: 'starter_test',
    DATABASE_PASSWORD: secret,
    DATABASE_NAME: 'starter_test',
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
  for (let i = 0; ; i++) {
    try {
      source = await new DataSource(options).initialize();
      break;
    } catch (error) {
      if (i >= 80) throw error;
      await delay(250);
    }
  }
  const migrations = source.migrations;
  source.migrations = migrations.filter(
    (m) => !m.name.startsWith('StarterBoardOnboarding'),
  );
  await source.runMigrations();
  const [legacy] = await source.query(
    "INSERT INTO users(email,display_name,email_verified_at) VALUES ('legacy@starter.test','Legacy',now()) RETURNING *",
  );
  await source.query('SELECT ensure_personal_workspace($1)', [legacy.id]);
  const [legacyBoard] = await source.query(
    "INSERT INTO boards(name,created_by_id,workspace_id) SELECT 'Existing real project',$1,id FROM workspaces WHERE created_by_id=$1 AND type='PERSONAL' RETURNING *",
    [legacy.id],
  );
  const [legacyColumn] = await source.query(
    "INSERT INTO board_columns(board_id,name,position) VALUES($1,'Existing column',1024) RETURNING *",
    [legacyBoard.id],
  );
  const [legacyCard] = await source.query(
    "INSERT INTO cards(board_id,column_id,created_by_id,title,description,position) VALUES($1,$2,$3,'Existing card','Keep my work',1024) RETURNING *",
    [legacyBoard.id, legacyColumn.id, legacy.id],
  );
  source.migrations = migrations;
  assert.equal((await source.runMigrations()).length, 1);
  assert.deepEqual(
    (
      await source.query('SELECT * FROM boards WHERE id=$1', [legacyBoard.id])
    )[0],
    legacyBoard,
  );
  assert.deepEqual(
    (await source.query('SELECT * FROM cards WHERE id=$1', [legacyCard.id]))[0],
    legacyCard,
  );
  assert.equal(
    (
      await source.query('SELECT count(*)::int n FROM starter_board_provisions')
    )[0].n,
    0,
  );
  assert.equal(
    (await source.query('SELECT count(*)::int n FROM boards'))[0].n,
    1,
  );
  await source.undoLastMigration();
  assert.equal((await source.runMigrations()).length, 1);
  assert.deepEqual(await source.runMigrations(), []);
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries,
    [],
  );
  assert.equal(source.options.synchronize, false);
  assert.equal(source.options.migrationsRun, false);
  pass(
    'additive populated upgrade, empty down/up, idempotent migration, zero ORM drift, no legacy backfill',
  );

  const profiles = new Map();
  const environment = validateEnvironment({
    ...process.env,
    SWAGGER_ENABLED: 'true',
  });
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => environment],
      }),
      ThrottlerModule.forRoot([{ ttl: 60000, limit: 10000 }]),
      LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
      TypeOrmModule.forRoot(options),
      AuthModule,
      UsersModule,
      BoardsModule,
      CardsModule,
      WorkspaceApiModule,
    ],
  })
    .overrideProvider(DataSource)
    .useValue(source)
    .overrideProvider(GoogleTokenVerifier)
    .useValue({
      verify: async (credential) => {
        assert.ok(profiles.has(credential));
        return profiles.get(credential);
      },
    })
    .compile();
  app = module.createNestApplication();
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');
  const http = request(app.getHttpServer()),
    auth = app.get(AuthService),
    google = app.get(GoogleAuthService),
    starter = app.get(StarterBoardProvisioningService),
    workspaces = app.get(WorkspacesService),
    removal = app.get(StarterBoardRemovalService);
  const token = async (user) =>
    app
      .get(JwtService)
      .signAsync({ sub: user.id, authVersion: user.authVersion });
  const enroll = async () => {
    const email = `local-${++sequence}@starter.test`;
    await auth.register({ email, password, displayName: 'New member' });
    await source.query(
      'UPDATE users SET email_verified_at=now() WHERE email=$1',
      [email],
    );
    const user = await source.getRepository(User).findOneByOrFail({ email });
    const [ledger] = await source.query(
      'SELECT * FROM starter_board_provisions WHERE user_id=$1',
      [user.id],
    );
    return { user, boardId: ledger.board_id, jwt: await token(user) };
  };
  const preview = async (account) =>
    (
      await http
        .get(`/api/boards/${account.boardId}/sample-removal`)
        .auth(account.jwt, { type: 'bearer' })
        .expect(200)
    ).body.data;
  const remove = (account, input) =>
    http
      .delete(`/api/boards/${account.boardId}/sample-removal`)
      .auth(account.jwt, { type: 'bearer' })
      .send({ version: input.version, confirmation: input.confirmation });
  const count = async (table, where = '', values = []) =>
    (
      await source.query(
        `SELECT count(*)::int n FROM ${table} ${where}`,
        values,
      )
    )[0].n;
  const first = await enroll();
  assert.equal(
    await count('boards', 'WHERE created_by_id=$1', [first.user.id]),
    1,
  );
  const [board] = await source.query('SELECT * FROM boards WHERE id=$1', [
    first.boardId,
  ]);
  assert.equal(board.name, 'Welcome to Kanvexa');
  assert.equal(board.visibility, 'PRIVATE');
  assert.equal(board.background_preset, 'indigo');
  const [membership] = await source.query(
    'SELECT * FROM board_members WHERE board_id=$1',
    [first.boardId],
  );
  assert.equal(membership.user_id, first.user.id);
  assert.equal(membership.role, 'OWNER');
  const columns = await source.query(
    'SELECT * FROM board_columns WHERE board_id=$1 ORDER BY position',
    [first.boardId],
  );
  assert.deepEqual(
    columns.map((c) => c.name),
    STARTER_COLUMNS.map((c) => c.name),
  );
  assert.equal(
    await count('board_labels', 'WHERE board_id=$1', [first.boardId]),
    Object.keys(STARTER_LABELS).length,
  );
  let totalItems = 0,
    checked = 0;
  for (const [index, column] of columns.entries()) {
    assert.equal(Number(column.position), (index + 1) * 100);
    const cards = await source.query(
      'SELECT * FROM cards WHERE column_id=$1 ORDER BY position',
      [column.id],
    );
    assert.deepEqual(
      cards.map((c) => c.title),
      STARTER_COLUMNS[index].cards.map((c) => c.title),
    );
    for (const [cardIndex, card] of cards.entries()) {
      const template = STARTER_COLUMNS[index].cards[cardIndex];
      assert.equal(card.created_by_id, first.user.id);
      assert.equal(card.board_id, first.boardId);
      assert.equal(card.description, template.description);
      assert.equal(Number(card.position), (cardIndex + 1) * 100);
      const labels = await source.query(
        'SELECT l.name,l.color FROM board_labels l JOIN card_labels cl ON cl.label_id=l.id WHERE cl.card_id=$1 ORDER BY l.name',
        [card.id],
      );
      assert.deepEqual(
        labels.map((l) => l.name),
        [...template.labels].sort(),
      );
      for (const label of labels)
        assert.equal(label.color, STARTER_LABELS[label.name]);
      const assignees = await source.query(
        'SELECT * FROM card_assignees WHERE card_id=$1',
        [card.id],
      );
      assert.equal(assignees.length, template.assigned ? 1 : 0);
      if (template.assigned) assert.equal(assignees[0].user_id, first.user.id);
      for (const [key, offset] of [
        ['start_date', template.startDay],
        ['due_date', template.dueDay],
      ]) {
        if (offset === undefined) assert.equal(card[key], null);
        else
          assert.equal(
            card[key].getTime(),
            first.user.createdAt.getTime() + offset * 86400000,
          );
      }
      const items = await source.query(
        'SELECT i.* FROM card_checklist_items i JOIN card_checklists l ON l.id=i.checklist_id WHERE l.card_id=$1 ORDER BY i.position',
        [card.id],
      );
      assert.deepEqual(
        items.map((i) => i.text),
        template.checklist.items,
      );
      assert.equal(
        items.filter((i) => i.is_checked).length,
        template.checklist.checked,
      );
      totalItems += items.length;
      checked += items.filter((i) => i.is_checked).length;
    }
  }
  assert.equal(await count('cards', 'WHERE board_id=$1', [first.boardId]), 10);
  assert.equal(totalItems, 35);
  assert.equal(checked, 12);
  for (const table of [
    'activities',
    'comments',
    'user_notifications',
    'task_notification_email_outbox',
    'card_attachments',
  ])
    assert.equal(await count(table), 0);
  assert.equal(
    await count('email_verification_tokens', 'WHERE user_id=$1', [
      first.user.id,
    ]),
    1,
  );
  assert.equal(
    await count('welcome_email_deliveries', 'WHERE user_id=$1', [
      first.user.id,
    ]),
    1,
  );
  assert.equal((await preview(first)).isCustomized, false);
  const detail = await http
    .get(`/api/boards/${first.boardId}`)
    .auth(first.jwt, { type: 'bearer' })
    .expect(200);
  assert.equal(detail.body.data.isStarterBoard, true);
  await auth.login({ email: first.user.email, password });
  await auth.login({ email: first.user.email, password });
  await workspaces.ensurePersonalWorkspace(legacy.id);
  assert.equal(await count('boards', 'WHERE created_by_id=$1', [legacy.id]), 1);
  assert.equal(
    await count('boards', 'WHERE created_by_id=$1', [first.user.id]),
    1,
  );
  pass(
    'local signup: 4 columns, 10 ordered cards, 9 labels, 35 items/12 checked, dates/self-assignment, no synthetic events; repeated login/reconciliation do not seed',
  );

  const concurrentLocal = await Promise.allSettled(
    [1, 2].map(() =>
      auth.register({
        email: 'same-local@starter.test',
        password,
        displayName: 'Concurrent local',
      }),
    ),
  );
  assert.equal(
    concurrentLocal.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  const [sameLocal] = await source.query(
    "SELECT id FROM users WHERE email='same-local@starter.test'",
  );
  assert.equal(
    await count('boards', 'WHERE created_by_id=$1', [sameLocal.id]),
    1,
  );
  const listed = await http
    .get(`/api/boards/${first.boardId}/cards`)
    .query({ page: 1, limit: 100, sortBy: 'title', sortDirection: 'asc' })
    .auth(first.jwt, { type: 'bearer' })
    .expect(200);
  assert.equal(listed.body.data.length, 10);
  const summaries = await http
    .get(`/api/boards/${first.boardId}/card-preview-summaries`)
    .query({ cardIds: listed.body.data.map((card) => card.id).join(',') })
    .auth(first.jwt, { type: 'bearer' })
    .expect(200);
  assert.equal(summaries.body.data.summaries.length, 10);
  assert.equal(
    summaries.body.data.summaries.reduce(
      (sum, item) => sum + item.checklist.totalItems,
      0,
    ),
    35,
  );
  const checklistDetail = await http
    .get(
      `/api/boards/${first.boardId}/cards/${listed.body.data[0].id}/checklists`,
    )
    .auth(first.jwt, { type: 'bearer' })
    .expect(200);
  assert.equal(checklistDetail.body.data.checklists.length, 1);
  pass(
    'concurrent email registration commits once; real sorted Cards, preview summaries and checklist APIs expose the complete template',
  );

  const googleProof = 'google-new';
  profiles.set(googleProof, {
    sub: 'google-sub-new',
    email: 'google@starter.test',
    displayName: 'Google member',
    avatarUrl: null,
    authoritativeEmail: true,
  });
  const googleLogins = await Promise.all([
    google.signIn(googleProof),
    google.signIn(googleProof),
    google.signIn(googleProof),
  ]);
  assert.equal(new Set(googleLogins.map((r) => r.user.id)).size, 1);
  assert.equal(
    await count('boards', 'WHERE created_by_id=$1', [googleLogins[0].user.id]),
    1,
  );
  const existingProof = 'google-existing';
  profiles.set(existingProof, {
    sub: 'legacy-google',
    email: legacy.email,
    displayName: 'Legacy',
    avatarUrl: null,
    authoritativeEmail: true,
  });
  await source.query(
    'INSERT INTO google_identities(user_id,google_sub) VALUES($1,$2)',
    [legacy.id, 'legacy-google'],
  );
  await google.signIn(existingProof);
  await google.signIn(existingProof);
  assert.equal(await count('boards', 'WHERE created_by_id=$1', [legacy.id]), 1);
  pass(
    'concurrent new Google signup enrolls once; existing Google login remains unseeded',
  );

  const pending = await source.getRepository(User).save(
    source.getRepository(User).create({
      email: 'concurrent@starter.test',
      displayName: 'Concurrent',
      emailVerifiedAt: new Date(),
    }),
  );
  const personal = await workspaces.ensurePersonalWorkspace(pending.id);
  const outcomes = await Promise.all(
    [1, 2, 3].map(() =>
      source.transaction((manager) =>
        starter.provision(manager, pending, personal.id),
      ),
    ),
  );
  assert.equal(new Set(outcomes).size, 1);
  assert.equal(
    await count('boards', 'WHERE created_by_id=$1', [pending.id]),
    1,
  );
  const originalProvision = starter.provision.bind(starter);
  let rolledBackId;
  starter.provision = async (manager, user, workspaceId) => {
    rolledBackId = user.id;
    await originalProvision(manager, user, workspaceId);
    throw new Error('Injected registration rollback');
  };
  try {
    await assert.rejects(
      auth.register({
        email: 'rollback@starter.test',
        password,
        displayName: 'Rollback',
      }),
      /Injected/,
    );
    assert.equal(await count('users', 'WHERE id=$1', [rolledBackId]), 0);
    assert.equal(
      await count('boards', 'WHERE created_by_id=$1', [rolledBackId]),
      0,
    );
    profiles.set('google-rollback', {
      sub: 'rollback-sub',
      email: 'google-rollback@starter.test',
      displayName: 'Rollback',
      avatarUrl: null,
      authoritativeEmail: true,
    });
    await assert.rejects(google.signIn('google-rollback'), /Injected/);
    assert.equal(await count('users', 'WHERE id=$1', [rolledBackId]), 0);
    assert.equal(
      await count('google_identities', 'WHERE user_id=$1', [rolledBackId]),
      0,
    );
    assert.equal(
      await count('starter_board_provisions', 'WHERE user_id=$1', [
        rolledBackId,
      ]),
      0,
    );
  } finally {
    starter.provision = originalProvision;
  }
  await assert.rejects(source.undoLastMigration(), /retained/);
  pass(
    'concurrent provisioning idempotency, complete local/Google signup rollback, populated rollback protection',
  );

  const initial = await preview(first);
  await http.get(`/api/boards/${first.boardId}/sample-removal`).expect(401);
  const outsider = await enroll();
  await http
    .get(`/api/boards/${first.boardId}/sample-removal`)
    .auth(outsider.jwt, { type: 'bearer' })
    .expect(404);
  const normal = await http
    .post('/api/boards')
    .auth(first.jwt, { type: 'bearer' })
    .send({ name: 'Welcome to Kanvexa' })
    .expect(201);
  await http
    .delete(`/api/boards/${normal.body.data.id}/sample-removal`)
    .auth(first.jwt, { type: 'bearer' })
    .send({ version: initial.version, confirmation: initial.confirmation })
    .expect(404);
  await remove(first, {
    version: initial.version,
    confirmation: 'remove sample board',
  }).expect(400);
  const [target] = await source.query(
    'SELECT id FROM cards WHERE board_id=$1 ORDER BY id LIMIT 1',
    [first.boardId],
  );
  await http
    .patch(`/api/boards/${first.boardId}/cards/${target.id}`)
    .auth(first.jwt, { type: 'bearer' })
    .send({ description: 'My real project notes' })
    .expect(200);
  await remove(first, {
    version: initial.version,
    confirmation: initial.confirmation,
  }).expect(409);
  const customized = await preview(first);
  assert.equal(customized.isCustomized, true);
  assert.equal(customized.confirmation, 'DELETE MY CUSTOMIZED BOARD');
  await remove(first, {
    version: customized.version,
    confirmation: 'REMOVE SAMPLE BOARD',
  }).expect(400);
  await remove(first, {
    version: customized.version,
    confirmation: customized.confirmation,
  }).expect(204);
  assert.equal(await count('boards', 'WHERE id=$1', [first.boardId]), 0);
  assert.equal(await count('cards', 'WHERE board_id=$1', [first.boardId]), 0);
  assert.equal(
    (
      await source.query(
        'SELECT board_id FROM starter_board_provisions WHERE user_id=$1',
        [first.user.id],
      )
    )[0].board_id,
    null,
  );
  assert.equal(
    await source.transaction((manager) =>
      starter.provision(manager, first.user, board.workspace_id),
    ),
    null,
  );
  assert.equal(
    await count('boards', 'WHERE created_by_id=$1', [first.user.id]),
    1,
  ); // Ordinary same-name board survives.
  pass(
    'authenticated OWNER removal, ordinary same-name protection, stale preview/wrong phrase guards, real customized work confirmation, durable no-reseed marker',
  );

  const collaborative = await enroll();
  await source.query(
    "INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'MEMBER')",
    [collaborative.boardId, outsider.user.id],
  );
  await http
    .get(`/api/boards/${collaborative.boardId}/sample-removal`)
    .auth(outsider.jwt, { type: 'bearer' })
    .expect(403);
  await http
    .get(`/api/boards/${collaborative.boardId}/sample-removal`)
    .auth(collaborative.jwt, { type: 'bearer' })
    .expect(409);
  await source.query(
    'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
    [collaborative.boardId, outsider.user.id],
  );
  await source.query(
    "INSERT INTO activities(board_id,actor_id,action_type,entity_type) VALUES($1,$2,'MEMBER_ADDED','MEMBER')",
    [collaborative.boardId, collaborative.user.id],
  );
  await http
    .get(`/api/boards/${collaborative.boardId}/sample-removal`)
    .auth(collaborative.jwt, { type: 'bearer' })
    .expect(409);
  const shared = await enroll();
  await source.query(
    "UPDATE boards SET visibility='WORKSPACE_VISIBLE' WHERE id=$1",
    [shared.boardId],
  );
  await http
    .get(`/api/boards/${shared.boardId}/sample-removal`)
    .auth(shared.jwt, { type: 'bearer' })
    .expect(409);
  const moved = await enroll();
  const [team] = await source.query(
    "INSERT INTO workspaces(name,type,created_by_id) VALUES('Own team','TEAM',$1) RETURNING id",
    [moved.user.id],
  );
  await source.query('UPDATE boards SET workspace_id=$1 WHERE id=$2', [
    team.id,
    moved.boardId,
  ]);
  await http
    .get(`/api/boards/${moved.boardId}/sample-removal`)
    .auth(moved.jwt, { type: 'bearer' })
    .expect(409);
  const foreignContent = await enroll();
  await source.query('UPDATE cards SET created_by_id=$1 WHERE board_id=$2', [
    outsider.user.id,
    foreignContent.boardId,
  ]);
  await http
    .get(`/api/boards/${foreignContent.boardId}/sample-removal`)
    .auth(foreignContent.jwt, { type: 'bearer' })
    .expect(409);
  pass(
    'non-owner MEMBER, shared visibility and historical collaboration block removal',
  );

  const raced = await enroll(),
    racePreview = await preview(raced);
  const runner = source.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  await runner.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE', [
    raced.boardId,
  ]);
  await runner.query(
    "UPDATE cards SET title='Concurrent real work',updated_at=clock_timestamp() WHERE board_id=$1",
    [raced.boardId],
  );
  let finished = false;
  const racing = removal.remove(raced.user.id, raced.boardId, racePreview).then(
    () => {
      finished = true;
      return null;
    },
    (error) => {
      finished = true;
      return error;
    },
  );
  await delay(100);
  assert.equal(finished, false);
  await runner.commitTransaction();
  await runner.release();
  const raceError = await racing;
  assert.equal(raceError.getStatus(), 409);
  assert.equal(await count('cards', 'WHERE board_id=$1', [raced.boardId]), 10);
  const fresh = await preview(raced);
  const simultaneous = await Promise.all([
    remove(raced, fresh),
    remove(raced, fresh),
  ]);
  assert.deepEqual(simultaneous.map((r) => r.status).sort(), [204, 404]);
  pass(
    'real Board lock fences modification/removal; stale confirmation preserves work; concurrent removals commit once',
  );

  const files = await enroll();
  const [fileCard] = await source.query(
    'SELECT id FROM cards WHERE board_id=$1 LIMIT 1',
    [files.boardId],
  );
  const fileId = randomUUID();
  await source.query(
    `INSERT INTO card_attachments(id,card_id,board_id,uploader_id,kind,state,display_name,original_filename,pending_key,storage_key,requested_mime_type,reserved_bytes,declared_bytes,expires_at)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'FILE','PENDING','My document','notes.txt','attachments/v1/pending/'||$1::text,'attachments/v1/active/'||$1::text,'text/plain',100,100,now()+interval '10 minutes')`,
    [fileId, fileCard.id, files.boardId, files.user.id],
  );
  await source.query(
    'UPDATE card_attachment_cleanup_jobs SET completed_at=now() WHERE attachment_id=$1',
    [fileId],
  );
  await remove(files, await preview(files)).expect(204);
  const jobs = await source.query(
    'SELECT * FROM card_attachment_cleanup_jobs WHERE attachment_id=$1',
    [fileId],
  );
  assert.equal(jobs.length, 2);
  assert.ok(
    jobs.every(
      (job) => job.completed_at === null && job.not_before > Date.now(),
    ),
  );
  assert.equal(
    await count('card_attachments', 'WHERE board_id=$1', [files.boardId]),
    0,
  );
  pass(
    'pending FILE cascade retains/rearms both durable storage cleanup keys after Board deletion',
  );

  const closing = await enroll();
  const blocked = await http
    .delete('/api/users/me')
    .auth(closing.jwt, { type: 'bearer' })
    .send({ confirmation: 'DELETE', currentPassword: password })
    .expect(409);
  assert.ok(
    blocked.body.blockers.some(
      (b) => b.type === 'PERSONAL_WORKSPACE_HAS_BOARDS',
    ),
  );
  const pristine = await preview(closing);
  await remove(closing, pristine).expect(204);
  await http
    .delete('/api/users/me')
    .auth(closing.jwt, { type: 'bearer' })
    .send({ confirmation: 'DELETE', currentPassword: password })
    .expect(204);
  assert.equal(
    await count('starter_board_provisions', 'WHERE user_id=$1', [
      closing.user.id,
    ]),
    0,
  );
  assert.equal(
    await count('workspaces', 'WHERE created_by_id=$1', [closing.user.id]),
    0,
  );
  for (const [table, join] of [
    ['board_columns', 'board_id'],
    ['cards', 'board_id'],
    ['board_members', 'board_id'],
    ['board_labels', 'board_id'],
  ])
    assert.equal(await count(table, `WHERE ${join}=$1`, [closing.boardId]), 0);
  await assert.rejects(
    source.transaction((manager) =>
      starter.provision(manager, closing.user, board.workspace_id),
    ),
    /live account/,
  );
  await assert.rejects(
    source.query(
      'INSERT INTO starter_board_provisions(user_id,template_version,baseline_hash) VALUES($1,1,$2)',
      [closing.user.id, 'a'.repeat(64)],
    ),
    (error) => error.driverError?.code === '23503',
  );
  pass(
    'pristine removal clears real account-deletion blockers and private enrollment; tombstones cannot re-enroll; no dangling Board graph',
  );
  console.log(`${groups} Starter Board PostgreSQL acceptance groups passed.`);
} finally {
  if (app) await app.close();
  if (source?.isInitialized) await source.destroy();
  if (started) docker('rm', '--force', container);
}
