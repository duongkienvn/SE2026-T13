import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchInput, searchRequest } from '../../src/features/search/input.ts';
import {
  decodeSearch,
  searchDestination,
} from '../../src/features/search/decoder.ts';
import { cardHit, results } from './fixtures.ts';
import { uuid } from '../workspaces/fixtures.ts';

test('search validates trimmed Unicode code points and preserves literal text', () => {
  for (const q of [
    '',
    '   ',
    '😀'.repeat(120),
    'e\u0301'.repeat(60),
    '%_\\/ SELECT * FROM cards',
  ]) {
    assert.deepEqual(searchInput(q), { query: q.trim(), error: '' });
  }
  for (const q of ['😀'.repeat(121), '\0', '\ud800', '\udfff', 'a\ud800b'])
    assert.ok(searchInput(q).error);
  assert.deepEqual(searchRequest(' x ', 'all'), {
    q: 'x',
    type: 'all',
    limit: 5,
  });
  assert.deepEqual(searchRequest('x', 'cards', 2), {
    q: 'x',
    type: 'cards',
    page: 2,
    limit: 20,
  });
  for (const make of [
    () => searchRequest('x', 'all', 1),
    () => searchRequest('x', 'all', undefined, 11),
    () => searchRequest('x', 'cards', 0),
    () => searchRequest('x', 'cards', Number.MAX_SAFE_INTEGER),
    () => searchRequest('x', 'cards', 1, 51),
  ])
    assert.throws(make);
});
test('decoder checks request binding, all groups, bounds, types, null contexts, totals and unique IDs', () => {
  const good = results();
  const decode = (value: unknown) =>
    decodeSearch(value, searchRequest('design', 'all'));
  assert.deepEqual(decode(good), good);
  for (const bad of [
    { ...good, query: 'other' },
    { ...good, type: 'cards' },
    { ...good, groups: {} },
    ...[
      { total: -1 },
      { total: 1.5 },
      { total: Number.MAX_SAFE_INTEGER + 1 },
      { hasMore: 'false' },
      { items: [cardHit, cardHit] },
      { items: Array(6).fill(cardHit) },
      { items: [{ ...cardHit, type: 'board' }] },
      { items: [{ ...cardHit, subtitle: 'x'.repeat(161) }] },
      { items: [{ ...cardHit, workspaceId: 'nope' }] },
      { items: [{ ...cardHit, workspaceName: undefined }] },
      { items: [{ ...cardHit, boardName: '' }] },
      { items: [{ ...cardHit, id: 'x' }] },
    ].map((patch) => ({
      ...good,
      groups: { ...good.groups, cards: { ...good.groups.cards, ...patch } },
    })),
  ])
    assert.throws(() => decode(bad));
});
test('response windows accept 0/1/5/10/20/50 rows with exact totals and reject inconsistent paging', () => {
  for (const [type, limit] of [
    ['all', 5],
    ['all', 10],
    ['cards', 20],
    ['cards', 50],
  ] as const) {
    for (const count of [0, 1, limit]) {
      const value = results(type);
      value.groups.cards = {
        total: count,
        hasMore: false,
        items: Array.from({ length: count }, (_, n) => ({
          ...cardHit,
          id: uuid(n),
          path: `/boards/${cardHit.boardId}/cards/${uuid(n)}`,
        })),
      };
      const request = searchRequest('design', type, undefined, limit);
      assert.equal(
        decodeSearch(value, request).groups.cards.items.length,
        count,
      );
      value.groups.cards.hasMore = true;
      assert.throws(() => decodeSearch(value, request));
    }
  }
  const page = results('cards');
  page.groups.cards.total = 21;
  assert.equal(
    decodeSearch(page, searchRequest('design', 'cards', 2)).groups.cards.items
      .length,
    1,
  );
  assert.throws(() => decodeSearch(page, searchRequest('design', 'cards', 1)));
  page.groups.boards = results().groups.boards;
  assert.throws(() => decodeSearch(page, searchRequest('design', 'cards', 2)));
});

test('navigation accepts only paths matching the exact item kind and identifiers', () => {
  assert.equal(searchDestination(cardHit), cardHit.path);
  for (const path of [
    'https://evil.test',
    '//evil.test',
    cardHit.path + '?a=1',
    '/boards/%2e%2e',
    '/boards/../cards/x',
    '/search',
    '/boards/' + cardHit.id,
    cardHit.path.replace(cardHit.id, cardHit.boardId),
  ])
    assert.throws(() => searchDestination({ ...cardHit, path }));
});

test('a sanitized Board name can legitimately produce an empty Card snippet', () => {
  const value = results('cards');
  value.groups.cards.items = [{ ...cardHit, boardName: '***', subtitle: '' }];
  assert.equal(
    decodeSearch(value, searchRequest('design', 'cards')).groups.cards.items[0]
      ?.subtitle,
    '',
  );
});
