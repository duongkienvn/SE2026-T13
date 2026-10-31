import assert from 'node:assert/strict';
import console from 'node:console';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  WorkspacesService,
} = require('../../dist/api/workspaces/workspaces.service.js');

/** Called only on the integrity runner's owned disposable PostgreSQL server. */
export async function verifyPersonalWorkspaceName(source) {
  const service = new WorkspacesService(source.getRepository('Workspace'));
  const user = async (name) =>
    (
      await source.query(
        'INSERT INTO users(email,display_name) VALUES ($1,$1) RETURNING id',
        [`${name}@naming.example.test`],
      )
    )[0];
  await source.undoLastMigration(); // Naming function only: reproduce the real pre-upgrade path.
  const legacy = await user('legacy');
  const custom = await user('custom');
  const oldWorkspace = await service.ensurePersonalWorkspace(legacy.id);
  const customWorkspace = await service.ensurePersonalWorkspace(custom.id);
  assert.equal(oldWorkspace.name, 'Personal Workspace');
  await source.query(
    "UPDATE workspaces SET name='My custom workspace' WHERE id=$1",
    [customWorkspace.id],
  );
  const snapshot = () =>
    source.query(
      'SELECT to_jsonb(w) AS row FROM workspaces w WHERE id=ANY($1::uuid[]) ORDER BY id',
      [[oldWorkspace.id, customWorkspace.id]],
    );
  const before = await snapshot();
  assert.deepEqual(
    (await source.runMigrations()).map((migration) => migration.name),
    ['PersonalWorkspaceName1793577600000'],
  );
  await service.ensurePersonalWorkspace(legacy.id);
  await service.ensurePersonalWorkspace(custom.id);
  assert.deepEqual(
    await snapshot(),
    before,
    'Migration/ensure must not rename or rewrite old/custom Workspaces',
  );
  const account = await user('concurrent');
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      service.ensurePersonalWorkspace(account.id),
    ),
  );
  assert(
    results.every(
      (workspace) =>
        workspace.name === 'Kanvexa Workspace' &&
        workspace.id === results[0].id,
    ),
  );
  assert.equal(
    await source.getRepository('WorkspaceMember').countBy({
      workspaceId: results[0].id,
      userId: account.id,
      role: 'ADMIN',
    }),
    1,
  );
  assert.equal(
    await source
      .getRepository('Workspace')
      .countBy({ createdById: account.id, type: 'PERSONAL' }),
    1,
  );
  const bridgeUser = await user('bridge');
  await source.query(
    "INSERT INTO boards(name,created_by_id) VALUES ('Old writer Board',$1)",
    [bridgeUser.id],
  );
  assert.equal(
    (await service.findPersonalWorkspace(bridgeUser.id)).name,
    'Kanvexa Workspace',
  );
  await assert.rejects(
    source.transaction(async (manager) => {
      const [rollback] = await manager.query(
        "INSERT INTO users(email,display_name) VALUES ('rollback@naming.example.test','Rollback') RETURNING id",
      );
      await service.ensurePersonalWorkspace(rollback.id, manager);
      throw new Error('naming rollback');
    }),
    /naming rollback/,
  );
  assert.equal(
    (
      await source.query(
        "SELECT id FROM users WHERE email='rollback@naming.example.test'",
      )
    ).length,
    0,
  );
  const namesBeforeDown = await source.query(
    'SELECT id,name FROM workspaces ORDER BY id',
  );
  await source.undoLastMigration();
  assert.deepEqual(
    await source.query('SELECT id,name FROM workspaces ORDER BY id'),
    namesBeforeDown,
  );
  await source.runMigrations();
  assert.deepEqual(
    await source.query('SELECT id,name FROM workspaces ORDER BY id'),
    namesBeforeDown,
  );
  console.log(
    'PASS: future Personal default across service/legacy bridge; old/custom names and timestamps unchanged; concurrent uniqueness, rollback and data-preserving naming down/up',
  );
}
