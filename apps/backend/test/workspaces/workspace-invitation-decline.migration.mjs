import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes } from 'node:crypto';

export async function verifyDeclineMigration(source) {
  const allMigrations = source.migrations;
  source.migrations = allMigrations.filter(
    (m) =>
      !m.name.startsWith('WorkspaceActivity') &&
      !m.name.startsWith('PersonalWorkspaceName'),
  );
  const before = await source.query(
    'SELECT * FROM workspace_invitations ORDER BY id',
  );
  assert(before.every((row) => row.declined_at === null));
  await source.undoLastMigration();
  assert.deepEqual(
    await source.query('SELECT * FROM workspace_invitations ORDER BY id'),
    before.map((row) => {
      const legacy = { ...row };
      delete legacy.declined_at;
      return legacy;
    }),
  );
  const [owner] = await source.query(
    'SELECT created_by_id AS id, id AS workspace FROM workspaces LIMIT 1',
  );
  const [accepted] = await source.query(
    `INSERT INTO workspace_invitations(workspace_id,email,role,token_hash,invited_by_id,expires_at,consumed_at)
    VALUES ($1,'accepted-migration@example.test','MEMBER',$2,$3,clock_timestamp()+interval '1 day',clock_timestamp()) RETURNING *`,
    [owner.workspace, randomBytes(32).toString('hex'), owner.id],
  );
  const legacy = await source.query(
    'SELECT * FROM workspace_invitations ORDER BY id',
  );
  assert.equal((await source.runMigrations()).length, 1);
  for (const row of await source.query(
    'SELECT * FROM workspace_invitations ORDER BY id',
  )) {
    assert.equal(row.declined_at, null);
    const rest = { ...row };
    delete rest.declined_at;
    assert.deepEqual(
      rest,
      legacy.find((old) => old.id === row.id),
    );
  }
  assert.equal(
    source.migrations.filter((m) =>
      m.name.startsWith('WorkspaceInvitationDecline'),
    ).length,
    1,
  );
  const open = before.find((row) => !row.revoked_at && !row.consumed_at);
  const insert = () =>
    source.query(
      `INSERT INTO workspace_invitations(workspace_id,email,role,token_hash,invited_by_id,expires_at)
    VALUES ($1,$2,'MEMBER',$3,$4,clock_timestamp()+interval '1 day')`,
      [
        open.workspace_id,
        open.email,
        randomBytes(32).toString('hex'),
        open.invited_by_id,
      ],
    );
  await assert.rejects(insert(), (error) => error.code === '23505');
  for (const sql of [
    "declined_at=created_at-interval '1 second'",
    'declined_at=expires_at',
    'declined_at=clock_timestamp(),consumed_at=clock_timestamp()',
    'declined_at=clock_timestamp(),revoked_at=clock_timestamp()',
    'consumed_at=clock_timestamp(),revoked_at=clock_timestamp()',
  ])
    await assert.rejects(
      source.query(`UPDATE workspace_invitations SET ${sql} WHERE id=$1`, [
        open.id,
      ]),
      (error) => error.code === '23514',
    );
  await assert.rejects(
    source.query(
      'UPDATE workspace_invitations SET declined_at=consumed_at WHERE id=$1',
      [accepted.id],
    ),
    (error) => error.code === '23514',
  );
  await source.query(
    'UPDATE workspace_invitations SET declined_at=clock_timestamp() WHERE id=$1',
    [open.id],
  );
  await insert(); // Declined history no longer occupies the one truly open slot.
  await assert.rejects(insert(), (error) => error.code === '23505');
  const preserved = await source.query(
    'SELECT * FROM workspace_invitations ORDER BY id',
  );
  const history = await source.query('SELECT * FROM migrations ORDER BY id');
  await assert.rejects(
    source.undoLastMigration(),
    /Cannot discard invitation decline history/,
  );
  assert.deepEqual(
    await source.query('SELECT * FROM workspace_invitations ORDER BY id'),
    preserved,
  );
  assert.deepEqual(
    await source.query('SELECT * FROM migrations ORDER BY id'),
    history,
  );
  assert.deepEqual(await source.runMigrations(), []);
  source.migrations = allMigrations;
  assert.equal((await source.runMigrations()).length, 2);
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries,
    [],
  );
  console.log(
    'PASS: Decline migration populated up/down/up, legacy preservation, terminal timestamps/exclusivity, open uniqueness, metadata and guarded rollback',
  );
}
