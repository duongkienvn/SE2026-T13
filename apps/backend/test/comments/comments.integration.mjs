import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
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
const { databaseOptions } = require('../../dist/database/database-options.js');
const {
  BoardAuthorizationService,
} = require('../../dist/api/board-members/board-authorization.service.js');
const { Board } = require('../../dist/api/boards/entities/board.entity.js');
const {
  BoardMember,
} = require('../../dist/api/board-members/entities/board-member.entity.js');
const {
  BoardColumn,
} = require('../../dist/api/columns/entities/board-column.entity.js');
const { Card } = require('../../dist/api/cards/entities/card.entity.js');
const {
  Comment,
} = require('../../dist/api/comments/entities/comment.entity.js');
const {
  CommentsService,
} = require('../../dist/api/comments/comments.service.js');

const testDatabase = `kanban_comments_verify_${randomBytes(8).toString('hex')}`;
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
      email: 'comments-owner@example.test',
      displayName: 'owner',
      passwordHash: 'integration-only-hash',
      avatarUrl: null,
    }),
  );
  const member = await users.save(
    users.create({
      email: 'comments-member@example.test',
      displayName: 'member',
      passwordHash: 'integration-only-hash',
      avatarUrl: null,
    }),
  );
  const boards = source.getRepository(Board);
  const board = await boards.save(
    boards.create({ name: 'Comments', createdById: owner.id }),
  );
  const members = source.getRepository(BoardMember);
  await members.save(
    members.create({ boardId: board.id, userId: owner.id, role: 'OWNER' }),
  );
  await members.save(
    members.create({ boardId: board.id, userId: member.id, role: 'MEMBER' }),
  );
  const columns = source.getRepository(BoardColumn);
  const column = await columns.save(
    columns.create({
      boardId: board.id,
      name: 'Todo',
      position: '100.0000000000',
    }),
  );
  const cards = source.getRepository(Card);
  const card = await cards.save(
    cards.create({
      boardId: board.id,
      columnId: column.id,
      createdById: owner.id,
      title: 'Card',
      position: '100.0000000000',
      isArchived: false,
      archivedAt: null,
    }),
  );
  const comments = source.getRepository(Comment);
  const authorization = new BoardAuthorizationService(members);
  const {
    ActivityWriterService,
  } = require('../../dist/api/activities/activity-writer.service.js');
  const service = new CommentsService(
    comments,
    cards,
    boards,
    authorization,
    new ActivityWriterService(),
  );

  const createdComment = await service.create(member.id, board.id, card.id, {
    content: 'Created',
  });
  assert.equal(createdComment.authorId, member.id);
  assert.equal(
    (await service.list(member.id, board.id, card.id, { page: 1, limit: 20 }))
      .meta.total,
    1,
  );
  await assert.rejects(
    service.update(owner.id, board.id, card.id, createdComment.id, {
      content: 'Denied',
    }),
    (error) => error.getStatus?.() === 403,
  );
  await service.update(member.id, board.id, card.id, createdComment.id, {
    content: 'Edited',
  });
  await service.remove(member.id, board.id, card.id, createdComment.id);
  const deleted = await comments.findOne({
    where: { id: createdComment.id },
    withDeleted: true,
  });
  assert.ok(deleted?.deletedAt);
  assert.equal(
    (await service.list(member.id, board.id, card.id, { page: 1, limit: 20 }))
      .meta.total,
    0,
  );
  await assert.rejects(
    service.remove(member.id, board.id, card.id, createdComment.id),
    (error) => error.getStatus?.() === 404,
  );
  await cards.update(card.id, { isArchived: true, archivedAt: new Date() });
  assert.equal(
    (await service.list(member.id, board.id, card.id, { page: 1, limit: 20 }))
      .meta.total,
    0,
  );
  await assert.rejects(
    service.create(member.id, board.id, card.id, { content: 'Rejected' }),
    (error) => error.getStatus?.() === 409,
  );
  console.log(
    'Comments PostgreSQL persistence, author permissions, soft delete and archived-card read-only: PASS',
  );
} finally {
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${testDatabase}"`);
  await admin.end();
}
