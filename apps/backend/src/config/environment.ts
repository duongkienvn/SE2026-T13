export type AppEnvironment = 'development' | 'test' | 'production';
export type LogLevel =
  'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface EnvironmentConfig {
  NODE_ENV: AppEnvironment;
  API_PORT: number;
  API_PREFIX: string;
  CORS_ORIGINS: string[];
  LOG_LEVEL: LogLevel;
  SWAGGER_ENABLED: boolean;
  DATABASE_HOST: string;
  DATABASE_PORT: number;
  DATABASE_NAME: string;
  DATABASE_USER: string;
  DATABASE_PASSWORD: string;
  DATABASE_POOL_SIZE: number;
  DATABASE_CONNECT_TIMEOUT_MS: number;
  DATABASE_SSL: boolean;
  RATE_LIMIT_TTL_MS: number;
  RATE_LIMIT_MAX: number;
}

function required(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function port(value: unknown, key: string, defaultValue?: number): number {
  if (value === undefined || value === '') {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required environment variable: ${key}`);
  }
  if (typeof value === 'string' && !/^\d+$/.test(value)) {
    throw new Error(`${key} must be an integer between 1 and 65535`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${key} must be an integer between 1 and 65535`);
  }
  return parsed;
}

function boolean(value: unknown, key: string, defaultValue: boolean): boolean {
  if (value === undefined || value === '') return defaultValue;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${key} must be true or false`);
}

function positiveInteger(
  value: unknown,
  key: string,
  defaultValue: number,
  maximum: number,
): number {
  if (value === undefined || value === '') return defaultValue;
  if (
    (typeof value === 'string' && !/^[1-9]\d*$/.test(value)) ||
    (typeof value !== 'string' && typeof value !== 'number')
  ) {
    throw new Error(`${key} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(
      `${key} must be a positive integer no greater than ${maximum}`,
    );
  }
  return parsed;
}

export function validateEnvironment(
  input: Record<string, unknown>,
): EnvironmentConfig {
  const environment = input.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(String(environment))) {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  const nodeEnv = environment as AppEnvironment;
  const apiPrefix = String(input.API_PREFIX ?? 'api').replace(/^\/+|\/+$/g, '');
  if (!/^[a-zA-Z0-9/_-]+$/.test(apiPrefix)) {
    throw new Error('API_PREFIX must be a non-empty URL path');
  }
  const origins = String(
    input.CORS_ORIGINS ??
      (nodeEnv === 'production' ? '' : 'http://localhost:5173'),
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (nodeEnv === 'production' && origins.length === 0) {
    throw new Error('CORS_ORIGINS is required in production');
  }
  if (
    origins.some((origin) => {
      try {
        const url = new URL(origin);
        return (
          !['http:', 'https:'].includes(url.protocol) || url.origin !== origin
        );
      } catch {
        return true;
      }
    })
  ) {
    throw new Error('CORS_ORIGINS must contain exact HTTP or HTTPS origins');
  }
  const level =
    input.LOG_LEVEL ?? (nodeEnv === 'production' ? 'info' : 'debug');
  if (
    !['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(
      String(level),
    )
  ) {
    throw new Error('LOG_LEVEL is invalid');
  }

  return {
    NODE_ENV: nodeEnv,
    API_PORT: port(input.API_PORT, 'API_PORT', 3000),
    API_PREFIX: apiPrefix,
    CORS_ORIGINS: origins,
    LOG_LEVEL: level as LogLevel,
    SWAGGER_ENABLED: boolean(
      input.SWAGGER_ENABLED,
      'SWAGGER_ENABLED',
      nodeEnv !== 'production',
    ),
    DATABASE_HOST: required(input, 'DATABASE_HOST'),
    DATABASE_PORT: port(input.DATABASE_PORT, 'DATABASE_PORT'),
    DATABASE_NAME: required(input, 'DATABASE_NAME'),
    DATABASE_USER: required(input, 'DATABASE_USER'),
    DATABASE_PASSWORD: required(input, 'DATABASE_PASSWORD'),
    DATABASE_POOL_SIZE: positiveInteger(
      input.DATABASE_POOL_SIZE,
      'DATABASE_POOL_SIZE',
      10,
      100,
    ),
    DATABASE_CONNECT_TIMEOUT_MS: positiveInteger(
      input.DATABASE_CONNECT_TIMEOUT_MS,
      'DATABASE_CONNECT_TIMEOUT_MS',
      5000,
      60000,
    ),
    DATABASE_SSL: boolean(input.DATABASE_SSL, 'DATABASE_SSL', false),
    RATE_LIMIT_TTL_MS: positiveInteger(
      input.RATE_LIMIT_TTL_MS,
      'RATE_LIMIT_TTL_MS',
      60000,
      3600000,
    ),
    RATE_LIMIT_MAX: positiveInteger(
      input.RATE_LIMIT_MAX,
      'RATE_LIMIT_MAX',
      120,
      10000,
    ),
  };
}
