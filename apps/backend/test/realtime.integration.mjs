import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import {
  configureTestEnvironment,
  ids,
  runRealtimeChecks,
} from './realtime-checks.mjs';

const require = createRequire(import.meta.url);
require('reflect-metadata');
require('dotenv').config({
  path: resolve(fileURLToPath(new URL('../', import.meta.url)), '../../.env'),
  quiet: true,
});
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { Test } = require('@nestjs/testing');
const argon2 = require('argon2');
const { databaseOptions } = require('../src/database/database-options.ts');
const { configureHttpApplication } = require('../src/http-application.ts');

const testDatabase = `kanban_realtime_verify_${randomBytes(8).toString('hex')}`;
const baseOptions = databaseOptions(process.env);
const admin = new Client({
  ...baseOptions,
  user: baseOptions.username,
  database: baseOptions.database,
});
let source;
let app;
let created = false;

try {
  await admin.connect();
  // Only create/drop the generated test database. Never migrate the configured DB.
  await admin.query(`CREATE DATABASE "${testDatabase}"`);
  created = true;
  source = new DataSource({ ...baseOptions, database: testDatabase });
  await source.initialize();
  await source.runMigrations();

  const passwordHash = await argon2.hash('realtime-test-password');
  const users = source.getRepository('User');
  for (const name of ['owner', 'member', 'other']) {
    await users.save(
      users.create({
        id: ids[name],
        email: `${name}@realtime.test`,
        displayName: name,
        passwordHash,
        avatarUrl: null,
      }),
    );
  }
  const boards = source.getRepository('Board');
  for (const [id, createdById, isArchived] of [
    [ids.a, ids.owner, false],
    [ids.b, ids.other, false],
    [ids.archived, ids.owner, true],
  ]) {
    await boards.save(
      boards.create({ id, name: 'Realtime fixture', createdById, isArchived }),
    );
  }
  const members = source.getRepository('BoardMember');
  for (const [boardId, userId, role] of [
    [ids.a, ids.owner, 'OWNER'],
    [ids.a, ids.member, 'MEMBER'],
    [ids.b, ids.other, 'OWNER'],
    [ids.b, ids.member, 'MEMBER'],
    [ids.archived, ids.owner, 'OWNER'],
    [ids.archived, ids.member, 'MEMBER'],
  ]) {
    await members.save(members.create({ boardId, userId, role }));
  }
  const cards = [];
  for (const boardId of [ids.a, ids.b]) {
    const creator = boardId === ids.a ? ids.owner : ids.other;
    const [column] = await source.query(
      `INSERT INTO board_columns (board_id, name, position) VALUES ($1, 'Fixture', 100) RETURNING id`,
      [boardId],
    );
    for (const isArchived of [false, true]) {
      const [card] = await source.query(
        `INSERT INTO cards (board_id, column_id, created_by_id, title, position, is_archived) VALUES ($1, $2, $3, 'Fixture', $4, $5) RETURNING id`,
        [boardId, column.id, creator, isArchived ? 200 : 100, isArchived],
      );
      cards.push(card.id);
      await source.query(
        'INSERT INTO card_assignees (card_id, user_id, assigned_by_id) VALUES ($1, $2, $3)',
        [card.id, ids.member, creator],
      );
    }
  }

  configureTestEnvironment();
  process.env.DATABASE_NAME = testDatabase;
  const { AppModule } = require('../src/app.module.ts');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(source)
    .compile();
  app = module.createNestApplication();
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');
  const count = await runRealtimeChecks(app, source);
  assert.equal(count, 14);
  assert.equal(
    await members.countBy({ boardId: ids.a, userId: ids.member }),
    0,
  );
  assert.equal(
    await members.countBy({ boardId: ids.b, userId: ids.member }),
    1,
  );
  const assignments = await source.query(
    'SELECT card_id FROM card_assignees WHERE user_id = $1 ORDER BY card_id',
    [ids.member],
  );
  assert.deepEqual(
    assignments.map((row) => row.card_id).sort(),
    cards.slice(2).sort(),
  );
  console.log(
    `Realtime PostgreSQL + Socket.IO: ${count} scenarios PASS; active/archived assignment cleanup and board isolation PASS`,
  );
} finally {
  try {
    if (app) await app.close();
  } finally {
    if (source?.isInitialized) await source.destroy();
    try {
      if (created) await admin.query(`DROP DATABASE "${testDatabase}"`);
    } finally {
      await admin.end();
    }
  }
}
