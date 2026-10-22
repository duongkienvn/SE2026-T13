import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';
import process from 'node:process';
import { RealtimeServerEvent, RealtimePresenceEvent } from '@kanban/shared';

const require = createRequire(import.meta.url);

test('exports the separate presence contract in ESM and CommonJS', () => {
  assert.deepEqual(RealtimePresenceEvent, { SYNC: 'presence:sync' });
  assert.deepEqual(
    require('@kanban/shared').RealtimePresenceEvent,
    RealtimePresenceEvent,
  );
});

test('exports exactly the twelve reviewed server events in ESM and CommonJS', () => {
  assert.deepEqual(Object.values(RealtimeServerEvent), [
    'column:created',
    'column:updated',
    'column:moved',
    'column:deleted',
    'card:created',
    'card:updated',
    'card:moved',
    'card:archived',
    'card:assignees-changed',
    'member:added',
    'member:role-changed',
    'member:removed',
  ]);
  assert.deepEqual(
    require('@kanban/shared').RealtimeServerEvent,
    RealtimeServerEvent,
  );
});

test('typechecks key/payload mapping and rejects invalid contracts', () => {
  execFileSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      '--strict',
      '--noEmit',
      '--skipLibCheck',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2022',
      'test/realtime-contracts.ts',
    ],
    { stdio: 'pipe' },
  );
});
