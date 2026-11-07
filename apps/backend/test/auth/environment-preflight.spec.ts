import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const valid = {
  NODE_ENV: 'production',
  CORS_ORIGINS: 'https://kanvexa.tech',
  JWT_SECRET: 'preflight-test-only-jwt-secret-32-bytes',
  RESEND_API_KEY: 're_preflight_test_only',
  MAIL_FROM: 'Kanvexa <no-reply@kanvexa.tech>',
  PUBLIC_APP_URL: 'https://kanvexa.tech',
  DATABASE_HOST: 'unreachable.invalid',
  DATABASE_PORT: '5432',
  DATABASE_NAME: 'preflight',
  DATABASE_USER: 'preflight',
  DATABASE_PASSWORD: 'preflight-test-only-password',
};

function preflight(overrides: Record<string, string | undefined> = {}) {
  return spawnSync(
    process.execPath,
    [
      '-r',
      require.resolve('ts-node/register/transpile-only'),
      '-e',
      `
      const Module = require('node:module');
      const load = Module._load;
      Module._load = function(id, ...args) {
        if (/^(@nestjs|typeorm|pg$|@aws-sdk|resend)/.test(id))
          throw new Error('Preflight must not load application/provider modules');
        return load.call(this, id, ...args);
      };
      require('./src/config/validate-environment');
    `,
    ],
    {
      cwd: resolve(__dirname, '../..'),
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ...valid,
        ...overrides,
      },
      encoding: 'utf8',
      timeout: 15_000,
    },
  );
}

describe('validation-only deployment preflight', () => {
  it.each([
    {},
    {
      AVATAR_STORAGE_DRIVER: 's3',
      AVATAR_S3_BUCKET: 'test-avatar-bucket',
      ATTACHMENT_STORAGE_DRIVER: 's3',
      ATTACHMENT_S3_BUCKET: 'test-attachment-bucket',
      ATTACHMENT_POLICY_ACK: 'v1',
      TASK_NOTIFICATION_JOBS_ENABLED: 'true',
      TASK_NOTIFICATION_EMAIL_ENABLED: 'true',
    },
  ])(
    'accepts valid production settings without loading Nest, database or providers',
    (overrides) => {
      const result = preflight(overrides);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    },
  );

  it.each([
    { JWT_SECRET: 'short-secret' },
    { TASK_NOTIFICATION_POLL_SECONDS: '1' },
    { AVATAR_STORAGE_DRIVER: 's3', AVATAR_S3_BUCKET: '' },
    {
      ATTACHMENT_STORAGE_DRIVER: 's3',
      ATTACHMENT_S3_BUCKET: 'test-attachment-bucket',
      ATTACHMENT_POLICY_ACK: '',
    },
  ])(
    'rejects invalid production settings with secret-free diagnostics',
    (overrides) => {
      const result = preflight(overrides);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr.trim()).toBe(
        'Backend environment validation failed. Check configuration.',
      );
      for (const secret of [
        valid.JWT_SECRET,
        valid.RESEND_API_KEY,
        valid.DATABASE_PASSWORD,
        'short-secret',
      ])
        expect(result.stderr).not.toContain(secret);
    },
  );
});
