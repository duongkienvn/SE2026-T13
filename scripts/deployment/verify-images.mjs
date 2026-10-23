import assert from 'node:assert/strict';
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const tag = process.env.IMAGE_TAG;
assert(tag && tag !== 'latest', 'Set IMAGE_TAG to the built release tag');
const frontend = `${process.env.FRONTEND_IMAGE || 'kanvexa-frontend'}:${tag}`;
const backend = `${process.env.BACKEND_IMAGE || 'kanvexa-backend'}:${tag}`;
function docker(args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

for (const file of ['Caddyfile', 'Caddyfile.local']) {
  docker([
    'run',
    '--rm',
    '--network',
    'none',
    '--entrypoint',
    'caddy',
    frontend,
    'validate',
    '--config',
    `/etc/caddy/${file}`,
    '--adapter',
    'caddyfile',
  ]);
  console.log(`PASS Caddy validation: ${file}`);
}
const image = JSON.parse(docker(['image', 'inspect', backend]))[0];
assert.equal(image.Config.User, 'node');
assert.deepEqual(image.Config.Cmd, ['node', 'dist/main.js']);
assert(image.Config.Healthcheck.Test.join(' ').includes('/health/ready'));
docker([
  'run',
  '--rm',
  '--network',
  'none',
  '--read-only',
  '--cap-drop',
  'ALL',
  '--entrypoint',
  'node',
  backend,
  '-e',
  `
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const argon2 = require('argon2');
  require('pg'); require('@kanban/shared'); require('typeorm');
  require.resolve('typeorm/cli.js');
  assert(fs.existsSync('dist/main.js'));
  assert(fs.readdirSync('dist/database/migrations').some(f => f.endsWith('.js')));
  assert(!fs.existsSync('src'));
  assert(!fs.existsSync('.env'));
  assert(!fs.existsSync('node_modules/@kanban/shared/src'));
  assert(!fs.existsSync('node_modules/jest'));
  assert(!fs.existsSync('node_modules/ts-node'));
  argon2.hash('runtime-verification-only').then(async hash => {
    assert(await argon2.verify(hash, 'runtime-verification-only'));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
`,
]);
console.log(
  'PASS non-root read-only backend: native argon2, pg, shared CommonJS, compiled migrations, no host secrets or development runtime',
);

const files = docker([
  'run',
  '--rm',
  '--network',
  'none',
  '--entrypoint',
  'sh',
  frontend,
  '-c',
  'test ! -e /srv/src && test ! -e /srv/node_modules && test ! -e /srv/.env && cat /srv/assets/*.js',
]);
assert(files.includes('/api'), 'Frontend must include the relative API base');
assert(
  !files.includes('http://localhost:3000'),
  'Development API origin leaked into the production bundle',
);
console.log(
  'PASS frontend bundle: same-origin API configuration and static-only runtime',
);
