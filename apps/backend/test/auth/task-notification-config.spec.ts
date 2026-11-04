import { validateEnvironment } from '../../src/config/environment';

const base = {
  NODE_ENV: 'test',
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: '5432',
  DATABASE_NAME: 'test',
  DATABASE_USER: 'test',
  DATABASE_PASSWORD: 'secret',
  JWT_SECRET: 'test-secret-that-is-at-least-32-bytes-long',
};

describe('task notification configuration', () => {
  it('defaults to disabled jobs and email', () => {
    expect(validateEnvironment(base)).toMatchObject({
      TASK_NOTIFICATION_JOBS_ENABLED: false,
      TASK_NOTIFICATION_EMAIL_ENABLED: false,
      TASK_NOTIFICATION_POLL_SECONDS: 60,
      TASK_NOTIFICATION_BATCH_SIZE: 50,
    });
  });

  it('validates flags and bounds', () => {
    for (const [key, value] of [
      ['TASK_NOTIFICATION_JOBS_ENABLED', 'yes'],
      ['TASK_NOTIFICATION_EMAIL_ENABLED', '1'],
      ['TASK_NOTIFICATION_POLL_SECONDS', '14'],
      ['TASK_NOTIFICATION_POLL_SECONDS', '301'],
      ['TASK_NOTIFICATION_BATCH_SIZE', '0'],
      ['TASK_NOTIFICATION_BATCH_SIZE', '501'],
    ]) {
      expect(() => validateEnvironment({ ...base, [key]: value })).toThrow(key);
    }
    expect(
      validateEnvironment({
        ...base,
        TASK_NOTIFICATION_JOBS_ENABLED: 'true',
        TASK_NOTIFICATION_EMAIL_ENABLED: 'true',
        TASK_NOTIFICATION_POLL_SECONDS: '15',
        TASK_NOTIFICATION_BATCH_SIZE: '1',
      }),
    ).toMatchObject({
      TASK_NOTIFICATION_JOBS_ENABLED: true,
      TASK_NOTIFICATION_EMAIL_ENABLED: true,
      TASK_NOTIFICATION_POLL_SECONDS: 15,
      TASK_NOTIFICATION_BATCH_SIZE: 1,
    });
  });
});
