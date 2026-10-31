import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';

const tables = [
  'workspaces',
  'workspace_members',
  'workspace_invitations',
  'boards',
  'board_members',
  'board_workspace_moves',
  'deleted_workspace_invitation_quota',
  'workspace_activities',
];
const actions = {
  a: 'NO ACTION',
  r: 'RESTRICT',
  c: 'CASCADE',
  n: 'SET NULL',
  d: 'SET DEFAULT',
  ' ': '',
};

/** Schema metadata only; never selects application rows, proofs or credentials. */
export async function phase2Catalog(source) {
  const columns = await source.query(
    `SELECT c.relname AS table_name, a.attname AS name,
    format_type(a.atttypid,a.atttypmod) AS type, NOT a.attnotnull AS nullable,
    pg_get_expr(d.adbin,d.adrelid) AS default_value
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])
    ORDER BY c.relname,a.attnum`,
    [tables],
  );
  const constraints = await source.query(
    `SELECT c.relname AS table_name, k.conname AS name,
    k.contype AS type, pg_get_constraintdef(k.oid) AS definition,
    k.convalidated AS validated, k.condeferrable AS deferrable, k.condeferred AS deferred,
    CASE WHEN k.contype='f' THEN k.confdeltype ELSE NULL END AS delete_action
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[])
    ORDER BY c.relname,k.conname`,
    [tables],
  );
  const indexes = await source.query(
    `SELECT tablename AS table_name,indexname AS name,indexdef AS definition
    FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,indexname`,
    [tables],
  );
  const triggers = await source.query(
    `SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled,
    pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,t.tgname`,
    [tables],
  );
  const references = await source.query(
    `SELECT c.relname AS table_name,k.conname AS name,
    pg_get_constraintdef(k.oid) AS definition,k.confdeltype AS delete_action
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
    JOIN pg_class target ON target.oid=k.confrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE k.contype='f' AND n.nspname='public' AND target.relname=ANY($1::text[])
    ORDER BY c.relname,k.conname`,
    [['users', 'boards', 'workspaces']],
  );
  return { columns, constraints, indexes, triggers, references };
}

function inventory(catalog) {
  const cell = (value) =>
    String(value ?? '—')
      .replaceAll('|', '\\|')
      .replaceAll('\n', ' ');
  const row = (...values) => `| ${values.map(cell).join(' | ')} |`;
  const lines = [
    '# Phase 2 PostgreSQL schema inventory',
    '',
    'Generated from a disposable PostgreSQL 16 database by `test:phase2-integrity:database`.',
    'Schema only; no application data. See [audit and policy findings](phase2-database-integrity.md).',
    'The test compares this reviewed inventory to both fresh and upgraded catalogs.',
    '',
  ];
  for (const table of tables) {
    lines.push(
      `## ${table}`,
      '',
      '| Column | PostgreSQL type | Nullable | Default |',
      '| --- | --- | --- | --- |',
    );
    for (const column of catalog.columns.filter(
      (item) => item.table_name === table,
    ))
      lines.push(
        row(column.name, column.type, column.nullable, column.default_value),
      );
    lines.push(
      '',
      '| Constraint | Kind | Definition | ON DELETE | Validated | Deferrable |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const constraint of catalog.constraints.filter(
      (item) => item.table_name === table,
    ))
      lines.push(
        row(
          constraint.name,
          constraint.type,
          constraint.definition,
          actions[constraint.delete_action] || '—',
          constraint.validated,
          constraint.deferrable,
        ),
      );
    lines.push('', '| Index | Definition |', '| --- | --- |');
    for (const index of catalog.indexes.filter(
      (item) => item.table_name === table,
    ))
      lines.push(row(index.name, index.definition));
    for (const trigger of catalog.triggers.filter(
      (item) => item.table_name === table,
    ))
      lines.push(
        '',
        `Trigger ${trigger.name} (enabled=${trigger.enabled}):`,
        '',
        '```sql',
        trigger.definition,
        '```',
      );
    lines.push('');
  }
  lines.push(
    '## All inbound User, Board and Workspace foreign keys',
    '',
    '| Table | Constraint | Definition | ON DELETE |',
    '| --- | --- | --- | --- |',
  );
  for (const reference of catalog.references)
    lines.push(
      row(
        reference.table_name,
        reference.name,
        reference.definition,
        actions[reference.delete_action],
      ),
    );
  return lines.join('\n') + '\n';
}

export async function verifyPhase2Catalog(source, { write = false } = {}) {
  assert.equal(source.options.synchronize, false);
  assert.equal(source.options.migrationsRun, false);
  const catalog = await phase2Catalog(source);
  assert(
    catalog.constraints.every(
      (item) => item.validated && !item.deferrable && !item.deferred,
    ),
  );
  // Migration-only audit/anti-abuse ledgers intentionally are not ORM entities.
  for (const table of [
    'board_workspace_moves',
    'deleted_workspace_invitation_quota',
  ])
    assert(
      !source.entityMetadatas.some((metadata) => metadata.tableName === table),
    );
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries,
    [],
  );
  const expectedActions = {
    FK_workspaces_creator: 'a',
    FK_workspace_members_workspace: 'a',
    FK_workspace_members_user: 'a',
    FK_workspace_invitations_workspace: 'a',
    FK_workspace_invitations_inviter: 'a',
    FK_boards_workspace: 'a',
    board_workspace_moves_board_id_fkey: 'a',
    board_workspace_moves_actor_id_fkey: 'a',
    FK_workspace_activities_workspace: 'c',
    FK_workspace_activities_actor: 'n',
    FK_workspace_activities_board: 'c',
  };
  for (const [name, action] of Object.entries(expectedActions))
    assert.equal(
      catalog.constraints.find((item) => item.name === name)?.delete_action,
      action,
      name,
    );
  assert.equal(
    catalog.constraints.filter(
      (item) => item.table_name === 'deleted_workspace_invitation_quota',
    ).length,
    1,
  );
  assert.equal(
    catalog.constraints.filter(
      (item) =>
        item.table_name === 'board_workspace_moves' && item.type === 'f',
    ).length,
    2,
  );
  const document = new URL(
    '../../../../docs/tasks/backend/phase2-schema-inventory.md',
    import.meta.url,
  );
  // Use the repo's formatter so the checked-in evidence follows repository style.
  const prettier = await import('prettier');
  const formatted = await prettier.format(inventory(catalog), {
    parser: 'markdown',
  });
  if (write) await writeFile(document, formatted);
  else
    assert.equal(
      (await readFile(document, 'utf8')).replaceAll('\r\n', '\n'),
      formatted,
      'Reviewed catalog inventory drift',
    );
  return catalog;
}
