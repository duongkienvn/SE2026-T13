import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { APP_NAME } from '@kanban/shared';

const require = createRequire(import.meta.url);

test('provides the same named export to ESM and CommonJS consumers', () => {
  assert.equal(APP_NAME, 'Realtime Collaborative Kanban');
  assert.equal(require('@kanban/shared').APP_NAME, APP_NAME);
});
