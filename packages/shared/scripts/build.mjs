import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(packageRoot, 'dist');

if (relative(packageRoot, dist) !== 'dist') {
  throw new Error('Unexpected shared build output path');
}

rmSync(dist, { recursive: true, force: true });

for (const config of ['tsconfig.json', 'tsconfig.cjs.json']) {
  execFileSync(
    process.execPath,
    [require.resolve('typescript/bin/tsc'), '-p', config],
    { cwd: packageRoot, stdio: 'inherit' },
  );
}

mkdirSync(resolve(dist, 'cjs'), { recursive: true });
writeFileSync(resolve(dist, 'cjs', 'package.json'), '{"type":"commonjs"}\n');
