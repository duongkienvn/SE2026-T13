import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createJobModel } from './job-model.mjs';

const backend = new URL('../../apps/backend/', import.meta.url);
const require = createRequire(new URL('package.json', backend));
require('reflect-metadata');
require('ts-node').register({
  project: fileURLToPath(new URL('tsconfig.json', backend)),
  transpileOnly: true,
});
const { BoardExportService } = require(
  fileURLToPath(new URL('src/api/exports/board-export.service.ts', backend)),
);
const { BOARD_EXPORT_CSV_HEADERS } = require('@kanban/shared');

function fixture(role = 'OWNER') {
  const board = { id: 'board-1', name: 'Synthetic Board', isArchived: false };
  let reads = 0;
  const builder = new Proxy(
    {},
    {
      get(target, key) {
        if (key === 'getRawMany') return async () => [];
        return () => builder;
      },
    },
  );
  const manager = {
    getRepository(entity) {
      if (entity.name === 'BoardMember')
        return {
          findOne: async ({ where }) =>
            where.userId === 'alice' && where.boardId === board.id
              ? { board, role }
              : null,
        };
      if (entity.name === 'Card')
        return { countBy: async () => 0, createQueryBuilder: () => builder };
      throw new Error(`unexpected repository: ${entity.name}`);
    },
  };
  const snapshots = {
    read: async (callback) => {
      reads++;
      return callback(manager);
    },
  };
  return { service: new BoardExportService(snapshots), reads: () => reads };
}

test('model invokes real BoardExportService CSV path once on a duplicate request', async () => {
  const { service, reads } = fixture();
  const outputs = [];
  const model = createJobModel(async (board) =>
    outputs.push(await service.create('alice', board, 'csv')),
  );
  const first = model.submit('alice', 'request-1', 'board-1');
  assert.equal(first.status, 'QUEUED');
  assert.equal(model.submit('alice', 'request-1', 'board-1').id, first.id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(model.status('alice', first.id).status, 'COMPLETED');
  assert.equal(reads(), 1);
  assert.equal(outputs.length, 1);
  assert.equal(
    outputs[0].toString('utf8'),
    `${BOARD_EXPORT_CSV_HEADERS.join(',')}\r\n`,
  );
});

test('real BoardExportService rejects a non-owner through mocked repository data', async () => {
  const { service } = fixture('MEMBER');
  const model = createJobModel((board) =>
    service.create('alice', board, 'csv'),
  );
  const { id } = model.submit('alice', 'request-1', 'board-1');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(model.status('alice', id), { id, status: 'FAILED' });
});
