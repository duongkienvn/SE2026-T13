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
const { ColumnsService } = require('../../dist/api/columns/columns.service.js');
const { Board } = require('../../dist/api/boards/entities/board.entity.js');
const {
  BoardMember,
} = require('../../dist/api/board-members/entities/board-member.entity.js');
const {
  BoardColumn,
} = require('../../dist/api/columns/entities/board-column.entity.js');
const { Card } = require('../../dist/api/cards/entities/card.entity.js');

const testDatabase = `kanban_columns_verify_${randomBytes(8).toString('hex')}`;
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

const rejectsStatus = (promise, status) =>
  assert.rejects(promise, (error) => error.getStatus?.() === status);

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${testDatabase}"`);
  created = true;
  source = new DataSource({ ...baseOptions, database: testDatabase });
  await source.initialize();
  await source.runMigrations();

  const boards = source.getRepository(Board);
  const members = source.getRepository(BoardMember);
  const columns = source.getRepository(BoardColumn);
  const cards = source.getRepository(Card);
  const users = source.getRepository('User');
  const authorization = new BoardAuthorizationService(members);
  const service = new ColumnsService(columns, boards, cards, authorization, {
    publish: async () => undefined,
  });
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
  const member = await user('member');
  const outsider = await user('outsider');
  const board = await boards.save(
    boards.create({ name: 'Columns', createdById: owner.id }),
  );
  await members.save(
    members.create({ boardId: board.id, userId: owner.id, role: 'OWNER' }),
  );
  await members.save(
    members.create({ boardId: board.id, userId: member.id, role: 'MEMBER' }),
  );

  const first = await service.create(owner.id, board.id, { name: 'To Do' });
  const second = await service.create(owner.id, board.id, {
    name: 'In Progress',
  });
  const third = await service.create(owner.id, board.id, { name: 'Done' });
  assert.deepEqual(
    (await service.list(owner.id, board.id, { page: 1, limit: 20 })).data.map(
      (column) => column.name,
    ),
    ['To Do', 'In Progress', 'Done'],
  );
  assert.equal(first.position, '100.0000000000');
  assert.equal(second.position, '200.0000000000');
  assert.equal(third.position, '300.0000000000');

  const renamed = await service.rename(member.id, board.id, second.id, {
    name: 'Doing',
  });
  assert.equal(renamed.name, 'Doing');
  assert.equal(renamed.position, second.position);
  await service.move(member.id, board.id, third.id, {
    beforeColumnId: first.id,
  });
  assert.deepEqual(
    (await service.list(member.id, board.id, { page: 1, limit: 20 })).data.map(
      (column) => column.name,
    ),
    ['Done', 'To Do', 'Doing'],
  );
  await rejectsStatus(
    service.list(outsider.id, board.id, { page: 1, limit: 20 }),
    404,
  );
  console.log(
    'Column create, list, MEMBER rename/move and access isolation: PASS',
  );

  await columns.update({ id: first.id }, { position: '100.0000000000' });
  await columns.update({ id: second.id }, { position: '100.0000000001' });
  await service.move(owner.id, board.id, third.id, {
    beforeColumnId: second.id,
  });
  const rebalanced = await service.list(owner.id, board.id, {
    page: 1,
    limit: 20,
  });
  assert.deepEqual(
    rebalanced.data.map((column) => column.name),
    ['To Do', 'Done', 'Doing'],
  );
  assert.deepEqual(
    rebalanced.data.map((column) => column.position),
    ['100.0000000000', '200.0000000000', '300.0000000000'],
  );
  console.log('Fractional gap exhaustion and atomic rebalance: PASS');

  const concurrent = await Promise.all(
    Array.from({ length: 8 }, (_value, index) =>
      service.create(owner.id, board.id, { name: `Concurrent ${index}` }),
    ),
  );
  assert.equal(new Set(concurrent.map((column) => column.position)).size, 8);
  assert.equal(await columns.countBy({ boardId: board.id }), 11);
  console.log('Concurrent create serialization and unique positions: PASS');

  const protectedColumn = await service.create(owner.id, board.id, {
    name: 'Protected',
  });
  await cards.save(
    cards.create({
      boardId: board.id,
      columnId: protectedColumn.id,
      createdById: owner.id,
      title: 'Archived card',
      position: '100.0000000000',
      isArchived: true,
      archivedAt: new Date(),
    }),
  );
  await rejectsStatus(
    service.remove(member.id, board.id, protectedColumn.id),
    409,
  );
  assert.equal(await columns.countBy({ id: protectedColumn.id }), 1);
  const empty = await service.create(owner.id, board.id, { name: 'Empty' });
  await service.remove(member.id, board.id, empty.id);
  assert.equal(await columns.countBy({ id: empty.id }), 0);
  console.log('Delete empty column and reject archived-card reference: PASS');

  const archived = await service.create(owner.id, board.id, {
    name: 'Archived board',
  });
  await boards.update(board.id, { isArchived: true, archivedAt: new Date() });
  assert.equal(
    (await service.list(owner.id, board.id, { page: 1, limit: 20 })).meta.total,
    13,
  );
  await rejectsStatus(
    service.create(owner.id, board.id, { name: 'Rejected' }),
    409,
  );
  await rejectsStatus(
    service.move(owner.id, board.id, archived.id, { beforeColumnId: null }),
    409,
  );
  console.log('Archived board read-only behavior: PASS');
} finally {
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${testDatabase}"`);
  await admin.end();
}
