import assert from 'node:assert/strict';
import console from 'node:console';
import { createRequire } from 'node:module';
import { phase2Catalog } from './phase2-catalog.mjs';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');

// pg_dump/restore re-parses varchar IN checks: an array-level ::text[] cast
// can become per-element ::text casts. Normalize ONLY that lossless rewrite;
// preserve literals, order, operators, names, FK actions and every other field.
function dumpCatalog(catalog) {
  return {
    ...catalog,
    constraints: catalog.constraints.map((constraint) => ({
      ...constraint,
      definition:
        constraint.type === 'c'
          ? constraint.definition.replace(
              /\(\(ARRAY\[((?:'[^']*'::character varying)(?:, '[^']*'::character varying)*)\]\)::text\[\]\)/g,
              (_match, values) =>
                `(ARRAY[${values
                  .split(', ')
                  .map((value) => `(${value})::text`)
                  .join(', ')}])`,
            )
          : constraint.definition,
    })),
  };
}

async function fingerprints(source) {
  const tables = await source.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
  );
  const result = {};
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    result[tablename] = await source.query(`SELECT count(*)::int AS count,
      md5(COALESCE(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text),'')) AS checksum FROM "${tablename}" t`);
  }
  return result;
}

/** Synthetic data only, dump stays inside the owned container until cleanup. */
export async function verifyPhase2Backup(source, docker, container) {
  const before = await fingerprints(source);
  docker(
    'exec',
    container,
    'pg_dump',
    '--username=integrity_test',
    '--dbname=integrity_test',
    '--format=custom',
    '--file=/tmp/phase2-audit.dump',
  );
  await source.query('CREATE DATABASE integrity_restore');
  let restored;
  try {
    docker(
      'exec',
      container,
      'pg_restore',
      '--username=integrity_test',
      '--dbname=integrity_restore',
      '--exit-on-error',
      '--single-transaction',
      '--no-owner',
      '/tmp/phase2-audit.dump',
    );
    restored = await new DataSource({
      ...source.options,
      database: 'integrity_restore',
    }).initialize();
    assert.deepEqual(
      dumpCatalog(await phase2Catalog(restored)),
      dumpCatalog(await phase2Catalog(source)),
    );
    assert.deepEqual(await fingerprints(restored), before);
    assert.deepEqual(await restored.runMigrations(), []);
    assert.deepEqual(
      (await restored.driver.createSchemaBuilder().log()).upQueries,
      [],
    );
    console.log(
      'PASS: synthetic pg_dump/pg_restore into a separate empty database; all public table counts/content fingerprints, catalog and migration history preserved',
    );
  } finally {
    if (restored?.isInitialized) await restored.destroy();
    await source.query('DROP DATABASE integrity_restore');
  }
}
