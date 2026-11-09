import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobModel } from './job-model.mjs';

// Reuse the exact user/key in two model instances within one process.
// Running both orders helps expose accidental module-global state.
async function scenario(fail) {
  let calls = 0;
  const model = createJobModel(async () => {
    calls++;
    if (fail) throw new Error('synthetic failure');
  });
  const job = model.submit('alice', 'same-key', 'board-1');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    model.status('alice', job.id).status,
    fail ? 'FAILED' : 'COMPLETED',
  );
  assert.equal(model.submit('alice', 'same-key', 'board-1').id, job.id);
  assert.equal(calls, 1);
}

test('success/failure scenarios remain isolated in both orders', async () => {
  for (const order of [
    [false, true],
    [true, false],
  ]) {
    for (const fail of order) await scenario(fail);
  }
});
