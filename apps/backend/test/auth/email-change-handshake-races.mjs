import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { URL } from 'node:url';

const require = createRequire(import.meta.url);
const { io } = createRequire(
  new URL('../../../frontend/package.json', import.meta.url),
)('socket.io-client');
const {
  BoardRoomCoordinator,
} = require('../../dist/realtime/board-room-coordinator.service.js');
const {
  BoardRoomService,
} = require('../../dist/realtime/board-room.service.js');
const {
  RealtimeBroadcastService,
} = require('../../dist/realtime/realtime-broadcast.service.js');
const { RealtimePresenceEvent } = require('@kanban/shared');

/** Real JWT/database lookup, real email confirmation and real Socket.IO middleware. */
export async function verifyEmailChangeHandshakeRaces(ctx) {
  const {
    source,
    app,
    auth,
    changes,
    factory,
    session,
    issue,
    tokenFor,
    eventually,
    pass,
  } = ctx;
  const coordinator = app.get(BoardRoomCoordinator),
    rooms = app.get(BoardRoomService),
    broadcast = app.get(RealtimeBroadcastService);
  const url = await app.getUrl();
  for (const phase of ['lookup', 'authenticated']) {
    const actor = await factory(),
      target = `handshake-${phase}@email-change.test`;
    const current = await issue(actor, target),
      proof = tokenFor(target);
    const [workspace] = await source.query(
      "INSERT INTO workspaces(type,name,created_by_id) VALUES ('TEAM','Handshake fixture',$1) RETURNING id",
      [actor.id],
    );
    const [board] = await source.query(
      "INSERT INTO boards(name,created_by_id,workspace_id) VALUES ('Handshake fixture',$1,$2) RETURNING id",
      [actor.id, workspace.id],
    );
    await source.query(
      "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')",
      [board.id, actor.id],
    );
    let release,
      reached = false,
      captured;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const original = auth.authenticateAccessToken;
    auth.authenticateAccessToken = async function (token, ...args) {
      const identity = await original.call(this, token, ...args);
      if (token === current.jwt && phase === 'lookup') {
        assert.equal(identity.authVersion, 0);
        reached = true;
        await gate;
      }
      return identity;
    };
    // The second phase pauses AFTER our authentication middleware has completed,
    // before Socket.IO publishes the socket in namespace.sockets.
    coordinator.server.use((socket, next) => {
      if (
        phase === 'authenticated' &&
        socket.data.identity?.userId === actor.id &&
        socket.data.identity.authVersion === 0
      ) {
        captured = socket;
        reached = true;
        void gate.then(() => next());
      } else next();
    });
    const stale = io(url, {
      autoConnect: false,
      transports: ['websocket'],
      reconnection: false,
      auth: { accessToken: current.jwt },
    });
    const received = [];
    let connected = false,
      outcome,
      fresh;
    stale.on('connect', () => {
      connected = true;
      stale.emit('board:join', { boardId: board.id }, () => undefined);
    });
    stale.on('board:archived', (value) => received.push(value));
    stale.on(RealtimePresenceEvent.SYNC, (value) => received.push(value));
    stale.on('connect_error', (error) => {
      outcome = { kind: 'error', error };
    });
    stale.on('disconnect', () => {
      outcome = { kind: 'disconnect' };
    });
    try {
      stale.connect();
      await eventually(() => reached, `reach ${phase} handshake barrier`);
      assert.equal(
        [...coordinator.server.sockets.sockets.values()].some(
          (socket) => socket.data.identity?.userId === actor.id,
        ),
        false,
      );
      // Commit and scan while the old authenticated socket is absent.
      await changes.confirm(current.identity, proof);
      assert.equal(
        (
          await source.query('SELECT auth_version FROM users WHERE id=$1', [
            actor.id,
          ])
        )[0].auth_version,
        1,
      );
      release();
      await eventually(
        () => outcome !== undefined,
        `reject ${phase} stale handshake`,
      );
      if (phase === 'lookup') {
        assert.equal(connected, false);
        assert.equal(outcome.kind, 'error');
        assert.equal(outcome.error.data.code, 'UNAUTHORIZED');
      } else {
        assert.equal(outcome.kind, 'disconnect');
        assert.equal(
          (await rooms.join(captured, { boardId: board.id })).code,
          'UNAUTHORIZED',
        );
        assert.equal(
          captured.data.authorizedBoardIds?.has(board.id) ?? false,
          false,
        );
      }
      assert.deepEqual(received, []);
      const freshSession = await session(actor),
        snapshots = [],
        events = [];
      fresh = io(url, {
        autoConnect: false,
        transports: ['websocket'],
        reconnection: false,
        auth: { accessToken: freshSession.jwt },
      });
      fresh.on(RealtimePresenceEvent.SYNC, (value) => snapshots.push(value));
      fresh.on('board:archived', (value) => events.push(value));
      fresh.connect();
      await eventually(
        () => fresh.connected,
        'current-version socket connects',
      );
      const ack = await fresh
        .timeout(5000)
        .emitWithAck('board:join', { boardId: board.id });
      assert.equal(ack.success, true);
      await broadcast.emitToBoard(board.id, 'board:archived', {
        boardId: board.id,
      });
      await eventually(
        () => events.length === 1 && snapshots.length > 0,
        'fresh Board event and presence delivery',
      );
      assert.deepEqual(snapshots.at(-1).userIds, [actor.id]);
      assert.deepEqual(received, []);
      await coordinator.run(board.id, () => coordinator.syncPresence(board.id));
      assert.equal(
        [...coordinator.server.sockets.sockets.values()].filter(
          (socket) => socket.data.identity?.userId === actor.id,
        ).length,
        1,
      );
    } finally {
      release();
      auth.authenticateAccessToken = original;
      stale.disconnect();
      fresh?.disconnect();
    }
    pass(
      `post-commit revocation fences in-flight ${phase} completion; no stale Board join/event/presence and fresh version remains valid`,
    );
  }
}
