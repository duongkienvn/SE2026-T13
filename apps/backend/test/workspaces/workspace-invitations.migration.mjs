import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

export async function verifyInvitationMigration(source) {
  const migrations = source.migrations;
  const lifecycle = migrations.find((m) =>
    m.name.startsWith('WorkspaceInvitationLifecycle'),
  );
  const policies = migrations.find((m) =>
    m.name.startsWith('WorkspacePolicies'),
  );
  source.migrations = migrations.filter(
    (m) => m !== lifecycle && m !== policies,
  );
  await source.runMigrations();
  const [user] = await source.query(
    `INSERT INTO users(email,display_name) VALUES ('migration@example.test','Migration') RETURNING id`,
  );
  const [workspace] = await source.query(
    `INSERT INTO workspaces(type,name,created_by_id) VALUES ('TEAM','Legacy',$1) RETURNING id`,
    [user.id],
  );
  for (let i = 0; i < 2; i++)
    await source.query(
      `INSERT INTO workspace_invitations(workspace_id,email,role,token_hash,invited_by_id,expires_at)
    VALUES ($1,'duplicate@example.test','MEMBER',$2,$3,now()+interval '1 day')`,
      [workspace.id, randomBytes(32).toString('hex'), user.id],
    );
  const before = await source.query(
    'SELECT * FROM workspace_invitations ORDER BY id',
  );
  source.migrations = migrations.filter((m) => m !== policies);
  await assert.rejects(source.runMigrations(), /Duplicate open invitations/);
  assert.deepEqual(
    await source.query('SELECT * FROM workspace_invitations ORDER BY id'),
    before,
  );
  // Explicit remediation in this test fixture only; migration never chooses a survivor.
  await source.query(
    `UPDATE workspace_invitations SET revoked_at=clock_timestamp() WHERE id=$1`,
    [before[1].id],
  );
  const preserved = await source.query(
    'SELECT * FROM workspace_invitations ORDER BY id',
  );
  assert.equal((await source.runMigrations()).length, 1);
  for (const row of await source.query(
    'SELECT * FROM workspace_invitations ORDER BY id',
  )) {
    assert.equal(row.send_state, 'UNAVAILABLE');
    const legacy = { ...row };
    delete legacy.send_state;
    assert.deepEqual(
      legacy,
      preserved.find((item) => item.id === row.id),
    );
  }
  await source.undoLastMigration();
  assert.deepEqual(
    await source.query('SELECT * FROM workspace_invitations ORDER BY id'),
    preserved,
  );
  assert.equal((await source.runMigrations()).length, 1);
  source.migrations = migrations;
  assert.equal((await source.runMigrations()).length, 1);
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries,
    [],
  );
}
