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
const { instanceToPlain } = require('class-transformer');
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
  const published = [];
  const {
    ActivityWriterService,
  } = require('../../dist/api/activities/activity-writer.service.js');
  const service = new CommentsService(
    comments,
    cards,
    boards,
    authorization,
    new ActivityWriterService(),
    { publish: async (event, payload) => published.push([event, payload]) },
    new (require('../../dist/api/notifications/notification.service.js').NotificationService)(
      source.getRepository('UserNotification'),
    ),
    { afterCommit: async () => undefined },
  );

  const createdComment = await service.create(member.id, board.id, card.id, {
    content: 'Created',
  });
  const mention = await service.create(owner.id, board.id, card.id, {
    content: '😀 @member',
    mentions: [{ userId: member.id, start: 3, end: 10 }],
  });
  assert.deepEqual(instanceToPlain(mention).mentions, [
    { userId: member.id, start: 3, end: 10 },
  ]);
  const notificationCount = async () =>
    Number(
      (
        await source.query(
          "SELECT count(*) AS count FROM user_notifications WHERE recipient_user_id=$1 AND kind='COMMENT_MENTIONED'",
          [member.id],
        )
      )[0].count,
    );
  assert.equal(await notificationCount(), 1);
  await source.query('UPDATE users SET email_verified_at=now() WHERE id=$1', [
    member.id,
  ]);
  await source.query(
    `INSERT INTO notification_preferences(user_id,in_app_comment_mentioned,email_comment_mentioned)
    VALUES ($1,false,true) ON CONFLICT (user_id) DO UPDATE SET in_app_comment_mentioned=false,email_comment_mentioned=true`,
    [member.id],
  );
  const emailMention = await service.create(owner.id, board.id, card.id, {
    content: '@member',
    mentions: [{ userId: member.id, start: 0, end: 7 }],
  });
  await service.update(owner.id, board.id, card.id, emailMention.id, {
    content: 'plain',
  });
  await service.update(owner.id, board.id, card.id, emailMention.id, {
    content: '@member',
    mentions: [{ userId: member.id, start: 0, end: 7 }],
  });
  const emailMentions = await source.query(
    "SELECT occurrence_key FROM task_notification_email_outbox WHERE kind='COMMENT_MENTIONED' AND card_id=$1",
    [card.id],
  );
  assert.deepEqual(emailMentions, [
    { occurrence_key: `${emailMention.id}:${member.id}` },
  ]);
  assert.equal(await notificationCount(), 1);
  await source.query(
    'DELETE FROM task_notification_email_outbox WHERE occurrence_key=$1',
    [`${emailMention.id}:${member.id}`],
  );
  await comments.delete(emailMention.id);
  await source.query(
    'UPDATE notification_preferences SET in_app_comment_mentioned=true,email_comment_mentioned=false WHERE user_id=$1',
    [member.id],
  );
  await assert.rejects(
    source.query(
      'INSERT INTO comment_mentions(comment_id,user_id,start_offset,end_offset) VALUES ($1,$2,3,10)',
      [mention.id, member.id],
    ),
    (error) => error.code === '23505',
  );
  await assert.rejects(
    source.query(
      'INSERT INTO comment_mentions(comment_id,user_id,start_offset,end_offset) VALUES ($1,$2,-1,2)',
      [mention.id, member.id],
    ),
    (error) => error.code === '23514',
  );
  await assert.rejects(
    source.query(
      'INSERT INTO comment_mentions(comment_id,user_id,start_offset,end_offset) VALUES (gen_random_uuid(),$1,0,1)',
      [member.id],
    ),
    (error) => error.code === '23503',
  );
  await service.update(owner.id, board.id, card.id, mention.id, {
    content: 'plain',
  });
  await service.update(owner.id, board.id, card.id, mention.id, {
    content: '😀 @member',
    mentions: [{ userId: member.id, start: 3, end: 10 }],
  });
  assert.equal(await notificationCount(), 1);
  await assert.rejects(
    service.create(owner.id, board.id, card.id, {
      content: '😀 @member',
      mentions: [{ userId: member.id, start: 1, end: 10 }],
    }),
    (error) => error.getStatus?.() === 400,
  );
  await service.remove(owner.id, board.id, card.id, mention.id);
  const concurrent = await service.create(owner.id, board.id, card.id, {
    content: 'plain',
  });
  await Promise.all(
    [1, 2].map(() =>
      service.update(owner.id, board.id, card.id, concurrent.id, {
        content: '@member',
        mentions: [{ userId: member.id, start: 0, end: 7 }],
      }),
    ),
  );
  assert.equal(await notificationCount(), 2);
  await service.remove(owner.id, board.id, card.id, concurrent.id);
  await source.query(
    'INSERT INTO notification_preferences(user_id,in_app_comment_mentioned) VALUES ($1,false)',
    [owner.id],
  );
  const optedOut = await service.create(member.id, board.id, card.id, {
    content: '@owner',
    mentions: [{ userId: owner.id, start: 0, end: 6 }],
  });
  assert.equal(
    Number(
      (
        await source.query(
          "SELECT count(*) AS count FROM user_notifications WHERE recipient_user_id=$1 AND kind='COMMENT_MENTIONED'",
          [owner.id],
        )
      )[0].count,
    ),
    0,
  );
  await service.remove(member.id, board.id, card.id, optedOut.id);
  await source.query('DELETE FROM notification_preferences WHERE user_id=$1', [
    owner.id,
  ]);
  published.splice(1);
  assert.equal(createdComment.authorId, member.id);
  assert.equal(
    (await service.list(member.id, board.id, card.id, { page: 1, limit: 20 }))
      .meta.total,
    1,
  );
  await source.query(
    `CREATE FUNCTION reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit rejected'; END $$`,
  );
  await source.query(
    'CREATE TRIGGER reject_activity BEFORE INSERT ON activities FOR EACH ROW EXECUTE FUNCTION reject_audit()',
  );
  const eventsBeforeFailure = published.length;
  await assert.rejects(
    service.create(member.id, board.id, card.id, {
      content: '@owner',
      mentions: [{ userId: owner.id, start: 0, end: 6 }],
    }),
    /audit rejected/,
  );
  assert.equal(
    Number(
      (
        await source.query(
          "SELECT count(*) AS count FROM user_notifications WHERE recipient_user_id=$1 AND kind='COMMENT_MENTIONED'",
          [owner.id],
        )
      )[0].count,
    ),
    0,
  );
  assert.equal(await comments.count(), 1);
  await assert.rejects(
    service.update(member.id, board.id, card.id, createdComment.id, {
      content: 'Rollback update',
    }),
    /audit rejected/,
  );
  assert.equal(
    (await comments.findOneByOrFail({ id: createdComment.id })).content,
    'Created',
  );
  await assert.rejects(
    service.remove(member.id, board.id, card.id, createdComment.id),
    /audit rejected/,
  );
  assert.equal(
    (await comments.findOneByOrFail({ id: createdComment.id })).deletedAt,
    null,
  );
  assert.equal(published.length, eventsBeforeFailure);
  await source.query('DROP TRIGGER reject_activity ON activities');
  await source.query('DROP FUNCTION reject_audit()');
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
  assert.deepEqual(
    published.map(([event]) => event),
    ['comment:created', 'comment:updated', 'comment:deleted'],
  );
  assert.deepEqual(
    published.map(([, payload]) => payload),
    Array(3).fill({
      boardId: board.id,
      cardId: card.id,
      commentId: createdComment.id,
    }),
  );
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
