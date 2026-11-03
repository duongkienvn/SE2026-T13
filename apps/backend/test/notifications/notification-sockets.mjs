import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL } from 'node:url';

const require = createRequire(import.meta.url);
const { io } = createRequire(
  new URL('../../../frontend/package.json', import.meta.url),
)('socket.io-client');
function once(socket, event, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const listener = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeout);
    socket.once(event, listener);
  });
}
const ack = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));

export async function verifyNotificationSockets(ctx) {
  const {
    source,
    app,
    actors,
    tokens,
    user,
    send,
    list,
    count,
    workspace,
    board,
    card,
    producer,
    publisher,
    jwt,
    http,
    load,
    pass,
  } = ctx;
  const base = await app.getUrl(),
    clients = [];
  const connect = async (token, extra = {}) => {
    const socket = io(base, {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      auth: { accessToken: token, ...extra },
    });
    clients.push(socket);
    socket.notifications = [];
    socket.on('notifications:changed', (payload) =>
      socket.notifications.push(payload),
    );
    const connected = once(socket, 'connect');
    socket.connect();
    await connected;
    return socket;
  };
  try {
    const rejected = io(base, {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      auth: { accessToken: 'invalid', userId: actors.owner },
    });
    clients.push(rejected);
    const failure = once(rejected, 'connect_error');
    rejected.connect();
    assert.equal((await failure).message, 'Unauthorized');
    const own = await connect(tokens.owner, {
        userId: actors.other,
        room: `user:${actors.other}`,
      }),
      tab = await connect(tokens.owner),
      other = await connect(tokens.other);
    const forbidden = await ack(own, 'notifications:changed', {
      recipientUserId: actors.other,
    });
    assert.equal(forbidden.success, false);
    assert.equal(forbidden.code, 'VALIDATION_FAILED');
    const room = await ack(own, 'user:join', {
      userId: actors.other,
      room: `user:${actors.other}`,
    });
    assert.equal(room.success, false);
    const parent = await board(await workspace('Sockets'), 'Socket Board'),
      resource = await card(parent, 'Private Socket Card');
    const key = randomUUID(),
      input = {
        recipientUserId: actors.owner,
        kind: 'CARD_ASSIGNED',
        cardId: resource,
        actorUserId: actors.owner,
        occurrenceKey: key,
      };
    await assert.rejects(
      source.transaction(async (manager) => {
        await producer.record(manager, {
          ...input,
          occurrenceKey: randomUUID(),
        });
        throw new Error('socket rollback');
      }),
      /socket rollback/,
    );
    await ack(own, 'unsupported:barrier', {});
    assert.equal(own.notifications.length, 0);
    assert.equal(tab.notifications.length, 0);
    const created = await source.transaction(async (manager) => {
      const result = await producer.record(manager, input);
      assert.equal(
        (
          await source.query(
            'SELECT count(*)::int AS total FROM user_notifications WHERE id=$1',
            [result.notificationId],
          )
        )[0].total,
        0,
        'separate connection must not observe an uncommitted notification',
      );
      assert.equal(own.notifications.length, 0);
      return result;
    });
    assert.equal(
      (
        await source.query(
          'SELECT count(*)::int AS total FROM user_notifications WHERE id=$1',
          [created.notificationId],
        )
      )[0].total,
      1,
    );
    const seen = [
      once(own, 'notifications:changed'),
      once(tab, 'notifications:changed'),
    ];
    await publisher.afterCommit([
      created.recipientUserId,
      created.recipientUserId,
    ]);
    assert.deepEqual(await Promise.all(seen), [{}, {}]);
    await ack(other, 'unsupported:barrier', {});
    assert.equal(other.notifications.length, 0);
    const duplicate = await source.transaction((manager) =>
      producer.record(manager, input),
    );
    assert.equal(duplicate.status, 'duplicate');
    assert.equal(own.notifications.length, 1);
    assert.equal(tab.notifications.length, 1);
    assert.equal(
      (await list('owner')).data.find(
        (row) => row.id === created.notificationId,
      ).readAt,
      null,
    );
    pass(
      'real authenticated sockets, forged channels denied, rollback silence, COMMIT visibility, ID-free multi-tab recipient delivery and no cross-user replay',
    );

    const originalPublish = publisher.afterCommit;
    publisher.afterCommit = async () => {
      throw new Error('injected post-commit transport failure');
    };
    let firstRead;
    try {
      firstRead = (
        await send(
          'owner',
          'patch',
          `/api/notifications/${created.notificationId}/read`,
        ).expect(200)
      ).body.data.readAt;
      assert.ok(firstRead);
    } finally {
      publisher.afterCommit = originalPublish;
    }
    assert.equal(
      (await list('owner')).data.find(
        (row) => row.id === created.notificationId,
      ).readAt,
      firstRead,
    );
    const previous = own.notifications.length;
    await send(
      'owner',
      'patch',
      `/api/notifications/${created.notificationId}/read`,
    ).expect(200);
    await ack(own, 'unsupported:barrier', {});
    assert.equal(
      own.notifications.length,
      previous,
      'idempotent read must not publish another invalidation',
    );
    // Real read-all emits exactly once, after persistence, and leaves repeat=0.
    const unread = await count('owner'),
      readEvents = [
        once(own, 'notifications:changed'),
        once(tab, 'notifications:changed'),
      ];
    assert.ok(unread > 0);
    assert.equal(
      (await send('owner', 'post', '/api/notifications/read-all').expect(200))
        .body.data.updatedCount,
      unread,
    );
    assert.deepEqual(await Promise.all(readEvents), [{}, {}]);
    assert.equal(await count('owner'), 0);
    assert.equal(
      (await send('owner', 'post', '/api/notifications/read-all').expect(200))
        .body.data.updatedCount,
      0,
    );
    // Recover through REST on a newly authenticated tab, not a private backlog.
    own.disconnect();
    const reconnect = await connect(tokens.owner);
    assert.equal(reconnect.notifications.length, 0);
    assert.equal(
      (await list('owner')).data.find(
        (row) => row.id === created.notificationId,
      ).readAt,
      firstRead,
    );
    const { BoardRoomCoordinator } = load(
      'realtime/board-room-coordinator.service',
    );
    const coordinator = app.get(BoardRoomCoordinator),
      broken = coordinator.server.sockets.sockets.get(reconnect.id),
      emit = broken.emit;
    broken.emit = function (event, ...args) {
      if (event === 'notifications:changed')
        throw new Error('private transport payload');
      return emit.call(this, event, ...args);
    };
    try {
      const record = await source.transaction((manager) =>
        producer.record(manager, { ...input, occurrenceKey: randomUUID() }),
      );
      const healthy = once(tab, 'notifications:changed');
      await publisher.afterCommit([record.recipientUserId]);
      assert.deepEqual(await healthy, {});
      assert.equal(
        (
          await source
            .getRepository('UserNotification')
            .findOneByOrFail({ id: record.notificationId })
        ).readAt,
        null,
      );
    } finally {
      broken.emit = emit;
    }
    pass(
      'failure-isolated committed read/read-all, repeat suppression, broken-tab isolation and reconnect repair from persisted REST state',
    );

    // Mutating adapter data cannot change the immutable authenticated owner.
    const serverSocket = coordinator.server.sockets.sockets.get(reconnect.id),
      identity = serverSocket.data.identity;
    serverSocket.data.identity = { ...identity, userId: actors.other };
    const before = reconnect.notifications.length,
      otherEvent = once(other, 'notifications:changed');
    await publisher.afterCommit([actors.other]);
    assert.deepEqual(await otherEvent, {});
    await ack(reconnect, 'unsupported:barrier', {});
    assert.equal(reconnect.notifications.length, before);
    serverSocket.data.identity = identity;
    const disconnects = [
      once(reconnect, 'disconnect'),
      once(tab, 'disconnect'),
    ];
    await source.query(
      'UPDATE users SET auth_version=auth_version+1 WHERE id=$1',
      [actors.owner],
    );
    await publisher.afterCommit([actors.owner]);
    await Promise.all(disconnects);
    assert.equal(reconnect.notifications.length, before);
    await http
      .get('/api/notifications')
      .auth(tokens.owner, { type: 'bearer' })
      .expect(401);
    tokens.owner = await jwt.signAsync({ sub: actors.owner, authVersion: 1 });
    const current = await connect(tokens.owner);
    const currentHint = once(current, 'notifications:changed');
    await publisher.afterCommit([actors.owner]);
    assert.deepEqual(await currentHint, {});
    const shortUser = await user('short-socket'),
      shortToken = await jwt.signAsync({ sub: shortUser }, { expiresIn: 3 }),
      short = await connect(shortToken);
    await once(short, 'disconnect');
    await publisher.afterCommit([shortUser]);
    assert.equal(short.notifications.length, 0);
    await http
      .get('/api/notifications')
      .auth(shortToken, { type: 'bearer' })
      .expect(401);
    pass(
      'immutable owner resists adapter mutation, live authVersion revocation, fresh reconnect, real token expiry and expired REST rejection',
    );

    // A new application and DataSource reconstruct persisted read state without
    // replay caches, implicit migrations, or notifications manufactured at boot.
    const { DataSource } = require('typeorm'),
      { Test } = require('@nestjs/testing'),
      { AppModule } = load('app.module'),
      { configureHttpApplication } = load('http-application');
    const secondSource = await new DataSource({
      ...source.options,
    }).initialize();
    let secondApp;
    const beforeRows = await source.getRepository('UserNotification').count();
    try {
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(DataSource)
        .useValue(secondSource)
        .compile();
      secondApp = module.createNestApplication();
      configureHttpApplication(secondApp);
      await secondApp.init();
      const request = require('supertest');
      const response = await request(secondApp.getHttpServer())
        .get('/api/notifications?limit=100')
        .auth(tokens.owner, { type: 'bearer' })
        .expect(200);
      assert.equal(
        response.body.data.find((row) => row.id === created.notificationId)
          .readAt,
        firstRead,
      );
      assert.equal(
        await secondSource.getRepository('UserNotification').count(),
        beforeRows,
      );
      assert.equal(secondSource.options.migrationsRun, false);
      assert.equal(secondSource.options.synchronize, false);
    } finally {
      if (secondApp) await secondApp.close();
      if (secondSource.isInitialized) await secondSource.destroy();
    }
    pass(
      'fresh application/DataSource reconstruct history and original readAt without startup writes or implicit migrations',
    );
  } finally {
    for (const socket of clients) socket.disconnect();
  }
}
