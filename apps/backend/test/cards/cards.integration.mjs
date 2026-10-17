import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes, randomUUID } from 'node:crypto';
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
const { databaseOptions } = require('../../dist/database/database-options.js');
const { CardsService } = require('../../dist/api/cards/cards.service.js');
const { ColumnsService } = require('../../dist/api/columns/columns.service.js');
const {
  BoardAuthorizationService,
} = require('../../dist/api/board-members/board-authorization.service.js');
const {
  BoardMembersService,
} = require('../../dist/api/board-members/board-members.service.js');
const {
  BoardRoomCoordinator,
} = require('../../dist/realtime/board-room-coordinator.service.js');
const { Board } = require('../../dist/api/boards/entities/board.entity.js');
const {
  BoardMember,
} = require('../../dist/api/board-members/entities/board-member.entity.js');
const {
  BoardColumn,
} = require('../../dist/api/columns/entities/board-column.entity.js');
const { Card } = require('../../dist/api/cards/entities/card.entity.js');
const {
  CardAssignee,
} = require('../../dist/api/cards/entities/card-assignee.entity.js');
const { Test } = require('@nestjs/testing');
const { JwtService } = require('@nestjs/jwt');
const argon2 = require('argon2');
const request = require('supertest');

const options = databaseOptions(process.env);
const testDatabase = `kanban_cards_verify_${randomBytes(8).toString('hex')}`;
const admin = new Client({
  host: options.host,
  port: options.port,
  user: options.username,
  password: options.password,
  database: options.database,
  ssl: options.ssl,
  connectionTimeoutMillis: options.connectTimeoutMS,
});
let source, app;
let created = false,
  checks = 0;
const pass = (name) => {
  checks++;
  console.log(`PASS: ${name}`);
};
const rejects = (promise, status) =>
  assert.rejects(promise, (error) => error.getStatus?.() === status);

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${testDatabase}"`);
  created = true;
  source = new DataSource({ ...options, database: testDatabase });
  await source.initialize();
  await source.runMigrations();
  assert.equal(source.options.synchronize, false);
  const [numeric] = await source.query(
    "SELECT numeric_precision, numeric_scale FROM information_schema.columns WHERE table_name='cards' AND column_name='position'",
  );
  assert.deepEqual(numeric, { numeric_precision: 20, numeric_scale: 10 });
  pass('clean migrations and existing NUMERIC(20,10) schema');

  const users = source.getRepository('User'),
    boards = source.getRepository(Board),
    members = source.getRepository(BoardMember);
  const columns = source.getRepository(BoardColumn),
    cards = source.getRepository(Card),
    assignees = source.getRepository(CardAssignee);
  const authorization = new BoardAuthorizationService(members);
  const {
    ActivityWriterService,
  } = require('../../dist/api/activities/activity-writer.service.js');
  const activityWriter = new ActivityWriterService();
  const service = new CardsService(
    cards,
    boards,
    columns,
    authorization,
    {
      publish: async () => undefined,
    },
    activityWriter,
  );
  const columnService = new ColumnsService(
    columns,
    boards,
    cards,
    authorization,
    { publish: async () => undefined },
    activityWriter,
  );
  const memberService = new BoardMembersService(
    members,
    boards,
    authorization,
    new BoardRoomCoordinator(),
    { publish: async () => undefined },
    activityWriter,
  );
  const passwordHash = await argon2.hash('cards-integration-password');
  const user = async (name) =>
    users.save(
      users.create({
        email: `${name}@cards.test`,
        displayName: name,
        passwordHash,
        avatarUrl: null,
      }),
    );
  const owner = await user('owner'),
    member = await user('member'),
    outsider = await user('outsider');
  const newBoard = async (name) => {
    const board = await boards.save(
      boards.create({ name, createdById: owner.id }),
    );
    await members.save(
      members.create({ boardId: board.id, userId: owner.id, role: 'OWNER' }),
    );
    return board;
  };
  const board = await newBoard('Cards'),
    foreign = await newBoard('Other board');
  await members.save(
    members.create({ boardId: board.id, userId: member.id, role: 'MEMBER' }),
  );
  await members.save(
    members.create({ boardId: foreign.id, userId: member.id, role: 'MEMBER' }),
  );
  const column = await columnService.create(owner.id, board.id, {
    name: 'Source',
  });
  const destination = await columnService.create(owner.id, board.id, {
    name: 'Destination',
  });
  const foreignColumn = await columnService.create(owner.id, foreign.id, {
    name: 'Foreign',
  });
  const create = (columnId, title, actor = owner.id) =>
    service.create(actor, board.id, { columnId, title });
  const active = (columnId) =>
    cards.find({
      where: { boardId: board.id, columnId, isArchived: false },
      order: { position: 'ASC', id: 'ASC' },
    });
  const distinctPositions = (rows) =>
    assert.equal(new Set(rows.map((row) => row.position)).size, rows.length);

  const first = await service.create(member.id, board.id, {
    columnId: column.id,
    title: 'First',
    description: 'Keep',
    dueDate: '2000-01-01T07:00:00+07:00',
  });
  assert.equal(first.createdById, member.id);
  assert.equal(first.position, '100.0000000000');
  assert.equal(first.dueDate, '2000-01-01T00:00:00.000Z');
  await rejects(
    service.list(outsider.id, board.id, { page: 1, limit: 20 }),
    404,
  );
  await rejects(create(foreignColumn.id, 'No'), 404);
  const foreignCard = await service.create(owner.id, foreign.id, {
    columnId: foreignColumn.id,
    title: 'Foreign',
  });
  await rejects(service.get(owner.id, board.id, foreignCard.id), 404);
  await rejects(
    service.move(owner.id, board.id, first.id, {
      toColumnId: foreignColumn.id,
      beforeCardId: null,
    }),
    404,
  );
  await rejects(
    service.list(owner.id, board.id, {
      page: 1,
      limit: 20,
      columnId: foreignColumn.id,
    }),
    404,
  );
  pass(
    'OWNER/MEMBER access, deadline UTC and cross-board isolation even for members of both boards',
  );

  const concurrent = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      create(column.id, `Concurrent ${index}`),
    ),
  );
  distinctPositions(await active(column.id));
  assert.equal((await active(column.id)).length, 9);
  const moving = concurrent.slice(0, 4);
  const movedIds = new Set(moving.map((card) => card.id));
  const previousSource = (await active(column.id))
    .filter((card) => !movedIds.has(card.id))
    .map((card) => card.id);
  await Promise.all(
    moving.map((card) =>
      service.move(owner.id, board.id, card.id, {
        toColumnId: destination.id,
        beforeCardId: null,
      }),
    ),
  );
  const destRows = await active(destination.id);
  distinctPositions(destRows);
  assert.equal(destRows.length, 4);
  assert.deepEqual(new Set(destRows.map((card) => card.id)), movedIds);
  assert.deepEqual(
    (await active(column.id)).map((card) => card.id),
    previousSource,
  );
  pass(
    'concurrent create/cross-column move: unique active positions, no lost cards, preserved source order',
  );

  const last = destRows.at(-1);
  const head = await service.move(member.id, board.id, last.id, {
    toColumnId: destination.id,
    beforeCardId: destRows[0].id,
  });
  assert.equal(head.position, '50.0000000000');
  const noOp = await service.move(owner.id, board.id, last.id, {
    toColumnId: destination.id,
    beforeCardId: destRows[0].id,
  });
  assert.equal(noOp.position, head.position);
  await rejects(
    service.move(owner.id, board.id, last.id, {
      toColumnId: destination.id,
      beforeCardId: last.id,
    }),
    400,
  );
  await rejects(
    service.move(owner.id, board.id, last.id, {
      toColumnId: destination.id,
      beforeCardId: first.id,
    }),
    404,
  );
  await rejects(
    service.move(owner.id, board.id, last.id, {
      toColumnId: destination.id,
      beforeCardId: foreignCard.id,
    }),
    404,
  );
  await service.move(owner.id, board.id, last.id, {
    toColumnId: destination.id,
    beforeCardId: destRows[1].id,
  });
  assert.equal(
    (await cards.findOneByOrFail({ id: last.id })).position,
    '150.0000000000',
  );
  pass(
    'fresh reads persist front/middle/no-op movement and reject invalid anchors',
  );

  const compact = await columnService.create(owner.id, board.id, {
    name: 'Rebalance',
  });
  const a = await create(compact.id, 'A'),
    b = await create(compact.id, 'Reject rebalance');
  await cards.update(b.id, { position: '100.0000000001' });
  const snapshot = () =>
    source.query(
      'SELECT id, column_id, position FROM cards WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[a.id, b.id, first.id]],
    );
  const before = await snapshot();
  await source.query(
    `CREATE FUNCTION reject_card_rebalance() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN IF NEW.title = 'Reject rebalance' AND NEW.position <> OLD.position THEN RAISE EXCEPTION 'test-only rebalance failure'; END IF; RETURN NEW; END; $body$`,
  );
  await source.query(
    'CREATE TRIGGER reject_card_rebalance BEFORE UPDATE ON cards FOR EACH ROW EXECUTE FUNCTION reject_card_rebalance()',
  );
  await assert.rejects(
    service.move(owner.id, board.id, first.id, {
      toColumnId: compact.id,
      beforeCardId: b.id,
    }),
    /test-only rebalance failure/,
  );
  assert.deepEqual(await snapshot(), before);
  await source.query('DROP TRIGGER reject_card_rebalance ON cards');
  await source.query('DROP FUNCTION reject_card_rebalance()');
  await service.move(owner.id, board.id, first.id, {
    toColumnId: compact.id,
    beforeCardId: b.id,
  });
  assert.deepEqual(
    (await active(compact.id)).map((card) => [card.id, card.position]),
    [
      [a.id, '100.0000000000'],
      [first.id, '200.0000000000'],
      [b.id, '300.0000000000'],
    ],
  );
  const overflow = await columnService.create(owner.id, board.id, {
    name: 'Overflow',
  });
  const high = await create(overflow.id, 'High');
  await cards.update(high.id, { position: '9999999999.9999999999' });
  const appended = await create(overflow.id, 'After high');
  assert.equal(appended.position, '200.0000000000');
  assert.equal(
    (await cards.findOneByOrFail({ id: high.id })).position,
    '100.0000000000',
  );
  pass(
    'gap exhaustion/overflow rebalancing and real database rollback of multi-row moves',
  );

  const assignmentCard = await create(column.id, 'Assignments');
  await service.assign(owner.id, board.id, assignmentCard.id, {
    userId: owner.id,
  });
  const assignmentResults = await Promise.allSettled([
    service.assign(owner.id, board.id, assignmentCard.id, {
      userId: member.id,
    }),
    service.assign(owner.id, board.id, assignmentCard.id, {
      userId: member.id,
    }),
  ]);
  assert.equal(
    assignmentResults.filter((r) => r.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    assignmentResults.find((r) => r.status === 'rejected').reason.getStatus(),
    409,
  );
  assert.equal(
    (await service.get(owner.id, board.id, assignmentCard.id)).assignees.length,
    2,
  );
  await rejects(
    service.assign(owner.id, board.id, assignmentCard.id, {
      userId: outsider.id,
    }),
    404,
  );
  await assert.rejects(
    assignees.save(
      assignees.create({
        cardId: assignmentCard.id,
        userId: member.id,
        assignedById: owner.id,
      }),
    ),
    (error) => error.driverError?.code === '23505',
  );
  await assert.rejects(
    assignees.save(
      assignees.create({
        cardId: randomUUID(),
        userId: owner.id,
        assignedById: owner.id,
      }),
    ),
    (error) => error.driverError?.code === '23503',
  );
  await service.unassign(member.id, board.id, assignmentCard.id, owner.id);
  await rejects(
    service.unassign(owner.id, board.id, assignmentCard.id, owner.id),
    404,
  );
  pass(
    'multi-assignee persistence, concurrent duplicate assignment, exact unassign and FK/UNIQUE constraints',
  );

  const comment = await source.getRepository('Comment').save({
    cardId: assignmentCard.id,
    authorId: owner.id,
    content: 'Retained',
    deletedAt: null,
  });
  const archived = await service.archive(
    member.id,
    board.id,
    assignmentCard.id,
  );
  assert.equal(archived.assignees.length, 1);
  assert.equal(archived.position, assignmentCard.position);
  assert.equal(
    await source.getRepository('Comment').countBy({ id: comment.id }),
    1,
  );
  assert.equal(
    (await service.get(member.id, board.id, assignmentCard.id)).isArchived,
    true,
  );
  await rejects(columnService.remove(owner.id, board.id, column.id), 409);
  for (const operation of [
    () => service.archive(owner.id, board.id, assignmentCard.id),
    () =>
      service.update(owner.id, board.id, assignmentCard.id, { title: 'No' }),
    () =>
      service.move(owner.id, board.id, assignmentCard.id, {
        toColumnId: destination.id,
        beforeCardId: null,
      }),
    () =>
      service.assign(owner.id, board.id, assignmentCard.id, {
        userId: owner.id,
      }),
    () => service.unassign(owner.id, board.id, assignmentCard.id, member.id),
  ])
    await rejects(operation(), 409);
  await rejects(
    service.move(owner.id, board.id, first.id, {
      toColumnId: column.id,
      beforeCardId: assignmentCard.id,
    }),
    404,
  );
  pass(
    'archive retains comments/assignments and blocks all mutations, anchors and E1 column deletion',
  );

  const activeAssigned = await create(column.id, 'Active assigned');
  await service.assign(owner.id, board.id, activeAssigned.id, {
    userId: member.id,
  });
  await service.assign(owner.id, foreign.id, foreignCard.id, {
    userId: member.id,
  });
  await memberService.remove(owner.id, board.id, member.id);
  assert.equal(
    await assignees.countBy({ userId: member.id, cardId: assignmentCard.id }),
    0,
  );
  assert.equal(
    await assignees.countBy({ userId: member.id, cardId: activeAssigned.id }),
    0,
  );
  assert.equal(
    await assignees.countBy({ userId: member.id, cardId: foreignCard.id }),
    1,
  );
  pass(
    'member removal cleans active/archived assignments only within its board',
  );

  // Hold the Board row, observe real PostgreSQL lock waiters, then admit requests
  // in both orders. No mock transaction or arbitrary sleep determines the winner.
  const waitForWaiters = async (count) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const [row] = await source.query(
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
      );
      if (row.count >= count) return;
      await delay(10);
    }
    throw new Error(`Expected ${count} PostgreSQL lock waiters`);
  };
  const race = async (firstOperation, secondOperation) => {
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    const tasks = [];
    const start = (operation) =>
      operation().then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason }),
      );
    try {
      await runner.query('SELECT id FROM boards WHERE id = $1 FOR UPDATE', [
        board.id,
      ]);
      tasks.push(start(firstOperation));
      await waitForWaiters(1);
      tasks.push(start(secondOperation));
      await waitForWaiters(2);
      await runner.commitTransaction();
      return await Promise.all(tasks);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await Promise.all(tasks);
      await runner.release();
    }
  };
  for (const removeFirst of [false, true]) {
    const target = await user(removeFirst ? 'remove-first' : 'assign-first');
    await memberService.add(owner.id, board.id, { email: target.email });
    const raceCard = await create(destination.id, 'Membership race');
    const assign = () =>
      service.assign(owner.id, board.id, raceCard.id, { userId: target.id });
    const remove = () => memberService.remove(owner.id, board.id, target.id);
    const result = await race(
      removeFirst ? remove : assign,
      removeFirst ? assign : remove,
    );
    assert.equal(result[0].status, 'fulfilled');
    if (removeFirst) {
      assert.equal(result[1].status, 'rejected');
      assert.equal(result[1].reason.getStatus(), 404);
    } else assert.equal(result[1].status, 'fulfilled');
    assert.equal(
      await members.countBy({ boardId: board.id, userId: target.id }),
      0,
    );
    assert.equal(
      await assignees.countBy({ cardId: raceCard.id, userId: target.id }),
      0,
    );
  }
  pass(
    'deterministic assign-vs-remove-member races in both lock acquisition orders leave no stale assignment',
  );

  for (const deleteFirst of [false, true]) {
    const target = await columnService.create(owner.id, board.id, {
      name: 'Column race',
    });
    const createCard = () => create(target.id, 'Racing create');
    const deleteColumn = () =>
      columnService.remove(owner.id, board.id, target.id);
    const result = await race(
      deleteFirst ? deleteColumn : createCard,
      deleteFirst ? createCard : deleteColumn,
    );
    assert.equal(result[0].status, 'fulfilled');
    assert.equal(result[1].status, 'rejected');
    assert.equal(result[1].reason.getStatus(), deleteFirst ? 404 : 409);
    assert.equal(await columns.countBy({ id: target.id }), deleteFirst ? 0 : 1);
    assert.equal(
      await cards.countBy({ columnId: target.id }),
      deleteFirst ? 0 : 1,
    );
  }
  pass(
    'create-vs-E1-column-delete races obey the shared Board lock and preserve references',
  );

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_NAME: testDatabase,
    JWT_SECRET: randomBytes(32).toString('hex'),
    LOG_LEVEL: 'silent',
    API_PREFIX: 'api',
    SWAGGER_ENABLED: 'true',
    RATE_LIMIT_MAX: '1000',
  });
  const { AppModule } = require('../../dist/app.module.js');
  const {
    configureHttpApplication,
  } = require('../../dist/http-application.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(source)
    .compile();
  app = module.createNestApplication({ logger: false });
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: owner.email, password: 'cards-integration-password' })
    .expect(200);
  const token = login.body.data.accessToken;
  const api = (method, path) => {
    const agent = request(app.getHttpServer());
    return agent[method](path).set('Authorization', `Bearer ${token}`);
  };
  const httpColumn = await columnService.create(owner.id, board.id, {
    name: 'HTTP pagination',
  });
  const path = `/api/boards/${board.id}/cards`;
  const httpCard = (
    await api('post', path)
      .send({ columnId: httpColumn.id, title: ' HTTP card ' })
      .expect(201)
  ).body.data;
  await api('post', `${path}/${httpCard.id}/assignees`)
    .send({ userId: owner.id })
    .expect(201);
  await memberService.add(owner.id, board.id, { email: member.email });
  await api('post', `${path}/${httpCard.id}/assignees`)
    .send({ userId: member.id })
    .expect(201);
  await create(httpColumn.id, 'Second page');
  const page = (
    await api('get', `${path}?columnId=${httpColumn.id}&page=1&limit=1`).expect(
      200,
    )
  ).body;
  assert.deepEqual(page.meta, { page: 1, limit: 1, total: 2, totalPages: 2 });
  assert.equal(page.data.length, 1);
  assert.equal(page.data[0].assignees.length, 2);
  assert.equal(typeof page.data[0].position, 'string');
  assert.equal(JSON.stringify(page).includes('passwordHash'), false);
  const secondPage = (
    await api('get', `${path}?columnId=${httpColumn.id}&page=2&limit=1`).expect(
      200,
    )
  ).body;
  assert.equal(secondPage.data[0].title, 'Second page');
  const memberToken = await app.get(JwtService).signAsync({ sub: member.id });
  await request(app.getHttpServer())
    .get(path)
    .set('Authorization', `Bearer ${memberToken}`)
    .expect(200);
  const list = await service.list(owner.id, board.id, { page: 1, limit: 100 });
  const databaseOrder = await cards.find({
    where: { boardId: board.id, isArchived: false },
    order: { columnId: 'ASC', position: 'ASC', id: 'ASC' },
  });
  assert.deepEqual(
    list.data.map((card) => card.id),
    databaseOrder.map((card) => card.id),
  );
  pass(
    'real AppModule/REST login/Card HTTP and joined-assignee pagination match persisted SQL ordering',
  );

  await boards.update(board.id, { isArchived: true, archivedAt: new Date() });
  await api('get', path).expect(200);
  await api('get', `${path}/${httpCard.id}`).expect(200);
  for (const operation of [
    () => create(httpColumn.id, 'No'),
    () => service.update(owner.id, board.id, httpCard.id, { title: 'No' }),
    () => service.archive(owner.id, board.id, httpCard.id),
    () =>
      service.move(owner.id, board.id, httpCard.id, {
        toColumnId: httpColumn.id,
        beforeCardId: null,
      }),
    () => service.assign(owner.id, board.id, httpCard.id, { userId: owner.id }),
    () => service.unassign(owner.id, board.id, httpCard.id, owner.id),
  ])
    await rejects(operation(), 409);
  pass('archived Board remains readable and blocks every Card mutation');
  console.log(`Card PostgreSQL integration: ${checks} groups PASS`);
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
