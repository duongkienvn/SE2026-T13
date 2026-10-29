import assert from 'node:assert/strict';
import console from 'node:console';
import { createRequire } from 'node:module';
import { setTimeout, clearTimeout } from 'node:timers';
import { URL } from 'node:url';
import { ids } from '../realtime-checks.mjs';

const require = createRequire(import.meta.url);
const { RealtimeServerEvent } = require('@kanban/shared');
const { JwtService } = require('@nestjs/jwt');
const {
  BoardRoomCoordinator,
} = require('../../../src/realtime/board-room-coordinator.service.ts');
const {
  RealtimeBroadcastService,
} = require('../../../src/realtime/realtime-broadcast.service.ts');
const {
  BOARD_ROOM_REQUEST_LIMITS,
} = require('../../../src/realtime/board-room-rate-limiter.service.ts');
const argon2 = require('argon2');
const request = require('supertest');
const { io } = createRequire(
  new URL('../../../../frontend/package.json', import.meta.url),
)('socket.io-client');
// The ACL integration suite drives access changes; this fixture covers content/member events.
const events = Object.values(RealtimeServerEvent).filter(
  (event) =>
    event !== RealtimeServerEvent.BOARD_ACCESS_CHANGED &&
    event !== RealtimeServerEvent.BOARD_ACCESS_REVOKED,
);

export async function seedBoardEvents(source) {
  const passwordHash = await argon2.hash('board-events-password');
  for (const name of ['owner', 'member', 'other', 'absent'])
    await source.getRepository('User').save({
      id: ids[name],
      email: `${name}@events.test`,
      displayName: name,
      passwordHash,
      authVersion: 0,
      emailVerifiedAt: new Date(),
      avatarUrl: null,
    });
  for (const [id, creator, archived] of [
    [ids.a, ids.owner, false],
    [ids.b, ids.other, false],
    [ids.archived, ids.owner, true],
  ]) {
    await source.getRepository('Board').save({
      id,
      name: 'Events',
      createdById: creator,
      isArchived: archived,
      description: null,
      archivedAt: null,
    });
  }
  for (const [boardId, userId, role] of [
    [ids.a, ids.owner, 'OWNER'],
    [ids.a, ids.member, 'MEMBER'],
    [ids.b, ids.other, 'OWNER'],
    [ids.b, ids.owner, 'MEMBER'],
    [ids.b, ids.member, 'MEMBER'],
    [ids.archived, ids.owner, 'OWNER'],
  ])
    await source.getRepository('BoardMember').save({ boardId, userId, role });
}

export function nextBoardEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const done = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      socket.off(event, done);
      reject(new Error(`Timeout: ${event}`));
    }, 5000);
    socket.once(event, done);
  });
}

export async function runBoardEventChecks(app, source) {
  const base = await app.getUrl();
  const clients = [],
    received = new Map(),
    tokens = {},
    seen = new Set();
  let checks = 0;
  const pass = (name) => {
    checks++;
    console.log(`PASS: ${name}`);
  };
  const coordinator = app.get(BoardRoomCoordinator);
  const broadcast = app.get(RealtimeBroadcastService);
  const ack = (socket, event, boardId) =>
    socket.timeout(4000).emitWithAck(event, { boardId });
  const join = async (socket, boardId) =>
    assert.deepEqual(await ack(socket, 'board:join', boardId), {
      success: true,
      boardId,
    });
  const flush = async () =>
    Promise.all(
      clients
        .filter((s) => s.connected)
        .map((s) =>
          ack(s, 'board:leave', ids.empty).then((ack) =>
            assert.equal(ack.success, true),
          ),
        ),
    );
  const connect = async (token) => {
    const socket = io(base, {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      auth: { accessToken: token },
    });
    clients.push(socket);
    received.set(socket, []);
    socket.onAny((event, payload) => {
      if (events.includes(event)) received.get(socket).push([event, payload]);
    });
    const ready = nextBoardEvent(socket, 'connect');
    socket.connect();
    await ready;
    return socket;
  };
  const http = (method, path, body, status = 200, token = tokens.owner) => {
    const agent = request(app.getHttpServer());
    const req = agent[method](`/api/boards/${path}`).auth(token, {
      type: 'bearer',
    });
    return (body === undefined ? req : req.send(body)).expect(status);
  };
  let recipients;
  const mutation = async (event, method, path, body, status, expected) => {
    const before = new Map(clients.map((s) => [s, received.get(s).length]));
    const pending = recipients.map((s) => nextBoardEvent(s, event));
    const response = await http(method, path, body, status);
    const payload =
      typeof expected === 'function' ? expected(response.body.data) : expected;
    const payloads = await Promise.all(pending);
    for (const value of payloads) assert.deepEqual(value, payload);
    await flush();
    for (const socket of clients)
      assert.deepEqual(
        received.get(socket).slice(before.get(socket)),
        recipients.includes(socket) ? [[event, payload]] : [],
      );
    seen.add(event);
    return response.body.data;
  };
  const silent = async (operation) => {
    const before = clients.map((s) => received.get(s).length);
    await operation();
    await flush();
    assert.deepEqual(
      clients.map((s) => received.get(s).length),
      before,
    );
  };

  try {
    for (const name of ['owner', 'member', 'other', 'absent']) {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: `${name}@events.test`,
          password: 'board-events-password',
        })
        .expect(200);
      tokens[name] = login.body.data.accessToken;
    }
    let owner = await connect(tokens.owner),
      member = await connect(tokens.member),
      tab = await connect(tokens.member);
    let other = await connect(tokens.other),
      unjoined = await connect(tokens.owner),
      outsider = await connect(tokens.other);
    await join(owner, ids.a);
    await join(member, ids.a);
    await join(tab, ids.a);
    await join(member, ids.b);
    await join(other, ids.b);
    assert.equal((await ack(outsider, 'board:join', ids.a)).code, 'NOT_FOUND');
    recipients = [owner, member, tab];
    pass(
      'authorized owner/member/multiple tabs join; other-board and unjoined clients isolated',
    );

    const columnPayload = (value) => ({ boardId: ids.a, columnId: value.id });
    const cardPayload = (value) => ({
      boardId: ids.a,
      cardId: value.id,
      columnId: value.columnId,
    });
    const c1 = await mutation(
      'column:created',
      'post',
      `${ids.a}/columns`,
      { name: 'Private Todo' },
      201,
      columnPayload,
    );
    const c2 = await mutation(
      'column:created',
      'post',
      `${ids.a}/columns`,
      { name: 'Done' },
      201,
      columnPayload,
    );
    await mutation(
      'column:updated',
      'patch',
      `${ids.a}/columns/${c1.id}`,
      { name: 'Renamed' },
      200,
      columnPayload,
    );
    await mutation(
      'column:moved',
      'patch',
      `${ids.a}/columns/${c1.id}/move`,
      { beforeColumnId: null },
      200,
      columnPayload,
    );
    await mutation(
      'column:deleted',
      'delete',
      `${ids.a}/columns/${c2.id}`,
      undefined,
      204,
      { boardId: ids.a, columnId: c2.id },
    );
    assert.equal(
      await source
        .getRepository('BoardColumn')
        .findOne({ where: { id: c2.id } }),
      null,
    );
    const c3 = await mutation(
      'column:created',
      'post',
      `${ids.a}/columns`,
      { name: 'Destination' },
      201,
      columnPayload,
    );
    pass(
      'all four Column events are exact minimal payloads after successful REST writes',
    );

    const card = await mutation(
      'card:created',
      'post',
      `${ids.a}/cards`,
      { columnId: c1.id, title: 'Private title', description: 'Private body' },
      201,
      cardPayload,
    );
    await mutation(
      'card:updated',
      'patch',
      `${ids.a}/cards/${card.id}`,
      { title: 'Changed' },
      200,
      cardPayload,
    );
    assert.equal(
      (await source.getRepository('Card').findOne({ where: { id: card.id } }))
        .title,
      'Changed',
    );
    const assignmentPayload = {
      boardId: ids.a,
      cardId: card.id,
      columnId: c1.id,
    };
    await mutation(
      'card:assignees-changed',
      'post',
      `${ids.a}/cards/${card.id}/assignees`,
      { userId: ids.member },
      201,
      assignmentPayload,
    );
    await silent(() =>
      http(
        'post',
        `${ids.a}/cards/${card.id}/assignees`,
        { userId: ids.member },
        409,
      ),
    );
    await mutation(
      'card:assignees-changed',
      'delete',
      `${ids.a}/cards/${card.id}/assignees/${ids.member}`,
      undefined,
      204,
      assignmentPayload,
    );
    await mutation(
      'card:moved',
      'patch',
      `${ids.a}/cards/${card.id}/move`,
      { toColumnId: c3.id, beforeCardId: null },
      200,
      {
        boardId: ids.a,
        cardId: card.id,
        fromColumnId: c1.id,
        toColumnId: c3.id,
      },
    );
    assert.equal(
      (await source.getRepository('Card').findOne({ where: { id: card.id } }))
        .columnId,
      c3.id,
    );
    const commentPath = `${ids.a}/cards/${card.id}/comments`;
    const commentPayload = (value) => ({
      boardId: ids.a,
      cardId: card.id,
      commentId: value.id,
    });
    const comment = await mutation(
      'comment:created',
      'post',
      commentPath,
      { content: 'Private comment' },
      201,
      commentPayload,
    );
    await mutation(
      'comment:updated',
      'patch',
      `${commentPath}/${comment.id}`,
      { content: 'Updated comment' },
      200,
      commentPayload,
    );
    await silent(async () => {
      await http('patch', `${commentPath}/${comment.id}`, {
        content: 'Updated comment',
      });
      await http(
        'patch',
        `${commentPath}/${comment.id}`,
        { content: 'Denied' },
        403,
        tokens.member,
      );
    });
    await mutation(
      'comment:deleted',
      'delete',
      `${commentPath}/${comment.id}`,
      undefined,
      204,
      { boardId: ids.a, cardId: card.id, commentId: comment.id },
    );
    assert.ok(
      (
        await source.getRepository('Comment').findOne({
          where: { id: comment.id },
          withDeleted: true,
        })
      ).deletedAt,
    );
    for (const socket of clients) socket.close();
    owner = await connect(tokens.owner);
    member = await connect(tokens.member);
    tab = await connect(tokens.member);
    other = await connect(tokens.other);
    unjoined = await connect(tokens.owner);
    outsider = await connect(tokens.other);
    await join(owner, ids.a);
    await join(member, ids.a);
    await join(tab, ids.a);
    await join(member, ids.b);
    await join(other, ids.b);
    recipients = [owner, member, tab];
    await silent(async () => {
      await http('patch', `${ids.a}/cards/${card.id}`, { title: 'Changed' });
      await http(
        'patch',
        `${ids.a}/cards/${card.id}/move`,
        { toColumnId: c3.id, beforeCardId: card.id },
        400,
      );
      await http(
        'patch',
        `${ids.a}/columns/${c1.id}/move`,
        { beforeColumnId: c1.id },
        400,
      );
      await http(
        'delete',
        `${ids.a}/cards/${card.id}/assignees/${ids.member}`,
        undefined,
        404,
      );
      await http(
        'post',
        `${ids.a}/members`,
        { email: 'member@events.test' },
        409,
      );
      await http('patch', `${ids.a}/cards/${card.id}/move`, {
        toColumnId: c3.id,
        beforeCardId: null,
      });
      await http('patch', `${ids.a}/columns/${c1.id}`, { name: 'Renamed' });
      await http('patch', `${ids.a}/columns/${c3.id}/move`, {
        beforeColumnId: null,
      });
    });
    await mutation(
      'card:archived',
      'post',
      `${ids.a}/cards/${card.id}/archive`,
      undefined,
      200,
      cardPayload,
    );
    assert.equal(
      (await source.getRepository('Card').findOne({ where: { id: card.id } }))
        .isArchived,
      true,
    );
    await mutation(
      'card:restored',
      'post',
      `${ids.a}/cards/${card.id}/restore`,
      undefined,
      200,
      cardPayload,
    );
    assert.equal(
      (await source.getRepository('Card').findOne({ where: { id: card.id } }))
        .isArchived,
      false,
    );
    await silent(() =>
      http('post', `${ids.a}/cards/${card.id}/restore`, undefined, 409),
    );
    await mutation(
      'card:archived',
      'post',
      `${ids.a}/cards/${card.id}/archive`,
      undefined,
      200,
      cardPayload,
    );
    pass(
      'all six Card events, both assignment operations, persisted move source and no-op suppression',
    );
    pass(
      'all three Comment events are ID-only, isolated and suppress no-ops and denied writes',
    );

    await silent(async () => {
      await http(
        'patch',
        `${ids.a}/cards/${card.id}`,
        { title: 'Denied' },
        409,
      );
      await http('post', `${ids.archived}/columns`, { name: 'Denied' }, 409);
      await http('delete', `${ids.a}/columns/${c3.id}`, undefined, 409);
      await http('post', `${ids.a}/columns`, { name: '' }, 400);
      await http(
        'post',
        `${ids.a}/columns`,
        { name: 'Denied' },
        404,
        tokens.other,
      );
      await http(
        'post',
        `${ids.a}/members`,
        { email: 'absent@events.test' },
        403,
        tokens.member,
      );
      await http('post', commentPath, { content: 'Archived' }, 409);
      for (const event of events)
        outsider.emit(event, {
          boardId: ids.a,
          cardId: card.id,
          title: 'Spoofed',
        });
      await ack(outsider, 'board:leave', ids.empty);
    });
    assert.equal(
      (await source.getRepository('Card').findOne({ where: { id: card.id } }))
        .title,
      'Changed',
    );
    pass(
      'validation, authorization, archive and duplicate failures emit nothing; inbound business spoofing ignored',
    );

    const added = await connect(tokens.absent); // adding membership does not grant a room
    await mutation(
      'member:added',
      'post',
      `${ids.a}/members`,
      { email: 'absent@events.test' },
      201,
      { boardId: ids.a, userId: ids.absent },
    );
    await mutation(
      'member:role-changed',
      'patch',
      `${ids.a}/members/${ids.absent}`,
      { role: 'OWNER' },
      200,
      { boardId: ids.a, userId: ids.absent },
    );
    await silent(() =>
      http('patch', `${ids.a}/members/${ids.absent}`, { role: 'OWNER' }),
    );
    assert.deepEqual(received.get(added), []);
    pass(
      'membership events target the changed user; add never auto-joins a socket; unchanged role is silent',
    );

    for (const socket of clients) socket.close();
    owner = await connect(tokens.owner);
    member = await connect(tokens.member);
    tab = await connect(tokens.member);
    other = await connect(tokens.other);
    unjoined = await connect(tokens.owner);
    outsider = await connect(tokens.other);
    await join(owner, ids.a);
    await join(member, ids.a);
    await join(tab, ids.a);
    await join(member, ids.b);
    await join(other, ids.b);
    recipients = [owner, member, tab];
    await new Promise((resolve) =>
      setTimeout(resolve, BOARD_ROOM_REQUEST_LIMITS.windowMs),
    );

    const jwt = app.get(JwtService);
    const expired = io(base, {
      autoConnect: false,
      reconnection: false,
      transports: ['websocket'],
      auth: {
        accessToken: await jwt.signAsync({ sub: ids.owner }, { expiresIn: -1 }),
      },
    });
    clients.push(expired);
    received.set(expired, []);
    const denied = nextBoardEvent(expired, 'connect_error');
    expired.connect();
    assert.equal((await denied).data.code, 'UNAUTHORIZED');
    expired.close();
    const serverSockets = [member, tab].map((s) =>
      coordinator.server.sockets.sockets.get(s.id),
    );
    const restore = serverSockets.map((s) => ({
      socket: s,
      leave: s.leave,
      disconnect: s.disconnect,
    }));
    for (const { socket: s, leave } of restore) {
      s.leave = async (room) => {
        if (room === `board:${ids.a}`)
          throw new Error('injected adapter leave failure');
        return leave.call(s, room);
      };
      s.disconnect = () => {
        throw new Error('injected disconnect failure');
      };
    }
    recipients = [owner, member, tab];
    let activeCard;
    try {
      await mutation(
        'member:removed',
        'delete',
        `${ids.a}/members/${ids.member.toUpperCase()}`,
        undefined,
        204,
        { boardId: ids.a, userId: ids.member },
      );
      recipients = [owner];
      for (const s of serverSockets) {
        assert.equal(s.data.authorizedBoardIds.has(ids.a), false);
        assert.equal(s.rooms.has(`board:${ids.a}`), true); // deliberately stale physical room
      }
      await mutation(
        'column:updated',
        'patch',
        `${ids.a}/columns/${c1.id}`,
        { name: 'After revoke' },
        200,
        columnPayload,
      );
      activeCard = await mutation(
        'card:created',
        'post',
        `${ids.a}/cards`,
        { columnId: c1.id, title: 'After revoke' },
        201,
        cardPayload,
      );
      await mutation(
        'comment:created',
        'post',
        `${ids.a}/cards/${activeCard.id}/comments`,
        { content: 'After revoke' },
        201,
        (value) => ({
          boardId: ids.a,
          cardId: activeCard.id,
          commentId: value.id,
        }),
      );
      assert.equal((await ack(member, 'board:join', ids.a)).code, 'NOT_FOUND');
      const reconnect = await connect(tokens.member);
      assert.equal(
        (await ack(reconnect, 'board:join', ids.a)).code,
        'NOT_FOUND',
      );
      const before = received.get(tab).length;
      const bEvent = nextBoardEvent(member, 'column:created');
      const bOwnerEvent = nextBoardEvent(other, 'column:created');
      const bColumn = await http(
        'post',
        `${ids.b}/columns`,
        { name: 'Other board' },
        201,
        tokens.other,
      );
      const expected = { boardId: ids.b, columnId: bColumn.body.data.id };
      assert.deepEqual(await bEvent, expected);
      assert.deepEqual(await bOwnerEvent, expected);
      await flush();
      assert.equal(received.get(tab).length, before);
    } finally {
      for (const { socket, leave, disconnect } of restore) {
        socket.leave = leave;
        socket.disconnect = disconnect;
      }
    }
    pass(
      'remove commits then revokes every tab before emission, including double transport failure; other-board grant survives',
    );

    await mutation(
      'board:archived',
      'post',
      `${ids.a}/archive`,
      undefined,
      200,
      { boardId: ids.a },
    );
    await silent(() => http('post', `${ids.a}/archive`, undefined, 409));
    assert.equal(
      (await source.getRepository('Board').findOne({ where: { id: ids.a } }))
        .isArchived,
      true,
    );
    await mutation(
      'board:restored',
      'post',
      `${ids.a}/restore`,
      undefined,
      200,
      { boardId: ids.a },
    );
    await silent(() => http('post', `${ids.a}/restore`, undefined, 409));
    assert.equal(
      (await source.getRepository('Board').findOne({ where: { id: ids.a } }))
        .isArchived,
      false,
    );
    for (const action of ['BOARD_ARCHIVED', 'BOARD_RESTORED']) {
      const rows = await source
        .getRepository('Activity')
        .find({ where: { boardId: ids.a, actionType: action } });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].entityId, ids.a);
      assert.equal(rows[0].metadata, null);
    }
    pass(
      'archive and restore emit once after REST persistence and only to authorized board recipients',
    );

    const original = broadcast.emitToBoard;
    try {
      broadcast.emitToBoard = async () => {
        throw new Error('unexpected delivery exception');
      };
      let committedComment;
      await silent(async () => {
        const response = await http(
          'post',
          `${ids.a}/cards/${activeCard.id}/comments`,
          { content: 'Committed despite transport' },
          201,
        );
        committedComment = response.body.data;
      });
      assert.equal(
        (
          await source.getRepository('Comment').findOne({
            where: { id: committedComment.id },
          })
        ).content,
        'Committed despite transport',
      );
      await silent(() =>
        http('patch', `${ids.a}/columns/${c1.id}`, {
          name: 'Committed despite transport',
        }),
      );
      assert.equal(
        (
          await source
            .getRepository('BoardColumn')
            .findOne({ where: { id: c1.id } })
        ).name,
        'Committed despite transport',
      );
      broadcast.emitToBoard = async () => false;
      await silent(() =>
        http(
          'patch',
          `${ids.a}/cards/${activeCard.id}/comments/${committedComment.id}`,
          { content: 'Committed without transport' },
          200,
        ),
      );
      await silent(() =>
        http(
          'patch',
          `${ids.a}/cards/${card.id}`,
          { title: 'Still archived' },
          409,
        ),
      );
      await silent(() =>
        http('patch', `${ids.a}/columns/${c1.id}`, {
          name: 'Committed without transport',
        }),
      );
    } finally {
      broadcast.emitToBoard = original;
    }
    assert.deepEqual([...seen].sort(), [...events].sort());
    pass(
      'false/throwing delivery cannot change committed HTTP success; all eighteen contracts observed exactly',
    );
    void unjoined;
    return checks;
  } finally {
    for (const socket of clients) socket.close();
  }
}
