import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { test } from 'node:test';

const env = {
  ...process.env,
  DATABASE_NAME: 'configuration_test',
  DATABASE_USER: 'configuration_test',
  DATABASE_PASSWORD: 'validation-only-not-a-deployment-password',
  JWT_SECRET: 'validation-only-not-a-deployment-jwt-secret',
  GOOGLE_CLIENT_ID: '123456-infra.apps.googleusercontent.com',
  VITE_GOOGLE_CLIENT_ID: '123456-infra.apps.googleusercontent.com',
  RESEND_API_KEY: 're_configuration_test_only',
  MAIL_FROM: 'Kanvexa <no-reply@kanvexa.tech>',
  PUBLIC_APP_URL: 'https://kanvexa.tech',
  IMAGE_TAG: 'configuration-test',
  BACKEND_IMAGE: 'kanvexa-backend',
  FRONTEND_IMAGE: 'kanvexa-frontend',
};
const args = [
  'compose',
  '--env-file',
  '.env.production.example',
  '-f',
  'compose.prod.yml',
];
function config(local = false) {
  return JSON.parse(
    execFileSync(
      'docker',
      [
        ...args,
        ...(local ? ['-f', 'compose.local.yml'] : []),
        '--profile',
        'tools',
        'config',
        '--format',
        'json',
      ],
      { env, encoding: 'utf8' },
    ),
  );
}

test('production publishes only Caddy and isolates the database network', () => {
  const result = config();
  assert.deepEqual(Object.keys(result.services).sort(), [
    'backend',
    'frontend',
    'migrate',
    'postgres',
  ]);
  for (const name of ['backend', 'postgres', 'migrate']) {
    assert.equal(
      result.services[name].ports,
      undefined,
      `${name} must stay private`,
    );
    assert.equal(result.services[name].container_name, undefined);
  }
  assert.deepEqual(
    result.services.frontend.ports.map((p) => [p.target, p.protocol]),
    [
      [80, 'tcp'],
      [443, 'tcp'],
      [443, 'udp'],
    ],
  );
  assert.equal(result.networks.database.internal, true);
  assert.deepEqual(Object.keys(result.services.postgres.networks), [
    'database',
  ]);
  assert.deepEqual(Object.keys(result.services.frontend.networks), [
    'application',
  ]);
  assert.deepEqual(Object.keys(result.services.backend.networks).sort(), [
    'application',
    'database',
  ]);
});

test('runtime, migrations, readiness and resource limits are explicit', () => {
  const { services, volumes } = config();
  assert.deepEqual(Object.keys(volumes).sort(), [
    'caddy_config',
    'caddy_data',
    'postgres_data',
  ]);
  assert.equal(services.backend.environment.NODE_ENV, 'production');
  assert.equal(services.backend.environment.SWAGGER_ENABLED, 'false');
  assert.equal(
    services.backend.environment.CORS_ORIGINS,
    'https://kanvexa.tech',
  );
  assert.equal(services.backend.environment.TRUST_PROXY_HOPS, '1');
  assert.equal(services.backend.environment.RESEND_API_KEY, env.RESEND_API_KEY);
  assert.equal(services.backend.environment.MAIL_FROM, env.MAIL_FROM);
  assert.equal(services.backend.environment.PUBLIC_APP_URL, env.PUBLIC_APP_URL);
  for (const name of ['frontend', 'postgres', 'migrate'])
    assert.equal(services[name].environment?.RESEND_API_KEY, undefined);
  assert.equal(services.backend.environment.DATABASE_HOST, 'postgres');
  assert.equal(services.backend.init, true);
  assert.equal(services.backend.read_only, true);
  assert.equal(
    services.backend.depends_on.postgres.condition,
    'service_healthy',
  );
  assert.equal(
    services.frontend.depends_on.backend.condition,
    'service_healthy',
  );
  assert.deepEqual(services.frontend.build.args, {
    VITE_API_BASE_URL: '/api',
    VITE_GOOGLE_CLIENT_ID: env.VITE_GOOGLE_CLIENT_ID,
  });
  assert.equal(
    services.backend.environment.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_ID,
  );
  for (const name of ['frontend', 'postgres', 'migrate'])
    assert.equal(services[name].environment?.GOOGLE_CLIENT_ID, undefined);
  assert.deepEqual(services.migrate.profiles, ['tools']);
  assert.equal(services.migrate.image, services.backend.image);
  assert.deepEqual(services.migrate.entrypoint, [
    'node',
    'node_modules/typeorm/cli.js',
  ]);
  assert.deepEqual(services.migrate.command, [
    'migration:show',
    '-d',
    'dist/database/data-source.js',
  ]);
  for (const name of ['frontend', 'backend', 'postgres']) {
    assert.equal(services[name].restart, 'unless-stopped');
    assert.equal(services[name].logging.options['max-size'], '10m');
    assert.equal(services[name].logging.options['max-file'], '3');
    assert(services[name].mem_limit > 0);
  }
  assert(
    Object.values(services)
      .filter((s) => !s.profiles)
      .reduce((sum, s) => sum + Number(s.mem_limit), 0) <=
      1280 * 1024 * 1024,
  );
  const databaseOptions = readFileSync(
    'apps/backend/src/database/database-options.ts',
    'utf8',
  );
  assert.match(databaseOptions, /synchronize: false/);
  assert.match(databaseOptions, /migrationsRun: false/);
});

test('missing release tags or secrets fail before containers can start', () => {
  for (const name of [
    'IMAGE_TAG',
    'DATABASE_NAME',
    'DATABASE_USER',
    'DATABASE_PASSWORD',
    'JWT_SECRET',
    'RESEND_API_KEY',
    'MAIL_FROM',
    'PUBLIC_APP_URL',
  ]) {
    const result = spawnSync('docker', [...args, 'config', '--quiet'], {
      env: { ...env, [name]: '' },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, `Missing ${name} must fail`);
    assert.match(result.stderr, new RegExp(name));
  }
});

test('OAuth configuration is public build data and optional backend runtime data', () => {
  const dockerfile = readFileSync('apps/frontend/Dockerfile', 'utf8');
  assert.deepEqual(
    [...dockerfile.matchAll(/^ARG (\w+)/gm)].map((m) => m[1]),
    ['VITE_API_BASE_URL', 'VITE_GOOGLE_CLIENT_ID'],
  );
  assert.match(dockerfile, /VITE_GOOGLE_CLIENT_ID="\$VITE_GOOGLE_CLIENT_ID"/);
  assert.doesNotMatch(
    dockerfile,
    /JWT_SECRET|RESEND_API_KEY|GOOGLE_CLIENT_SECRET/,
  );
  const routes = readFileSync('infra/caddy/routes.caddy', 'utf8');
  assert.match(routes, /Cross-Origin-Opener-Policy same-origin-allow-popups/);
  assert.match(routes, /Referrer-Policy strict-origin-when-cross-origin/);
  const disabled = JSON.parse(
    execFileSync('docker', [...args, 'config', '--format', 'json'], {
      env: { ...env, GOOGLE_CLIENT_ID: '', VITE_GOOGLE_CLIENT_ID: '' },
      encoding: 'utf8',
    }),
  );
  assert.equal(disabled.services.backend.environment.GOOGLE_CLIENT_ID, '');
  assert.equal(disabled.services.frontend.build.args.VITE_GOOGLE_CLIENT_ID, '');
});

test('local HTTP override replaces every public binding without changing production HTTPS', () => {
  const local = config(true);
  assert.equal(local.services.backend.environment.NODE_ENV, 'test');
  assert.deepEqual(
    local.services.frontend.ports.map((p) => [
      p.host_ip,
      p.published,
      p.target,
    ]),
    [['127.0.0.1', '8080', 80]],
  );
  assert.equal(
    local.services.backend.environment.CORS_ORIGINS,
    'http://localhost:8080',
  );
  const file = local.services.frontend.volumes.find(
    (v) => v.target === '/etc/caddy/Caddyfile',
  );
  assert.equal(file.read_only, true);
  assert.match(
    file.source.replaceAll('\\', '/'),
    /infra\/caddy\/Caddyfile.local$/,
  );
  const production = readFileSync('infra/caddy/Caddyfile', 'utf8');
  assert.match(production, /^kanvexa\.tech\s*\{/);
  assert.doesNotMatch(production, /auto_https off|http:\/\//);
});
