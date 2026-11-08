import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const { runBuild } = require('@expo/metro/metro');
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function collectSources(map) {
  return map.sections
    ? map.sections.flatMap((section) => collectSources(section.map))
    : map.sources;
}

test('Metro evaluates shared ESM runtime exports for Android without source aliases', async () => {
  const config = require('../metro.config.cjs');
  const bundle = await runBuild(
    {
      ...config,
      maxWorkers: 2,
      reporter: { update() {} },
      serializer: {
        ...config.serializer,
        // The fixture exercises pure contracts without launching React Native.
        getModulesRunBeforeMainModule: () => [],
      },
    },
    {
      entry: resolve(projectRoot, 'test/fixtures/shared-entry.ts'),
      platform: 'android',
      dev: false,
      minify: false,
      sourceMap: true,
    },
  );
  const sources = collectSources(JSON.parse(bundle.map)).map((path) =>
    path.replaceAll('\\', '/'),
  );
  assert.ok(
    sources.some((path) => path.endsWith('packages/shared/dist/esm/index.js')),
    'Metro must honor the existing shared import export',
  );
  assert.ok(
    sources.some((path) =>
      path.endsWith('packages/shared/dist/esm/enums/board-role.js'),
    ),
  );
  assert.ok(
    !sources.some((path) => /packages\/shared\/(src|dist\/cjs)\//.test(path)),
  );
  assert.ok(!sources.some((path) => /apps\/(backend|frontend)\//.test(path)));

  const context = {};
  runInNewContext(bundle.code, context, { timeout: 5000 });
  assert.equal(context.__kanvexaSharedRole, 'MEMBER');
});

test('native logo is the unmodified approved transparent PNG', () => {
  assert.deepEqual(
    readFileSync(resolve(projectRoot, 'assets/brand/kanvexa-logo-v1.png')),
    readFileSync(
      resolve(projectRoot, '../../docs/mobile/assets/kanvexa-logo-v1.png'),
    ),
  );
});
