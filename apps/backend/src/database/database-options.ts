import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined || value === '') return fallback;
  if (!/^[1-9]\d*$/.test(value))
    throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum)
    throw new Error(`${name} must be at most ${maximum}`);
  return parsed;
}

function databaseSsl(value: string | undefined): boolean {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error('DATABASE_SSL must be true or false');
}

export function databaseOptions(env: NodeJS.ProcessEnv): DataSourceOptions {
  const extension = __filename.endsWith('.ts') ? 'ts' : 'js';
  return {
    type: 'postgres',
    host: required(env, 'DATABASE_HOST'),
    port: boundedInteger(
      required(env, 'DATABASE_PORT'),
      5432,
      65535,
      'DATABASE_PORT',
    ),
    database: required(env, 'DATABASE_NAME'),
    username: required(env, 'DATABASE_USER'),
    password: required(env, 'DATABASE_PASSWORD'),
    poolSize: boundedInteger(
      env.DATABASE_POOL_SIZE,
      10,
      100,
      'DATABASE_POOL_SIZE',
    ),
    connectTimeoutMS: boundedInteger(
      env.DATABASE_CONNECT_TIMEOUT_MS,
      5000,
      60000,
      'DATABASE_CONNECT_TIMEOUT_MS',
    ),
    ssl: databaseSsl(env.DATABASE_SSL),
    logging: false,
    uuidExtension: 'pgcrypto',
    entities: [
      join(__dirname, '..', 'api', '**', 'entities', `*.entity.${extension}`),
    ],
    migrations: [join(__dirname, 'migrations', `*.${extension}`)],
    synchronize: false,
    migrationsRun: false,
  };
}
