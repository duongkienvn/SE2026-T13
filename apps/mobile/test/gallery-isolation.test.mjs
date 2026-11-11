import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';

const script = fileURLToPath(
  new URL('../scripts/verify-native-bundle.mjs', import.meta.url),
);
const logo = fileURLToPath(
  new URL('../assets/brand/kanvexa-logo-v1.png', import.meta.url),
);

test('production bundle audit rejects development gallery sources', () => {
  const root = realpathSync(resolve(tmpdir()));
  const directory = realpathSync(
    mkdtempSync(join(root, 'kanvexa-gallery-audit-')),
  );
  const relativeDirectory = relative(root, directory);
  assert.ok(
    relativeDirectory &&
      !relativeDirectory.startsWith('..') &&
      !isAbsolute(relativeDirectory),
  );
  try {
    copyFileSync(logo, join(directory, 'logo.png'));
    writeFileSync(
      join(directory, 'metadata.json'),
      JSON.stringify({
        fileMetadata: { android: { assets: [{ path: 'logo.png' }] } },
      }),
    );
    const sources = [
      '/repo/apps/mobile/src/app/index.tsx',
      '/repo/packages/shared/dist/esm/enums/board-role.js',
    ];
    const audit = () =>
      spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
    writeFileSync(join(directory, 'bundle.map'), JSON.stringify({ sources }));
    assert.equal(audit().status, 0);
    writeFileSync(
      join(directory, 'bundle.map'),
      JSON.stringify({
        sources: [...sources, '/repo/apps/mobile/gallery/Gallery.tsx'],
      }),
    );
    const result = audit();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /development gallery/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
