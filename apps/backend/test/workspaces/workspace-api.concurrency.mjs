import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const {
  WorkspaceApiService,
} = require('../../dist/api/workspaces/workspace-api.service.js');
const {
  WorkspaceBoardsService,
} = require('../../dist/api/workspaces/workspace-boards.service.js');
const { BoardsService } = require('../../dist/api/boards/boards.service.js');
const {
  WorkspacesService,
} = require('../../dist/api/workspaces/workspaces.service.js');

async function waitForBlocked(source, pid, minimum = 1) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const [row] = await source.query(
      'SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
      [pid],
    );
    if (row.n >= minimum) return;
    await delay(10);
  }
  assert.fail('Expected an actual PostgreSQL lock waiter');
}

export async function verifyConcurrency(ctx) {
  const { source, app, runtimeSource, actors, team, send } = ctx;
  const service = app.get(WorkspaceApiService);
  const boardService = app.get(BoardsService);
  const queries = app.get(WorkspaceBoardsService);
  const foundation = app.get(WorkspacesService);
  const memberRepo = source.getRepository('WorkspaceMember');
  await memberRepo.insert({
    workspaceId: team.id,
    userId: actors.member,
    role: 'MEMBER',
  });
  await Promise.all([
    service.update(actors.admin, team.id, { name: 'Concurrent name' }),
    service.update(actors.admin, team.id, {
      description: 'Concurrent description',
    }),
  ]);
  const updated = await service.detail(actors.admin, team.id);
  assert.equal(updated.name, 'Concurrent name');
  assert.equal(updated.description, 'Concurrent description');
  const duplicates = await Promise.all([
    service.create(actors.admin, { name: 'Same name' }),
    service.create(actors.admin, { name: 'Same name' }),
  ]);
  assert.notEqual(duplicates[0].id, duplicates[1].id);
  for (const workspace of duplicates)
    assert.equal(
      await memberRepo.countBy({ workspaceId: workspace.id, role: 'ADMIN' }),
      1,
    );

  // Real DB insert failure after Workspace/Board INSERT must roll back the entire operation.
  const fault = {
    beforeInsert: (event) => {
      if (
        ['WorkspaceMember', 'BoardMember'].includes(event.metadata.name) &&
        event.entity.userId === actors.outsider
      )
        event.entity.role = 'INVALID';
    },
  };
  await foundation.ensurePersonalWorkspace(actors.outsider);
  const before = await source.getRepository('Workspace').count();
  runtimeSource.subscribers.push(fault);
  try {
    await assert.rejects(
      service.create(actors.outsider, { name: 'Rollback Team' }),
    );
    await assert.rejects(
      boardService.create(actors.outsider, { name: 'Rollback Board' }),
    );
  } finally {
    runtimeSource.subscribers.splice(
      runtimeSource.subscribers.indexOf(fault),
      1,
    );
  }
  assert.equal(await source.getRepository('Workspace').count(), before);
  assert.equal(
    await source.getRepository('Board').countBy({ name: 'Rollback Board' }),
    0,
  );
  assert.equal(
    await source.getRepository('Workspace').countBy({ name: 'Rollback Team' }),
    0,
  );

  // Revocation wins before a waiting create/overview can inspect the grant.
  const runner = source.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction();
    const [{ pid }] = await runner.query('SELECT pg_backend_pid() AS pid');
    await runner.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [
      team.id,
    ]);
    await runner.query(
      'DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
      [team.id, actors.member],
    );
    const create = boardService.create(actors.member, {
      name: 'Removed in flight',
      workspaceId: team.id,
    });
    const createRejected = assert.rejects(
      create,
      (e) => e.getStatus?.() === 404,
    );
    const readRejected = assert.rejects(
      queries.overview(actors.member, team.id),
      (e) => e.getStatus?.() === 404,
    );
    await waitForBlocked(source, pid, 2);
    await runner.commitTransaction();
    await Promise.all([createRejected, readRejected]);
    assert.equal(
      await source
        .getRepository('Board')
        .countBy({ name: 'Removed in flight' }),
      0,
    );
    await send('member', 'get', `/api/workspaces/${team.id}`).expect(404);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
  // Holding a read grant prevents membership deletion from overtaking that read.
  await memberRepo.insert({
    workspaceId: team.id,
    userId: actors.member,
    role: 'MEMBER',
  });
  const reader = source.createQueryRunner();
  await reader.connect();
  try {
    await reader.startTransaction();
    const [{ pid }] = await reader.query('SELECT pg_backend_pid() AS pid');
    await foundation.requireMember(actors.member, team.id, reader.manager);
    const removal = memberRepo.delete({
      workspaceId: team.id,
      userId: actors.member,
    });
    await waitForBlocked(source, pid);
    await reader.commitTransaction();
    await removal;
  } finally {
    if (reader.isTransactionActive) await reader.rollbackTransaction();
    await reader.release();
  }
  await source.query(
    'UPDATE users SET auth_version=auth_version+1 WHERE id=$1',
    [actors.admin],
  );
  await send('admin', 'get', '/api/workspaces').expect(401);
  const [deleted] = await source.query(
    `INSERT INTO users(email,display_name,email_verified_at) VALUES ('deleted@example.test','Deleted',now()) RETURNING id`,
  );
  const token = await ctx.jwt.signAsync({ sub: deleted.id });
  await source.query('DELETE FROM users WHERE id=$1', [deleted.id]);
  await ctx.http
    .get('/api/workspaces')
    .set('Authorization', `Bearer ${token}`)
    .expect(401);
}
