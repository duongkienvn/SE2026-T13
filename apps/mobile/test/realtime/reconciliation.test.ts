import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryObserver } from '@tanstack/react-query';
import { hintTargets } from '../../src/infrastructure/realtime/reconciliation.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { setup } from '../query/support.ts';
import { USER_A, USER_B, deferred, flush } from '../auth/support.ts';

test('shared scopes target Card children precisely and generic events keep a correctness-safe fallback', () => {
  const identity = { userId: USER_A, generation: 1 };
  const hint = { boardId: USER_A, cardId: USER_B };
  assert.deepEqual(
    hintTargets(identity, 'card:updated', {
      ...hint,
      changeScope: 'checklists',
    }),
    [queryKeys.checklists(identity, USER_A, USER_B)],
  );
  assert.deepEqual(
    hintTargets(identity, 'card:updated', {
      ...hint,
      changeScope: 'attachments',
    }),
    [queryKeys.attachments(identity, USER_A, USER_B)],
  );
  assert.ok(
    hintTargets(identity, 'card:updated', hint).some(
      (key) =>
        JSON.stringify(key) ===
        JSON.stringify(queryKeys.card(identity, USER_A, USER_B)),
    ),
  );
  assert.deepEqual(hintTargets(identity, 'comment:updated', hint), [
    queryKeys.comments(identity, USER_A, USER_B),
  ]);
  assert.deepEqual(hintTargets(identity, 'notifications:changed', {}), [
    queryKeys.notifications(identity),
  ]);
});
test('hint bursts and local mutation refreshes coalesce; unrelated Boards are never held behind another edit', async () => {
  const c = await setup();
  const { layer } = c;
  const identity = layer.getIdentity()!;
  const card = queryKeys.card(identity, USER_A, USER_B);
  const list = queryKeys.cards(identity, USER_A);
  const other = queryKeys.card(identity, USER_B, USER_A);
  const stops = [card, list, other].map((key) => {
    layer.queryClient.setQueryData(key, 'old');
    return new QueryObserver(layer.queryClient, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: ({ signal }) =>
        layer.api.json('/test', () => 'server', { identity, signal }),
    }).subscribe(() => {});
  });
  const gate = deferred<void>();
  try {
    const edit = layer.optimistic({
      identity,
      key: card,
      invalidate: [card, list],
      update: () => 'edit',
      mutation: () => gate.promise,
    });
    await flush();
    const hints = [
      layer.invalidateHints(identity, [card, list, other]),
      layer.invalidateHints(identity, [card, list, other]),
    ];
    c.time.advance(50);
    await flush();
    assert.equal(
      c.requests.length,
      1,
      'unrelated Board refetch proceeds during this edit',
    );
    gate.resolve();
    await edit;
    await Promise.all(hints);
    await flush();
    assert.equal(
      c.requests.length,
      3,
      'one authoritative HTTP read for each affected active key',
    );
  } finally {
    gate.resolve();
    stops.forEach((stop) => stop());
    c.dispose();
  }
});
