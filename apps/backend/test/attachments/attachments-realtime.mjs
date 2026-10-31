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

export async function verifyAttachmentRealtime(ctx) {
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
    attachments,
    pass,
  } = ctx;
  let asset = await service.create(actors.owner, board.id, card.id, {
    kind: 'URL',
    url: 'https://example.com/realtime',
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
      'SELECT id,state,revision,display_name,url FROM card_attachments WHERE card_id=$1 ORDER BY id',
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
    const gate = async (operation, rollback = false) => {
      const entered = deferred(),
        release = deferred(),
        before = snapshot(),
        beforeState = await state();
      hook = async () => {
        entered.resolve();
        await release.promise;
        if (rollback) throw new Error('Injected attachment COMMIT failure');
      };
      const mutation = operation().then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      let timer;
      try {
        await Promise.race([
          entered.promise,
          mutation.then((result) => {
            throw result.error ?? new Error('Missing COMMIT gate');
          }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('COMMIT gate timeout')),
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
        assert.match(
          result.error.message,
          /Injected attachment COMMIT failure/,
        );
        assert.deepEqual(await state(), beforeState);
      } else asset = result.value;
      return before;
    };
    const delivered = next(owner, 'card:updated');
    const before = await gate(() =>
      service.update(actors.owner, board.id, card.id, asset.id, {
        expectedRevision: asset.revision,
        displayName: 'Committed',
      }),
    );
    const column = (
      await source.query('SELECT column_id FROM cards WHERE id=$1', [card.id])
    )[0].column_id;
    assert.deepEqual(await delivered, {
      boardId: board.id,
      cardId: card.id,
      columnId: column,
    });
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
    const silent = await gate(
      () =>
        service.update(actors.owner, board.id, card.id, asset.id, {
          expectedRevision: asset.revision,
          displayName: 'Rolled back',
        }),
      true,
    );
    await flush();
    assert.deepEqual(snapshot(), silent);
    const noops = snapshot();
    await service.update(actors.owner, board.id, card.id, asset.id, {
      expectedRevision: asset.revision,
      displayName: asset.displayName,
    });
    await send('owner', 'patch', `${attachments}/${asset.id}`)
      .send({ expectedRevision: asset.revision, url: 'http://unsafe.example' })
      .expect(400);
    await send('viewer', 'delete', `${attachments}/${asset.id}`).expect(404);
    await send('owner', 'post', attachments).send({ kind: 'FILE' }).expect(503);
    await flush();
    assert.deepEqual(snapshot(), noops);
    pass(
      'real Socket.IO invalidation is minimal, Board-isolated and visible only after COMMIT; rollback/no-op/invalid/denied/unavailable paths stay silent',
    );

    const broadcaster = app.get(RealtimeBroadcastService),
      emit = broadcaster.emitToBoard.bind(broadcaster);
    restoreBroadcast = () => {
      broadcaster.emitToBoard = emit;
    };
    for (const outcome of [false, 'throw']) {
      broadcaster.emitToBoard = async () => {
        if (outcome === 'throw')
          throw new Error('Injected attachment transport failure');
        return false;
      };
      asset = (
        await send('owner', 'patch', `${attachments}/${asset.id}`)
          .send({
            expectedRevision: asset.revision,
            displayName: `Transport ${outcome}`,
          })
          .expect(200)
      ).body.data;
      assert.equal(
        (
          await source.query(
            'SELECT revision FROM card_attachments WHERE id=$1',
            [asset.id],
          )
        )[0].revision,
        asset.revision,
      );
    }
    broadcaster.emitToBoard = emit;
    owner.close();
    asset = await service.update(actors.owner, board.id, card.id, asset.id, {
      expectedRevision: asset.revision,
      displayName: 'Reconnect',
    });
    owner = await connect('owner');
    const reloaded = (
      await send('owner', 'get', attachments).expect(200)
    ).body.data.find((row) => row.id === asset.id);
    assert.equal(reloaded.displayName, 'Reconnect');
    pass(
      'false/throwing transport preserves committed REST success; reconnect/rejoin REST resync returns current attachment metadata',
    );

    await send('owner', 'patch', `/api/boards/${board.id}/visibility`)
      .send({ visibility: 'PRIVATE' })
      .expect(200);
    await send('viewer', 'get', attachments).expect(404);
    assert.equal((await ack(viewer, 'board:join', board.id)).code, 'NOT_FOUND');
    await send(
      'owner',
      'delete',
      `/api/boards/${board.id}/members/${actors.guest}`,
    ).expect(204);
    await send('guest', 'get', attachments).expect(404);
    assert.equal((await ack(guest, 'board:join', board.id)).code, 'NOT_FOUND');
    const guestCount = received.get(guest).length,
      viewerCount = received.get(viewer).length,
      changed = next(owner, 'card:updated');
    await service.remove(actors.owner, board.id, card.id, asset.id);
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
      'visibility/member revocation evicts protected attachment invalidation grants and invalid tokens cannot reconnect',
    );
  } finally {
    restoreRunner?.();
    restoreBroadcast?.();
    for (const socket of clients) socket.close();
  }
}
