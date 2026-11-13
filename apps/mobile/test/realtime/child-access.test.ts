import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import {
  BOARD,
  CARD,
  WORKSPACE,
  integration,
  json,
  ok,
} from './integration-support.ts';
import { deferred, flush, loginResponse, USER_B } from '../auth/support.ts';

const access = {
  id: BOARD,
  workspaceId: WORKSPACE,
  isArchived: false,
  capabilities: { canReadBoard: true, canWriteBoard: true },
};
const commentPath = `/boards/${BOARD}/cards/${CARD}/comments/${WORKSPACE}`;

for (const status of [403, 404]) {
  test(`child ${status} fences only its work and verifies once without dropping valid Board access`, async () => {
    const c = await integration();
    try {
      await c.join();
      const key = [
        ...queryKeys.comments(c.identity, BOARD, CARD),
        WORKSPACE,
      ] as const;
      c.data.queryClient.setQueryData(c.cardKey, 'authorized Card');
      c.data.queryClient.setQueryData(key, 'old Comment');
      const unrelated = deferred<Response>();
      c.respond((url) =>
        url.endsWith('/unrelated')
          ? unrelated.promise
          : url.endsWith(`/comments/${WORKSPACE}`)
            ? Promise.resolve(json({}, status))
            : null,
      );
      const other = c.data.api.json('/unrelated', (value) => value, {
        identity: c.identity,
        resourceKey: c.cardKey,
      });
      const before = c.requests.length;
      await assert.rejects(
        c.data.api.json(commentPath, (value) => value, {
          identity: c.identity,
          resourceKey: key,
        }),
        { status },
      );
      assert.equal(c.data.queryClient.getQueryData(key), undefined);
      assert.equal(
        c.data.queryClient.getQueryData(c.cardKey),
        'authorized Card',
      );
      assert.equal(c.realtime.getBoardSnapshot(BOARD).status, 'live');
      assert.equal(
        c.requests.find((request) => request.url.endsWith('/unrelated'))!.init
          .signal?.aborted,
        false,
      );
      c.time.advance(50);
      await flush();
      assert.equal(
        c.requests.length,
        before + 2,
        'one child request and one Board probe',
      );
      assert.equal(c.realtime.getBoardSnapshot(BOARD).canRead, true);
      assert.equal(
        c.socket.commands.filter((command) => command.event === 'board:join')
          .length,
        1,
      );
      unrelated.resolve(ok('still authorized'));
      assert.equal(await other, 'still authorized');
      c.time.advance(1000);
      await flush();
      assert.equal(
        c.requests.length,
        before + 2,
        'the failed child is not automatically refetched',
      );
    } finally {
      c.dispose();
    }
  });
}

test('non-author Comment edit 403 preserves the Board and shares one verification across HTTP and mutation handlers', async () => {
  const c = await integration();
  try {
    await c.join();
    const key = queryKeys.comments(c.identity, BOARD, CARD);
    const comments = c.observe(key, 'comments');
    c.data.queryClient.setQueryData(c.cardKey, 'authorized');
    c.respond((url, init) =>
      url.endsWith(`/comments/${WORKSPACE}`) && init.method === 'PATCH'
        ? Promise.resolve(json({}, 403))
        : null,
    );
    const before = c.requests.length;
    await assert.rejects(
      c.data.optimistic({
        identity: c.identity,
        key,
        update: () => 'draft',
        mutation: () =>
          c.data.api.json(commentPath, (value) => value, {
            identity: c.identity,
            resourceKey: key,
            method: 'PATCH',
            body: { content: 'not the author' },
          }),
      }),
      { status: 403 },
    );
    await flush();
    c.time.advance(50);
    await flush();
    assert.equal(
      c.requests.length,
      before + 3,
      'one failed write, one comments-list refresh, one Board probe',
    );
    assert.equal(comments.getCurrentResult().status, 'success');
    assert.equal(c.data.queryClient.getQueryData(c.cardKey), 'authorized');
    assert.equal(c.realtime.getBoardSnapshot(BOARD).canWrite, true);
  } finally {
    c.dispose();
  }
});

test('a mounted deleted child stays empty without recursive probes, while Board requests continue', async () => {
  const c = await integration();
  try {
    await c.join();
    const key = [
      ...queryKeys.comments(c.identity, BOARD, CARD),
      WORKSPACE,
    ] as const;
    c.respond((url) =>
      url.endsWith('/deleted-comment') ? Promise.resolve(json({}, 404)) : null,
    );
    const observer = c.observe(key, 'deleted-comment');
    const before = c.requests.length;
    await c.data.invalidate(c.identity, [key]);
    c.time.advance(50);
    await flush();
    assert.equal(observer.getCurrentResult().data, undefined);
    assert.equal(c.requests.length, before + 2);
    c.time.advance(10_000);
    await flush();
    assert.equal(c.requests.length, before + 2);
    assert.equal(c.realtime.getBoardSnapshot(BOARD).status, 'live');
    assert.equal(
      await c.data.api.json(`/boards/${BOARD}/card`, (value) => value, {
        identity: c.identity,
        resourceKey: c.cardKey,
      }),
      1,
    );
  } finally {
    c.dispose();
  }
});

test('a child failure with no room subscriber still probes and never joins an unused room', async () => {
  const c = await integration();
  try {
    c.socket.server('connect');
    const key = queryKeys.attachments(c.identity, BOARD, CARD);
    c.respond((url) =>
      url.endsWith('/attachment') ? Promise.resolve(json({}, 404)) : null,
    );
    const before = c.requests.length;
    await assert.rejects(
      c.data.api.json('/attachment', (value) => value, {
        identity: c.identity,
        resourceKey: key,
      }),
      { status: 404 },
    );
    c.time.advance(50);
    await flush();
    assert.equal(c.requests.length, before + 2);
    assert.equal(c.socket.commands.length, 0);
    assert.equal(
      await c.data.api.json('/card', (value) => value, {
        identity: c.identity,
        resourceKey: c.cardKey,
      }),
      1,
    );
  } finally {
    c.dispose();
  }
});

test('confirmed Board loss from the verification probe blocks all protected work without recursive probes', async () => {
  const c = await integration();
  try {
    await c.join();
    c.configure({ allowed: false });
    c.respond((url) =>
      url.endsWith('/child') ? Promise.resolve(json({}, 403)) : null,
    );
    const key = queryKeys.checklists(c.identity, BOARD, CARD);
    const before = c.requests.length;
    await assert.rejects(
      c.data.api.json('/child', (value) => value, {
        identity: c.identity,
        resourceKey: key,
      }),
    );
    c.time.advance(50);
    await flush();
    assert.equal(c.realtime.getBoardSnapshot(BOARD).status, 'unavailable');
    await assert.rejects(
      c.data.api.json('/card', (value) => value, {
        identity: c.identity,
        resourceKey: c.cardKey,
      }),
      { code: 'RESOURCE_ACCESS_CHANGED' },
    );
    c.time.advance(1000);
    await flush();
    assert.equal(c.requests.length, before + 2);
  } finally {
    c.dispose();
  }
});

for (const change of ['account', 'revocation', 'dispose']) {
  test(`${change} during child access verification aborts the probe and rejects a late grant`, async () => {
    const c = await integration();
    try {
      await c.join();
      const gate = deferred<Response>();
      c.respond((url) =>
        url.endsWith('/child')
          ? Promise.resolve(json({}, 404))
          : url.endsWith(`/boards/${BOARD}`)
            ? gate.promise
            : null,
      );
      const key = queryKeys.comments(c.identity, BOARD, CARD);
      await assert.rejects(
        c.data.api.json('/child', (value) => value, {
          identity: c.identity,
          resourceKey: key,
        }),
      );
      c.time.advance(50);
      await flush();
      const request = c.requests.at(-1)!;
      if (change === 'account')
        await c.manager.establishSession(loginResponse(USER_B));
      else if (change === 'revocation')
        c.socket.server('board:access-revoked', { boardId: BOARD });
      else c.realtime.dispose();
      assert.equal(request.init.signal?.aborted, true);
      const identity = c.identity;
      const freshKey = queryKeys.notifications(identity);
      c.data.queryClient.setQueryData(freshKey, 'current');
      const before = c.requests.length;
      gate.resolve(ok(access));
      await flush();
      assert.equal(c.requests.length, before);
      assert.equal(c.data.queryClient.getQueryData(freshKey), 'current');
      assert.equal(c.realtime.getBoardSnapshot(BOARD).canRead, false);
    } finally {
      c.dispose();
    }
  });
}

test('concurrent child denials share one Board probe and fence late responses and queued edits only for those keys', async () => {
  const c = await integration();
  try {
    await c.join();
    const keys = [
      queryKeys.comments(c.identity, BOARD, CARD),
      queryKeys.checklists(c.identity, BOARD, CARD),
      queryKeys.attachments(c.identity, BOARD, CARD),
    ];
    const gate = deferred<Response>();
    const mutation = deferred<string>();
    c.respond((url) =>
      url.endsWith('/slow-child')
        ? gate.promise
        : url.endsWith('/denied-child')
          ? Promise.resolve(json({}, 404))
          : null,
    );
    const slow = c.data.api.json('/slow-child', (value) => value, {
      identity: c.identity,
      resourceKey: keys[0],
    });
    const late = assert.rejects(slow, { code: 'RESOURCE_ACCESS_CHANGED' });
    const edit = c.data.optimistic({
      identity: c.identity,
      key: keys[0]!,
      update: () => 'draft',
      mutation: () => mutation.promise,
    });
    const failedEdit = assert.rejects(edit, {
      code: 'RESOURCE_ACCESS_CHANGED',
    });
    let queuedCalls = 0;
    const queued = c.data.optimistic({
      identity: c.identity,
      key: keys[0]!,
      update: () => 'queued',
      mutation: async () => {
        queuedCalls++;
      },
    });
    const failedQueue = assert.rejects(queued, {
      code: 'RESOURCE_ACCESS_CHANGED',
    });
    await flush();
    const before = c.requests.length;
    await Promise.all(
      keys.map((key) =>
        assert.rejects(
          c.data.api.json('/denied-child', (value) => value, {
            identity: c.identity,
            resourceKey: key,
          }),
          { status: 404 },
        ),
      ),
    );
    c.time.advance(50);
    await flush();
    assert.equal(
      c.requests.length,
      before + 4,
      'three child errors share one verification',
    );
    gate.resolve(ok('stale child'));
    mutation.resolve('stale write');
    await Promise.all([late, failedEdit, failedQueue]);
    assert.equal(queuedCalls, 0);
    assert.equal(c.realtime.getBoardSnapshot(BOARD).status, 'live');
    assert.equal(c.data.queryClient.getQueryData(keys[0]!), undefined);
  } finally {
    c.dispose();
  }
});

test('Query-only 403/404 errors request one verification without treating other cache updates as fresh failures', async () => {
  const c = await integration();
  try {
    await c.join();
    const key = queryKeys.attachments(c.identity, BOARD, CARD);
    const before = c.requests.length;
    await assert.rejects(
      c.data.queryClient.fetchQuery({
        queryKey: key,
        queryFn: async () => {
          throw new ApiError('http', { status: 404 });
        },
      }),
    );
    c.time.advance(50);
    await flush();
    assert.equal(c.requests.length, before + 1);
    assert.equal(c.realtime.getBoardSnapshot(BOARD).status, 'live');
    c.time.advance(1000);
    await flush();
    assert.equal(c.requests.length, before + 1);
  } finally {
    c.dispose();
  }
});

test('a successful child-error probe preserves read access but enforces a new write downgrade', async () => {
  const c = await integration();
  try {
    await c.join();
    c.configure({ writable: false });
    c.respond((url) =>
      url.endsWith('/child') ? Promise.resolve(json({}, 403)) : null,
    );
    await assert.rejects(
      c.data.api.json('/child', (value) => value, {
        identity: c.identity,
        resourceKey: queryKeys.comments(c.identity, BOARD, CARD),
      }),
      { status: 403 },
    );
    c.time.advance(50);
    await flush();
    assert.equal(c.realtime.getBoardSnapshot(BOARD).canRead, true);
    assert.equal(c.realtime.getBoardSnapshot(BOARD).canWrite, false);
    await assert.rejects(
      c.data.optimistic({
        identity: c.identity,
        key: c.cardKey,
        update: () => 'forbidden',
        mutation: async () => 'forbidden',
      }),
      { code: 'RESOURCE_ACCESS_CHANGED' },
    );
  } finally {
    c.dispose();
  }
});
