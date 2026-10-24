import assert from 'node:assert/strict';
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { http, smoke } from './smoke.mjs';

assert(
  process.env.IMAGE_TAG && process.env.IMAGE_TAG !== 'latest',
  'Build both images and set IMAGE_TAG first',
);
// This script owns only its randomly named Compose project and temporary volumes.
const project = `kanvexa-smoke-${randomBytes(6).toString('hex')}`;
const env = {
  ...process.env,
  DATABASE_NAME: 'smoke',
  DATABASE_USER: 'smoke',
  DATABASE_PASSWORD: randomBytes(32).toString('hex'),
  JWT_SECRET: randomBytes(48).toString('base64'),
  RESEND_API_KEY: 're_local_fake_transport_only',
  MAIL_FROM: 'Kanvexa <no-reply@kanvexa.tech>',
  PUBLIC_APP_URL: 'http://localhost:8080',
};
const args = [
  'compose',
  '--project-name',
  project,
  '--env-file',
  '.env.production.example',
  '-f',
  'compose.prod.yml',
  '-f',
  'compose.local.yml',
];
function compose(...command) {
  return execFileSync('docker', [...args, ...command], {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
  });
}
async function json(path, body, token) {
  const response = await http('http://localhost:8080', path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert(response.ok, `${path}: HTTP ${response.status}`);
  return (await response.json()).data;
}

async function waitForIngress() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await http('http://localhost:8080', '/health/ready')).ok) return;
    } catch {
      // Published connections can reset while Docker/Caddy restarts.
    }
    await delay(500);
  }
  throw new Error('Caddy ingress did not become ready within 30 seconds');
}

try {
  console.log(
    `Starting isolated local project ${project}; no production env or database is used.`,
  );
  compose('up', '-d', '--wait', '--wait-timeout', '120', 'postgres');
  const pending = compose('run', '--rm', 'migrate');
  assert.match(pending, /\[ \]/, 'Fresh database must have pending migrations');
  compose(
    'run',
    '--rm',
    'migrate',
    'migration:run',
    '-d',
    'dist/database/data-source.js',
  );
  assert.doesNotMatch(compose('run', '--rm', 'migrate'), /\[ \]/);
  compose(
    'up',
    '--no-build',
    '-d',
    '--wait',
    '--wait-timeout',
    '120',
    'backend',
    'frontend',
  );
  await waitForIngress();
  const password = `Aa1!${randomBytes(24).toString('base64')}`;
  const email = `${project}@example.test`;
  await json('/api/auth/register', {
    email,
    password,
    displayName: 'Infrastructure smoke',
  });
  // This isolated database has no real mail provider. Explicitly verify only
  // this smoke account in its disposable project before testing authenticated UI.
  compose(
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'smoke',
    '-d',
    'smoke',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `UPDATE users SET email_verified_at = now() WHERE email = '${email}'`,
  );
  const { accessToken } = await json('/api/auth/login', { email, password });
  const board = await json(
    '/api/boards',
    { name: 'Persistent infrastructure smoke' },
    accessToken,
  );
  await smoke('http://localhost:8080', accessToken);
  compose(
    'exec',
    '-T',
    'backend',
    'node',
    '-e',
    "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
  );
  compose('stop', 'postgres');
  assert.equal((await http('http://localhost:8080', '/health')).status, 200);
  assert.equal(
    (await http('http://localhost:8080', '/health/ready')).status,
    503,
  );
  console.log(
    'PASS database outage: liveness stays 200, readiness becomes 503',
  );
  compose('up', '-d', '--wait', '--wait-timeout', '120', 'postgres');
  compose('restart', 'backend', 'frontend');
  compose(
    'up',
    '--no-build',
    '-d',
    '--wait',
    '--wait-timeout',
    '120',
    'backend',
    'frontend',
  );
  await waitForIngress();
  const persisted = await json(
    `/api/boards/${board.id}`,
    undefined,
    accessToken,
  );
  assert.equal(persisted.id, board.id);
  await smoke('http://localhost:8080', accessToken);
  console.log(
    'PASS explicit compiled migrations, native password hashing, restart, database volume persistence and recovery',
  );
} catch (error) {
  // Container logs can contain operational data; do not dump environments/secrets.
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  assert.match(project, /^kanvexa-smoke-[a-f0-9]{12}$/);
  compose('down', '--volumes', '--remove-orphans');
  console.log(
    `Removed only the temporary project ${project} and its test volumes.`,
  );
}
