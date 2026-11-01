import { Buffer } from 'node:buffer';
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

export async function verifyPrivateFileRealtime(ctx) {
  const {
    source,
    app,
    files,
    service,
    actor,
    send,
    actors,
    tokens,
    board,
    foreignBoard,
    createCard,
    team,
    pass,
  } = ctx;
  const card = await createCard('Socket files'),
    base = `/api/boards/${board.id}/cards/${card.id}/attachments`;
  const input = { filename: 'rt.txt', contentType: 'text/plain', fileSize: 5 };
  const make = async () => {
    const intent = await files.createIntent(actor(), board.id, card.id, input);
    await files.receiveLocal(
      actor(),
      board.id,
      card.id,
      intent.uploadId,
      Buffer.from('hello'),
      'text/plain',
    );
    return intent;
  };
  const clients = [],
    received = new Map();
  const ack = (socket, event, boardId) =>
    socket.timeout(5000).emitWithAck(event, { boardId });
  const connect = async (who, boardId = board.id) => {
    const socket = io(await app.getUrl(), {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      auth: { accessToken: tokens[who] },
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
  let restoreRunner, restoreBroadcast;
  try {
    // Workspace Move must keep all objects and remove inherited source-Workspace readers.
    const moveFile = await make(),
      moved = await files.complete(
        actor(),
        board.id,
        card.id,
        moveFile.uploadId,
      );
    const beforeMove = await source.query(
      'SELECT to_jsonb(asset) AS row FROM card_attachments asset WHERE card_id=$1 ORDER BY id',
      [card.id],
    );
    const destination = (
      await send('owner', 'post', '/api/workspaces')
        .send({ name: 'File destination' })
        .expect(201)
    ).body.data;
    await send('owner', 'post', `/api/boards/${board.id}/move-workspace`)
      .send({ destinationWorkspaceId: destination.id })
      .expect(200);
    await send('viewer', 'get', base + '/' + moved.id + '/file').expect(404);
    await send('guest', 'get', base + '/' + moved.id + '/file').expect(200);
    assert.deepEqual(
      await source.query(
        'SELECT to_jsonb(asset) AS row FROM card_attachments asset WHERE card_id=$1 ORDER BY id',
        [card.id],
      ),
      beforeMove,
    );
    await send('owner', 'post', `/api/boards/${board.id}/move-workspace`)
      .send({ destinationWorkspaceId: team.id })
      .expect(200);
    await send('owner', 'patch', `/api/boards/${board.id}/visibility`)
      .send({ visibility: 'WORKSPACE_VISIBLE' })
      .expect(200);
    pass(
      'Workspace Board Move preserves private attachment pointers and ownership while removing inherited old-Workspace access',
    );

    let owner = await connect('owner');
    const guest = await connect('guest'),
      viewer = await connect('viewer'),
      foreign = await connect('owner', foreignBoard.id);
    const initial = snapshot(),
      intent = await make();
    await flush();
    assert.deepEqual(snapshot(), initial);
    const createRunner = source.createQueryRunner.bind(source),
      entered = deferred(),
      release = deferred();
    let hooked = false;
    source.createQueryRunner = (...args) => {
      const runner = createRunner(...args),
        commit = runner.commitTransaction.bind(runner);
      runner.commitTransaction = async () => {
        const rows = await runner.query(
          'SELECT state FROM card_attachments WHERE id=$1',
          [intent.uploadId],
        );
        if (!hooked && rows[0]?.state === 'ACTIVE') {
          hooked = true;
          entered.resolve();
          await release.promise;
        }
        return commit();
      };
      return runner;
    };
    restoreRunner = () => {
      source.createQueryRunner = createRunner;
    };
    const event = next(owner, 'card:updated'),
      completion = files
        .complete(actor(), board.id, card.id, intent.uploadId)
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
    let timer;
    try {
      await Promise.race([
        entered.promise,
        completion.then((result) => {
          throw result.error ?? new Error('Missing file COMMIT gate');
        }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('File COMMIT timeout')),
            5000,
          );
        }),
      ]);
      assert.equal(
        (
          await source.query('SELECT state FROM card_attachments WHERE id=$1', [
            intent.uploadId,
          ])
        )[0].state,
        'PENDING',
      );
      assert.ok(
        !(await send('viewer', 'get', base).expect(200)).body.data.some(
          (row) => row.id === intent.uploadId,
        ),
      );
      await flush();
      assert.deepEqual(snapshot(), initial);
    } finally {
      clearTimeout(timer);
      release.resolve();
    }
    const active = (await completion).value;
    assert.ok(active);
    assert.deepEqual(await event, {
      boardId: board.id,
      cardId: card.id,
      columnId: card.columnId,
    });
    restoreRunner();
    restoreRunner = undefined;
    await flush();
    for (const socket of [owner, guest, viewer])
      assert.equal(
        received.get(socket).length,
        initial[clients.indexOf(socket)] + 1,
      );
    assert.equal(
      received.get(foreign).length,
      initial[clients.indexOf(foreign)],
    );
    const silent = snapshot();
    await files.complete(actor(), board.id, card.id, intent.uploadId);
    await send('viewer', 'post', base + '/uploads')
      .send(input)
      .expect(404);
    await send('owner', 'post', base + '/uploads')
      .send({ ...input, storageKey: 'secret' })
      .expect(400);
    await flush();
    assert.deepEqual(snapshot(), silent);
    const removed = next(owner, 'card:updated');
    await service.remove(actors.guest, board.id, card.id, active.id);
    await removed;
    await flush();
    const removedCounts = snapshot();
    await service.remove(actors.owner, board.id, card.id, active.id);
    await flush();
    assert.deepEqual(snapshot(), removedCounts);
    await send('owner', 'get', base + '/' + active.id + '/file').expect(404);
    pass(
      'real sockets see one minimal-ID file invalidation only after activation COMMIT and effective removal; intents/retries/repeat delete/invalid/denied operations stay silent and foreign Boards stay isolated',
    );

    const broadcaster = app.get(RealtimeBroadcastService),
      emit = broadcaster.emitToBoard.bind(broadcaster);
    restoreBroadcast = () => {
      broadcaster.emitToBoard = emit;
    };
    const created = [];
    for (const outcome of [false, 'throw']) {
      const retry = await make();
      broadcaster.emitToBoard = async () => {
        if (outcome === 'throw')
          throw new Error('Injected file transport failure');
        return false;
      };
      const completed = (
        await send(
          'owner',
          'post',
          base + '/uploads/' + retry.uploadId + '/complete',
        )
          .send({})
          .expect(200)
      ).body.data;
      assert.equal(completed.state, 'ACTIVE');
      created.push(completed.id);
    }
    broadcaster.emitToBoard = emit;
    owner.close();
    owner = await connect('owner');
    const reloaded = (await send('owner', 'get', base).expect(200)).body.data;
    assert.ok(created.every((id) => reloaded.some((row) => row.id === id)));
    pass(
      'false/throwing event transport cannot fail committed file REST results; reconnect and scoped REST resync recover authoritative metadata',
    );

    const pendingGuest = await files.createIntent(
      actor('guest'),
      board.id,
      card.id,
      input,
    );
    await send('owner', 'patch', `/api/boards/${board.id}/visibility`)
      .send({ visibility: 'PRIVATE' })
      .expect(200);
    await send('viewer', 'get', base + '/' + moved.id + '/file').expect(404);
    assert.equal((await ack(viewer, 'board:join', board.id)).code, 'NOT_FOUND');
    await send(
      'owner',
      'delete',
      `/api/boards/${board.id}/members/${actors.guest}`,
    ).expect(204);
    await send('guest', 'get', base + '/' + moved.id + '/file').expect(404);
    await send(
      'guest',
      'post',
      base + '/uploads/' + pendingGuest.uploadId + '/complete',
    )
      .send({})
      .expect(404);
    assert.equal((await ack(guest, 'board:join', board.id)).code, 'NOT_FOUND');
    const guestCount = received.get(guest).length,
      viewerCount = received.get(viewer).length,
      changed = next(owner, 'card:updated');
    await service.remove(actors.owner, board.id, card.id, moved.id);
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
      'visibility/member revocation removes download and pending completion rights plus receive grants; invalidated tokens cannot reconnect',
    );
  } finally {
    restoreRunner?.();
    restoreBroadcast?.();
    for (const socket of clients) socket.close();
  }
}
