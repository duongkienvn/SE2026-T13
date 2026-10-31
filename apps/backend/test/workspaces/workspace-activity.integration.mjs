import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export async function verifyWorkspaceActivity({
  source,
  runtimeSource,
  http,
  jwt,
}) {
  const actors = {};
  const tokens = {};
  for (const role of ['admin', 'member', 'guest', 'outsider']) {
    const [user] = await source.query(
      `INSERT INTO users(email,display_name,email_verified_at) VALUES ($1,$2,now()) RETURNING id`,
      [`activity-${role}@example.test`, role],
    );
    actors[role] = user.id;
    tokens[role] = await jwt.signAsync({ sub: user.id });
  }
  const send = (actor, method, path) =>
    http[method](path).set('Authorization', `Bearer ${tokens[actor]}`);
  const personal = await Promise.all([
    send('admin', 'get', '/api/workspaces/personal').expect(200),
    send('admin', 'get', '/api/workspaces/personal').expect(200),
  ]);
  assert.equal(personal[0].body.data.id, personal[1].body.data.id);
  const [personalCount] = await source.query(
    `SELECT count(*)::int AS total FROM workspace_activities WHERE workspace_id=$1 AND event_type='WORKSPACE_CREATED'`,
    [personal[0].body.data.id],
  );
  assert.equal(personalCount.total, 1);
  const empty = (
    await send('admin', 'post', '/api/workspaces')
      .send({ name: 'Disposable activity team' })
      .expect(201)
  ).body.data;
  await send('admin', 'delete', `/api/workspaces/${empty.id}`)
    .send({ confirmationName: 'Disposable activity team' })
    .expect(204);
  const [deleted] = await source.query(
    'SELECT count(*)::int AS total FROM workspace_activities WHERE workspace_id=$1',
    [empty.id],
  );
  assert.equal(deleted.total, 0);
  const foreignKeys = await source.query(
    `SELECT conname, confdeltype FROM pg_constraint WHERE conname IN ('FK_workspace_activities_workspace','FK_workspace_activities_actor','FK_workspace_activities_board')`,
  );
  assert.deepEqual(
    Object.fromEntries(
      foreignKeys.map((row) => [row.conname, row.confdeltype]),
    ),
    {
      FK_workspace_activities_workspace: 'c',
      FK_workspace_activities_actor: 'n',
      FK_workspace_activities_board: 'c',
    },
  );
  const indexes = await source.query(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename='workspace_activities'`,
  );
  const orderIndex = indexes.find(
    (index) => index.indexname === 'IDX_workspace_activities_order',
  );
  assert.match(
    orderIndex?.indexdef ?? '',
    /workspace_id, created_at DESC, id DESC/,
  );
  assert(
    indexes.some(
      (index) =>
        index.indexname === 'IDX_workspace_activities_board' &&
        index.indexdef.includes('board_id IS NOT NULL'),
    ),
  );
  const team = (
    await send('admin', 'post', '/api/workspaces')
      .send({ name: 'Activity test' })
      .expect(201)
  ).body.data;
  await assert.rejects(
    source.query(
      `INSERT INTO workspace_activities(workspace_id,actor_id,event_type) VALUES ($1,$2,'NOT_ALLOWED')`,
      [team.id, actors.admin],
    ),
    (error) => error.code === '23514',
  );
  await assert.rejects(
    source.query(
      `INSERT INTO workspace_activities(workspace_id,actor_id,event_type) VALUES ($1,$2,'BOARD_MOVED')`,
      [team.id, actors.admin],
    ),
    (error) => error.code === '23514',
  );
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [team.id, actors.member],
  );
  const path = `/api/workspaces/${team.id}/activity`;
  for (const who of ['guest', 'outsider'])
    await send(who, 'get', path).expect(404);
  const initial = await send('member', 'get', path).expect(200);
  assert.equal(initial.headers['cache-control'], 'no-store');
  assert.equal(initial.body.meta.total, 1);
  assert.equal(initial.body.data[0].eventType, 'WORKSPACE_CREATED');
  const [temporaryBoard] = await source.query(
    `INSERT INTO boards(name,created_by_id,workspace_id,visibility) VALUES ('Disposable board',$1,$2,'PRIVATE') RETURNING id`,
    [actors.admin, team.id],
  );
  await source.query(
    `INSERT INTO workspace_activities(workspace_id,actor_id,event_type,board_id,board_move_version) VALUES ($1,$2,'BOARD_MOVED',$3,0)`,
    [team.id, actors.admin, temporaryBoard.id],
  );
  await source.query('DELETE FROM boards WHERE id=$1', [temporaryBoard.id]);
  const [boardDeleted] = await source.query(
    'SELECT count(*)::int AS total FROM workspace_activities WHERE board_id=$1',
    [temporaryBoard.id],
  );
  assert.equal(boardDeleted.total, 0);
  await assert.rejects(
    source.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO workspace_activities(workspace_id,actor_id,event_type) VALUES ($1,$2,'POLICY_UPDATED')`,
        [team.id, actors.admin],
      );
      throw new Error('rollback activity');
    }),
    /rollback activity/,
  );
  assert.equal(
    (await send('admin', 'get', path).expect(200)).body.meta.total,
    1,
  );
  const fault = {
    beforeInsert: (event) => {
      if (event.metadata.name === 'WorkspaceActivity')
        throw new Error('Injected activity write failure');
    },
  };
  runtimeSource.subscribers.push(fault);
  try {
    await send('admin', 'patch', `/api/workspaces/${team.id}`)
      .send({ name: 'Must roll back' })
      .expect(500);
  } finally {
    runtimeSource.subscribers.splice(
      runtimeSource.subscribers.indexOf(fault),
      1,
    );
  }
  assert.equal(
    (await send('admin', 'get', `/api/workspaces/${team.id}`).expect(200)).body
      .data.name,
    'Activity test',
  );
  assert.equal(
    (await send('admin', 'get', path).expect(200)).body.meta.total,
    1,
  );
  const [disposable] = await source.query(
    `INSERT INTO users(email, display_name) VALUES ('activity-disposable@example.test', 'Disposable') RETURNING id`,
  );
  await source.query(
    `INSERT INTO workspace_activities(workspace_id,actor_id,event_type) VALUES ($1,$2,'POLICY_UPDATED')`,
    [team.id, disposable.id],
  );
  await source.query('DELETE FROM users WHERE id=$1', [disposable.id]);
  const [anonymized] = await source.query(
    `SELECT actor_id FROM workspace_activities WHERE workspace_id=$1 AND event_type='POLICY_UPDATED'`,
    [team.id],
  );
  assert.equal(anonymized.actor_id, null);
  await source.query(
    `DELETE FROM workspace_activities WHERE workspace_id=$1 AND event_type='POLICY_UPDATED'`,
    [team.id],
  );
  await send('admin', 'patch', `/api/workspaces/${team.id}`)
    .send({ name: 'Activity test' })
    .expect(200);
  assert.equal(
    (await send('admin', 'get', path).expect(200)).body.meta.total,
    1,
  );
  await send('admin', 'patch', `/api/workspaces/${team.id}`)
    .send({ name: 'Renamed' })
    .expect(200);
  await send('admin', 'post', `/api/workspaces/${team.id}/invitations`)
    .send({ email: 'secret@example.test' })
    .expect(202);
  const admin = (await send('admin', 'get', `${path}?limit=1`).expect(200))
    .body;
  const member1 = (await send('member', 'get', `${path}?limit=1`).expect(200))
    .body;
  const member2 = (
    await send('member', 'get', `${path}?limit=1&page=2`).expect(200)
  ).body;
  assert.equal(admin.meta.total, 3);
  assert.equal(member1.meta.total, 2);
  assert.equal(member2.meta.total, 2);
  assert.equal(member1.data.length, 1);
  assert.equal(member2.data.length, 1);
  assert.notEqual(member1.data[0].id, member2.data[0].id);
  assert(!JSON.stringify(admin).includes('secret@example.test'));
  await send('member', 'get', `${path}?limit=101`).expect(400);
  const destination = (
    await send('member', 'post', '/api/workspaces')
      .send({ name: 'Move source' })
      .expect(201)
  ).body.data;
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [destination.id, actors.admin],
  );
  const board = (
    await send('member', 'post', '/api/boards')
      .send({ name: 'Private activity board', workspaceId: destination.id })
      .expect(201)
  ).body.data;
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [board.id, actors.guest],
  );
  await send('guest', 'get', `/api/boards/${board.id}`).expect(200);
  await send('member', 'post', `/api/boards/${board.id}/move-workspace`)
    .send({ destinationWorkspaceId: team.id })
    .expect(200);
  const hidden = (await send('admin', 'get', path).expect(200)).body;
  assert.equal(hidden.meta.total, 3);
  assert(!JSON.stringify(hidden).includes(board.id));
  await send('admin', 'post', `/api/boards/${board.id}/move-workspace`)
    .send({ destinationWorkspaceId: team.id })
    .expect(404);
  await send('member', 'post', `/api/boards/${board.id}/move-workspace`)
    .send({ destinationWorkspaceId: team.id })
    .expect(200);
  const [moveCount] = await source.query(
    `SELECT count(*)::int AS total FROM workspace_activities WHERE workspace_id=$1 AND event_type='BOARD_MOVED'`,
    [team.id],
  );
  assert.equal(moveCount.total, 1);
  await send('guest', 'get', path).expect(404);
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [board.id, actors.admin],
  );
  assert(
    (await send('admin', 'get', path).expect(200)).body.data.some(
      (event) => event.board?.id === board.id,
    ),
  );
  await source.query(
    'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
    [board.id, actors.admin],
  );
  assert(
    !(await send('admin', 'get', path).expect(200)).body.data.some(
      (event) => event.board?.id === board.id,
    ),
  );
  assert(
    (await send('member', 'get', path).expect(200)).body.data.some(
      (event) => event.board?.id === board.id,
    ),
  );
  await source.query(
    `UPDATE boards SET visibility='WORKSPACE_VISIBLE' WHERE id=$1`,
    [board.id],
  );
  assert(
    (await send('admin', 'get', path).expect(200)).body.data.some(
      (event) => event.board?.id === board.id,
    ),
  );
  await source.query(
    'UPDATE boards SET is_archived=true, archived_at=clock_timestamp() WHERE id=$1',
    [board.id],
  );
  assert(
    (await send('admin', 'get', path).expect(200)).body.data.some(
      (event) => event.board?.id === board.id,
    ),
  );
  await source.query(
    'UPDATE boards SET is_archived=false, archived_at=NULL WHERE id=$1',
    [board.id],
  );
  await send('member', 'post', `/api/boards/${board.id}/move-workspace`)
    .send({ destinationWorkspaceId: destination.id })
    .expect(200);
  await send('member', 'post', `/api/boards/${board.id}/move-workspace`)
    .send({ destinationWorkspaceId: team.id })
    .expect(200);
  const visible = (
    await send('member', 'get', path).expect(200)
  ).body.data.filter((event) => event.board?.id === board.id);
  assert.equal(visible.length, 1);
  // Count and page share one repeatable-read snapshot even if an event commits after the page query.
  const beforeSnapshot = (await send('member', 'get', path).expect(200)).body
    .meta.total;
  let inserted = false;
  const subscriber = {
    afterLoad: async (_row, event) => {
      if (inserted || event.metadata.name !== 'WorkspaceActivity') return;
      inserted = true;
      await source.query(
        `INSERT INTO workspace_activities(workspace_id,actor_id,event_type) VALUES ($1,$2,'WORKSPACE_UPDATED')`,
        [team.id, actors.admin],
      );
    },
  };
  runtimeSource.subscribers.push(subscriber);
  try {
    const snapshot = (await send('member', 'get', path).expect(200)).body;
    assert.equal(snapshot.meta.total, beforeSnapshot);
    assert.equal(snapshot.data.length, beforeSnapshot);
    assert.equal(inserted, true);
  } finally {
    runtimeSource.subscribers.splice(
      runtimeSource.subscribers.indexOf(subscriber),
      1,
    );
  }
  assert.equal(
    (await send('member', 'get', path).expect(200)).body.meta.total,
    beforeSnapshot + 1,
  );
  await send('admin', 'patch', `/api/workspaces/${team.id}/policies`)
    .send({ boardInvitesEnabled: false })
    .expect(200);
  await send('admin', 'patch', `/api/workspaces/${team.id}/policies`)
    .send({ boardInvitesEnabled: false })
    .expect(200);
  await send('member', 'patch', `/api/workspaces/${team.id}/policies`)
    .send({ boardInvitesEnabled: true })
    .expect(403);
  const rolePath = `/api/workspaces/${team.id}/members/${actors.member}`;
  await send('admin', 'patch', rolePath).send({ role: 'MEMBER' }).expect(200);
  await send('admin', 'patch', rolePath).send({ role: 'ADMIN' }).expect(200);
  await send('admin', 'patch', rolePath).send({ role: 'MEMBER' }).expect(200);
  await send('admin', 'delete', rolePath).expect(204);
  const events = await source.query(
    'SELECT event_type, count(*)::int AS total FROM workspace_activities WHERE workspace_id=$1 GROUP BY event_type',
    [team.id],
  );
  const counts = Object.fromEntries(
    events.map((event) => [event.event_type, event.total]),
  );
  assert.equal(counts.POLICY_UPDATED, 1);
  assert.equal(counts.MEMBER_ROLE_CHANGED, 2);
  assert.equal(counts.MEMBER_REMOVED, 1);
  await send('member', 'get', path).expect(404);
  // Tied database timestamps use UUID ordering and hidden invitations never create page gaps.
  const sortedTeam = (
    await send('admin', 'post', '/api/workspaces')
      .send({ name: 'Activity order' })
      .expect(201)
  ).body.data;
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [sortedTeam.id, actors.member],
  );
  const rows = await source.query(
    `INSERT INTO workspace_activities(workspace_id,actor_id,event_type,created_at)
    SELECT $1,$2,t,'2100-01-01T00:00:00Z'::timestamptz FROM unnest(ARRAY['POLICY_UPDATED','INVITATION_REQUESTED','WORKSPACE_UPDATED','INVITATION_DECLINED','MEMBER_JOINED']) AS t RETURNING id,event_type`,
    [sortedTeam.id, actors.admin],
  );
  const sortedPath = `/api/workspaces/${sortedTeam.id}/activity`;
  const firstPage = (
    await send('member', 'get', `${sortedPath}?limit=2`).expect(200)
  ).body;
  const secondPage = (
    await send('member', 'get', `${sortedPath}?limit=2&page=2`).expect(200)
  ).body;
  const expected = rows
    .filter((row) => !row.event_type.startsWith('INVITATION_'))
    .map((row) => row.id)
    .sort()
    .reverse();
  assert.equal(firstPage.meta.total, 4);
  assert.equal(secondPage.meta.total, 4);
  assert.deepEqual(
    [...firstPage.data, ...secondPage.data]
      .slice(0, 3)
      .map((event) => event.id),
    expected,
  );
  assert.equal(secondPage.data.length, 2);
  assert.equal(
    (await send('admin', 'get', sortedPath).expect(200)).body.meta.total,
    6,
  );
  const writer = source.createQueryRunner();
  await writer.connect();
  try {
    await writer.startTransaction();
    const [{ pid }] = await writer.query('SELECT pg_backend_pid() AS pid');
    await writer.query(
      `INSERT INTO workspace_activities(workspace_id,actor_id,event_type) VALUES ($1,$2,'POLICY_UPDATED')`,
      [team.id, actors.admin],
    );
    const rejected = assert.rejects(
      source.transaction((manager) =>
        source.migrations
          .find((migration) => migration.name.startsWith('WorkspaceActivity'))
          .down(manager.queryRunner),
      ),
      /Workspace activity history requires a forward fix/,
    );
    let waiting = false;
    for (let attempt = 0; attempt < 500; attempt++) {
      const [row] = await source.query(
        'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS waiting',
        [pid],
      );
      if (row.waiting) {
        waiting = true;
        break;
      }
      await delay(10);
    }
    assert.equal(
      waiting,
      true,
      'rollback waits for the concurrent activity writer',
    );
    await writer.commitTransaction();
    await rejected;
  } finally {
    if (writer.isTransactionActive) await writer.rollbackTransaction();
    await writer.release();
  }
}
