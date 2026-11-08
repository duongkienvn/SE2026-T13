import assert from 'node:assert/strict';
import console from 'node:console';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const directory = resolve(process.argv[2] ?? 'dist/android');
const maps = readdirSync(directory, { recursive: true }).filter((file) =>
  file.endsWith('.map'),
);
assert.ok(maps.length > 0, `No native source maps found in ${directory}`);
const metadata = JSON.parse(
  readFileSync(resolve(directory, 'metadata.json'), 'utf8'),
);
const approvedLogo = readFileSync(
  new URL('../assets/brand/kanvexa-logo-v1.png', import.meta.url),
);
for (const platform of Object.values(metadata.fileMetadata)) {
  assert.ok(
    platform.assets.some((asset) =>
      readFileSync(resolve(directory, asset.path.replaceAll('\\', '/'))).equals(
        approvedLogo,
      ),
    ),
    'The exported native assets must include the original Kanvexa logo',
  );
}

function collectSources(map) {
  return map.sections
    ? map.sections.flatMap((section) => collectSources(section.map))
    : map.sources;
}

for (const file of maps) {
  const sources = collectSources(
    JSON.parse(readFileSync(resolve(directory, file), 'utf8')),
  ).map((source) => source.replaceAll('\\', '/'));
  for (const required of [
    '/apps/mobile/src/app/index.tsx',
    '/packages/shared/dist/esm/enums/board-role.js',
  ]) {
    assert.ok(
      sources.some((source) => source.endsWith(required)),
      required,
    );
  }
  const forbidden = sources.filter(
    (source) =>
      /apps\/(frontend|backend)\//.test(source) ||
      /node_modules\/(react-dom|react-native-web|jsdom|@expo\/dom-webview)\//.test(
        source,
      ) ||
      /(?:^|external:)node:/.test(source) ||
      /node_modules\/(node-libs[^/]*|node-stdlib-browser|browserify-[^/]*)\//.test(
        source,
      ),
  );
  assert.deepEqual(
    forbidden,
    [],
    'Native graph must not contain Web/server code or Node shims',
  );
  console.log(
    `Verified ${file}: ${sources.length} native sources, shared ESM and approved logo`,
  );
}
