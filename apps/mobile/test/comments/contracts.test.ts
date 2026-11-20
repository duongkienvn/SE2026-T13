import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createCommentsApi,
  decodeComment,
} from '../../src/features/cards/comments/api.ts';
import {
  integration,
  json,
  BOARD,
  CARD,
} from '../realtime/integration-support.ts';
import { page, uuid } from '../workspaces/fixtures.ts';

import { comment } from './fixtures.ts';
const signal = () => new AbortController().signal;
const success = (data: unknown, status: number) =>
  json({ success: true, statusCode: status, message: 'OK', data }, status);

test('API uses authenticated scoped GET/POST/PATCH/204 DELETE, exact statuses and 0/1/20/21/101 pagination', async () => {
  const env = await integration();
  let count = 0;
  env.respond((input, init) => {
    const url = new URL(input),
      method = init.method ?? 'GET';
    if (!url.pathname.includes('/comments')) return null;
    if (method === 'GET')
      return Promise.resolve(
        json(
          page(
            Array.from({ length: count }, (_, i) => comment(i + 1)),
            Number(url.searchParams.get('page')),
            Number(url.searchParams.get('limit')),
          ),
        ),
      );
    if (method === 'DELETE')
      return Promise.resolve(new Response(null, { status: 204 }));
    const body = JSON.parse(String(init.body));
    return Promise.resolve(
      success({ ...comment(), ...body }, method === 'POST' ? 201 : 200),
    );
  });
  try {
    const api = createCommentsApi(env.data.api, env.identity, BOARD, CARD);
    for (count of [0, 1, 20, 21, 101]) {
      const pages = [];
      for (let p = 1; p <= Math.max(1, Math.ceil(count / 20)); p++) {
        const result = await api.list(p, signal());
        assert.equal(result.meta.total, count);
        pages.push(...result.data);
      }
      assert.equal(pages.length, count);
    }
    assert.equal((await api.list(1, signal(), 100)).data.length, 100);
    const body = { content: 'Test\n😀', mentions: [] };
    assert.equal((await api.create(body, signal())).content, body.content);
    await api.edit(comment().id, body, signal());
    assert.equal(await api.remove(comment().id, signal()), undefined);
    const methods = env.requests.slice(-3).map(({ init }) => init.method);
    assert.deepEqual(methods, ['POST', 'PATCH', 'DELETE']);
    assert.deepEqual(JSON.parse(String(env.requests.at(-3)!.init.body)), body);
    for (const request of env.requests)
      assert.match(
        String((request.init.headers as Record<string, string>).Authorization),
        /^Bearer /,
      );
    for (const p of [0, -1, 1.5, NaN])
      await assert.rejects(api.list(p, signal()));
    for (const limit of [0, 101, 1.5])
      await assert.rejects(api.list(1, signal(), limit));
    assert.throws(() =>
      createCommentsApi(env.data.api, env.identity, 'bad', CARD),
    );
  } finally {
    env.dispose();
  }
});

test('decoder allowlists author, mentions and IDs; rejects malformed DTOs and cross-Card responses', () => {
  const dto = comment();
  assert.deepEqual(decodeComment({ ...dto, token: 'private' }, CARD), dto);
  assert.deepEqual(
    decodeComment(
      {
        ...dto,
        author: {
          displayName: 'Deleted user',
          isDeleted: true,
          email: 'hidden',
        },
      },
      CARD,
    ).author,
    { displayName: 'Deleted user', isDeleted: true },
  );
  assert.equal(decodeComment({ ...dto, author: null }, CARD).author, undefined);
  for (const raw of [
    null,
    [],
    { ...dto, id: 'bad' },
    { ...dto, cardId: uuid(999) },
    { ...dto, authorId: null },
    { ...dto, content: '' },
    { ...dto, content: 'a'.repeat(2001) },
    { ...dto, mentions: null },
    { ...dto, author: { displayName: 'Invented author' } },
    { ...dto, updatedAt: 'yesterday' },
  ])
    assert.throws(() => decodeComment(raw, CARD));
});

test('malformed pages, wrong create/edit status and response relationships fail without retries', async () => {
  const env = await integration();
  let response: Response;
  env.respond(() => Promise.resolve(response));
  try {
    const api = createCommentsApi(env.data.api, env.identity, BOARD, CARD);
    for (const raw of [
      page([comment(), comment()], 1, 20),
      {
        ...page([comment()], 1, 20),
        meta: { ...page([], 1, 20).meta, page: 2 },
      },
      page([comment(2), comment(1)], 1, 20),
    ]) {
      response = json(raw);
      await assert.rejects(api.list(1, signal()));
    }
    const body = { content: 'Safe', mentions: [] };
    response = success({ ...comment(), ...body }, 200);
    await assert.rejects(api.create(body, signal()));
    response = success({ ...comment(), ...body, authorId: uuid(999) }, 201);
    await assert.rejects(api.create(body, signal()));
    response = success(comment(), 201);
    await assert.rejects(api.create(body, signal()));
    response = success({ ...comment(2), ...body }, 200);
    await assert.rejects(api.edit(comment().id, body, signal()));
    for (const status of [400, 403, 404, 409, 429, 500]) {
      response = json(
        {
          success: false,
          statusCode: status,
          code: 'COMMENT_ERROR',
          message: 'Rejected',
        },
        status,
      );
      const before = env.requests.length;
      await assert.rejects(api.create(body, signal()));
      assert.equal(env.requests.length, before + 1);
    }
  } finally {
    env.dispose();
  }
});
