import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';

export function localRuntimeEnvironment({
  databasePort,
  databasePassword,
  jwtSecret,
  apiPort = '3000',
}) {
  for (const value of [databasePort, apiPort])
    assert(
      /^[1-9]\d*$/.test(value) && Number(value) <= 65535,
      'Local runtime ports must be integers between 1 and 65535',
    );
  return {
    NODE_ENV: 'test',
    DATABASE_HOST: '127.0.0.1',
    DATABASE_PORT: databasePort,
    DATABASE_NAME: 'mobile_runtime_test',
    DATABASE_USER: 'mobile_runtime',
    DATABASE_PASSWORD: databasePassword,
    DATABASE_SSL: 'false',
    JWT_SECRET: jwtSecret,
    API_PORT: apiPort,
    API_PREFIX: 'api',
    // Android's native WebSocket supplies the endpoint's HTTP Origin.
    CORS_ORIGINS: `http://localhost:5173,http://10.0.2.2:${apiPort}`,
    LOG_LEVEL: 'silent',
    MAIL_TRANSPORT: 'fake',
    PUBLIC_APP_URL: 'http://localhost:5173',
    GOOGLE_CLIENT_ID: '',
    AVATAR_STORAGE_DRIVER: 'memory',
    ATTACHMENT_STORAGE_DRIVER: 'memory',
    PUSH_NOTIFICATIONS_ENABLED: 'false',
    TASK_NOTIFICATION_JOBS_ENABLED: 'false',
    TASK_NOTIFICATION_EMAIL_ENABLED: 'false',
  };
}

async function run() {
  const require = createRequire(
    new URL('../../backend/package.json', import.meta.url),
  );
  const container = `kanvexa-mobile-runtime-${randomBytes(8).toString('hex')}`;
  const databasePassword = randomBytes(32).toString('hex');
  const docker = (...args) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      env: { ...process.env, POSTGRES_PASSWORD: databasePassword },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60_000,
    }).trim();
  // Validate the operator's only setting before creating any resources.
  const config = localRuntimeEnvironment({
    databasePort: '5432',
    databasePassword,
    jwtSecret: randomBytes(32).toString('hex'),
    apiPort: process.env.MOBILE_LOCAL_API_PORT ?? '3000',
  });
  const previousDirectory = process.cwd();
  let temporaryDirectory,
    source,
    app,
    started = false;
  let stop;
  const stopped = new Promise((done) => {
    stop = done;
  });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
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
      `POSTGRES_USER=${config.DATABASE_USER}`,
      '--env',
      `POSTGRES_DB=${config.DATABASE_NAME}`,
      'postgres:16-alpine',
    );
    started = true;
    config.DATABASE_PORT = docker(
      'inspect',
      '--format',
      '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
      container,
    );
    // AppModule normally reads ../../.env. Use an owned empty directory so the
    // fixture never reads application/provider credentials from the checkout.
    temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'kanvexa-mobile-runtime-'),
    );
    const directory = join(temporaryDirectory, 'runtime', 'app');
    await mkdir(directory, { recursive: true });
    process.chdir(directory);
    Object.assign(process.env, config);
    require('reflect-metadata');
    const { DataSource } = require('typeorm');
    const { hash } = require('argon2');
    const { databaseOptions } = require('./dist/database/database-options.js');
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        source = await new DataSource(
          databaseOptions(process.env),
        ).initialize();
        break;
      } catch (error) {
        if (attempt === 79) throw error;
        await delay(250);
      }
    }
    console.log('Applying migrations to the new disposable database.');
    await source.runMigrations();
    const passwordHash = await hash('Mob42Local!2026');
    for (const name of ['alice', 'bob'])
      await source.query(
        'INSERT INTO users(email,display_name,password_hash,email_verified_at) VALUES($1,$2,$3,now())',
        [`${name}@mob42.test`, `MOB42 ${name}`, passwordHash],
      );
    await source.destroy();
    const { createApplication } = require('./dist/main.js');
    app = await createApplication();
    await app.listen(Number(config.API_PORT), '127.0.0.1');
    console.log(
      `Local API: http://10.0.2.2:${config.API_PORT}/api (Android emulator)`,
    );
    console.log(
      'Fixtures: alice@mob42.test and bob@mob42.test; password: Mob42Local!2026',
    );
    console.log(
      'Fake mail and in-memory files only; Google and push providers are not configured.',
    );
    console.log(
      `Container: ${container}. Press Enter to close the backend and remove its database.`,
    );
    // Enter also works in Windows terminal hosts that terminate an entire
    // process tree on Ctrl+C before Node can finish its signal cleanup.
    process.stdin.once('data', stop);
    process.stdin.once('end', stop);
    process.stdin.resume();
    await stopped;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    process.stdin.removeListener('data', stop);
    process.stdin.removeListener('end', stop);
    process.stdin.pause();
    try {
      await app?.close();
    } finally {
      try {
        if (source?.isInitialized) await source.destroy();
      } finally {
        try {
          if (started) docker('rm', '--force', container);
        } finally {
          process.chdir(previousDirectory);
          if (temporaryDirectory) {
            assert.equal(
              dirname(resolve(temporaryDirectory)),
              resolve(tmpdir()),
            );
            assert(
              basename(temporaryDirectory).startsWith(
                'kanvexa-mobile-runtime-',
              ),
            );
            await rm(temporaryDirectory, { recursive: true, force: true });
          }
        }
      }
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await run();
