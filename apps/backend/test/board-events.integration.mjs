import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import { URL, fileURLToPath } from 'node:url';
import { configureTestEnvironment, ids } from './realtime-checks.mjs';
import {
  seedBoardEvents,
  runBoardEventChecks,
  nextBoardEvent,
} from './board-events-checks.mjs';

const require = createRequire(import.meta.url);
require('reflect-metadata');
require('dotenv').config({
  path: resolve(fileURLToPath(new URL('../', import.meta.url)), '../../.env'),
  quiet: true,
});
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { Test } = require('@nestjs/testing');
const request = require('supertest');
const { io } = createRequire(
  new URL('../../frontend/package.json', import.meta.url),
)('socket.io-client');
const { databaseOptions } = require('../src/database/database-options.ts');
const { configureHttpApplication } = require('../src/http-application.ts');
const {
  BoardRoomCoordinator,
} = require('../src/realtime/board-room-coordinator.service.ts');
const {
  RealtimeBroadcastService,
} = require('../src/realtime/realtime-broadcast.service.ts');
const options = databaseOptions(process.env);
const database = `kanban_events_verify_${randomBytes(8).toString('hex')}`;
const admin = new Client({
  ...options,
  user: options.username,
  database: options.database,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { resolve, promise };
};
const bounded = async (promise, name) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${name}`)), 8000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
let source,
  app,
  created = false,
  checks = 0;
const clients = [];
const pass = (name) => {
  checks++;
  console.log(`PASS: ${name}`);
};

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  source = new DataSource({ ...options, database });
  await source.initialize();
  await source.runMigrations();
  assert.equal(source.options.synchronize, false);
  await seedBoardEvents(source);
  configureTestEnvironment();
  process.env.DATABASE_NAME = database;
  const { AppModule } = require('../src/app.module.ts');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(source)
    .compile();
  app = module.createNestApplication();
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');
  assert.equal(await runBoardEventChecks(app, source), 7);
  pass(
    'all twelve REST -> Socket.IO contracts and security checks on migrated PostgreSQL',
  );

  // Independent transport suites get independent application lifetimes. This
  // preserves the real F1 quota instead of disabling/resetting its private state.
  await app.close();
  if (!source.isInitialized) await source.initialize();
  const raceModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(source)
    .compile();
  app = raceModule.createNestApplication();
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');

  const boardId = randomUUID();
  const boards = source.getRepository('Board'),
    columns = source.getRepository('BoardColumn'),
    cards = source.getRepository('Card'),
    members = source.getRepository('BoardMember');
  await boards.save({
    id: boardId,
    name: 'Commit/race fixture',
    createdById: ids.owner,
    isArchived: false,
  });
  for (const [userId, role] of [
    [ids.owner, 'OWNER'],
    [ids.member, 'MEMBER'],
  ])
    await members.save({ boardId, userId, role });
  const column = await columns.save({
    boardId,
    name: 'Source',
    position: '100.0000000000',
  });
  const destination = await columns.save({
    boardId,
    name: 'Destination',
    position: '200.0000000000',
  });
  const card = await cards.save({
    boardId,
    columnId: column.id,
    createdById: ids.owner,
    title: 'Before',
    description: null,
    dueDate: null,
    isArchived: false,
    archivedAt: null,
    position: '100.0000000000',
  });
  const tokens = {};
  for (const name of ['owner', 'member']) {
    const result = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: `${name}@events.test`, password: 'board-events-password' })
      .expect(200);
    tokens[name] = result.body.data.accessToken;
  }
  const ack = (socket, event, id = ids.empty) =>
    socket.timeout(5000).emitWithAck(event, { boardId: id });
  const received = new Map();
  const connect = async (token) => {
    const socket = io(await app.getUrl(), {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      auth: { accessToken: token },
    });
    clients.push(socket);
    received.set(socket, []);
    socket.onAny((event, payload) => {
      if (/^(column|card|member):/.test(event))
        received.get(socket).push([event, payload]);
    });
    const ready = nextBoardEvent(socket, 'connect');
    socket.connect();
    await ready;
    assert.equal((await ack(socket, 'board:join', boardId)).success, true);
    return socket;
  };
  const owner = await connect(tokens.owner),
    member = await connect(tokens.member),
    tab = await connect(tokens.member);
  const flush = async () => {
    // A quota rejection is also an ordered reply on this transport. Keep the
    // production per-user limiter active across both suites and multiple tabs.
    for (const s of clients) {
      const reply = await ack(s, 'board:leave');
      assert.ok(reply.success || reply.code === 'TOO_MANY_REQUESTS');
    }
  };
  const snapshot = () => clients.map((s) => received.get(s).length);
  const http = (method, path, body, status = 200) => {
    const agent = request(app.getHttpServer());
    const req = agent[method](`/api/boards/${boardId}/${path}`).auth(
      tokens.owner,
      { type: 'bearer' },
    );
    return (body === undefined ? req : req.send(body))
      .timeout({ deadline: 8000 })
      .expect(status);
  };

  // Instrument the real QueryRunner at COMMIT, after the callback's SQL writes.
  // TypeORM still owns commit/rollback/release; no mock transaction decides success.
  let commitHook;
  const createRunner = source.createQueryRunner.bind(source);
  source.createQueryRunner = (...args) => {
    const runner = createRunner(...args),
      commit = runner.commitTransaction.bind(runner);
    runner.commitTransaction = async () => {
      if (commitHook) {
        const hook = commitHook;
        commitHook = undefined;
        await hook(runner);
      }
      return commit();
    };
    return runner;
  };
  const withCommitGate = async (start, inspect, rollback = false) => {
    const entered = deferred(),
      release = deferred();
    const before = snapshot();
    commitHook = async () => {
      entered.resolve();
      await release.promise;
      if (rollback) throw new Error('injected commit failure');
    };
    const mutation = start().then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    try {
      await Promise.race([
        entered.promise,
        mutation.then((result) => {
          throw (
            result.error ?? new Error('mutation ended without reaching commit')
          );
        }),
      ]);
      await inspect();
      await flush();
      assert.deepEqual(snapshot(), before);
    } finally {
      release.resolve();
    }
    const result = await mutation;
    commitHook = undefined;
    if (result.error) throw result.error;
    return result.value;
  };

  const firstEvents = clients.map((s) => nextBoardEvent(s, 'column:created'));
  const result = await withCommitGate(
    () => http('post', 'columns', { name: 'Delayed create' }, 201),
    async () =>
      assert.equal(
        await columns.count({ where: { boardId, name: 'Delayed create' } }),
        0,
      ),
  );
  for (const event of await Promise.all(firstEvents))
    assert.deepEqual(event, { boardId, columnId: result.body.data.id });
  assert.equal(
    (await columns.findOne({ where: { id: result.body.data.id } })).name,
    'Delayed create',
  );
  pass(
    'real pre-COMMIT barrier: no early Column event, fresh reads see committed creation',
  );

  const moveEvents = clients.map((s) => nextBoardEvent(s, 'card:moved'));
  await withCommitGate(
    () =>
      http('patch', `cards/${card.id}/move`, {
        toColumnId: destination.id,
        beforeCardId: null,
      }),
    async () =>
      assert.equal(
        (await cards.findOne({ where: { id: card.id } })).columnId,
        column.id,
      ),
  );
  for (const event of await Promise.all(moveEvents))
    assert.deepEqual(event, {
      boardId,
      cardId: card.id,
      fromColumnId: column.id,
      toColumnId: destination.id,
    });
  assert.equal(
    (await cards.findOne({ where: { id: card.id } })).columnId,
    destination.id,
  );
  pass(
    'real pre-COMMIT Card move barrier and authoritative source/destination payload',
  );

  // A second connection must be able to acquire the Board lock during delivery.
  const broadcaster = app.get(RealtimeBroadcastService);
  const originalBroadcast = broadcaster.emitToBoard;
  let lockReleased = false,
    lockError;
  broadcaster.emitToBoard = async (...args) => {
    const probe = source.createQueryRunner();
    try {
      await probe.startTransaction();
      await probe.query(
        'SELECT id FROM boards WHERE id = $1 FOR UPDATE NOWAIT',
        [boardId],
      );
      lockReleased = true;
    } catch (error) {
      lockError = error;
    } finally {
      if (probe.isTransactionActive) await probe.rollbackTransaction();
      await probe.release();
    }
    return originalBroadcast.apply(broadcaster, args);
  };
  try {
    await http('patch', `cards/${card.id}`, { title: 'After commit' });
  } finally {
    broadcaster.emitToBoard = originalBroadcast;
  }
  assert.equal(lockError, undefined);
  assert.equal(lockReleased, true);
  await flush();
  pass('PostgreSQL Board lock is released before any delivery work begins');

  const beforeRollback = snapshot();
  await withCommitGate(
    () => http('patch', `cards/${card.id}`, { title: 'Rolled back' }, 500),
    async () => {
      assert.equal(
        (await cards.findOne({ where: { id: card.id } })).title,
        'After commit',
      );
    },
    true,
  );
  await flush();
  assert.deepEqual(snapshot(), beforeRollback);
  assert.equal(
    (await cards.findOne({ where: { id: card.id } })).title,
    'After commit',
  );
  await withCommitGate(
    () => http('post', 'columns', { name: 'Rolled back Column' }, 500),
    async () => {
      assert.equal(
        await columns.count({ where: { boardId, name: 'Rolled back Column' } }),
        0,
      );
    },
    true,
  );
  assert.equal(
    await columns.count({ where: { boardId, name: 'Rolled back Column' } }),
    0,
  );
  pass(
    'actual SQL writes followed by commit failure fully roll back Card/Column changes without events',
  );

  const assignment = await source
    .getRepository('CardAssignee')
    .save({ cardId: card.id, userId: ids.member, assignedById: ids.owner });
  const beforeRemovalRollback = snapshot();
  await withCommitGate(
    () => http('delete', `members/${ids.member}`, undefined, 500),
    async () => {
      assert.equal(
        await members.count({ where: { boardId, userId: ids.member } }),
        1,
      );
    },
    true,
  );
  await flush();
  assert.deepEqual(snapshot(), beforeRemovalRollback);
  assert.equal(
    await members.count({ where: { boardId, userId: ids.member } }),
    1,
  );
  assert.ok(
    await source
      .getRepository('CardAssignee')
      .findOne({ where: { id: assignment.id } }),
  );
  const coordinator = app.get(BoardRoomCoordinator);
  for (const s of [member, tab])
    assert.equal(
      coordinator.server.sockets.sockets
        .get(s.id)
        .data.authorizedBoardIds.has(boardId),
      true,
    );
  pass(
    'removal rollback retains membership, assignments and all socket grants; no removal event',
  );

  const concurrentBefore = snapshot();
  const concurrent = await Promise.all([
    ...Array.from({ length: 4 }, (_, i) =>
      http('post', 'columns', { name: `Concurrent ${i}` }, 201),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      http(
        'post',
        'cards',
        { columnId: column.id, title: `Concurrent ${i}` },
        201,
      ),
    ),
  ]);
  await flush();
  const expected = concurrent.map((r, i) => [
    i < 4 ? 'column:created' : 'card:created',
    i < 4
      ? { boardId, columnId: r.body.data.id }
      : { boardId, cardId: r.body.data.id, columnId: column.id },
  ]);
  const sorted = (values) => values.map((v) => JSON.stringify(v)).sort();
  for (const [i, socket] of clients.entries())
    assert.deepEqual(
      sorted(received.get(socket).slice(concurrentBefore[i])),
      sorted(expected),
    );
  const persistedColumns = await columns.find({
    where: { boardId },
    order: { position: 'ASC' },
  });
  assert.equal(
    new Set(persistedColumns.map((c) => c.position)).size,
    persistedColumns.length,
  );
  const persistedCards = await cards.find({
    where: { boardId, columnId: column.id },
    order: { position: 'ASC' },
  });
  assert.equal(
    new Set(persistedCards.map((c) => c.position)).size,
    persistedCards.length,
  );
  const updateBefore = snapshot();
  const updates = await Promise.all([
    ...Array.from({ length: 4 }, (_, i) =>
      http('patch', `columns/${column.id}`, { name: `Concurrent rename ${i}` }),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      http('patch', `cards/${card.id}`, { title: `Concurrent update ${i}` }),
    ),
  ]);
  await flush();
  const expectedUpdates = updates.map((_, i) =>
    i < 4
      ? ['column:updated', { boardId, columnId: column.id }]
      : [
          'card:updated',
          { boardId, cardId: card.id, columnId: destination.id },
        ],
  );
  for (const [i, socket] of clients.entries())
    assert.deepEqual(
      sorted(received.get(socket).slice(updateBefore[i])),
      sorted(expectedUpdates),
    );
  const latestColumn = await columns.findOne({ where: { id: column.id } });
  const latestCard = await cards.findOne({ where: { id: card.id } });
  assert.ok(
    updates.slice(0, 4).some((r) => r.body.data.name === latestColumn.name),
  );
  assert.ok(
    updates.slice(4).some((r) => r.body.data.title === latestCard.title),
  );
  pass(
    'concurrent Column/Card creates and updates preserve persistence and emit once per mutation/socket without assuming arrival order',
  );

  const originalEvict = coordinator.evictUser;
  const evictionEntered = deferred(),
    evictionRelease = deferred(),
    broadcastEntered = deferred();
  coordinator.evictUser = async (...args) => {
    evictionEntered.resolve();
    await evictionRelease.promise;
    return originalEvict.apply(coordinator, args);
  };
  broadcaster.emitToBoard = async (...args) => {
    if (args[1] === 'column:created') broadcastEntered.resolve();
    return originalBroadcast.apply(broadcaster, args);
  };
  const memberSockets = [member, tab].map((s) =>
    coordinator.server.sockets.sockets.get(s.id),
  );
  const restoreSockets = memberSockets.map((socket) => ({
    socket,
    leave: socket.leave,
    disconnect: socket.disconnect,
  }));
  for (const { socket, leave } of restoreSockets) {
    socket.leave = async (room) => {
      if (room === `board:${boardId}`)
        throw new Error('injected leave failure');
      return leave.call(socket, room);
    };
    socket.disconnect = () => {
      throw new Error('injected disconnect failure');
    };
  }
  const beforeRace = snapshot();
  const removed = nextBoardEvent(owner, 'member:removed');
  const createdEvent = nextBoardEvent(owner, 'column:created');
  const removal = http('delete', `members/${ids.member}`, undefined, 204).then(
    (value) => value,
  );
  let pendingJoin, pendingColumn;
  try {
    await bounded(evictionEntered.promise, 'post-commit eviction'); // queue is still held
    assert.equal(
      await members.count({ where: { boardId, userId: ids.member } }),
      0,
    );
    assert.equal(
      await source
        .getRepository('CardAssignee')
        .count({ where: { cardId: card.id, userId: ids.member } }),
      0,
    );
    pendingJoin = ack(member, 'board:join', boardId);
    pendingColumn = http(
      'post',
      'columns',
      { name: 'Committed while eviction waits' },
      201,
    ).then((value) => value);
    await bounded(broadcastEntered.promise, 'concurrent committed broadcast');
    assert.equal(
      await columns.count({
        where: { boardId, name: 'Committed while eviction waits' },
      }),
      1,
    );
    await flush();
    assert.deepEqual(snapshot(), beforeRace);
  } finally {
    evictionRelease.resolve();
  }
  try {
    const [, columnResult, joinResult] = await Promise.all([
      removal,
      pendingColumn,
      pendingJoin,
    ]);
    assert.equal(joinResult.code, 'NOT_FOUND');
    assert.deepEqual(await removed, { boardId, userId: ids.member });
    assert.deepEqual(await createdEvent, {
      boardId,
      columnId: columnResult.body.data.id,
    });
    await flush();
    for (let i = 1; i < clients.length; i++)
      assert.equal(received.get(clients[i]).length, beforeRace[i]);
    for (const socket of memberSockets) {
      assert.equal(socket.data.authorizedBoardIds.has(boardId), false);
      assert.equal(socket.rooms.has(`board:${boardId}`), true);
    }
    assert.equal((await ack(tab, 'board:join', boardId)).code, 'NOT_FOUND');
  } finally {
    coordinator.evictUser = originalEvict;
    broadcaster.emitToBoard = originalBroadcast;
    for (const { socket, leave, disconnect } of restoreSockets) {
      socket.leave = leave;
      socket.disconnect = disconnect;
    }
  }
  pass(
    'real removal commit/eviction/broadcast/join race completes without deadlock or revoked-tab delivery despite double adapter failure',
  );
  assert.equal(checks, 8);
  console.log(
    `Board events PostgreSQL + Socket.IO: ${checks} groups PASS; isolated migrations and cleanup`,
  );
} finally {
  for (const socket of clients) socket.close();
  try {
    if (app) await app.close();
  } finally {
    if (source?.isInitialized) await source.destroy();
    try {
      if (created) await admin.query(`DROP DATABASE "${database}"`);
    } finally {
      await admin.end();
    }
  }
}
