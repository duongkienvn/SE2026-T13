import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
require('reflect-metadata');
require('dotenv').config({
  path: resolve(process.cwd(), '../../.env'),
  quiet: true,
});

const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { databaseOptions } = require('../../dist/database/database-options.js');
const {
  Activity,
} = require('../../dist/api/activities/entities/activity.entity.js');
const {
  ActivitiesService,
} = require('../../dist/api/activities/activities.service.js');
const {
  BoardAuthorizationService,
} = require('../../dist/api/board-members/board-authorization.service.js');
const { Board } = require('../../dist/api/boards/entities/board.entity.js');
const {
  BoardMember,
} = require('../../dist/api/board-members/entities/board-member.entity.js');

const testDatabase = `kanban_activity_verify_${randomBytes(8).toString('hex')}`;
const missingActorId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
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
let created = false;

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${testDatabase}"`);
  created = true;
  source = new DataSource({ ...baseOptions, database: testDatabase });
  await source.initialize();
  await source.runMigrations();

  const users = source.getRepository('User');
  const owner = await users.save(
    users.create({
      email: 'activity-owner@example.test',
      displayName: 'owner',
      passwordHash: 'integration-only-hash',
      avatarUrl: null,
    }),
  );
  const member = await users.save(
    users.create({
      email: 'activity-member@example.test',
      displayName: 'member',
      passwordHash: 'integration-only-hash',
      avatarUrl: null,
    }),
  );
  const actor = await users.save(
    users.create({
      email: 'activity-actor@example.test',
      displayName: 'actor',
      passwordHash: 'integration-only-hash',
      avatarUrl: null,
    }),
  );
  const outsider = await users.save(
    users.create({
      email: 'activity-outsider@example.test',
      displayName: 'outsider',
      passwordHash: 'integration-only-hash',
      avatarUrl: null,
    }),
  );

  const boards = source.getRepository(Board);
  const board = await boards.save(
    boards.create({ name: 'Activity board', createdById: owner.id }),
  );
  const archivedBoard = await boards.save(
    boards.create({
      name: 'Archived activity board',
      createdById: owner.id,
      isArchived: true,
      archivedAt: new Date(),
    }),
  );
  const members = source.getRepository(BoardMember);
  await members.save(
    members.create({ boardId: board.id, userId: owner.id, role: 'OWNER' }),
  );
  await members.save(
    members.create({ boardId: board.id, userId: member.id, role: 'MEMBER' }),
  );
  await members.save(
    members.create({ boardId: board.id, userId: actor.id, role: 'MEMBER' }),
  );
  await members.save(
    members.create({
      boardId: archivedBoard.id,
      userId: member.id,
      role: 'MEMBER',
    }),
  );

  const activityRepository = source.getRepository(Activity);
  const authorization = new BoardAuthorizationService(members);
  const service = new ActivitiesService(activityRepository, authorization);
  const eventInput = {
    boardId: board.id,
    actorId: actor.id,
    actionType: 'CARD_MOVED',
    entityType: 'CARD',
    entityId: owner.id,
    metadata: { fromColumnId: owner.id, toColumnId: member.id },
  };

  await source.manager.transaction(async (manager) => {
    await service.record(manager, eventInput);
    await service.record(manager, {
      ...eventInput,
      entityId: member.id,
    });
  });
  const committed = await activityRepository.find({
    where: { boardId: board.id },
  });
  assert.equal(committed.length, 2);

  const fixedTime = new Date('2026-10-16T12:00:00.000Z');
  for (const row of committed) {
    await activityRepository.update(row.id, { createdAt: fixedTime });
  }

  const beforeRollback = await activityRepository.count({
    where: { boardId: board.id },
  });
  await assert.rejects(
    source.manager.transaction(async (manager) => {
      await service.record(manager, eventInput);
      throw new Error('force activity rollback');
    }),
  );
  assert.equal(
    await activityRepository.count({ where: { boardId: board.id } }),
    beforeRollback,
  );

  await assert.rejects(
    source.manager.transaction(async (manager) => {
      await service.record(manager, eventInput);
      await manager.query(
        'INSERT INTO activities (board_id, actor_id, action_type, entity_type) VALUES ($1, $2, $3, $4)',
        [board.id, missingActorId, 'CARD_MOVED', 'CARD'],
      );
    }),
  );
  assert.equal(
    await activityRepository.count({ where: { boardId: board.id } }),
    beforeRollback,
  );

  await service.record(source.manager, {
    boardId: archivedBoard.id,
    actorId: owner.id,
    actionType: 'BOARD_UPDATED',
    entityType: 'BOARD',
    entityId: archivedBoard.id,
    metadata: null,
  });

  const boardFeed = await service.list(member.id, board.id, {
    page: 1,
    limit: 20,
  });
  assert.equal(boardFeed.data.length, 2);
  assert.deepEqual(
    boardFeed.data.map((row) => row.boardId),
    [board.id, board.id],
  );
  assert.ok(boardFeed.data.every((row) => row.actorId === actor.id));
  assert.deepEqual(
    boardFeed.data.map((row) => row.id),
    [...boardFeed.data]
      .sort((left, right) => right.id.localeCompare(left.id))
      .map((row) => row.id),
  );

  const archivedFeed = await service.list(member.id, archivedBoard.id, {
    page: 1,
    limit: 20,
  });
  assert.equal(archivedFeed.data.length, 1);

  await members.delete({ boardId: board.id, userId: actor.id });
  const historicalFeed = await service.list(member.id, board.id, {
    page: 1,
    limit: 20,
  });
  assert.equal(historicalFeed.data[0].actorId, actor.id);

  await assert.rejects(
    service.list(outsider.id, board.id, { page: 1, limit: 20 }),
    (error) => error.getStatus?.() === 404,
  );
  console.log(
    'Activities PostgreSQL persistence, rollback, board isolation, archived read and removed-actor history: PASS',
  );
} finally {
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${testDatabase}"`);
  await admin.end();
}
