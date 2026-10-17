import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';

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
  BoardMembersService,
} = require('../../dist/api/board-members/board-members.service.js');
const {
  BoardAuthorizationService,
} = require('../../dist/api/board-members/board-authorization.service.js');
const { Board } = require('../../dist/api/boards/entities/board.entity.js');
const {
  BoardRoomCoordinator,
} = require('../../dist/realtime/board-room-coordinator.service.js');
const {
  BoardMember,
} = require('../../dist/api/board-members/entities/board-member.entity.js');

const testDatabase = `kanban_members_verify_${randomBytes(8).toString('hex')}`;
const baseOptions = databaseOptions(process.env);
const admin = new Client({
  ...baseOptions,
  user: baseOptions.username,
  database: baseOptions.database,
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

  const boards = source.getRepository(Board);
  const members = source.getRepository(BoardMember);
  const users = source.getRepository('User');
  const authorization = new BoardAuthorizationService(members);
  const {
    ActivityWriterService,
  } = require('../../dist/api/activities/activity-writer.service.js');
  const service = new BoardMembersService(
    members,
    boards,
    authorization,
    new BoardRoomCoordinator(),
    { publish: async () => undefined },
    new ActivityWriterService(),
  );
  const user = (name) =>
    users.save(
      users.create({
        email: `${name}@example.test`,
        displayName: name,
        passwordHash: 'integration-only-hash',
        avatarUrl: null,
      }),
    );
  const owner = await user('owner');
  const target = await user('target');
  const board = await boards.save(
    boards.create({ name: 'Members', createdById: owner.id }),
  );
  await members.save(
    members.create({ boardId: board.id, userId: owner.id, role: 'OWNER' }),
  );

  const added = await service.add(owner.id, board.id, {
    email: ` ${target.email.toUpperCase()} `,
  });
  assert.equal(added.role, 'MEMBER');
  await assert.rejects(
    service.add(owner.id, board.id, { email: target.email }),
    (error) => error.getStatus?.() === 409,
  );
  await service.updateRole(owner.id, board.id, target.id, { role: 'OWNER' });
  await service.updateRole(owner.id, board.id, target.id, { role: 'MEMBER' });

  const [column] = await source.query(
    `INSERT INTO board_columns (board_id, name, position) VALUES ($1, 'Todo', 100) RETURNING id`,
    [board.id],
  );
  const [activeCard] = await source.query(
    `INSERT INTO cards (board_id, column_id, created_by_id, title, position) VALUES ($1, $2, $3, 'Active', 100) RETURNING id`,
    [board.id, column.id, owner.id],
  );
  const [archivedCard] = await source.query(
    `INSERT INTO cards (board_id, column_id, created_by_id, title, position, is_archived) VALUES ($1, $2, $3, 'Archived', 200, true) RETURNING id`,
    [board.id, column.id, owner.id],
  );
  await source.query(
    'INSERT INTO card_assignees (card_id, user_id, assigned_by_id) VALUES ($1, $2, $3), ($4, $2, $3)',
    [activeCard.id, target.id, owner.id, archivedCard.id],
  );
  await service.remove(owner.id, board.id, target.id);
  assert.equal(
    await members.countBy({ boardId: board.id, userId: target.id }),
    0,
  );
  const [{ count }] = await source.query(
    'SELECT count(*)::int AS count FROM card_assignees WHERE user_id = $1 AND card_id IN ($2, $3)',
    [target.id, activeCard.id, archivedCard.id],
  );
  assert.equal(count, 0);
  await assert.rejects(
    service.list(target.id, board.id, { page: 1, limit: 20 }),
    (error) => error.getStatus?.() === 404,
  );
  console.log(
    'PostgreSQL member add, duplicate conflict, role transitions, multi-card cleanup and access revocation: PASS',
  );
} finally {
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${testDatabase}"`);
  await admin.end();
}
