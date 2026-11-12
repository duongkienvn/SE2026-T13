import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';

assert.equal(process.env.EXPORT_DATABASE_TESTS, 'local-only');
assert.equal(process.env.DATABASE_HOST, '127.0.0.1');
assert.equal(process.env.DATABASE_PORT, '55454');
assert.equal(process.env.DATABASE_NAME, 'vt054_test');
assert.notEqual(process.env.NODE_ENV, 'production');
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { databaseOptions } = require('../../dist/database/database-options.js');
const options = databaseOptions(process.env);
const admin = new Client({ ...options, user: options.username });
const database = `vt054_schema_${randomBytes(8).toString('hex')}`;
let source,
  created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  source = await new DataSource({ ...options, database }).initialize();
  await source.runMigrations();
  const runner = source.createQueryRunner();
  try {
    assert.equal(
      await runner.hasTable('board_export_jobs'),
      true,
      'VT-054 requires a durable board_export_jobs table',
    );
  } finally {
    await runner.release();
  }
  const [{ definition }] =
    await source.query(`SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conname='UQ_board_export_jobs_operation'`);
  assert.match(definition, /UNIQUE \(user_id, idempotency_key\)/);
  assert.equal(source.options.synchronize, false);
  assert.equal(source.options.migrationsRun, false);
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries,
    [],
  );
  console.log(
    'PASS: durable job table, unique operation identity, explicit migration, no schema drift',
  );
} finally {
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
