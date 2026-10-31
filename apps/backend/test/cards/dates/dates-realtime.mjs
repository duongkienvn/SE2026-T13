import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
const require = createRequire(import.meta.url);
const { io } = createRequire(
  new URL('../../../../frontend/package.json', import.meta.url),
)('socket.io-client');
const {
  RealtimeBroadcastService,
} = require('../../../dist/realtime/realtime-broadcast.service.js');
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { resolve, promise };
};
const next = (socket, event) =>
  new Promise((resolve, reject) => {
    const listener = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Timeout: ${event}`));
    }, 5000);
    socket.once(event, listener);
  });

export async function verifyDateRealtime(ctx) {
  const {
    source,
    app,
    service,
    send,
    actors,
    tokens,
    board,
    foreignBoard,
    card,
    cardBase,
    pass,
  } = ctx;
  await service.update(actors.owner, board.id, card.id, {
    startDate: '2026-03-08T06:30:00Z',
    dueDate: '2026-03-08T07:30:00Z',
  });
  const clients = [],
    received = new Map();
  const ack = (socket, event, boardId) =>
    socket.timeout(5000).emitWithAck(event, { boardId });
  const connect = async (actor, boardId = board.id) => {
    const socket = io(await app.getUrl(), {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      auth: { accessToken: tokens[actor] },
    });
    clients.push(socket);
    received.set(socket, []);
    socket.on('card:updated', (payload) => received.get(socket).push(payload));
    const ready = next(socket, 'connect');
    socket.connect();
    await ready;
    assert.equal((await ack(socket, 'board:join', boardId)).success, true);
    return socket;
  };
  const snapshot = () => clients.map((socket) => received.get(socket).length);
  const flush = async () => {
    for (const socket of clients.filter((client) => client.connected)) {
      const reply = await ack(
        socket,
        'board:leave',
        '00000000-0000-4000-8000-000000000000',
      );
      assert.ok(reply.success || reply.code === 'TOO_MANY_REQUESTS');
    }
  };
  const state = () =>
    source.query(
      `SELECT start_date,due_date,updated_at,(SELECT count(*)::int FROM activities WHERE entity_id=$1 AND action_type='CARD_UPDATED') AS activities FROM cards WHERE id=$1`,
      [card.id],
    );
  let restoreRunner, restoreBroadcast;
  try {
    let owner = await connect('owner');
    const guest = await connect('guest'),
      viewer = await connect('viewer'),
      foreign = await connect('owner', foreignBoard.id);
    const createRunner = source.createQueryRunner.bind(source);
    let hook;
    source.createQueryRunner = (...args) => {
      const runner = createRunner(...args),
        commit = runner.commitTransaction.bind(runner);
      runner.commitTransaction = async () => {
        if (hook) {
          const action = hook;
          hook = undefined;
          await action();
        }
        return commit();
      };
      return runner;
    };
    restoreRunner = () => {
      source.createQueryRunner = createRunner;
    };
    const gate = async (input, rollback = false) => {
      const entered = deferred(),
        release = deferred(),
        before = snapshot(),
        beforeState = await state();
      hook = async () => {
        entered.resolve();
        await release.promise;
        if (rollback) throw new Error('Injected date COMMIT failure');
      };
      const mutation = service
        .update(actors.owner, board.id, card.id, input)
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      let timer;
      try {
        await Promise.race([
          entered.promise,
          mutation.then((result) => {
            throw result.error ?? new Error('Missing date commit gate');
          }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Date commit gate timeout')),
              5000,
            );
          }),
        ]);
        assert.deepEqual(await state(), beforeState);
        await flush();
        assert.deepEqual(snapshot(), before);
      } finally {
        clearTimeout(timer);
        release.resolve();
      }
      const result = await mutation;
      if (rollback) {
        assert.match(result.error.message, /Injected date COMMIT failure/);
        assert.deepEqual(await state(), beforeState);
      } else assert.ok(result.value);
      return before;
    };
    const before = snapshot(),
      delivered = next(owner, 'card:updated');
    await gate({ startDate: '2026-03-08T06:45:00Z' });
    const payload = await delivered;
    assert.deepEqual(payload, {
      boardId: board.id,
      cardId: card.id,
      columnId: card.columnId,
    });
    assert.equal(
      (await state())[0].start_date.toISOString(),
      '2026-03-08T06:45:00.000Z',
    );
    await flush();
    for (const socket of [owner, guest, viewer])
      assert.equal(
        received.get(socket).length,
        before[clients.indexOf(socket)] + 1,
      );
    assert.equal(
      received.get(foreign).length,
      before[clients.indexOf(foreign)],
    );
    let silent = await gate(
      { startDate: '2026-03-08T06:55:00Z', dueDate: '2026-03-08T07:45:00Z' },
      true,
    );
    await flush();
    assert.deepEqual(snapshot(), silent);
    silent = snapshot();
    const silentState = await state();
    await service.update(actors.owner, board.id, card.id, {
      startDate: '2026-03-08T01:45:00-05:00',
      dueDate: '2026-03-08T03:30:00-04:00',
    });
    await send('owner', 'patch', cardBase)
      .send({ startDate: '2026-03-08T08:00Z' })
      .expect(400);
    await send('viewer', 'patch', cardBase)
      .send({ startDate: null })
      .expect(404);
    await flush();
    assert.deepEqual(snapshot(), silent);
    assert.deepEqual(await state(), silentState);
    pass(
      'real COMMIT gate proves dates and Activity/event visibility are post-commit, Board-isolated and silent on rollback/no-op/invalid/denied requests',
    );

    const broadcaster = app.get(RealtimeBroadcastService),
      emit = broadcaster.emitToBoard.bind(broadcaster);
    restoreBroadcast = () => {
      broadcaster.emitToBoard = emit;
    };
    for (const [outcome, startDate] of [
      [false, '2026-03-08T06:46:00Z'],
      ['throw', '2026-03-08T06:47:00Z'],
    ]) {
      broadcaster.emitToBoard = async () => {
        if (outcome === 'throw')
          throw new Error('Injected date transport failure');
        return false;
      };
      await send('owner', 'patch', cardBase).send({ startDate }).expect(200);
      assert.equal(
        (await state())[0].start_date.toISOString(),
        new Date(startDate).toISOString(),
      );
    }
    broadcaster.emitToBoard = emit;
    owner.close();
    await service.update(actors.owner, board.id, card.id, {
      dueDate: '2026-03-08T08:00:00Z',
    });
    owner = await connect('owner');
    const reloaded = (await send('owner', 'get', cardBase).expect(200)).body
      .data;
    assert.equal(reloaded.startDate, '2026-03-08T06:47:00.000Z');
    assert.equal(reloaded.dueDate, '2026-03-08T08:00:00.000Z');
    pass(
      'false/throwing date event transport preserves HTTP success; reconnect/rejoin and REST recover both authoritative instants',
    );

    await send('owner', 'patch', `/api/boards/${board.id}/visibility`)
      .send({ visibility: 'PRIVATE' })
      .expect(200);
    await send('viewer', 'get', cardBase).expect(404);
    assert.equal((await ack(viewer, 'board:join', board.id)).code, 'NOT_FOUND');
    await send(
      'owner',
      'delete',
      `/api/boards/${board.id}/members/${actors.guest}`,
    ).expect(204);
    await send('guest', 'get', cardBase).expect(404);
    assert.equal((await ack(guest, 'board:join', board.id)).code, 'NOT_FOUND');
    const guestCount = received.get(guest).length,
      viewerCount = received.get(viewer).length,
      changed = next(owner, 'card:updated');
    await service.update(actors.owner, board.id, card.id, {
      dueDate: '2026-03-08T09:00:00Z',
    });
    await changed;
    await flush();
    assert.equal(received.get(guest).length, guestCount);
    assert.equal(received.get(viewer).length, viewerCount);
    guest.close();
    await source.query(
      'UPDATE users SET auth_version=auth_version+1 WHERE id=$1',
      [actors.guest],
    );
    const invalid = io(await app.getUrl(), {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      auth: { accessToken: tokens.guest },
    });
    clients.push(invalid);
    received.set(invalid, []);
    const denied = next(invalid, 'connect_error');
    invalid.connect();
    await denied;
    assert.equal(invalid.connected, false);
    pass(
      'visibility/member revocation removes date invalidation receive grants and invalidated tokens cannot reconnect',
    );
  } finally {
    restoreRunner?.();
    restoreBroadcast?.();
    for (const socket of clients) socket.close();
  }
}
