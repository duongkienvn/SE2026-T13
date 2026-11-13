import assert from 'node:assert/strict';
import console from 'node:console';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
const require = createRequire(import.meta.url);
const store = resolve('node_modules/.pnpm'),
  packages = await readdir(store);
function installed(name) {
  const directory = packages.find((value) => value.startsWith(`${name}@`));
  assert.ok(
    directory,
    `${name} must already exist in the pnpm lockfile installation`,
  );
  return require(join(store, directory, 'node_modules', name));
}
const convert = installed('v8-to-istanbul'),
  { createCoverageMap } = installed('istanbul-lib-coverage');
const map = createCoverageMap({});
const directories = process.argv.slice(2);
assert.ok(directories.length);
for (const directory of directories)
  for (const file of await readdir(directory)) {
    if (!file.endsWith('.json')) continue;
    const raw = JSON.parse(await readFile(join(directory, file), 'utf8'));
    for (const script of raw.result) {
      if (!script.url.startsWith('file:')) continue;
      const path = fileURLToPath(script.url);
      if (
        !/[/\\]apps[/\\]backend[/\\]dist[/\\]api[/\\]exports[/\\](export-jobs\.service|export-jobs\.worker|export-job-policy|exports\.controller)\.js$/.test(
          path,
        )
      )
        continue;
      const converter = convert(path);
      await converter.load();
      converter.applyCoverage(script.functions);
      map.merge(converter.toIstanbul());
    }
  }
const report = {
  tool: 'Node V8 block coverage converted with existing v8-to-istanbul + TypeScript source maps; not the same branch metric as Jest Istanbul instrumentation',
  files: {},
};
for (const file of map.files())
  report.files[file] = {
    ...map.fileCoverageFor(file).toSummary().toJSON(),
    uncoveredLines: map.fileCoverageFor(file).getUncoveredLines(),
  };
assert.ok(
  Object.keys(report.files).length >= 3,
  'Coverage must include the actual service/worker/controller, not only policy',
);
await writeFile(
  'docs/assignments/VT-054/evidence/coverage-integration.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
