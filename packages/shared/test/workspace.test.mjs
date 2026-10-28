import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { BoardVisibility, WorkspaceRole, WorkspaceType } from '@kanban/shared';

test('workspace values have the same ESM and CommonJS contract', () => {
  const shared = createRequire(import.meta.url)('@kanban/shared');
  assert.deepEqual(WorkspaceType, { PERSONAL: 'PERSONAL', TEAM: 'TEAM' });
  assert.deepEqual(WorkspaceRole, { ADMIN: 'ADMIN', MEMBER: 'MEMBER' });
  assert.deepEqual(BoardVisibility, {
    PRIVATE: 'PRIVATE',
    WORKSPACE_VISIBLE: 'WORKSPACE_VISIBLE',
  });
  for (const [name, value] of Object.entries({
    WorkspaceType,
    WorkspaceRole,
    BoardVisibility,
  }))
    assert.deepEqual(shared[name], value);
});
