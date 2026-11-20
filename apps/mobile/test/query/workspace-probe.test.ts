import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createResourceAccess } from '../../src/infrastructure/query/resource-access.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
const id = '00000000-0000-4000-8000-000000000001';
const identity = { userId: id, generation: 1 };
test('Workspace confirmations fence older probes without invalidating concurrent scoped reads', () => {
  const access = createResourceAccess();
  const probe = access.captureWorkspaceProbe(id);
  const scoped = access.capture(queryKeys.workspace(identity, id), false);
  access.confirmWorkspace('00000000-0000-4000-8000-000000000002');
  assert.doesNotThrow(probe);
  access.confirmWorkspace(id);
  assert.throws(probe, { code: 'RESOURCE_ACCESS_CHANGED' });
  assert.doesNotThrow(scoped);
  const nextProbe = access.captureWorkspaceProbe(id);
  assert.doesNotThrow(nextProbe);
  access.confirmWorkspace(id);
  assert.throws(nextProbe, { code: 'RESOURCE_ACCESS_CHANGED' });
});
test('Workspace probes observe revocation, key eviction, fence-all and reset', () => {
  for (const change of [
    (access: ReturnType<typeof createResourceAccess>) =>
      access.denyWorkspace(id),
    (access: ReturnType<typeof createResourceAccess>) =>
      access.fenceWorkspace(id),
    (access: ReturnType<typeof createResourceAccess>) =>
      access.bumpKey(queryKeys.workspace(identity, id)),
    (access: ReturnType<typeof createResourceAccess>) => access.fenceAll(),
    (access: ReturnType<typeof createResourceAccess>) => {
      access.reset();
      access.captureWorkspaceProbe(id);
    },
  ]) {
    const access = createResourceAccess();
    access.confirmWorkspace(id);
    const probe = access.captureWorkspaceProbe(id);
    change(access);
    assert.throws(probe, { code: 'RESOURCE_ACCESS_CHANGED' });
  }
});
