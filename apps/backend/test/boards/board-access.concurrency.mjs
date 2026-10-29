import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { URL } from 'node:url';

export async function verifyWorkspaceSnapshotRace(ctx) {
  const require = createRequire(import.meta.url);
  const { DataSource } = require('typeorm');
  const { Board } = require('../../dist/api/boards/entities/board.entity.js');
  const {
    BoardRoomCoordinator,
  } = require('../../dist/realtime/board-room-coordinator.service.js');
  const { io } = createRequire(
    new URL('../../../frontend/package.json', import.meta.url),
  )('socket.io-client');
  const {
    source,
    app,
    send,
    actors,
    tokens,
    access: { team },
  } = ctx;
  const coordinator = app.get(BoardRoomCoordinator);
  const boards = app.get(DataSource).getRepository(Board);
  const find = boards.find.bind(boards);
  let snapshotReady, resumeSnapshot;
  const ready = new Promise((resolve) => {
    snapshotReady = resolve;
  });
  const resume = new Promise((resolve) => {
    resumeSnapshot = resolve;
  });
  boards.find = async (options) => {
    const result = await find(options);
    if (options?.select?.id && options.where.workspaceId === team.id) {
      snapshotReady();
      await resume;
    }
    return result;
  };
  let removing, joining, socket, board;
  try {
    removing = send(
      'admin',
      'delete',
      `/api/workspaces/${team.id}/members/${actors.admin2}`,
    ).then((response) => response);
    await Promise.race([
      ready,
      delay(6000, undefined, { ref: false }).then(() =>
        assert.fail('Workspace snapshot not reached'),
      ),
    ]);
    board = (
      await send('admin', 'post', '/api/boards')
        .send({ name: 'Created during removal snapshot', workspaceId: team.id })
        .expect(201)
    ).body.data;
    await send('admin', 'patch', `/api/boards/${board.id}/visibility`)
      .send({ visibility: 'WORKSPACE_VISIBLE' })
      .expect(200);
    socket = io(await app.getUrl(), {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      auth: { accessToken: tokens.admin2 },
    });
    const connected = new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    socket.connect();
    await connected;
    const serverSocket = coordinator.server.sockets.sockets.get(socket.id);
    const received = new Promise((resolve) =>
      serverSocket.once('board:join', resolve),
    );
    const removalFence = coordinator.pending.get('workspace-read-grants');
    joining = socket
      .timeout(6000)
      .emitWithAck('board:join', { boardId: board.id });
    await received;
    for (
      let attempt = 0;
      attempt < 500 &&
      coordinator.pending.get('workspace-read-grants') === removalFence;
      attempt++
    )
      await delay(10);
    assert.ok(
      coordinator.pending.get('workspace-read-grants') !== removalFence,
      'The new Board join must queue behind the Workspace removal snapshot',
    );
    resumeSnapshot();
    assert.equal((await removing).status, 204);
    assert.equal((await joining).code, 'NOT_FOUND');
    assert(!serverSocket.data.authorizedBoardIds?.has(board.id));
    await send('admin2', 'get', `/api/boards/${board.id}`).expect(404);
  } finally {
    boards.find = find;
    resumeSnapshot();
    await Promise.allSettled([removing, joining].filter(Boolean));
    socket?.disconnect();
    if (board)
      await send('admin', 'patch', `/api/boards/${board.id}/visibility`)
        .send({ visibility: 'PRIVATE' })
        .expect(200);
    await source.query(
      `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN') ON CONFLICT DO NOTHING`,
      [team.id, actors.admin2],
    );
  }
}

export async function verifyBoardMemberWriteRace(ctx) {
  const {
    source,
    send,
    actors,
    access: { board, card },
  } = ctx;
  const root = `/api/boards/${board.id}`;
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [board.id, actors.google],
  );
  const runner = source.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  let removing, writing;
  const waitForBlocked = async (minimum) => {
    for (let attempt = 0; attempt < 500; attempt++) {
      const [row] =
        await source.query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0`);
      if (row.n >= minimum) return;
      await delay(10);
    }
    assert.fail('Requests did not reach their PostgreSQL Board locks');
  };
  try {
    await runner.query('SELECT id FROM boards WHERE id = $1 FOR UPDATE', [
      board.id,
    ]);
    removing = send('admin', 'delete', `${root}/members/${actors.google}`).then(
      (response) => response,
    );
    await waitForBlocked(1);
    writing = send('google', 'patch', `${root}/cards/${card.id}`)
      .send({ title: 'Must never commit' })
      .then((response) => response);
    await waitForBlocked(2);
    await runner.commitTransaction();
    assert.equal((await removing).status, 204);
    assert.equal((await writing).status, 404);
    const [persisted] = await source.query(
      'SELECT title FROM cards WHERE id = $1',
      [card.id],
    );
    assert.notEqual(persisted.title, 'Must never commit');
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await Promise.allSettled([removing, writing].filter(Boolean));
    await runner.release();
  }
}
