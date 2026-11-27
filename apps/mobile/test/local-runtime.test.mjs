import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localRuntimeEnvironment } from '../scripts/local-backend.mjs';

test('native runtime fixture fixes its database and providers to disposable local resources', () => {
  const config = localRuntimeEnvironment({
    databasePort: '54321',
    databasePassword: 'ephemeral-database-password',
    jwtSecret: 'ephemeral-signing-key'.repeat(3),
    apiPort: '3300',
  });
  assert.equal(config.NODE_ENV, 'test');
  assert.equal(config.DATABASE_HOST, '127.0.0.1');
  assert.equal(config.DATABASE_PORT, '54321');
  assert.equal(config.DATABASE_NAME, 'mobile_runtime_test');
  assert.equal(config.DATABASE_SSL, 'false');
  assert.equal(config.API_PORT, '3300');
  assert.equal(
    config.CORS_ORIGINS,
    'http://localhost:5173,http://10.0.2.2:3300',
  );
  assert.equal(config.MAIL_TRANSPORT, 'fake');
  assert.equal(config.AVATAR_STORAGE_DRIVER, 'memory');
  assert.equal(config.ATTACHMENT_STORAGE_DRIVER, 'memory');
  assert.equal(config.PUSH_NOTIFICATIONS_ENABLED, 'false');
  assert.equal(config.GOOGLE_CLIENT_ID, '');
});

test('native runtime fixture rejects invalid host port inputs before starting services', () => {
  for (const apiPort of ['0', '65536', '-1', '3000;anything', '']) {
    assert.throws(() =>
      localRuntimeEnvironment({ databasePort: '54321', apiPort }),
    );
  }
  assert.throws(() =>
    localRuntimeEnvironment({ databasePort: 'not-a-port', apiPort: '3000' }),
  );
});
