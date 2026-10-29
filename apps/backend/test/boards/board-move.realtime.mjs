import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout, clearTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';

const require = createRequire(import.meta.url);
const { io } = createRequire(
  new URL('../../../frontend/package.json', import.meta.url),
)('socket.io-client');
const {
  BoardRoomCoordinator,
} = require('../../dist/realtime/board-room-coordinator.service.js');
const {
  RealtimeBroadcastService,
} = require('../../dist/realtime/realtime-broadcast.service.js');

const next = (socket, event) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Missing ${event}`)), 6000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
const join = (socket, boardId) =>
  new Promise((resolve, reject) => {
    socket
      .timeout(6000)
      .emit('board:join', { boardId }, (error, result) =>
        error ? reject(error) : resolve(result),
      );
  });

export async function verifyMoveRealtime({
  app,
  send,
  source,
  tokens,
  actors,
}) {
  const origin = (
    await send('admin', 'post', '/api/workspaces')
      .send({ name: 'Realtime move origin' })
      .expect(201)
  ).body.data;
  const destination = (
    await send('admin', 'post', '/api/workspaces')
      .send({ name: 'Realtime move target' })
      .expect(201)
  ).body.data;
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER'),($1,$3,'MEMBER'),($4,$5,'MEMBER')`,
    [origin.id, actors.member, actors.google, destination.id, actors.admin2],
  );
  const board = (
    await send('admin', 'post', '/api/boards')
      .send({ name: 'Realtime protected board', workspaceId: origin.id })
      .expect(201)
  ).body.data;
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [board.id, actors.guest],
  );
  await send('admin', 'patch', `/api/boards/${board.id}/visibility`)
    .send({ visibility: 'WORKSPACE_VISIBLE' })
    .expect(200);
  const sockets = [];
  const connect = async (actor) => {
    const socket = io(await app.getUrl(), {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      auth: { accessToken: tokens[actor] },
    });
    sockets.push(socket);
    const connected = next(socket, 'connect');
    socket.connect();
    await connected;
    return socket;
  };
  const coordinator = app.get(BoardRoomCoordinator);
  const broadcast = app.get(RealtimeBroadcastService);
  try {
    const owner = await connect('admin');
    const viewer = await connect('member');
    const guest = await connect('guest');
    const workspaceViewer = await connect('google');
    const destinationViewer = await connect('admin2');
    const outsider = await connect('outsider');
    for (const socket of [owner, viewer, guest])
      assert.equal((await join(socket, board.id)).success, true);
    assert.equal((await join(outsider, board.id)).code, 'NOT_FOUND');
    const revoked = next(viewer, 'board:access-revoked');
    const invalidated = next(workspaceViewer, 'access:changed');
    const destinationInvalidated = next(destinationViewer, 'access:changed');
    const guestEvent = next(guest, 'board:access-changed');
    let outsiderInvalidations = 0;
    let viewerUpdates = 0;
    outsider.on('access:changed', () => outsiderInvalidations++);
    viewer.on('card:updated', () => viewerUpdates++);
    await send('admin', 'post', `/api/boards/${board.id}/move-workspace`)
      .send({ destinationWorkspaceId: destination.id })
      .expect(200);
    assert.equal((await revoked).boardId, board.id);
    assert.equal(await invalidated, undefined);
    assert.equal(await destinationInvalidated, undefined);
    assert.equal((await guestEvent).boardId, board.id);
    const guestUpdate = next(guest, 'card:updated');
    const cardId = '01234567-89ab-4cde-8fab-0123456789ab';
    await broadcast.emitToBoard(board.id, 'card:updated', {
      boardId: board.id,
      cardId,
      columnId: cardId,
    });
    await guestUpdate;
    await delay(100);
    assert.equal(viewerUpdates, 0);
    assert.equal(outsiderInvalidations, 0);
    assert.equal((await join(viewer, board.id)).code, 'NOT_FOUND');
    assert.equal((await join(guest, board.id)).success, true);
    assert(
      !coordinator.presence.snapshot(board.id).userIds.includes(actors.member),
    );
    assert(
      coordinator.presence.snapshot(board.id).userIds.includes(actors.guest),
    );
    await send('member', 'get', `/api/boards/${board.id}`).expect(404);
    await send('guest', 'get', `/api/boards/${board.id}`).expect(200);
  } finally {
    for (const socket of sockets) socket.disconnect();
  }
}
