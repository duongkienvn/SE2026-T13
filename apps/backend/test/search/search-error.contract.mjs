import assert from 'node:assert/strict';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import process from 'node:process';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = process.env.VT053_SERVICE_SOURCE || new URL('../../src/api/search/search.service.ts', import.meta.url).pathname;
const code = readFileSync(source, 'utf8');
const js = ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
}).outputText;
const exports = {};
const mockRequire = (specifier) => {
  if (specifier === '@nestjs/common') return { Injectable: () => (klass) => klass };
  if (specifier === '@nestjs/typeorm') return { InjectRepository: () => () => undefined };
  if (specifier.endsWith('/workspace.entity')) return { Workspace: class Workspace {} };
  if (specifier.endsWith('/to-response-dto')) return { toResponseDto: (_type, data) => data };
  if (specifier.endsWith('/search-response.dto')) return { SearchResponseDto: class SearchResponseDto {} };
  return { searchBoards: async () => { throw new Error('unexpected board search'); },
           searchWorkspaces: async () => { throw new Error('unexpected workspace search'); },
           searchCards: async () => { throw new Error('unexpected card search'); } };
};
runInNewContext(js, { exports, require: mockRequire, Object, Promise, console, Error });

test('VT053-C08: a rejected DB transaction must not be swallowed into empty HTTP-200 data', async () => {
  const outage = new Error('VT053_DB_FAILURE');
  let called = 0;
  const service = new exports.SearchService({ manager: {
    transaction: async () => { called++; throw outage; },
  } });
  await assert.rejects(() => service.search('actor', { q: 'needle', type: 'cards' }), (err) => err === outage);
  assert.equal(called, 1);
});
