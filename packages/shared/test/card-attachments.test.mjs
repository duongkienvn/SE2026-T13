import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  AttachmentKind,
  AttachmentState,
  RealtimeServerEvent,
} from '@kanban/shared';

test('attachment lifecycle contracts match ESM/CommonJS and reuse Card invalidation', () => {
  const shared = createRequire(import.meta.url)('@kanban/shared');
  assert.deepEqual(AttachmentKind, { URL: 'URL', FILE: 'FILE' });
  assert.deepEqual(AttachmentState, {
    PENDING: 'PENDING',
    ACTIVE: 'ACTIVE',
    FAILED: 'FAILED',
    EXPIRED: 'EXPIRED',
    REMOVED: 'REMOVED',
  });
  assert.deepEqual(shared.AttachmentKind, AttachmentKind);
  assert.deepEqual(shared.AttachmentState, AttachmentState);
  assert.equal(RealtimeServerEvent.CARD_UPDATED, 'card:updated');
});
