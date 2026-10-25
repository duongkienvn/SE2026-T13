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
  ActivityWriterService,
} = require('../../dist/api/activities/activity-writer.service.js');
const {
  BoardAuthorizationService,
} = require('../../dist/api/board-members/board-authorization.service.js');
const { Board } = require('../../dist/api/boards/entities/board.entity.js');
const {
  BoardMember,
} = require('../../dist/api/board-members/entities/board-member.entity.js');
const { BoardsService } = require('../../dist/api/boards/boards.service.js');
const { ColumnsService } = require('../../dist/api/columns/columns.service.js');
const {
  BoardColumn,
} = require('../../dist/api/columns/entities/board-column.entity.js');
const { Card } = require('../../dist/api/cards/entities/card.entity.js');
const { CardsService } = require('../../dist/api/cards/cards.service.js');
const {
  CommentsService,
} = require('../../dist/api/comments/comments.service.js');
const {
  Comment,
} = require('../../dist/api/comments/entities/comment.entity.js');
const {
  BoardMembersService,
} = require('../../dist/api/board-members/board-members.service.js');
const {
  BoardRoomCoordinator,
} = require('../../dist/realtime/board-room-coordinator.service.js');
const {
  BoardPresenceService,
} = require('../../dist/realtime/board-presence.service.js');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const request = require('supertest');

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
let source, app;
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
      emailVerifiedAt: new Date(),
    }),
  );
  const member = await users.save(
    users.create({
      email: 'activity-member@example.test',
      displayName: 'member',
      passwordHash: 'integration-only-hash',
      avatarUrl: null,
      emailVerifiedAt: new Date(),
    }),
  );
  const actor = await users.save(
    users.create({
      email: 'activity-actor@example.test',
      displayName: 'actor',
      passwordHash: 'integration-only-hash',
      avatarUrl: null,
      emailVerifiedAt: new Date(),
    }),
  );
  const outsider = await users.save(
    users.create({
      email: 'activity-outsider@example.test',
      displayName: 'outsider',
      passwordHash: 'integration-only-hash',
      avatarUrl: null,
      emailVerifiedAt: new Date(),
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
  const service = new ActivitiesService(
    activityRepository,
    authorization,
    new ActivityWriterService(),
  );
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
  const writer = new ActivityWriterService();
  const published = [];
  const events = { publish: async (...args) => published.push(args) };
  const boardService = new BoardsService(
    boards,
    members,
    authorization,
    writer,
    events,
  );
  const columnRepository = source.getRepository(BoardColumn);
  const cardRepository = source.getRepository(Card);
  const columnService = new ColumnsService(
    columnRepository,
    boards,
    cardRepository,
    authorization,
    events,
    writer,
  );
  const cardService = new CardsService(
    cardRepository,
    boards,
    columnRepository,
    authorization,
    events,
    writer,
  );
  const commentService = new CommentsService(
    source.getRepository(Comment),
    cardRepository,
    boards,
    authorization,
    writer,
    events,
  );
  const memberService = new BoardMembersService(
    members,
    boards,
    authorization,
    new BoardRoomCoordinator(new BoardPresenceService()),
    events,
    writer,
  );
  const auditBoard = await boardService.create(owner.id, {
    name: 'Integration board',
  });
  const page = () =>
    service.list(owner.id, auditBoard.id, { page: 1, limit: 100 });
  await boardService.update(owner.id, auditBoard.id, { name: 'Renamed' });
  await boardService.update(owner.id, auditBoard.id, { name: 'Renamed' });
  const membership = await memberService.add(owner.id, auditBoard.id, {
    email: member.email,
  });
  await memberService.updateRole(owner.id, auditBoard.id, member.id, {
    role: 'OWNER',
  });
  await memberService.updateRole(owner.id, auditBoard.id, member.id, {
    role: 'OWNER',
  });
  const col = await columnService.create(owner.id, auditBoard.id, {
    name: 'Todo',
  });
  const col2 = await columnService.create(owner.id, auditBoard.id, {
    name: 'Done',
  });
  await columnService.rename(owner.id, auditBoard.id, col.id, {
    name: 'Working',
  });
  await columnService.rename(owner.id, auditBoard.id, col.id, {
    name: 'Working',
  });
  await columnService.move(owner.id, auditBoard.id, col.id, {
    beforeColumnId: null,
  });
  await columnService.move(owner.id, auditBoard.id, col.id, {
    beforeColumnId: null,
  });
  const empty = await columnService.create(owner.id, auditBoard.id, {
    name: 'Empty',
  });
  await columnService.remove(owner.id, auditBoard.id, empty.id);
  const card = await cardService.create(owner.id, auditBoard.id, {
    columnId: col.id,
    title: 'First',
  });
  const otherCard = await cardService.create(owner.id, auditBoard.id, {
    columnId: col.id,
    title: 'Second',
  });
  await cardService.update(owner.id, auditBoard.id, card.id, {
    title: 'Changed',
  });
  await cardService.update(owner.id, auditBoard.id, card.id, {
    title: 'Changed',
  });
  await cardService.move(owner.id, auditBoard.id, card.id, {
    toColumnId: col.id,
    beforeCardId: null,
  });
  await cardService.move(owner.id, auditBoard.id, card.id, {
    toColumnId: col2.id,
    beforeCardId: null,
  });
  await cardService.move(owner.id, auditBoard.id, card.id, {
    toColumnId: col2.id,
    beforeCardId: null,
  });
  const comment = await commentService.create(
    owner.id,
    auditBoard.id,
    card.id.toUpperCase(),
    { content: 'private text' },
  );
  await commentService.update(owner.id, auditBoard.id, card.id, comment.id, {
    content: 'private text',
  });
  await commentService.update(owner.id, auditBoard.id, card.id, comment.id, {
    content: 'different private text',
  });
  await assert.rejects(
    commentService.update(member.id, auditBoard.id, card.id, comment.id, {
      content: 'denied',
    }),
    (error) => error.getStatus?.() === 403,
  );
  await commentService.remove(owner.id, auditBoard.id, card.id, comment.id);
  await cardService.archive(owner.id, auditBoard.id, otherCard.id);
  await memberService.remove(owner.id, auditBoard.id, member.id);
  const rows = (await page()).data;
  const counts = Object.groupBy(rows, (row) => row.actionType);
  for (const action of [
    'BOARD_UPDATED',
    'MEMBER_ADDED',
    'MEMBER_REMOVED',
    'ROLE_CHANGED',
    'COLUMN_UPDATED',
    'COLUMN_MOVED',
    'COLUMN_DELETED',
    'CARD_UPDATED',
    'CARD_ARCHIVED',
    'COMMENT_CREATED',
    'COMMENT_UPDATED',
    'COMMENT_DELETED',
  ]) {
    assert.equal(counts[action]?.length, 1, action);
  }
  assert.equal(counts.COLUMN_CREATED.length, 3);
  assert.equal(counts.CARD_CREATED.length, 2);
  assert.equal(counts.CARD_MOVED.length, 2);
  assert.deepEqual(counts.COMMENT_CREATED[0].metadata, { cardId: card.id });
  assert.deepEqual(counts.MEMBER_REMOVED[0].metadata, {
    targetUserId: member.id,
  });
  assert.equal(counts.MEMBER_REMOVED[0].entityId, membership.id);
  assert.equal(counts.MEMBER_REMOVED[0].actorId, owner.id);
  assert.deepEqual(counts.ROLE_CHANGED[0].metadata, {
    fromRole: 'MEMBER',
    toRole: 'OWNER',
  });
  assert.ok(
    counts.CARD_MOVED.some(
      (row) => row.metadata.fromColumnId === row.metadata.toColumnId,
    ),
  );
  assert.ok(
    rows.every((row) => !JSON.stringify(row.metadata).includes('private')),
  );
  assert.equal(
    (
      await service
        .list(member.id, auditBoard.id, { page: 1, limit: 20 })
        .catch((e) => e)
    ).getStatus(),
    404,
  );

  await source.query(
    `CREATE FUNCTION reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit rejected'; END $$`,
  );
  await source.query(
    'CREATE TRIGGER reject_activity BEFORE INSERT ON activities FOR EACH ROW EXECUTE FUNCTION reject_audit()',
  );
  const eventsBefore = published.length;
  await assert.rejects(
    columnService.rename(owner.id, auditBoard.id, col.id, {
      name: 'Must rollback',
    }),
  );
  assert.equal(
    (await columnRepository.findOneByOrFail({ id: col.id })).name,
    'Working',
  );
  assert.equal(published.length, eventsBefore);
  await assert.rejects(
    boardService.update(owner.id, auditBoard.id, { name: 'Must rollback' }),
  );
  assert.equal(
    (await boards.findOneByOrFail({ id: auditBoard.id })).name,
    'Renamed',
  );
  assert.equal((await page()).meta.total, rows.length);
  await source.query('DROP TRIGGER reject_activity ON activities');
  await source.query('DROP FUNCTION reject_audit()');

  Object.assign(process.env, {
    DATABASE_NAME: testDatabase,
    JWT_SECRET: randomBytes(32).toString('hex'),
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
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
  const token = await app.get(JwtService).signAsync({ sub: owner.id });
  const url = `/api/boards/${auditBoard.id}/activities`;
  await request(app.getHttpServer()).get(url).expect(401);
  await request(app.getHttpServer())
    .post(url)
    .set('Authorization', `Bearer ${token}`)
    .expect(404);
  const feed = await request(app.getHttpServer())
    .get(url)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.equal(feed.body.meta.total, rows.length);
  await request(app.getHttpServer())
    .patch(`/api/boards/${auditBoard.id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'HTTP board update' })
    .expect(200);
  const commentResponse = await request(app.getHttpServer())
    .post(`/api/boards/${auditBoard.id}/cards/${card.id}/comments`)
    .set('Authorization', `Bearer ${token}`)
    .send({ content: 'HTTP private comment' })
    .expect(201);
  const httpFeed = await request(app.getHttpServer())
    .get(url)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.ok(
    httpFeed.body.data.some(
      (row) =>
        row.actionType === 'BOARD_UPDATED' && row.entityId === auditBoard.id,
    ),
  );
  assert.ok(
    httpFeed.body.data.some(
      (row) =>
        row.actionType === 'COMMENT_CREATED' &&
        row.entityId === commentResponse.body.data.id &&
        row.metadata.cardId === card.id,
    ),
  );
  assert.ok(
    httpFeed.body.data.every(
      (row) => !JSON.stringify(row.metadata).includes('private'),
    ),
  );
  console.log(
    'H2b 15 actions, no-ops, atomic rollback, post-commit events and HTTP feed: PASS',
  );
  console.log(
    'Activities PostgreSQL persistence, rollback, board isolation, archived read and removed-actor history: PASS',
  );
} finally {
  if (app) await app.close();
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${testDatabase}"`);
  await admin.end();
}
