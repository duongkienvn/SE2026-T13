import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each([undefined, '', 'false', 'TRUE', '1', 'true'])(
  'enables task email controls only for the explicit Vite build value %s',
  async (value) => {
    vi.stubEnv('VITE_TASK_EMAIL_ENABLED', value);
    vi.stubEnv('TASK_NOTIFICATION_EMAIL_ENABLED', 'true');
    const { env } = await import('./env');
    expect(env.taskEmailEnabled).toBe(value === 'true');
  },
);
