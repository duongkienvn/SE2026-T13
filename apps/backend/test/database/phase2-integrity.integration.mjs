import assert from 'node:assert/strict';
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyPhase2Catalog } from './phase2-catalog.mjs';
import { verifyPhase2Upgrade } from './phase2-upgrade.mjs';
import { verifyPhase2Lifecycles } from './phase2-lifecycles.mjs';
import { verifyPhase2Backup } from './phase2-backup.mjs';
import { verifyPersonalWorkspaceName } from '../workspaces/personal-workspace-name.integration.mjs';

// Same disposable Docker pattern as the Workspace membership runner. No .env.
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { databaseOptions } = require('../../dist/database/database-options.js');
const container = `kanvexa-integrity-test-${randomBytes(6).toString('hex')}`;
const password = randomBytes(32).toString('hex');
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    env: { ...process.env, POSTGRES_PASSWORD: password },
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
let source,
  started = false;
try {
  docker(
    'run',
    '--detach',
    '--rm',
    '--name',
    container,
    '--publish',
    '127.0.0.1::5432',
    '--env',
    'POSTGRES_PASSWORD',
    '--env',
    'POSTGRES_USER=integrity_test',
    '--env',
    'POSTGRES_DB=integrity_test',
    'postgres:16.15-alpine3.24',
  );
  started = true;
  const port = docker(
    'inspect',
    '--format',
    '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
    container,
  );
  Object.assign(process.env, {
    DATABASE_HOST: '127.0.0.1',
    DATABASE_PORT: port,
    DATABASE_NAME: 'integrity_test',
    DATABASE_USER: 'integrity_test',
    DATABASE_PASSWORD: password,
    DATABASE_SSL: 'false',
    NODE_ENV: 'test',
    API_PREFIX: 'api',
    LOG_LEVEL: 'silent',
    GOOGLE_CLIENT_ID: '',
    JWT_SECRET: randomBytes(32).toString('hex'),
    MAIL_TRANSPORT: 'fake',
    WORKSPACE_INVITATION_ACCEPT_PATH: '',
    AVATAR_STORAGE_DRIVER: 'disabled',
    RATE_LIMIT_MAX: '10000',
    WORKSPACE_DATABASE_TESTS: 'local-only',
  });
  const options = databaseOptions(process.env);
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      source = await new DataSource(options).initialize();
      break;
    } catch (error) {
      if (attempt === 79) throw error;
      await delay(250);
    }
  }
  assert(source);
  const migrations = await source.runMigrations();
  assert.equal(migrations.length, source.migrations.length);
  assert.deepEqual(await source.runMigrations(), []);
  const [{ version }] = await source.query(
    "SELECT current_setting('server_version') AS version",
  );
  assert(version.startsWith('16.'));
  const catalog = await verifyPhase2Catalog(source, {
    write: process.argv.includes('--write-catalog'),
  });
  console.log(
    `PASS: PostgreSQL ${version}; fresh compiled chain ${migrations.length} migrations; reviewed catalogs, FK actions, columns, checks, indexes, triggers, ORM schema diff`,
  );
  await verifyPhase2Upgrade(source, catalog);
  await verifyPersonalWorkspaceName(source);
  await verifyPhase2Lifecycles(source);
  await verifyPhase2Backup(source, docker, container);
  // Existing foundation, legacy-data, API/activity and migration-negative tests
  // create their own random databases on THIS dedicated server, never app DBs.
  for (const [label, file] of [
    [
      'foundation/legacy migration',
      'test/workspaces/workspaces.integration.mjs',
    ],
    [
      'Workspace API/activity lifecycle',
      'test/workspaces/workspace-api.integration.mjs',
    ],
    [
      'database foundation',
      'test/database/database-foundation.integration.mjs',
    ],
  ]) {
    execFileSync(process.execPath, [file], {
      env: process.env,
      stdio: 'inherit',
      timeout: 180000,
    });
    console.log(`PASS: existing ${label} regression suite`);
  }
} finally {
  if (source?.isInitialized) await source.destroy();
  if (started) docker('rm', '--force', container);
}
