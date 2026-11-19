import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSearchApi } from '../../src/features/search/api.ts';
import {
  searchOptions,
  searchCollection,
  nextSearchPage,
} from '../../src/features/search/queries.ts';
import { searchRequest } from '../../src/features/search/input.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { integration, json, ok } from '../realtime/integration-support.ts';
import { deferred, flush } from '../auth/support.ts';
import { results, cardHit } from './fixtures.ts';

test('Search API uses the envelope data and omits page in All; blank skips network', async () => {
  const env = await integration();
  try {
    env.respond((url) => {
      const u = new URL(url);
      const type = u.searchParams.get('type') as 'all' | 'cards';
      assert.equal(u.pathname, '/api/search');
      assert.equal(u.searchParams.get('limit'), type === 'all' ? '5' : '20');
      assert.equal(u.searchParams.get('page'), type === 'all' ? null : '1');
      assert.equal(u.searchParams.get('q'), '%_\\/😀');
      return Promise.resolve(ok(results(type, '%_\\/😀')));
    });
    const api = createSearchApi(env.data.api, env.identity);
    await api.list(
      searchRequest('%_\\/😀', 'all'),
      new AbortController().signal,
    );
    await api.list(
      searchRequest('%_\\/😀', 'cards'),
      new AbortController().signal,
    );
    const before = env.requests.length;
    assert.equal(
      (await api.list(searchRequest(' ', 'all'), new AbortController().signal))
        .groups.cards.total,
      0,
    );
    assert.equal(env.requests.length, before);
    assert.deepEqual(
      searchOptions(env.data, env.identity, 'design', 'all').queryKey.slice(
        0,
        5,
      ),
      queryKeys.search(env.identity),
    );
  } finally {
    env.dispose();
  }
});
test('type pagination uses requested page and authoritative hasMore, merging overlaps without reranking', () => {
  const page = results('cards');
  assert.equal(nextSearchPage(page, 1), undefined);
  page.groups.cards.hasMore = true;
  assert.equal(nextSearchPage(page, 2), 3);
  assert.equal(nextSearchPage(page, Number.MAX_SAFE_INTEGER), undefined);
  assert.equal(nextSearchPage(results('all'), 1), undefined);
  const second = results('cards');
  second.groups.cards.items = [
    { ...cardHit, title: 'latest' },
    { ...cardHit, id: 'second' },
  ];
  assert.deepEqual(
    searchCollection([results('cards'), second], 'cards').map((x) => x.title),
    ['latest', cardHit.title],
  );
});
test('aggregate denial drops all search snapshots', async () => {
  const env = await integration();
  try {
    const options = searchOptions(env.data, env.identity, 'design', 'all');
    env.data.queryClient.setQueryData(options.queryKey, {
      pages: [results()],
      pageParams: [1],
    });
    env.respond(() => Promise.resolve(json({}, 403)));
    await env.data.queryClient
      .fetchInfiniteQuery(options)
      .catch(() => undefined);
    assert.equal(
      env.data.queryClient.getQueryData(options.queryKey),
      undefined,
    );
  } finally {
    env.dispose();
  }
});

test('endpoint Retry-After survives query cache eviction without restarting its deadline', async (t) => {
  const env = await integration();
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  try {
    env.respond(() =>
      Promise.resolve(
        new Response('{}', {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '300' },
        }),
      ),
    );
    await assert.rejects(
      env.data.queryClient.fetchInfiniteQuery(
        searchOptions(env.data, env.identity, 'design', 'all'),
      ),
    );
    const before = env.requests.length;
    env.data.evict(env.identity, [queryKeys.search(env.identity)]);
    now += 30_000;
    await assert.rejects(
      env.data.queryClient.fetchInfiniteQuery(
        searchOptions(env.data, env.identity, 'different', 'cards'),
      ),
      (error: unknown) => {
        assert.ok(
          error && typeof error === 'object' && 'retryAfterMs' in error,
        );
        assert.equal(error.retryAfterMs, 270_000);
        return true;
      },
    );
    assert.equal(env.requests.length, before);
    now += 270_000;
    env.respond(() => Promise.resolve(ok(results('cards', 'different'))));
    await env.data.queryClient.fetchInfiniteQuery(
      searchOptions(env.data, env.identity, 'different', 'cards'),
    );
    assert.equal(env.requests.length, before + 1);
  } finally {
    env.dispose();
  }
});

test('an old aggregate denial cannot evict a newer authoritative Search snapshot', async () => {
  const env = await integration();
  try {
    const response = deferred<Response>();
    env.respond(() => response.promise);
    const first = env.data.queryClient
      .fetchInfiniteQuery(
        searchOptions(env.data, env.identity, 'design', 'all'),
      )
      .catch(() => undefined);
    await flush();
    env.data.resources.bumpKey(queryKeys.search(env.identity));
    const key = searchOptions(env.data, env.identity, 'newer', 'all').queryKey;
    const latest = { pages: [results('all', 'newer')], pageParams: [1] };
    env.data.queryClient.setQueryData(key, latest);
    response.resolve(json({}, 403));
    await first;
    assert.deepEqual(env.data.queryClient.getQueryData(key), latest);
  } finally {
    env.dispose();
  }
});
