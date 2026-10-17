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
  const service = new BoardsService(
    boards,
    members,
    new BoardAuthorizationService(members),
    new ActivityWriterService(),
  );
  const user = (name) =>
    users.save(
      users.create({
        email: `${name}@example.test`,
        displayName: name,
        passwordHash: 'test-only-hash',
        avatarUrl: null,
      }),
    );
  const owner = await user('owner');
  const member = await user('member');
  const outsider = await user('outsider');
  const faultUser = await user('fault');

  const first = await service.create(owner.id, {
    name: 'First',
    description: 'Keep',
  });
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
  await source.query(
    `INSERT INTO cards (board_id, column_id, created_by_id, title, position) VALUES ($1, $2, $3, 'Card', 100)`,
    [first.id, column.id, owner.id],
  );
  const result = await service.archive(owner.id, first.id);
  const persisted = await boards.findOneByOrFail({ id: first.id });
  assert.equal(persisted.isArchived, true);
  assert.equal(persisted.archivedAt.toISOString(), result.archivedAt);
  assert.equal(await members.countBy({ boardId: first.id }), 2);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM board_columns WHERE board_id = $1',
        [first.id],
      )
    )[0].n,
    1,
  );
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM cards WHERE board_id = $1',
        [first.id],
      )
    )[0].n,
    1,
  );
  await rejectsStatus(service.update(owner.id, first.id, { name: 'No' }), 409);
  await rejectsStatus(service.archive(owner.id, first.id), 409);
  assert.equal(
    (await boards.findOneByOrFail({ id: first.id })).archivedAt.toISOString(),
    result.archivedAt,
  );
  assert.equal((await service.getDetail(member.id, first.id)).isArchived, true);
  console.log(
    'PostgreSQL OWNER permissions, update persistence and archive preserving BoardMember/Column/Card: PASS',
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
  await request(app.getHttpServer()).get('/health/ready').expect(200);
  await request(app.getHttpServer()).get('/api/boards').expect(401);
  const response = await request(app.getHttpServer())
    .post('/api/boards')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: ' Runtime Board ' })
    .expect(201);
  assert.equal(response.body.data.name, 'Runtime Board');
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
  await request(app.getHttpServer()).get('/api-docs-json').expect(200);
  console.log(
    'Real compiled AppModule HTTP bootstrap, JWT, readiness, Swagger and all five board endpoints: PASS',
  );
} finally {
  if (app) await app.close();
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${testDatabase}"`);
  await admin.end();
}
