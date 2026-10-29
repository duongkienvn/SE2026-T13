import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const require = createRequire(import.meta.url);
require('dotenv').config({
  path: resolve(
    fileURLToPath(new URL('../../', import.meta.url)),
    '../../.env',
  ),
  quiet: true,
});
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { NestFactory } = require('@nestjs/core');
const { databaseOptions } = require('../../dist/database/database-options.js');
const {
  ReadinessService,
} = require('../../dist/api/health/readiness.service.js');
const {
  paginateQueryBuilder,
} = require('../../dist/utils/offset-pagination.js');
const { paginateCursor } = require('../../dist/utils/cursor-pagination.js');

const testDatabase = `kanban_foundation_verify_${randomBytes(8).toString('hex')}`;
const baseOptions = databaseOptions(process.env);
const admin = new Client({
  host: baseOptions.host,
  port: baseOptions.port,
  database: baseOptions.database,
  user: baseOptions.username,
  password: baseOptions.password,
});
let source;
let created = false;

async function expectConstraint(query, parameters, code) {
  await assert.rejects(
    source.query(query, parameters),
    (error) => error.code === code,
  );
}

async function inspectSchema() {
  const tables =
    await source.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'migrations'
    ORDER BY table_name`);
  assert.deepEqual(
    tables.map((row) => row.table_name),
    [
      'activities',
      'avatar_uploads',
      'board_columns',
      'board_members',
      'boards',
      'card_assignees',
      'cards',
      'comments',
      'email_verification_tokens',
      'google_identities',
      'password_reset_tokens',
      'user_preferences',
      'users',
      'welcome_email_deliveries',
      'workspace_invitations',
      'workspace_members',
      'workspaces',
    ],
  );

  const constraints =
    await source.query(`SELECT conname, contype, confdeltype FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace ORDER BY conname`);
  const byName = new Map(constraints.map((row) => [row.conname, row]));
  for (const table of tables.map((row) => row.table_name)) {
    assert.equal(byName.get(`PK_${table}`)?.contype, 'p');
  }
  for (const name of [
    'UQ_users_email',
    'UQ_google_identity_sub',
    'UQ_google_identity_user',
    'UQ_board_members_board_id_user_id',
    'UQ_card_assignees_card_id_user_id',
  ]) {
    assert.equal(byName.get(name)?.contype, 'u');
  }
  const deletes = {
    FK_board_members_board_id: 'c',
    FK_board_columns_board_id: 'c',
    FK_cards_board_id: 'c',
    FK_cards_column_id: 'r',
    FK_card_assignees_card_id: 'c',
    FK_comments_card_id: 'c',
    FK_email_verification_user: 'c',
    FK_password_reset_user: 'c',
    FK_welcome_email_user: 'c',
  };
  for (const [name, behavior] of Object.entries(deletes)) {
    assert.equal(byName.get(name)?.confdeltype, behavior, name);
  }
  assert.equal(constraints.filter((row) => row.contype === 'f').length, 26);
  for (const row of constraints.filter(
    (row) => row.contype === 'f' && !(row.conname in deletes),
  )) {
    assert.equal(row.confdeltype, 'a', row.conname);
  }

  const indexes = await source.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
  );
  const indexNames = new Set(indexes.map((row) => row.indexname));
  for (const name of [
    'IDX_board_members_user_id',
    'IDX_board_columns_board_id_position',
    'IDX_cards_board_id_column_id',
    'IDX_cards_column_id',
    'IDX_comments_card_id',
    'IDX_activities_board_id_created_at',
  ]) {
    assert.ok(indexNames.has(name), name);
  }
  assert.ok(!indexNames.has('IDX_cards_board_id'));

  const enumRows =
    await source.query(`SELECT t.typname, e.enumlabel FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname IN
    ('board_members_role_enum', 'activities_action_type_enum', 'activities_entity_type_enum')
    ORDER BY t.typname, e.enumsortorder`);
  const enumValues = (name) =>
    enumRows.filter((row) => row.typname === name).map((row) => row.enumlabel);
  assert.deepEqual(enumValues('board_members_role_enum'), ['OWNER', 'MEMBER']);
  assert.deepEqual(enumValues('activities_entity_type_enum'), [
    'BOARD',
    'MEMBER',
    'COLUMN',
    'CARD',
    'COMMENT',
  ]);
  assert.deepEqual(enumValues('activities_action_type_enum').slice(-3), [
    'BOARD_ARCHIVED',
    'BOARD_RESTORED',
    'CARD_RESTORED',
  ]);
  assert.equal(enumValues('activities_action_type_enum').length, 18);

  const columns =
    await source.query(`SELECT table_name, column_name, data_type, numeric_precision,
    numeric_scale, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name <> 'migrations'`);
  const column = (table, name) =>
    columns.find((row) => row.table_name === table && row.column_name === name);
  for (const [table, name] of [
    ['board_columns', 'position'],
    ['cards', 'position'],
  ]) {
    assert.equal(column(table, name)?.data_type, 'numeric');
    assert.equal(column(table, name)?.numeric_precision, 20);
    assert.equal(column(table, name)?.numeric_scale, 10);
  }
  assert.equal(column('activities', 'metadata')?.data_type, 'jsonb');
  assert.equal(column('comments', 'deleted_at')?.is_nullable, 'YES');
  assert.equal(column('cards', 'is_archived')?.column_default, 'false');
  assert.equal(column('users', 'email')?.is_nullable, 'NO');
  for (const table of tables.map((row) => row.table_name)) {
    if (table === 'user_preferences' || table === 'welcome_email_deliveries') {
      assert.equal(column(table, 'user_id')?.data_type, 'uuid');
      continue;
    }
    assert.equal(column(table, 'id')?.data_type, 'uuid');
    if (table === 'avatar_uploads') {
      // The authenticated service generates the UUID before signing the intent.
      assert.equal(column(table, 'id')?.column_default, null);
      continue;
    }
    assert.match(
      column(table, 'id')?.column_default ?? '',
      /gen_random_uuid\(\)/,
    );
  }

  const drift = await source.driver.createSchemaBuilder().log();
  assert.deepEqual(
    drift.upQueries.map((query) => query.query),
    [
      'ALTER TABLE "workspaces" ADD "board_creation_admin_only" boolean NOT NULL DEFAULT false',
      'ALTER TABLE "workspaces" ADD "board_invites_enabled" boolean NOT NULL DEFAULT true',
      'ALTER TABLE "workspaces" ADD "board_membership_changes_enabled" boolean NOT NULL DEFAULT true',
      'ALTER TABLE "workspaces" ADD "board_visibility_changes_enabled" boolean NOT NULL DEFAULT true',
    ],
    'Only P2-05 policy columns should differ before its migration',
  );
}

async function inspectBehavior() {
  const [user] =
    await source.query(`INSERT INTO users (email, password_hash, display_name)
    VALUES ('foundation@example.test', 'hash', 'Test') RETURNING id`);
  await expectConstraint(
    `INSERT INTO users (email, password_hash, display_name)
    VALUES ('foundation@example.test', 'hash', 'Duplicate')`,
    [],
    '23505',
  );
  const [board] = await source.query(
    `INSERT INTO boards (name, created_by_id)
    VALUES ('Test', $1) RETURNING id`,
    [user.id],
  );
  const [column] = await source.query(
    `INSERT INTO board_columns (board_id, name, position)
    VALUES ($1, 'Todo', '100.1234567890') RETURNING id, position`,
    [board.id],
  );
  assert.equal(column.position, '100.1234567890');
  const [card] = await source.query(
    `INSERT INTO cards (board_id, column_id, created_by_id, title, position, is_archived)
    VALUES ($1, $2, $3, 'Card', '200.1234567890', true) RETURNING id, position`,
    [board.id, column.id, user.id],
  );
  assert.equal(card.position, '200.1234567890');
  await source.query(
    `INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
    [board.id, user.id],
  );
  await expectConstraint(
    `INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, 'MEMBER')`,
    [board.id, user.id],
    '23505',
  );
  await source.query(
    `INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2)`,
    [card.id, user.id],
  );
  await expectConstraint(
    `INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2)`,
    [card.id, user.id],
    '23505',
  );
  await expectConstraint(
    `INSERT INTO comments (card_id, author_id, content)
    VALUES ('00000000-0000-0000-0000-000000000000', $1, 'Invalid')`,
    [user.id],
    '23503',
  );
  await expectConstraint(
    `DELETE FROM board_columns WHERE id = $1`,
    [column.id],
    '23503',
  );
  await source.query(
    `INSERT INTO comments (card_id, author_id, content) VALUES ($1, $2, 'Hello')`,
    [card.id, user.id],
  );
  await source.query(`DELETE FROM cards WHERE id = $1`, [card.id]);
  assert.equal(
    (await source.query(`SELECT count(*)::int AS n FROM card_assignees`))[0].n,
    0,
  );
  assert.equal(
    (await source.query(`SELECT count(*)::int AS n FROM comments`))[0].n,
    0,
  );
}

async function inspectPagination() {
  const ids = [];
  for (let index = 0; index < 5; index += 1) {
    const [row] = await source.query(
      `INSERT INTO users (email, password_hash, display_name, created_at)
       VALUES ($1, 'hash', 'Pagination', '2026-10-12T12:34:56.123456Z') RETURNING id`,
      [`page-${index}@example.test`],
    );
    ids.push(row.id);
  }
  const ordered = ids.toSorted().reverse();
  const repository = source.getRepository('users');
  const builder = () =>
    repository
      .createQueryBuilder('user')
      .where('user.email LIKE :prefix', { prefix: 'page-%' });

  const first = await paginateQueryBuilder(
    builder(),
    { page: 1, limit: 2 },
    'createdAt',
  );
  const last = await paginateQueryBuilder(
    builder(),
    { page: 3, limit: 2 },
    'createdAt',
  );
  const empty = await paginateQueryBuilder(
    builder(),
    { page: 4, limit: 2 },
    'createdAt',
  );
  assert.deepEqual(
    first.data.map((row) => row.id),
    ordered.slice(0, 2),
  );
  assert.deepEqual(first.meta, { page: 1, limit: 2, total: 5, totalPages: 3 });
  assert.deepEqual(
    last.data.map((row) => row.id),
    ordered.slice(4),
  );
  assert.deepEqual(empty.data, []);
  assert.equal(empty.meta.total, 5);

  const seen = [];
  let cursor;
  for (let page = 0; page < 3; page += 1) {
    const result = await paginateCursor(
      builder(),
      { limit: 2, cursor },
      'createdAt',
    );
    seen.push(...result.data.map((row) => row.id));
    cursor = result.meta.nextCursor ?? undefined;
    if (page < 2) assert.ok(cursor);
    else assert.equal(cursor, undefined);
  }
  assert.deepEqual(seen, ordered);
  await assert.rejects(
    paginateCursor(builder(), { limit: 2, cursor: '!invalid' }, 'createdAt'),
  );
  const invalidDate = Buffer.from(
    JSON.stringify({
      v: 1,
      timestamp: '2026-02-30T12:34:56.123456Z',
      id: ids[0],
    }),
  ).toString('base64url');
  await assert.rejects(
    paginateCursor(builder(), { limit: 2, cursor: invalidDate }, 'createdAt'),
  );
  await assert.rejects(
    paginateCursor(builder().skip(1), { limit: 2 }, 'createdAt'),
  );
  await assert.rejects(
    paginateQueryBuilder(
      builder().limit(1),
      { page: 1, limit: 2 },
      'createdAt',
    ),
  );
  await assert.rejects(paginateCursor(builder(), { limit: 101 }, 'createdAt'));
  await assert.rejects(
    paginateCursor(builder(), { limit: 2 }, 'email; DROP TABLE users'),
  );
  console.log(
    'TypeORM offset/cursor pagination including duplicate timestamps: PASS',
  );
}

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${testDatabase}"`);
  created = true;
  source = new DataSource({ ...baseOptions, database: testDatabase });
  await source.initialize();
  assert.deepEqual(await new ReadinessService(source).check(), {
    status: 'ok',
    database: 'ok',
  });
  const timeoutRunner = source.createQueryRunner();
  try {
    await timeoutRunner.connect();
    await timeoutRunner.startTransaction();
    await timeoutRunner.query('SET LOCAL statement_timeout = 100');
    await assert.rejects(
      timeoutRunner.query('SELECT pg_sleep(1)'),
      (error) => error.driverError?.code === '57014',
    );
  } finally {
    if (timeoutRunner.isTransactionActive)
      await timeoutRunner.rollbackTransaction();
    await timeoutRunner.release();
  }
  assert.equal(source.options.poolSize, 10);
  assert.equal(source.options.connectTimeoutMS, 5000);
  assert.equal(source.options.ssl, false);
  assert.equal(source.options.logging, false);
  assert.equal(source.options.synchronize, false);
  assert.equal(source.options.migrationsRun, false);
  assert.equal(source.entityMetadatas.length, 17);
  assert.deepEqual(
    source.entityMetadatas.map((entity) => entity.tableName).sort(),
    [
      'activities',
      'avatar_uploads',
      'board_columns',
      'board_members',
      'boards',
      'card_assignees',
      'cards',
      'comments',
      'email_verification_tokens',
      'google_identities',
      'password_reset_tokens',
      'user_preferences',
      'users',
      'welcome_email_deliveries',
      'workspace_invitations',
      'workspace_members',
      'workspaces',
    ],
  );
  assert.equal(source.migrations.length, 14);

  const originalDatabase = process.env.DATABASE_NAME;
  process.env.DATABASE_NAME = testDatabase;
  try {
    const { AppModule } = require('../../dist/app.module.js');
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
    });
    try {
      const nestDataSource = app.get(DataSource);
      assert.equal(nestDataSource.entityMetadatas.length, 17);
      assert.equal(nestDataSource.migrations.length, 14);
      assert.equal(nestDataSource.options.poolSize, source.options.poolSize);
      assert.equal(
        nestDataSource.options.connectTimeoutMS,
        source.options.connectTimeoutMS,
      );
      assert.equal(nestDataSource.options.ssl, source.options.ssl);
    } finally {
      await app.close();
    }
  } finally {
    process.env.DATABASE_NAME = originalDatabase;
  }

  const allMigrations = source.migrations;
  source.migrations = allMigrations.filter(
    (m) => !m.name.startsWith('WorkspacePolicies'),
  );
  assert.equal((await source.runMigrations()).length, 13);
  const cliOutput = execFileSync(
    process.execPath,
    [
      require.resolve('typeorm/cli-ts-node-commonjs.js'),
      'migration:show',
      '-d',
      'src/database/data-source.ts',
    ],
    {
      cwd: resolve(fileURLToPath(new URL('../../', import.meta.url))),
      env: { ...process.env, DATABASE_NAME: testDatabase },
      encoding: 'utf8',
    },
  );
  assert.match(cliOutput, /\[X\].*InitialDatabaseFoundation1791763200000/);
  execFileSync(
    process.execPath,
    [
      '-r',
      require.resolve('ts-node/register'),
      '-e',
      `const dataSource = require('./src/database/data-source.ts').default;
       dataSource.initialize().then(async () => {
         if (dataSource.entityMetadatas.length !== 17 || dataSource.migrations.length !== 14) {
           throw new Error('TypeScript DataSource discovery mismatch');
         }
         await dataSource.destroy();
       }).catch((error) => { console.error(error); process.exitCode = 1; });`,
    ],
    {
      cwd: resolve(fileURLToPath(new URL('../../', import.meta.url))),
      env: { ...process.env, DATABASE_NAME: testDatabase },
      encoding: 'utf8',
    },
  );
  await inspectSchema();
  await inspectBehavior();
  await inspectPagination();
  console.log('Migration run and schema/behavior inspection: PASS');

  await source.undoLastMigration(); // Invitation lifecycle.
  await source.undoLastMigration(); // Workspace icon.
  await source.undoLastMigration(); // Empty welcome ledger.
  await source.undoLastMigration();
  await assert.rejects(
    source.undoLastMigration(),
    /Cannot discard populated Workspace data/,
  );
  // Explicit fixture cleanup is restricted to this script's random disposable DB.
  await source.query('DELETE FROM board_columns');
  await source.query('DELETE FROM boards');
  await source.query('DELETE FROM workspace_members');
  await source.query('DELETE FROM workspaces');
  await source.undoLastMigration();
  await source.undoLastMigration();
  assert.equal(
    (
      await source.query(
        `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='users' AND column_name='avatar_object_key'`,
      )
    )[0].n,
    0,
  );
  await source.undoLastMigration();
  await source.undoLastMigration();
  await source.undoLastMigration();
  await source.undoLastMigration();
  await assert.rejects(source.undoLastMigration(), /cannot be safely removed/);
  assert.equal((await source.runMigrations()).length, 10);
  await inspectSchema();
  source.migrations = allMigrations;
  assert.equal((await source.runMigrations()).length, 1);
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries,
    [],
  );
  await assert.rejects(
    source.undoLastMigration(),
    /Workspace policies require a forward fix/,
  );
  console.log(
    'Enum rollback retains existing values/history; idempotent reapply: PASS',
  );
} finally {
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${testDatabase}"`);
  await admin.end();
}
