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
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { resolve, promise };
};
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
const bounded = async (promise) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Commit gate timeout')),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
export async function verifyChecklistRealtime(ctx) {
  const {
    source,
    app,
    tokens,
    actors,
    board,
    foreignBoard,
    card,
    base,
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
    socket.on('card:updated', (payload) => received.get(socket).push(payload));
    const ready = next(socket, 'connect');
    socket.connect();
    await ready;
    assert.equal((await ack(socket, 'board:join', boardId)).success, true);
    return socket;
  };
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
  const snapshot = () => clients.map((socket) => received.get(socket).length);
  let restoreRunner, restoreBroadcast;
  try {
    let owner = await connect('owner');
    const guest = await connect('guest'),
      viewer = await connect('viewer'),
      foreign = await connect('owner', foreignBoard.id);
    const expectEvent = async (operation) => {
      const before = snapshot(),
        delivery = next(owner, 'card:updated');
      const result = await operation(),
        payload = await delivery;
      const [persisted] = await source.query(
        'SELECT column_id FROM cards WHERE id=$1',
        [card.id],
      );
      assert.deepEqual(payload, {
        boardId: board.id,
        cardId: card.id,
        columnId: persisted.column_id,
      });
      await flush();
      assert.equal(
        received.get(foreign).length,
        before[clients.indexOf(foreign)],
      );
      for (const socket of [owner, guest, viewer])
        assert.equal(
          received.get(socket).length,
          before[clients.indexOf(socket)] + 1,
        );
      return result;
    };
    const a = await expectEvent(() =>
      service.create(actors.owner, board.id, card.id, {
        title: 'Socket checklist',
      }),
    );
    const b = await expectEvent(() =>
      service.create(actors.owner, board.id, card.id, {
        title: 'Socket second',
      }),
    );
    await expectEvent(() =>
      service.rename(actors.owner, board.id, card.id, a.id, {
        title: 'Renamed over socket',
      }),
    );
    await expectEvent(() =>
      service.move(actors.owner, board.id, card.id, b.id, a.id),
    );
    let result = await expectEvent(() =>
      service.addItem(actors.owner, board.id, card.id, a.id, { text: 'One' }),
    );
    const one = result.items[0];
    result = await expectEvent(() =>
      service.addItem(actors.owner, board.id, card.id, a.id, { text: 'Two' }),
    );
    const two = result.items[1];
    await expectEvent(() =>
      service.updateItem(actors.owner, board.id, card.id, a.id, one.id, {
        isChecked: true,
      }),
    );
    await expectEvent(() =>
      service.moveItem(actors.owner, board.id, card.id, a.id, two.id, one.id),
    );
    await expectEvent(() =>
      service.removeItem(actors.owner, board.id, card.id, a.id, two.id),
    );
    await expectEvent(() =>
      service.remove(actors.owner, board.id, card.id, b.id),
    );
    pass(
      'every effective checklist/item command emits one ID-only card:updated to authorized Board members/viewers, isolated from other rooms',
    );

    let commitHook;
    const createRunner = source.createQueryRunner.bind(source);
    source.createQueryRunner = (...args) => {
      const runner = createRunner(...args),
        commit = runner.commitTransaction.bind(runner);
      runner.commitTransaction = async () => {
        if (commitHook) {
          const hook = commitHook;
          commitHook = undefined;
          await hook();
        }
        return commit();
      };
      return runner;
    };
    restoreRunner = () => {
      source.createQueryRunner = createRunner;
    };
    const gate = async (checked, rollback = false) => {
      const entered = deferred(),
        release = deferred(),
        before = snapshot();
      commitHook = async () => {
        entered.resolve();
        await release.promise;
        if (rollback) throw new Error('Injected commit failure');
      };
      const operation = service
        .updateItem(actors.owner, board.id, card.id, a.id, one.id, {
          isChecked: checked,
        })
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      try {
        await bounded(
          Promise.race([
            entered.promise,
            operation.then((result) => {
              throw result.error ?? new Error('Missing commit gate');
            }),
          ]),
        );
        const [persisted] = await source.query(
          'SELECT is_checked FROM card_checklist_items WHERE id=$1',
          [one.id],
        );
        assert.equal(persisted.is_checked, !checked);
        await flush();
        assert.deepEqual(snapshot(), before);
      } finally {
        release.resolve();
      }
      const result = await operation;
      if (rollback)
        assert.match(result.error.message, /Injected commit failure/);
      else assert.ok(result.value);
      return before;
    };
    const delivery = next(owner, 'card:updated');
    await gate(false);
    await delivery;
    await flush();
    let before = await gate(true, true);
    await flush();
    assert.deepEqual(snapshot(), before);
    assert.equal(
      (
        await source.query(
          'SELECT is_checked FROM card_checklist_items WHERE id=$1',
          [one.id],
        )
      )[0].is_checked,
      false,
    );
    before = snapshot();
    await service.updateItem(actors.owner, board.id, card.id, a.id, one.id, {
      isChecked: false,
    });
    await service.rename(actors.owner, board.id, card.id, a.id, {
      title: 'Renamed over socket',
    });
    await service.moveItem(actors.owner, board.id, card.id, a.id, one.id, null);
    await flush();
    assert.deepEqual(snapshot(), before);
    pass(
      'real commit gate proves no early delivery, failed commit fully rolls back without events, and explicit-state/text/move retries are silent',
    );

    const broadcaster = app.get(RealtimeBroadcastService),
      emit = broadcaster.emitToBoard.bind(broadcaster);
    restoreBroadcast = () => {
      broadcaster.emitToBoard = emit;
    };
    broadcaster.emitToBoard = async () => {
      throw new Error('Injected transport failure');
    };
    await send('owner', 'patch', `${base}/${a.id}/items/${one.id}`)
      .send({ isChecked: true })
      .expect(200);
    broadcaster.emitToBoard = emit;
    assert.equal(
      (
        await source.query(
          'SELECT is_checked FROM card_checklist_items WHERE id=$1',
          [one.id],
        )
      )[0].is_checked,
      true,
    );
    owner.close();
    await service.updateItem(actors.owner, board.id, card.id, a.id, one.id, {
      isChecked: false,
    });
    owner = await connect('owner');
    const reloaded = (
      await send('owner', 'get', base).expect(200)
    ).body.data.checklists.find((row) => row.id === a.id);
    assert.equal(reloaded.checkedItems, 0);
    assert.equal(reloaded.items[0].isChecked, false);
    pass(
      'transport exception preserves HTTP success; reconnect/rejoin plus REST resync recovers missed checklist state',
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
    await send('guest', 'get', base).expect(404);
    assert.equal((await ack(guest, 'board:join', board.id)).code, 'NOT_FOUND');
    const guestCount = received.get(guest).length,
      viewerCount = received.get(viewer).length;
    const changed = next(owner, 'card:updated');
    await service.updateItem(actors.owner, board.id, card.id, a.id, one.id, {
      isChecked: true,
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
      'visibility and Board membership revocation evict receive grants; rejoin/read fail; invalidated token cannot reconnect',
    );
    await service.remove(actors.owner, board.id, card.id, a.id);
  } finally {
    restoreRunner?.();
    restoreBroadcast?.();
    for (const socket of clients) socket.close();
  }
}
