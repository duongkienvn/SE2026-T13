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
