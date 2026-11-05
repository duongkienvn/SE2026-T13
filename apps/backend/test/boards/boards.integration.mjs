import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';

const require = createRequire(import.meta.url);
require('reflect-metadata');
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
const { JwtService } = require('@nestjs/jwt');
const request = require('supertest');
const { databaseOptions } = require('../../dist/database/database-options.js');
const { BoardsService } = require('../../dist/api/boards/boards.service.js');
const {
  WorkspacesService,
} = require('../../dist/api/workspaces/workspaces.service.js');
const { Board } = require('../../dist/api/boards/entities/board.entity.js');
const {
  BoardMember,
} = require('../../dist/api/board-members/entities/board-member.entity.js');

const testDatabase = `kanban_boards_verify_${randomBytes(8).toString('hex')}`;
const baseOptions = databaseOptions(process.env);
const admin = new Client({
  host: baseOptions.host,
  port: baseOptions.port,
  database: baseOptions.database,
  user: baseOptions.username,
  password: baseOptions.password,
  ssl: baseOptions.ssl,
  connectionTimeoutMillis: baseOptions.connectTimeoutMS,
});
let source;
let app;
let created = false;
const rejectsStatus = (promise, status) =>
  assert.rejects(promise, (error) => error.getStatus?.() === status);

try {
  await admin.connect();
  const upgradeDatabase = `${testDatabase}_upgrade`;
  await admin.query(`CREATE DATABASE "${upgradeDatabase}"`);
  let upgradeSource;
  try {
    upgradeSource = new DataSource({
      ...baseOptions,
      database: upgradeDatabase,
    });
    await upgradeSource.initialize();
    // Rehearse the historical discovery rollback before the forward-only
    // notification boundary. The main database below exercises the full chain.
    const migrations = upgradeSource.migrations.filter(
      (migration) =>
        !migration.name.startsWith('NotificationFoundation') &&
        !migration.name.startsWith('CommentMentions') &&
        !migration.name.startsWith('TaskNotificationEmailOutbox') &&
        !migration.name.startsWith('EmailChangeSecurity') &&
        !migration.name.startsWith('AccountDeletion'),
    );
    upgradeSource.migrations = migrations.filter(
      (migration) =>
        !migration.name.startsWith('BoardDiscovery') &&
        !migration.name.startsWith('BoardBackgroundVersion'),
    );
    await upgradeSource.runMigrations();
    const [legacyUser] = await upgradeSource.query(
      "INSERT INTO users(email,display_name,email_verified_at) VALUES ('legacy-board@example.test','Legacy',now()) RETURNING id",
    );
    const [legacy] = await upgradeSource.query(
      "INSERT INTO boards(name,created_by_id) VALUES ('Legacy board',$1) RETURNING id, updated_at, workspace_id, visibility",
      [legacyUser.id],
    );
    upgradeSource.migrations = migrations;
    await upgradeSource.runMigrations();
    const [after] = await upgradeSource.query(
      'SELECT id, updated_at, workspace_id, visibility, background_preset, background_version FROM boards WHERE id=$1',
      [legacy.id],
    );
    assert.equal(after.background_preset, 'blue');
    assert.equal(after.background_version, 0);
    delete after.background_preset;
    delete after.background_version;
    assert.deepEqual(after, legacy);
    await assert.rejects(
      upgradeSource.query(
        "UPDATE boards SET background_preset='https://invalid.test' WHERE id=$1",
        [legacy.id],
      ),
      (error) => error.code === '23514',
    );
    await upgradeSource.query(
      'INSERT INTO board_user_states(user_id,board_id,is_starred) VALUES ($1,$2,true)',
      [legacyUser.id, legacy.id],
    );
    await upgradeSource.query(
      'UPDATE boards SET background_version=1 WHERE id=$1',
      [legacy.id],
    );
    await assert.rejects(
      upgradeSource.undoLastMigration(),
      /must be preserved/,
    );
    await upgradeSource.query(
      'UPDATE boards SET background_version=0 WHERE id=$1',
      [legacy.id],
    );
    await upgradeSource.undoLastMigration();
    await assert.rejects(
      upgradeSource.undoLastMigration(),
      /must be preserved/,
    );
    await upgradeSource.query(
      'DELETE FROM board_user_states WHERE user_id=$1 AND board_id=$2',
      [legacyUser.id, legacy.id],
    );
    await upgradeSource.undoLastMigration();
    assert.equal((await upgradeSource.runMigrations()).length, 2);
    console.log(
      'Populated Board upgrade preserves legacy fields and backfills default: PASS',
    );
  } finally {
    if (upgradeSource?.isInitialized) await upgradeSource.destroy();
    await admin.query(`DROP DATABASE "${upgradeDatabase}"`);
  }
  // The configured database is only an administrative connection. All fixtures and
  // migrations below run exclusively in a random database owned by this test.
  await admin.query(`CREATE DATABASE "${testDatabase}"`);
  created = true;
  source = new DataSource({ ...baseOptions, database: testDatabase });
  await source.initialize();
  await source.runMigrations();
  const boards = source.getRepository(Board);
  const members = source.getRepository(BoardMember);
  const users = source.getRepository('User');
  const {
    BoardAuthorizationService,
  } = require('../../dist/api/board-members/board-authorization.service.js');
  const {
    ActivityWriterService,
  } = require('../../dist/api/activities/activity-writer.service.js');
  const activityWriter = new ActivityWriterService();
  const service = new BoardsService(
    boards,
    members,
    new BoardAuthorizationService(members),
    activityWriter,
    { publish: async () => undefined },
    new WorkspacesService(source.getRepository('Workspace')),
  );
  const user = (name) =>
    users.save(
      users.create({
        email: `${name}@example.test`,
        displayName: name,
        passwordHash: 'test-only-hash',
        avatarUrl: null,
        emailVerifiedAt: new Date(),
      }),
    );
  const owner = await user('owner');
  const member = await user('member');
  const outsider = await user('outsider');
  const faultUser = await user('fault');

  const first = await service.create(owner.id, {
    name: 'First',
    description: 'Keep',
    backgroundPreset: 'forest',
  });
  assert.equal(first.backgroundPreset, 'forest');
  assert.equal(
    (await boards.findOneByOrFail({ id: first.id })).backgroundPreset,
    'forest',
  );
  const {
    BoardDiscoveryService,
  } = require('../../dist/api/boards/board-discovery.service.js');
  const delivered = [];
  const discovery = new BoardDiscoveryService(
    boards,
    new BoardAuthorizationService(members),
    {
      publish: async (event, payload) => delivered.push({ event, payload }),
    },
    activityWriter,
  );
  await members.save(
    members.create({ boardId: first.id, userId: member.id, role: 'MEMBER' }),
  );
  await Promise.all(
    Array.from({ length: 5 }, () =>
      discovery.setStar(owner.id, first.id, true),
    ),
  );
  await Promise.all(
    Array.from({ length: 5 }, () => discovery.view(owner.id, first.id)),
  );
  assert.equal((await discovery.state(owner.id, first.id)).isStarred, true);
  assert.equal((await discovery.state(member.id, first.id)).isStarred, false);
  assert.ok((await discovery.state(owner.id, first.id)).lastViewedAt);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM board_user_states WHERE user_id = $1 AND board_id = $2',
        [owner.id, first.id],
      )
    )[0].n,
    1,
  );
  await assert.rejects(
    source.query(
      'INSERT INTO board_user_states(user_id,board_id) VALUES ($1,$2)',
      [owner.id, first.id],
    ),
    (error) => error.code === '23505',
  );
  await assert.rejects(
    source.query(
      "INSERT INTO board_user_states(user_id,board_id) VALUES ('00000000-0000-4000-8000-000000000000',$1)",
      [first.id],
    ),
    (error) => error.code === '23503',
  );
  await rejectsStatus(discovery.setStar(outsider.id, first.id, true), 404);
  await rejectsStatus(discovery.background(member.id, first.id, 'forest'), 403);
  for (const preset of [
    'teal',
    'forest',
    'blue',
    'indigo',
    'violet',
    'rose',
    'orange',
    'amber',
    'green',
    'mountains',
    'coast',
    'lake',
  ]) {
    assert.equal(
      (await discovery.background(owner.id, first.id, preset)).backgroundPreset,
      preset,
    );
    assert.equal(
      (await boards.findOneByOrFail({ id: first.id })).backgroundPreset,
      preset,
    );
  }
  await rejectsStatus(
    discovery.background(owner.id, first.id, 'https://invalid.test'),
    400,
  );
  assert.equal(delivered.length, 12);
  assert.ok(
    delivered.every(
      ({ event, payload }) =>
        event === 'board:access-changed' &&
        Object.keys(payload).join() === 'boardId',
    ),
  );
  const version = (await boards.findOneByOrFail({ id: first.id }))
    .backgroundVersion;
  const concurrent = await Promise.allSettled([
    discovery.background(owner.id, first.id, 'blue', version),
    discovery.background(owner.id, first.id, 'teal', version),
  ]);
  assert.equal(
    concurrent.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  const backgroundRejected = concurrent.find(
    (result) => result.status === 'rejected',
  );
  assert.equal(backgroundRejected.reason.getStatus(), 409);
  assert.equal(
    (await boards.findOneByOrFail({ id: first.id })).backgroundVersion,
    version + 1,
  );
  const starred = await service.list(owner.id, {
    page: 1,
    limit: 20,
    starred: true,
  });
  assert.deepEqual(
    starred.data.map((board) => board.id),
    [first.id],
  );
  const recent = await service.list(owner.id, {
    page: 1,
    limit: 20,
    recent: true,
    sort: 'recent',
  });
  assert.deepEqual(
    recent.data.map((board) => board.id),
    [first.id],
  );
  await discovery.setStar(owner.id, first.id, false);
  await discovery.setStar(owner.id, first.id, false);
  assert.equal((await discovery.state(owner.id, first.id)).isStarred, false);
  await members.delete({ boardId: first.id, userId: member.id });
  await rejectsStatus(discovery.state(member.id, first.id), 404);
  console.log(
    'Board discovery concurrency, per-user state, access and preset persistence: PASS',
  );
  const planUser = await user('plan-user');
  const planBoards = await source.query(
    `INSERT INTO boards(name,created_by_id) SELECT 'plan-' || n, $1 FROM generate_series(1,1200) AS n RETURNING id`,
    [planUser.id],
  );
  await source.query(
    `INSERT INTO board_user_states(user_id,board_id,is_starred,last_viewed_at)
     SELECT $1, unnest($2::uuid[]), true, now()`,
    [planUser.id, planBoards.map((row) => row.id)],
  );
  await source.query('ANALYZE board_user_states');
  const plan = await source.query(
    `EXPLAIN (ANALYZE, FORMAT JSON) SELECT board_id FROM board_user_states
     WHERE user_id=$1 AND last_viewed_at IS NOT NULL ORDER BY last_viewed_at DESC,board_id DESC LIMIT 20`,
    [planUser.id],
  );
  assert.ok(plan[0]['QUERY PLAN'][0]['Execution Time'] >= 0);
  assert.ok(JSON.stringify(plan).includes('IDX_board_user_states_recent'));
  console.log(
    'PostgreSQL recent query EXPLAIN ANALYZE on 1,200 relations: PASS',
  );
  await members.save(
    members.create({
      boardId: planBoards[0].id,
      userId: planUser.id,
      role: 'OWNER',
    }),
  );
  await discovery.view(planUser.id, planBoards[0].id);
  const [retained] = await source.query(
    'SELECT count(*) FILTER (WHERE last_viewed_at IS NOT NULL)::int AS recent, count(*) FILTER (WHERE is_starred)::int AS starred FROM board_user_states WHERE user_id=$1',
    [planUser.id],
  );
  assert.equal(retained.recent, 100);
  assert.equal(retained.starred, 1200);
  await members.save(
    members.create({
      boardId: planBoards[1].id,
      userId: planUser.id,
      role: 'OWNER',
    }),
  );
  await source.query(
    "UPDATE boards SET name='Equal discovery name' WHERE id = ANY($1::uuid[])",
    [[planBoards[0].id, planBoards[1].id]],
  );
  const nameOrder = [planBoards[0].id, planBoards[1].id].sort();
  for (const page of [1, 2]) {
    const result = await service.list(planUser.id, {
      page,
      limit: 1,
      q: 'Equal discovery name',
      sort: 'name',
    });
    assert.equal(result.meta.total, 2);
    assert.equal(result.data[0].id, nameOrder[page - 1]);
  }
  assert.equal(first.currentUserRole, 'OWNER');
  assert.equal(await boards.countBy({ id: first.id }), 1);
  assert.equal(
    await members.countBy({
      boardId: first.id,
      userId: owner.id,
      role: 'OWNER',
    }),
    1,
  );

  const before = await boards.count();
  const beforeMembers = await members.count();
  // Fault injection changes only this DataSource's insert event. PostgreSQL itself
  // rejects the membership enum after the Board INSERT has executed.
  const fault = {
    listenTo: () => BoardMember,
    beforeInsert: (event) => {
      if (event.entity.userId === faultUser.id)
        event.entity.role = 'INVALID_ROLE';
    },
  };
  source.subscribers.push(fault);
  try {
    await assert.rejects(
      service.create(faultUser.id, { name: 'Must rollback' }),
      (error) => error.driverError?.code === '22P02',
    );
  } finally {
    source.subscribers.splice(source.subscribers.indexOf(fault), 1);
  }
  assert.equal(await boards.count(), before);
  assert.equal(await members.count(), beforeMembers);
  assert.equal(await boards.countBy({ name: 'Must rollback' }), 0);
  console.log(
    'PostgreSQL Board + OWNER persistence and real insert-failure rollback: PASS',
  );

  const second = await service.create(owner.id, { name: 'Second' });
  const third = await service.create(owner.id, { name: 'Third' });
  await members.save(
    [second, third].map(({ id }) =>
      members.create({ boardId: id, userId: member.id, role: 'MEMBER' }),
    ),
  );
  const unchangedBefore = (
    await boards.findOneByOrFail({ id: third.id })
  ).updatedAt.getTime();
  await discovery.view(owner.id, second.id);
  await delay(5);
  await discovery.view(owner.id, third.id);
  await discovery.view(member.id, third.id);
  await delay(5);
  await discovery.view(member.id, second.id);
  const ownerOrder = await service.list(owner.id, {
    page: 1,
    limit: 2,
    recent: true,
    sort: 'recent',
  });
  const memberOrder = await service.list(member.id, {
    page: 1,
    limit: 2,
    recent: true,
    sort: 'recent',
  });
  assert.deepEqual(
    ownerOrder.data.map((item) => item.id),
    [third.id, second.id],
  );
  assert.deepEqual(
    memberOrder.data.map((item) => item.id),
    [second.id, third.id],
  );
  assert.equal(
    (await boards.findOneByOrFail({ id: third.id })).updatedAt.getTime(),
    unchangedBefore,
  );
  await members.delete({ boardId: second.id, userId: member.id });
  await members.delete({ boardId: third.id, userId: member.id });
  await source.query(
    'DELETE FROM board_user_states WHERE board_id = ANY($1::uuid[])',
    [[second.id, third.id]],
  );
  await discovery.view(owner.id, second.id);
  await source.query(
    'UPDATE board_user_states SET last_viewed_at = $1 WHERE user_id = $2 AND board_id = ANY($3::uuid[])',
    [new Date('2026-01-01T00:00:00Z'), owner.id, [first.id, second.id]],
  );
  const recentOrder = [first.id, second.id].sort().reverse();
  for (const page of [1, 2]) {
    const result = await service.list(owner.id, {
      page,
      limit: 1,
      recent: true,
      sort: 'recent',
    });
    assert.equal(result.meta.total, 2);
    assert.equal(result.data[0].id, recentOrder[page - 1]);
  }
  const privateBoard = await service.create(outsider.id, { name: 'Private' });
  const creatorWithoutMembership = await service.create(owner.id, {
    name: 'No membership',
  });
  await members.delete({
    boardId: creatorWithoutMembership.id,
    userId: owner.id,
  });
  const archived = await service.create(owner.id, { name: 'Archived' });
  await service.archive(owner.id, archived.id);
  const archivedTwin = await service.create(owner.id, {
    name: 'Archived twin',
  });
  await service.archive(owner.id, archivedTwin.id);
  const sharedArchiveTime = new Date('2026-10-14T00:00:00Z');
  await boards.update(archived.id, { archivedAt: sharedArchiveTime });
  await boards.update(archivedTwin.id, { archivedAt: sharedArchiveTime });
  await members.save(
    members.create({ boardId: archived.id, userId: member.id, role: 'MEMBER' }),
  );
  const archivedOrder = [archived.id, archivedTwin.id].sort().reverse();
  const archivedPage = await service.list(owner.id, {
    page: 1,
    limit: 1,
    status: 'archived',
  });
  assert.deepEqual(
    archivedPage.data.map((board) => board.id),
    archivedOrder.slice(0, 1),
  );
  assert.deepEqual(archivedPage.meta, {
    page: 1,
    limit: 1,
    total: 2,
    totalPages: 2,
  });
  assert.deepEqual(
    (
      await service.list(owner.id, { page: 2, limit: 1, status: 'archived' })
    ).data.map((board) => board.id),
    archivedOrder.slice(1),
  );
  const memberArchivedPage = await service.list(member.id, {
    page: 1,
    limit: 20,
    status: 'archived',
  });
  assert.deepEqual(
    memberArchivedPage.data.map((board) => board.id),
    [archived.id],
  );
  assert.equal(memberArchivedPage.data[0].currentUserRole, 'MEMBER');
  await members.save(
    members.create({ boardId: first.id, userId: member.id, role: 'MEMBER' }),
  );
  for (const id of [first.id, second.id, third.id]) {
    await boards.update(id, { createdAt: new Date('2026-10-13T00:00:00Z') });
  }
  const expected = [first.id, second.id, third.id].sort().reverse();
  const page = await service.list(owner.id, { page: 1, limit: 2 });
  assert.deepEqual(
    page.data.map((board) => board.id),
    expected.slice(0, 2),
  );
  assert.deepEqual(page.meta, { page: 1, limit: 2, total: 3, totalPages: 2 });
  const last = await service.list(owner.id, { page: 2, limit: 2 });
  assert.deepEqual(
    last.data.map((board) => board.id),
    expected.slice(2),
  );
  const empty = await service.list(owner.id, { page: 3, limit: 2 });
  assert.deepEqual(empty.data, []);
  assert.equal(empty.meta.total, 3);
  const memberPage = await service.list(member.id, { page: 1, limit: 20 });
  assert.deepEqual(
    memberPage.data.map((board) => board.id),
    [first.id],
  );
  assert.equal(memberPage.data[0].currentUserRole, 'MEMBER');
  assert.equal(
    (await service.list(outsider.id, { page: 1, limit: 20 })).data[0].id,
    privateBoard.id,
  );
  await rejectsStatus(
    service.getDetail(owner.id, creatorWithoutMembership.id),
    404,
  );
  assert.equal(
    (await service.getDetail(owner.id, first.id)).currentUserRole,
    'OWNER',
  );
  assert.equal(
    (await service.getDetail(member.id, first.id)).currentUserRole,
    'MEMBER',
  );
  await rejectsStatus(service.getDetail(outsider.id, first.id), 404);
  console.log(
    'PostgreSQL membership isolation, archive filtering, pagination and UUID tie ordering: PASS',
  );

  await service.update(owner.id, first.id, { name: 'Updated' });
  assert.equal(
    (await boards.findOneByOrFail({ id: first.id })).description,
    'Keep',
  );
  await service.update(owner.id, first.id, { description: null });
  assert.equal(
    (await boards.findOneByOrFail({ id: first.id })).description,
    null,
  );
  await rejectsStatus(
    service.update(member.id, first.id, { name: 'Forbidden' }),
    403,
  );
  await rejectsStatus(
    service.update(outsider.id, first.id, { name: 'Forbidden' }),
    404,
  );
  await rejectsStatus(service.archive(member.id, first.id), 403);
  await rejectsStatus(service.archive(outsider.id, first.id), 404);
  const [column] = await source.query(
    `INSERT INTO board_columns (board_id, name, position) VALUES ($1, 'Todo', 100) RETURNING id`,
    [first.id],
  );
  const [card] = await source.query(
    `INSERT INTO cards (board_id, column_id, created_by_id, title, position, is_archived) VALUES ($1, $2, $3, 'Card', 100, true) RETURNING id`,
    [first.id, column.id, owner.id],
  );
  await source.query(
    'INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2)',
    [card.id, member.id],
  );
  await source.query(
    "INSERT INTO comments (card_id, author_id, content) VALUES ($1, $2, 'Keep')",
    [card.id, member.id],
  );
  const relatedRows = () =>
    Promise.all([
      source.query(
        'SELECT id, name, position FROM board_columns WHERE board_id = $1 ORDER BY id',
        [first.id],
      ),
      source.query(
        'SELECT id, column_id, position, is_archived FROM cards WHERE board_id = $1 ORDER BY id',
        [first.id],
      ),
      source.query(
        'SELECT a.card_id, a.user_id FROM card_assignees a JOIN cards c ON c.id = a.card_id WHERE c.board_id = $1 ORDER BY a.card_id, a.user_id',
        [first.id],
      ),
      source.query(
        'SELECT m.id, m.card_id, m.author_id, m.content FROM comments m JOIN cards c ON c.id = m.card_id WHERE c.board_id = $1 ORDER BY m.id',
        [first.id],
      ),
      source.query(
        'SELECT user_id, role FROM board_members WHERE board_id = $1 ORDER BY user_id',
        [first.id],
      ),
    ]);
  const beforeArchive = await relatedRows();
  const result = await service.archive(owner.id, first.id);
  await rejectsStatus(discovery.background(owner.id, first.id, 'green'), 409);
  const persisted = await boards.findOneByOrFail({ id: first.id });
  assert.equal(persisted.isArchived, true);
  assert.equal(persisted.archivedAt.toISOString(), result.archivedAt);
  assert.deepEqual(await relatedRows(), beforeArchive);
  await rejectsStatus(service.update(owner.id, first.id, { name: 'No' }), 409);
  await rejectsStatus(service.archive(owner.id, first.id), 409);
  assert.equal(
    (await boards.findOneByOrFail({ id: first.id })).archivedAt.toISOString(),
    result.archivedAt,
  );
  assert.equal((await service.getDetail(member.id, first.id)).isArchived, true);
  await rejectsStatus(service.restore(member.id, first.id), 403);
  await rejectsStatus(service.restore(outsider.id, first.id), 404);
  const restored = await service.restore(owner.id, first.id);
  assert.equal(restored.id, first.id);
  assert.equal(restored.isArchived, false);
  assert.equal(restored.archivedAt, null);
  await rejectsStatus(service.restore(owner.id, first.id), 409);
  assert.equal(await boards.countBy({ id: first.id }), 1);
  assert.deepEqual(await relatedRows(), beforeArchive);
  const audit = await source.query(
    'SELECT action_type, entity_id, metadata FROM activities WHERE board_id = $1 ORDER BY created_at, id',
    [first.id],
  );
  assert.equal(
    audit.filter((row) => row.action_type === 'BOARD_ARCHIVED').length,
    1,
  );
  assert.equal(
    audit.filter((row) => row.action_type === 'BOARD_RESTORED').length,
    1,
  );
  assert.ok(
    audit
      .filter((row) => row.action_type.startsWith('BOARD_'))
      .every((row) => row.entity_id === first.id && row.metadata === null),
  );
  console.log(
    'PostgreSQL OWNER permissions, update persistence and archive/restore preserving membership, ordering, archived Card, assignments and comments: PASS',
  );

  const racing = await service.create(owner.id, { name: 'Concurrent archive' });
  const races = await Promise.allSettled([
    service.archive(owner.id, racing.id),
    service.archive(owner.id, racing.id),
  ]);
  assert.equal(
    races.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  const rejected = races.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.getStatus(), 409);
  const restoreRaces = await Promise.allSettled([
    service.restore(owner.id, racing.id),
    service.restore(owner.id, racing.id),
  ]);
  assert.equal(
    restoreRaces.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    restoreRaces
      .find((result) => result.status === 'rejected')
      .reason.getStatus(),
    409,
  );
  assert.equal(
    (
      await source.query(
        "SELECT count(*)::int AS n FROM activities WHERE board_id = $1 AND action_type = 'BOARD_RESTORED'",
        [racing.id],
      )
    )[0].n,
    1,
  );
  const failedAuditBoard = await service.create(owner.id, {
    name: 'Audit rollback',
  });
  await service.archive(owner.id, failedAuditBoard.id);
  const recordActivity = activityWriter.record;
  activityWriter.record = async (manager, input) => {
    if (input.boardId === failedAuditBoard.id) {
      await manager.query('SELECT 1 / 0');
    }
    return recordActivity.call(activityWriter, manager, input);
  };
  try {
    await assert.rejects(service.restore(owner.id, failedAuditBoard.id));
  } finally {
    activityWriter.record = recordActivity;
  }
  assert.equal(
    (await boards.findOneByOrFail({ id: failedAuditBoard.id })).isArchived,
    true,
  );
  assert.equal(
    (
      await source.query(
        "SELECT count(*)::int AS n FROM activities WHERE board_id = $1 AND action_type = 'BOARD_RESTORED'",
        [failedAuditBoard.id],
      )
    )[0].n,
    0,
  );
  const queued = await service.create(owner.id, { name: 'Waiting update' });
  const runner = source.createQueryRunner();
  let pending;
  try {
    await runner.connect();
    await runner.startTransaction();
    const locked = await runner.manager.getRepository(Board).findOne({
      where: { id: queued.id },
      lock: { mode: 'pessimistic_write' },
    });
    locked.isArchived = true;
    locked.archivedAt = new Date();
    await runner.manager.getRepository(Board).save(locked);
    pending = service
      .update(owner.id, queued.id, { name: 'Must not persist' })
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [row] = await source.query(
        `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%') AS waiting`,
      );
      if (row.waiting) {
        waiting = true;
        break;
      }
      await delay(25);
    }
    assert.equal(waiting, true, 'Update must wait for the board row lock');
    await runner.commitTransaction();
    assert.equal((await pending).error.getStatus(), 409);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
    if (pending) await pending;
  }
  assert.equal(
    (await boards.findOneByOrFail({ id: queued.id })).name,
    'Waiting update',
  );
  console.log(
    'PostgreSQL concurrent archive and queued update lock behavior: PASS',
  );

  const raceBoard = await service.create(owner.id, { name: 'Discovery race' });
  await members.save(
    members.create({
      boardId: raceBoard.id,
      userId: member.id,
      role: 'MEMBER',
    }),
  );
  const raceRunner = source.createQueryRunner();
  try {
    await raceRunner.connect();
    await raceRunner.startTransaction();
    await raceRunner.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE', [
      raceBoard.id,
    ]);
    await raceRunner.query(
      'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
      [raceBoard.id, member.id],
    );
    let finished = false;
    const star = discovery
      .setStar(member.id, raceBoard.id, true)
      .then(
        () => ({ status: 200 }),
        (error) => ({ status: error.getStatus() }),
      )
      .finally(() => {
        finished = true;
      });
    await delay(100);
    assert.equal(finished, false, 'Star must wait for the Board lock');
    await raceRunner.commitTransaction();
    assert.equal((await star).status, 404);
    assert.equal(
      (
        await source.query(
          'SELECT count(*)::int AS n FROM board_user_states WHERE user_id=$1 AND board_id=$2',
          [member.id, raceBoard.id],
        )
      )[0].n,
      0,
    );

    await raceRunner.startTransaction();
    await raceRunner.query(
      'UPDATE boards SET is_archived=true, archived_at=now() WHERE id=$1',
      [raceBoard.id],
    );
    finished = false;
    const background = discovery
      .background(owner.id, raceBoard.id, 'forest')
      .then(
        () => ({ status: 200 }),
        (error) => ({ status: error.getStatus() }),
      )
      .finally(() => {
        finished = true;
      });
    await delay(100);
    assert.equal(finished, false, 'Background must wait for the Board lock');
    await raceRunner.commitTransaction();
    assert.equal((await background).status, 409);
    assert.equal(
      (await boards.findOneByOrFail({ id: raceBoard.id })).backgroundPreset,
      'blue',
    );
  } finally {
    if (raceRunner.isTransactionActive) await raceRunner.rollbackTransaction();
    await raceRunner.release();
  }
  console.log(
    'Discovery rechecks revoked membership and archive after Board lock: PASS',
  );

  Object.assign(process.env, {
    DATABASE_NAME: testDatabase,
    JWT_SECRET: randomBytes(32).toString('hex'),
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    SWAGGER_ENABLED: 'true',
    API_PREFIX: 'api',
  });
  const { AppModule } = require('../../dist/app.module.js');
  const {
    configureHttpApplication,
  } = require('../../dist/http-application.js');
  app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');
  assert.equal(app.get(DataSource).options.database, testDatabase);
  const token = await app.get(JwtService).signAsync({ sub: owner.id });
  await request(app.getHttpServer())
    .get('/api/boards/background-presets')
    .expect(401);
  const catalog = await request(app.getHttpServer())
    .get('/api/boards/background-presets')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.equal(
    catalog.body.data.filter((entry) => entry.kind === 'color').length,
    8,
  );
  assert.equal(
    catalog.body.data.filter((entry) => entry.kind === 'photo').length,
    4,
  );
  await request(app.getHttpServer()).get('/health/ready').expect(200);
  await request(app.getHttpServer()).get('/api/boards').expect(401);
  const response = await request(app.getHttpServer())
    .post('/api/boards')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: ' Runtime Board ' })
    .expect(201);
  assert.equal(response.body.data.name, 'Runtime Board');
  for (const preset of ['teal', 'forest']) {
    await request(app.getHttpServer())
      .patch(`/api/boards/${response.body.data.id}/background`)
      .set('Authorization', `Bearer ${token}`)
      .send({ preset })
      .expect(200);
    const detail = await request(app.getHttpServer())
      .get(`/api/boards/${response.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(detail.body.data.backgroundPreset, preset);
  }
  assert.equal(
    await members.countBy({
      boardId: response.body.data.id,
      userId: owner.id,
      role: 'OWNER',
    }),
    1,
  );
  await request(app.getHttpServer())
    .get(`/api/boards/${response.body.data.id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  await request(app.getHttpServer())
    .get('/api/boards?page=1&limit=2')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  await request(app.getHttpServer())
    .patch(`/api/boards/${response.body.data.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ description: null })
    .expect(200);
  await request(app.getHttpServer())
    .post(`/api/boards/${response.body.data.id}/archive`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  const archivedList = await request(app.getHttpServer())
    .get('/api/boards?status=archived')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.ok(
    archivedList.body.data.some((board) => board.id === response.body.data.id),
  );
  const restoredResponse = await request(app.getHttpServer())
    .post(`/api/boards/${response.body.data.id}/restore`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.equal(restoredResponse.body.data.archivedAt, null);
  assert.equal(restoredResponse.body.data.isArchived, false);
  await request(app.getHttpServer()).get('/api-docs-json').expect(200);
  console.log(
    'Real compiled AppModule HTTP bootstrap, JWT, readiness, Swagger and all six board endpoints: PASS',
  );
} finally {
  if (app) await app.close();
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${testDatabase}"`);
  await admin.end();
}
