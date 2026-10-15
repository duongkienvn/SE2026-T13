import { validateEnvironment } from '../src/config/environment';

const baseEnvironment = {
  NODE_ENV: 'test',
  API_PORT: '3000',
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: '5432',
  DATABASE_NAME: 'test',
  DATABASE_USER: 'test',
  DATABASE_PASSWORD: 'secret',
  JWT_SECRET: 'test-secret-that-is-at-least-32-bytes-long',
};

describe('JWT environment configuration', () => {
  it('rejects a missing secret during application startup validation', () => {
    const input = { ...baseEnvironment, JWT_SECRET: undefined };

    expect(() => validateEnvironment(input)).toThrow('JWT_SECRET');
  });

  it('rejects a secret shorter than 32 bytes', () => {
    const input = { ...baseEnvironment, JWT_SECRET: 'too-short' };

    expect(() => validateEnvironment(input)).toThrow('32 bytes');
  });
});
