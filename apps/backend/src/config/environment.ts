export type AppEnvironment = 'development' | 'test' | 'production';
export type MailTransport = 'fake' | 'resend';
export type LogLevel =
  'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface EnvironmentConfig {
  NODE_ENV: AppEnvironment;
  API_PORT: number;
  API_PREFIX: string;
  CORS_ORIGINS: string[];
  LOG_LEVEL: LogLevel;
  SWAGGER_ENABLED: boolean;
  TRUST_PROXY_HOPS: 0 | 1;
  JWT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  MAIL_TRANSPORT: MailTransport;
  RESEND_API_KEY: string;
  MAIL_FROM: string;
  PUBLIC_APP_URL: string;
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
  const jwtSecret = required(input, 'JWT_SECRET');
  const googleClientId = input.GOOGLE_CLIENT_ID ?? '';
  if (
    typeof googleClientId !== 'string' ||
    (googleClientId !== '' &&
      !/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(
        googleClientId,
      ))
  )
    throw new Error(
      'GOOGLE_CLIENT_ID must be a Web OAuth client ID or empty to disable Google sign-in',
    );
  if (Buffer.byteLength(jwtSecret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be at least 32 bytes');
  }
  const trustProxyHops = input.TRUST_PROXY_HOPS ?? '0';
  if (
    trustProxyHops !== 0 &&
    trustProxyHops !== 1 &&
    trustProxyHops !== '0' &&
    trustProxyHops !== '1'
  ) {
    throw new Error('TRUST_PROXY_HOPS must be 0 (direct) or 1 (private proxy)');
  }

  const production = nodeEnv === 'production';
  const requestedTransport =
    input.MAIL_TRANSPORT === undefined
      ? production
        ? 'resend'
        : 'fake'
      : input.MAIL_TRANSPORT;
  if (requestedTransport !== 'fake' && requestedTransport !== 'resend')
    throw new Error('MAIL_TRANSPORT must be fake or resend');
  if (production && requestedTransport !== 'resend')
    throw new Error('MAIL_TRANSPORT must be resend in production');
  // Test processes never use real delivery, even if the local .env enables it.
  const mailTransport = nodeEnv === 'test' ? 'fake' : requestedTransport;
  const useResend = mailTransport === 'resend';
  const resendKey = useResend ? required(input, 'RESEND_API_KEY') : '';
  const mailFrom = useResend
    ? required(input, 'MAIL_FROM')
    : 'Kanvexa <no-reply@kanvexa.tech>';
  const appUrl = useResend
    ? required(input, 'PUBLIC_APP_URL')
    : String(input.PUBLIC_APP_URL ?? 'http://localhost:5173');
  if (useResend && !/^re_[A-Za-z0-9_-]{10,}$/.test(resendKey))
    throw new Error('RESEND_API_KEY is invalid');
  if (!/^[^<>\r\n]+ <[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$/.test(mailFrom))
    throw new Error('MAIL_FROM must be a display name and email address');
  try {
    const url = new URL(appUrl);
    if (
      url.origin !== appUrl ||
      (url.protocol !== 'https:' &&
        (production ||
          url.protocol !== 'http:' ||
          !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    )
      throw new Error();
  } catch {
    throw new Error(
      'PUBLIC_APP_URL must be an exact HTTPS origin (HTTP loopback allowed outside production)',
    );
  }

  return {
    MAIL_TRANSPORT: mailTransport,
    RESEND_API_KEY: resendKey,
    MAIL_FROM: mailFrom,
    PUBLIC_APP_URL: appUrl,
    NODE_ENV: nodeEnv,
    API_PORT: port(input.API_PORT, 'API_PORT', 3000),
    API_PREFIX: apiPrefix,
    CORS_ORIGINS: origins,
    LOG_LEVEL: level as LogLevel,
    JWT_SECRET: jwtSecret,
    GOOGLE_CLIENT_ID: googleClientId,
    TRUST_PROXY_HOPS: Number(trustProxyHops) as 0 | 1,
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
