import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
const require = createRequire(import.meta.url);
const { io } = createRequire(
  new URL('../../../frontend/package.json', import.meta.url),
)('socket.io-client');
const {
  RealtimeBroadcastService,
} = require('../../dist/realtime/realtime-broadcast.service.js');
const next = (socket, event) =>
  new Promise((resolve, reject) => {
    const listener = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Timeout: ${event}`));
    }, 5000);
    socket.once(event, listener);
  });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { resolve, promise };
};
export async function verifyLabelRealtime(ctx) {
  const {
    source,
    app,
    tokens,
    actors,
    board,
    foreignBoard,
    card,
    secondCard,
    base,
    cardBase,
    service,
    send,
    pass,
  } = ctx;
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
    for (const event of ['labels:changed', 'card:updated'])
      socket.on(event, (payload) =>
        received.get(socket).push([event, payload]),
      );
    const ready = next(socket, 'connect');
    socket.connect();
    await ready;
    assert.equal((await ack(socket, 'board:join', boardId)).success, true);
    return socket;
  };
  const flush = async () => {
    for (const socket of clients.filter((s) => s.connected)) {
      const result = await ack(
        socket,
        'board:leave',
        '00000000-0000-4000-8000-000000000000',
      );
      assert.ok(result.success || result.code === 'TOO_MANY_REQUESTS');
    }
  };
  const snapshot = () => clients.map((socket) => received.get(socket).length);
  let restoreRunner, restoreBroadcast;
  try {
    let owner = await connect('owner');
    const guest = await connect('guest'),
      viewer = await connect('viewer'),
      foreign = await connect('owner', foreignBoard.id);
    const expected = async (event, operation) => {
      const before = snapshot(),
        delivery = next(owner, event),
        result = await operation(),
        payload = await delivery;
      if (event === 'labels:changed')
        assert.deepEqual(Object.keys(payload).sort(), ['boardId', 'labelId']);
      else {
        const [row] = await source.query(
          'SELECT column_id FROM cards WHERE id=$1',
          [card.id],
        );
        assert.deepEqual(payload, {
          boardId: board.id,
          cardId: card.id,
          columnId: row.column_id,
        });
      }
      assert.equal(payload.boardId, board.id);
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
      return result;
    };
    const a = await expected('labels:changed', () =>
      service.create(actors.owner, board.id, {
        name: 'Socket label',
        color: '#123456',
      }),
    );
    const b = await expected('labels:changed', () =>
      service.create(actors.member, board.id, {
        name: 'Socket other',
        color: '#123456',
      }),
    );
    await expected('card:updated', () =>
      service.assign(actors.guest, board.id, card.id, a.id),
    );
    await expected('card:updated', () =>
      service.assign(actors.member, board.id, card.id, b.id),
    );
    await source.query(
      'INSERT INTO card_labels(card_id,label_id,board_id) VALUES ($1,$2,$3)',
      [secondCard.id, a.id, board.id],
    );
    await expected('labels:changed', () =>
      service.update(actors.owner, board.id, a.id, {
        name: 'Renamed',
        color: '#ABCDEF',
      }),
    );
    for (const id of [card.id, secondCard.id])
      assert.equal(
        (await service.cardLabels(actors.owner, board.id, id)).labels.find(
          (label) => label.id === a.id,
        ).name,
        'Renamed',
      );
    await expected('card:updated', () =>
      service.unassign(actors.owner, board.id, card.id, b.id),
    );
    await expected('labels:changed', () =>
      service.remove(actors.owner, board.id, b.id),
    );
    pass(
      'every catalog and assignment command emits one minimal post-write event to authorized readers; rename uses one Board event across multiple Cards',
    );

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
    const gate = async (name, rollback = false) => {
      const entered = deferred(),
        release = deferred(),
        before = snapshot();
      hook = async () => {
        entered.resolve();
        await release.promise;
        if (rollback) throw new Error('Injected label commit failure');
      };
      const mutation = service
        .update(actors.owner, board.id, a.id, { name })
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      let timer;
      try {
        await Promise.race([
          entered.promise,
          mutation.then((result) => {
            throw result.error ?? new Error('Missing commit gate');
          }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Commit gate timeout')),
              5000,
            );
          }),
        ]);
        assert.notEqual(
          (
            await source.query('SELECT name FROM board_labels WHERE id=$1', [
              a.id,
            ])
          )[0].name,
          name,
        );
        await flush();
        assert.deepEqual(snapshot(), before);
      } finally {
        clearTimeout(timer);
        release.resolve();
      }
      const result = await mutation;
      if (rollback)
        assert.match(result.error.message, /Injected label commit failure/);
      else assert.ok(result.value);
      return before;
    };
    const delivered = next(owner, 'labels:changed');
    await gate('Committed');
    await delivered;
    await flush();
    let before = await gate('Rolled back', true);
    await flush();
    assert.deepEqual(snapshot(), before);
    assert.equal(
      (
        await source.query('SELECT name FROM board_labels WHERE id=$1', [a.id])
      )[0].name,
      'Committed',
    );
    before = snapshot();
    await service.update(actors.owner, board.id, a.id, {
      name: ' Committed ',
      color: '#abcdef',
    });
    await assert.rejects(
      service.assign(actors.owner, board.id, card.id, a.id),
      (error) => error.getStatus() === 409,
    );
    await send('viewer', 'post', base)
      .send({ name: 'Denied', color: '#123456' })
      .expect(404);
    await flush();
    assert.deepEqual(snapshot(), before);
    pass(
      'real COMMIT barrier proves no early catalog event; rollback, normalized no-op, duplicate and denied mutations emit nothing',
    );

    const broadcaster = app.get(RealtimeBroadcastService),
      emit = broadcaster.emitToBoard.bind(broadcaster);
    restoreBroadcast = () => {
      broadcaster.emitToBoard = emit;
    };
    broadcaster.emitToBoard = async () => {
      throw new Error('Injected transport failure');
    };
    await send('owner', 'patch', `${base}/${a.id}`)
      .send({ color: '#FFFEEE' })
      .expect(200);
    broadcaster.emitToBoard = emit;
    owner.close();
    await service.update(actors.owner, board.id, a.id, {
      name: 'Offline change',
    });
    owner = await connect('owner');
    assert.equal(
      (await send('owner', 'get', cardBase).expect(200)).body.data.labels.find(
        (row) => row.id === a.id,
      ).name,
      'Offline change',
    );
    assert.equal(
      (
        await service.cardLabels(actors.owner, board.id, secondCard.id)
      ).labels.find((row) => row.id === a.id).color,
      '#FFFEEE',
    );
    pass(
      'failed broadcast preserves committed HTTP success; reconnect/rejoin and REST recover catalog and Card metadata',
    );

    await send('owner', 'patch', `/api/boards/${board.id}/visibility`)
      .send({ visibility: 'PRIVATE' })
      .expect(200);
    await send('viewer', 'get', base).expect(404);
    assert.equal((await ack(viewer, 'board:join', board.id)).code, 'NOT_FOUND');
    await send(
      'owner',
      'delete',
      `/api/boards/${board.id}/members/${actors.guest}`,
    ).expect(204);
    await send('guest', 'get', cardBase).expect(404);
    assert.equal((await ack(guest, 'board:join', board.id)).code, 'NOT_FOUND');
    const guestCount = received.get(guest).length,
      viewerCount = received.get(viewer).length;
    const changed = next(owner, 'labels:changed');
    await service.update(actors.owner, board.id, a.id, { color: '#FFFFFF' });
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
      'visibility/member revocation removes catalog and Card receive grants; private rejoin/read and invalidated token reconnect fail',
    );
  } finally {
    restoreRunner?.();
    restoreBroadcast?.();
    for (const socket of clients) socket.close();
  }
}
