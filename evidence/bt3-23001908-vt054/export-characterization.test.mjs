import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createJobModel } from './job-model.mjs';

// Load the actual source through the repository's existing ts-node dependency.
const backend = new URL('../../apps/backend/', import.meta.url);
const require = createRequire(new URL('package.json', backend));
require('ts-node').register({
  project: fileURLToPath(new URL('tsconfig.json', backend)),
  transpileOnly: true,
});
const { csvRow } = require(
  fileURLToPath(new URL('src/api/exports/export-csv.ts', backend)),
);

test('a simulated export job invokes the real CSV serializer only once on retry', async () => {
  const outputs = [];
  const model = createJobModel(async (board) => {
    outputs.push(csvRow([board, '=SUM(A1:A2)', 'a,b']));
  });
  const first = model.submit('alice', 'export-1', 'board-1');
  assert.equal(first.status, 'QUEUED');
  assert.equal(model.submit('alice', 'export-1', 'board-1').id, first.id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(model.status('alice', first.id), {
    id: first.id,
    status: 'COMPLETED',
  });
  assert.deepEqual(outputs, ['"board-1","\'=SUM(A1:A2)","a,b"\r\n']);
});
