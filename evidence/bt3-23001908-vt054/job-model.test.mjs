import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobModel } from './job-model.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test('T01 accepts before operation finishes with QUEUED status', () => {
  const gate = deferred();
  const model = createJobModel(() => gate.promise);
  const response = model.submit('alice', 'request-1', 'board-1');
  assert.equal(response.status, 'QUEUED');
  assert.equal(typeof response.id, 'string');
});

test('T02 and T03 report RUNNING then COMPLETED through the response contract', async () => {
  const gate = deferred();
  const model = createJobModel(() => gate.promise);
  const { id } = model.submit('alice', 'request-1', 'board-1');
  await tick();
  assert.deepEqual(model.status('alice', id), { id, status: 'RUNNING' });
  gate.resolve();
  await tick();
  assert.deepEqual(model.status('alice', id), { id, status: 'COMPLETED' });
});

test('T04 and T05 duplicate submissions before and after completion execute once', async () => {
  let calls = 0;
  const model = createJobModel(async () => {
    calls++;
  });
  const first = model.submit('alice', 'key', 'board-1');
  assert.equal(model.submit('alice', 'key', 'board-1').id, first.id);
  await tick();
  assert.equal(model.submit('alice', 'key', 'board-1').id, first.id);
  await tick();
  assert.equal(calls, 1);
});

test('T06 rejects the same user and key with a different board', () => {
  const model = createJobModel(async () => {});
  model.submit('alice', 'key', 'board-1');
  assert.throws(() => model.submit('alice', 'key', 'board-2'), /conflict/i);
});

test('T07 scopes the same key to each user', () => {
  const model = createJobModel(async () => {});
  assert.notEqual(
    model.submit('alice', 'key', 'board-1').id,
    model.submit('bob', 'key', 'board-1').id,
  );
});

test('T08 failure and retry do not repeat the side effect or expose the error', async () => {
  let calls = 0;
  const model = createJobModel(async () => {
    calls++;
    throw new Error('private error');
  });
  const { id } = model.submit('alice', 'key', 'board-1');
  await tick();
  assert.deepEqual(model.status('alice', id), { id, status: 'FAILED' });
  assert.equal(model.submit('alice', 'key', 'board-1').id, id);
  await tick();
  assert.equal(calls, 1);
});

test('T09 and T10 hide other users and missing jobs', () => {
  const model = createJobModel(async () => {});
  const { id } = model.submit('alice', 'key', 'board-1');
  assert.throws(() => model.status('bob', id), /not found/i);
  assert.throws(() => model.status('alice', 'missing'), /not found/i);
});

test('T11 rejects empty and non-string request dimensions', () => {
  const model = createJobModel(async () => {});
  for (const args of [
    ['', 'key', 'board'],
    [null, 'key', 'board'],
    ['alice', '', 'board'],
    ['alice', null, 'board'],
    ['alice', 'key', ''],
    ['alice', 'key', null],
  ]) {
    assert.throws(() => model.submit(...args), /invalid/i);
  }
});

test('T12 concurrent same-key requests share one execution', async () => {
  let calls = 0;
  const model = createJobModel(async () => {
    calls++;
  });
  const jobs = await Promise.all(
    Array.from({ length: 120 }, async () =>
      model.submit('alice', 'key', 'board-1'),
    ),
  );
  assert.equal(new Set(jobs.map(({ id }) => id)).size, 1);
  await tick();
  assert.equal(calls, 1);
});
