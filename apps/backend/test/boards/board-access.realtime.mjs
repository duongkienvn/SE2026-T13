import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { setTimeout, clearTimeout } from 'node:timers';
import { URL } from 'node:url';
const require = createRequire(import.meta.url);
const { io } = createRequire(
  new URL('../../../frontend/package.json', import.meta.url),
)('socket.io-client');
const {
  BoardRoomCoordinator,
} = require('../../dist/realtime/board-room-coordinator.service.js');
const {
  BoardAuthorizationService,
} = require('../../dist/api/board-members/board-authorization.service.js');
const {
  RealtimeBroadcastService,
} = require('../../dist/realtime/realtime-broadcast.service.js');

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const next = (socket, event) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Missing ${event}`)), 6000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
const ack = (socket, event, payload) =>
  new Promise((resolve, reject) => {
    socket
      .timeout(6000)
      .emit(event, payload, (error, response) =>
        error ? reject(error) : resolve(response),
      );
  });

export async function verifyBoardAccessRealtime(ctx) {
  const {
    app,
    send,
    source,
    tokens,
    actors,
    access: { board, team, card },
  } = ctx;
  const root = `/api/boards/${board.id}`;
  const sockets = [];
  await app.listen(0, '127.0.0.1');
  const coordinator = app.get(BoardRoomCoordinator);
  const authorization = app.get(BoardAuthorizationService);
  const broadcast = app.get(RealtimeBroadcastService);
  const connect = async (actor, token = tokens[actor]) => {
    const socket = io(await app.getUrl(), {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      auth: { accessToken: token },
    });
    sockets.push(socket);
    const connected = next(socket, 'connect');
    socket.connect();
    await connected;
    return socket;
  };
  const join = (socket) => ack(socket, 'board:join', { boardId: board.id });
  const change = (visibility) =>
    send('admin', 'patch', `${root}/visibility`)
      .send({ visibility })
      .expect(200);
  try {
    await change('WORKSPACE_VISIBLE');
    const owner = await connect('admin');
    const first = await connect('member');
    const second = await connect('member');
    const explicit = await connect('google');
    const guest = await connect('guest');
    const outside = await connect('outsider');
    for (const socket of [owner, first, second, explicit, guest])
      assert.equal((await join(socket)).success, true);
    assert.equal((await join(outside)).code, 'NOT_FOUND');
    assert.deepEqual(
      coordinator.presence.snapshot(board.id).userIds,
      [actors.admin, actors.member, actors.google, actors.guest].sort(),
    );
    // Every current business event is server-only. Forged commands receive denial ACKs.
    for (const event of [
      'column:created',
      'column:updated',
      'column:moved',
      'column:deleted',
      'card:created',
      'card:updated',
      'card:moved',
      'card:archived',
      'card:restored',
      'card:assignees-changed',
      'comment:created',
      'comment:updated',
      'comment:deleted',
      'member:added',
      'member:removed',
      'member:role-changed',
      'board:archived',
      'board:restored',
      'board:access-changed',
    ]) {
      assert.equal(
        (await ack(first, event, { boardId: board.id, cardId: card.id }))
          .success,
        false,
      );
    }
    const deniedEvents = [];
    for (const socket of [first, second]) {
      socket.on('presence:sync', () => deniedEvents.push('presence'));
      socket.on('card:updated', () => deniedEvents.push('card'));
    }
    const revoked = [
      next(first, 'board:access-revoked'),
      next(second, 'board:access-revoked'),
    ];
    await change('PRIVATE');
    await Promise.all(revoked);
    const count = deniedEvents.length;
    await broadcast.emitToBoard(board.id, 'card:updated', {
      boardId: board.id,
      cardId: card.id,
      columnId: ctx.access.column.id,
    });
    coordinator.syncPresence(board.id);
    await delay(50);
    assert.equal(deniedEvents.length, count);
    for (const socket of [first, second]) {
      assert.equal((await join(socket)).code, 'NOT_FOUND');
      assert(
        !coordinator.server.sockets.sockets
          .get(socket.id)
          .data.authorizedBoardIds.has(board.id),
      );
      assert(
        !coordinator.server.sockets.sockets
          .get(socket.id)
          .rooms.has(`board:${board.id}`),
      );
    }
    assert(
      !coordinator.presence.snapshot(board.id).userIds.includes(actors.member),
    );
    assert.equal((await join(guest)).success, true);
    await change('WORKSPACE_VISIBLE');
    assert.equal((await join(first)).success, true);
    assert.equal((await join(second)).success, true);
    const workspaceLost = next(first, 'workspace:access-revoked');
    const lostTabs = [
      next(first, 'board:access-revoked'),
      next(second, 'board:access-revoked'),
    ];
    await send(
      'admin',
      'delete',
      `/api/workspaces/${team.id}/members/${actors.member}`,
    ).expect(204);
    await workspaceLost;
    await Promise.all(lostTabs);
    await send('member', 'get', root).expect(404);
    first.disconnect();
    const reconnected = await connect('member');
    assert.equal((await join(reconnected)).code, 'NOT_FOUND');
    // Departure cannot remove a separate Board grant, including the Guest deep link.
    await send('google', 'post', `/api/workspaces/${team.id}/leave`).expect(
      204,
    );
    await send('google', 'get', root).expect(200);
    await send('google', 'get', `/api/workspaces/${team.id}`).expect(404);
    assert.equal((await join(explicit)).success, true);
    await send('google', 'patch', `${root}/cards/${card.id}`)
      .send({ title: 'Still a collaborator' })
      .expect(200);
    // Board removal can reduce a collaborator to a Workspace-derived read-only user.
    await source.query(
      `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
      [team.id, actors.google],
    );
    const changed = next(explicit, 'member:removed');
    await send('admin', 'delete', `${root}/members/${actors.google}`).expect(
      204,
    );
    assert.equal((await changed).retainsReadAccess, true);
    const dto = (await send('google', 'get', root).expect(200)).body.data;
    assert.equal(dto.currentUserRole, null);
    assert.equal(dto.capabilities.canWriteBoard, false);
    assert.equal((await join(explicit)).success, true);
    await send('google', 'patch', `${root}/cards/${card.id}`)
      .send({ title: 'Denied' })
      .expect(404);
    // A join authorized before narrowing must finish before revocation, then lose access.
    const entered = deferred(),
      release = deferred();
    const original = authorization.requireRead.bind(authorization);
    authorization.requireRead = async (userId, boardId) => {
      const result = await original(userId, boardId);
      if (userId === actors.admin2 && boardId === board.id) {
        entered.resolve();
        await release.promise;
      }
      return result;
    };
    try {
      const racing = await connect('admin2');
      const joining = join(racing);
      await entered.promise;
      const revoke = next(racing, 'board:access-revoked');
      const narrowing = change('PRIVATE').then((result) => result);
      release.resolve();
      assert.equal((await joining).success, true);
      await narrowing;
      await revoke;
      assert(
        !coordinator.server.sockets.sockets
          .get(racing.id)
          .data.authorizedBoardIds.has(board.id),
      );
    } finally {
      authorization.requireRead = original;
      release.resolve();
    }
    await send('guest', 'get', root).expect(200);
    // Concurrent visibility writes leave the last serialized committed value authoritative.
    await Promise.all([change('WORKSPACE_VISIBLE'), change('PRIVATE')]);
    const [persisted] = await source.query(
      'SELECT visibility FROM boards WHERE id = $1',
      [board.id],
    );
    assert.equal(
      (await send('admin', 'get', root).expect(200)).body.data.visibility,
      persisted.visibility,
    );
    assert.equal(
      await authorization.canReadBoard(actors.admin2, board.id),
      persisted.visibility === 'WORKSPACE_VISIBLE',
    );
  } finally {
    for (const socket of sockets) socket.disconnect();
  }
}
