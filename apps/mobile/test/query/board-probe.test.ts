import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResourceAccess } from '../../src/infrastructure/query/resource-access.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
const id = '00000000-0000-4000-8000-000000000001';
test('every Board fence invalidates older probes, with teardown only on entering denial', () => {
  const access = createResourceAccess(),
    key = queryKeys.board({ userId: id, generation: 1 }, id);
  let teardown = 0;
  access.confirmBoard(id, true);
  access.subscribeBoardTeardown(() => teardown++);
  access.fenceBoard(id, true);
  for (const denied of [true, false, true]) {
    const probe = access.captureBoardProbe(id);
    access.fenceBoard(id, denied);
    assert.throws(
      () => {
        probe();
        access.confirmBoard(id, true);
      },
      { code: 'RESOURCE_ACCESS_CHANGED' },
    );
    assert.equal(access.readable(key), false);
    assert.throws(() => access.capture(key, true));
    assert.equal(teardown, 1);
  }
  access.confirmBoard(id, true);
  access.fenceBoard(id, true);
  assert.equal(teardown, 2);
});
