import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function databaseOptions(env: NodeJS.ProcessEnv): DataSourceOptions {
  const extension = __filename.endsWith('.ts') ? 'ts' : 'js';
  return {
    type: 'postgres',
    host: required(env, 'DATABASE_HOST'),
    port: Number(required(env, 'DATABASE_PORT')),
    database: required(env, 'DATABASE_NAME'),
    username: required(env, 'DATABASE_USER'),
    password: required(env, 'DATABASE_PASSWORD'),
    uuidExtension: 'pgcrypto',
    entities: [
      join(__dirname, '..', 'api', '**', 'entities', `*.entity.${extension}`),
    ],
    migrations: [join(__dirname, 'migrations', `*.${extension}`)],
    synchronize: false,
    migrationsRun: false,
  };
}
