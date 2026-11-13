import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashKey } from '@tanstack/react-query';
import {
  keyBelongsTo,
  queryKeys,
} from '../../src/infrastructure/query/keys.ts';

const a = { userId: 'a', generation: 1 };
test('query identity includes user, generation, resource, filters and pagination', () => {
  const first = queryKeys.cards(a, 'board', {
    page: 1,
    limit: 20,
    q: 'a',
    unset: undefined,
  });
  assert.equal(
    hashKey(first),
    hashKey(queryKeys.cards(a, 'board', { q: 'a', limit: 20, page: 1 })),
  );
  for (const other of [
    queryKeys.cards({ userId: 'b', generation: 1 }, 'board', { page: 1 }),
    queryKeys.cards({ ...a, generation: 2 }, 'board', { page: 1 }),
    queryKeys.cards(a, 'other', { page: 1 }),
    queryKeys.cards(a, 'board', { page: 2 }),
    queryKeys.cards(a, 'board', { cursor: 'opaque/+' }),
  ])
    assert.notEqual(hashKey(first), hashKey(other));
  assert.ok(keyBelongsTo(queryKeys.card(a, 'b', 'c'), a));
  assert.equal(
    hashKey(queryKeys.card(a, 'ABCDEF', 'ABCDEF')),
    hashKey(queryKeys.card(a, 'abcdef', 'abcdef')),
  );
  assert.ok(
    !keyBelongsTo(queryKeys.card(a, 'b', 'c'), { ...a, generation: 2 }),
  );
  assert.throws(() => queryKeys.cards(a, 'board', { page: NaN }));
});
