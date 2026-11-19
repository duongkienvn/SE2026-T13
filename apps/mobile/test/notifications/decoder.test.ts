import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeNotification,
  decodeCount,
  decodeReadAll,
  notificationDestination,
} from '../../src/features/notifications/decoder.ts';
import { notification, proof } from './fixtures.ts';
test('canonical DTOs keep only allowed fields and sanitize unavailable and deleted actors before cache insertion', () => {
  const value = notification();
  assert.deepEqual(decodeNotification({ ...value, secret: 'private' }), value);
  const stub = decodeNotification({
    ...value,
    isUnavailable: true,
    actor: { secret: 'malformed leak' },
    context: 'private',
    target: 'private',
  });
  assert.equal(stub.actor, null);
  assert.equal(stub.context, null);
  assert.equal(stub.target, null);
  const deleted = decodeNotification({
    ...value,
    actor: { ...value.actor, isDeleted: true },
  });
  assert.equal(deleted.actor?.displayName, 'Deleted user');
  assert.equal(decodeCount({ count: 100 }), 100);
  assert.equal(decodeReadAll({ updatedCount: 0 }), 0);
});
test('strict identity, kind, dates, boolean and scalar bounds reject malformed data', () => {
  for (const patch of [
    { id: 'x' },
    { kind: 'CARD_COMPLETED' },
    { createdAt: '2026-02-30T00:00:00Z' },
    { readAt: 'today' },
    { isUnavailable: 1 },
    { summary: 'x'.repeat(1025) },
    { actor: {} },
    { context: {} },
  ])
    assert.throws(() => decodeNotification({ ...notification(), ...patch }));
  for (const count of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '0'])
    assert.throws(() => decodeCount({ count }));
});
test('paths must match kind and context; unavailable, null and unsafe targets cannot navigate', () => {
  assert.equal(
    notificationDestination(notification()),
    notification().target?.path,
  );
  for (const path of [
    'https://evil.test',
    '//evil.test',
    '/boards/%2e%2e',
    '/search',
    '/invitations/workspace#proof=secret',
    notification().target!.path + '?x=1',
  ]) {
    const value = decodeNotification({
      ...notification(),
      target: { kind: 'card', path },
    });
    assert.equal(value.target, null);
    assert.equal(value.actor, null);
    assert.equal(notificationDestination(value), null);
  }
  assert.equal(
    notificationDestination(notification(1, { target: null })),
    null,
  );
});
test('invitation proof is validated but only its canonical recipient route enters caches', () => {
  const wire = notification(1, {
    kind: 'WORKSPACE_INVITED',
    context: {
      workspaceId: notification().context!.workspaceId,
      boardId: null,
      cardId: null,
    },
    target: {
      kind: 'invitation',
      path: '/invitations/workspace#proof=' + proof,
    },
  });
  let captured = '';
  const row = decodeNotification(wire, (id, value) => {
    assert.equal(id, wire.id);
    captured = value;
  });
  assert.equal(captured, proof);
  assert.equal(notificationDestination(row), '/invitations/workspace');
  assert.ok(!JSON.stringify(row).includes(proof));
  assert.equal(
    decodeNotification({ ...wire, isUnavailable: true }, () => {
      throw new Error('must not capture');
    }).target,
    null,
  );
});
