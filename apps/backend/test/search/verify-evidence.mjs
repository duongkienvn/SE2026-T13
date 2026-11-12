import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Replays tracked historical source/tests in a temporary directory. The mutation
// executes the SAME current oracle with only its service-source path changed.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const evidence = join(root, 'docs/assignments/VT-053/evidence');
const temporary = mkdtempSync(join(tmpdir(), 'kanvexa-vt053-'));
mkdirSync(evidence, { recursive: true });
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
const record = (name, args, env = {}) => {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  assert.ifError(result.error);
  writeFileSync(
    join(evidence, `${name}.txt`),
    `HEAD=${git('rev-parse', 'HEAD').trim()}\nNode=${process.version}\nCOMMAND=node ${args.join(' ')}\n` +
      (env.VT053_SERVICE_SOURCE
        ? `VT053_SERVICE_SOURCE=${env.VT053_SERVICE_SOURCE}\n`
        : '') +
      result.stdout +
      result.stderr +
      `\nEXIT_CODE=${result.status}\n`,
  );
  console.log(`${name}: exit ${result.status}`);
  return result;
};
const hash = (text) => createHash('sha256').update(text).digest('hex');

try {
  const mode = process.argv[2];
  if (mode === 'history') {
    const testPath = 'apps/backend/test/search/board-scope.contract.mjs';
    const sourcePath = 'apps/backend/src/api/search/card-board-scope.ts';
    const test = git('show', `b5b3814:${testPath}`);
    const target = join(temporary, testPath);
    mkdirSync(dirname(target), { recursive: true });
    mkdirSync(dirname(join(temporary, sourcePath)), { recursive: true });
    writeFileSync(target, test);
    for (const [name, commit, expected] of [
      ['history-red', 'b5b3814', 1],
      ['history-green', 'b591929', 0],
    ]) {
      const source = git('show', `${commit}:${sourcePath}`);
      writeFileSync(join(temporary, sourcePath), source);
      const result = record(name, [
        '--experimental-strip-types',
        '--test',
        target,
      ]);
      assert.equal(result.status, expected, result.stdout + result.stderr);
      if (expected === 1) assert.match(result.stdout, /# fail 2/);
      const log = join(evidence, `${name}.txt`);
      writeFileSync(
        log,
        readFileSync(log, 'utf8') +
          `SOURCE_COMMIT=${git('rev-parse', commit).trim()}\nTEST_COMMIT=${git('rev-parse', 'b5b3814').trim()}\n` +
          `SOURCE_SHA256=${hash(source)}\nTEST_SHA256=${hash(test)}\n`,
      );
    }
  } else if (mode === 'mutation') {
    const sourcePath = join(
      root,
      'apps/backend/src/api/search/search.service.ts',
    );
    const original = readFileSync(sourcePath, 'utf8');
    const needle = /\n {4}\);\r?\n {2}}\r?\n}\s*$/;
    assert.match(original, needle);
    const mutant = original.replace(
      needle,
      '\n    ).catch(() => toResponseDto(SearchResponseDto, result));\n  }\n}\n',
    );
    assert.notEqual(mutant, original);
    const mutantPath = join(temporary, 'search.service.mutant.ts');
    writeFileSync(mutantPath, mutant);
    const args = [
      '--test',
      'apps/backend/test/search/search-error.contract.mjs',
    ];
    assert.equal(
      record('mutation-original', args, { VT053_SERVICE_SOURCE: sourcePath })
        .status,
      0,
    );
    const killed = record('mutation-mutant', args, {
      VT053_SERVICE_SOURCE: mutantPath,
    });
    assert.equal(killed.status, 1);
    assert.match(killed.stdout, /Missing expected rejection/);
    assert.match(killed.stdout, /# fail 2/);
    assert.equal(
      record('mutation-restored', args, { VT053_SERVICE_SOURCE: sourcePath })
        .status,
      0,
    );
    assert.equal(hash(readFileSync(sourcePath, 'utf8')), hash(original));
    writeFileSync(
      join(evidence, 'mutation-summary.txt'),
      `HEAD=${git('rev-parse', 'HEAD').trim()}\n` +
        `ORIGINAL_SOURCE_SHA256=${hash(original)}\nRESTORED_SOURCE_SHA256=${hash(readFileSync(sourcePath, 'utf8'))}\n` +
        `MUTATION=append .catch(() => toResponseDto(SearchResponseDto, result)) to transaction promise\n` +
        'ORIGINAL_EXIT=0\nMUTANT_EXIT=1\nRESTORED_EXIT=0\nASSERTION=Missing expected rejection.\nKILLED_TESTS=2\n',
    );
  } else throw new Error('Choose history or mutation');
} finally {
  // Only the directory returned by mkdtempSync above is removed.
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  assert.ok(basename(temporary).startsWith('kanvexa-vt053-'));
  rmSync(temporary, { recursive: true, force: true });
}
