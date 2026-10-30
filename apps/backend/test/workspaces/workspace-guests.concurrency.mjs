import assert from 'node:assert/strict';
import console from 'node:console';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { createGuestFixture } from './workspace-guests.integration.mjs';

const require = createRequire(import.meta.url);
const {
  WorkspacesService,
} = require('../../dist/api/workspaces/workspaces.service.js');

async function waitForBlocked(source, pid) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const [row] = await source.query(
      'SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
      [pid],
    );
    if (row.n > 0) return;
    await delay(10);
  }
  assert.fail('Expected a real PostgreSQL lock waiter');
}

// Test-only barrier inside the real repeatable-read transaction; no sleeps to guess ordering.
function pauseRead(ctx, afterPage = false) {
  const foundation = ctx.app.get(WorkspacesService);
  const original = foundation.requireMember;
  let signal, resume;
  const ready = new Promise((resolve) => {
    signal = resolve;
  });
  const gate = new Promise((resolve) => {
    resume = resolve;
  });
  foundation.requireMember = async function (actor, workspaceId, manager) {
    const result = await original.call(this, actor, workspaceId, manager);
    if (actor === ctx.actors.member && workspaceId === ctx.team.id) {
      const [{ pid }] = await manager.query('SELECT pg_backend_pid() AS pid');
      if (afterPage) {
        const runner = manager.queryRunner;
        const query = runner.query;
        runner.query = async function (sql, ...args) {
          const rows = await query.call(this, sql, ...args);
          if (/FROM "users" "user"/.test(sql) && !/COUNT\(/.test(sql)) {
            runner.query = query;
            signal(pid);
            await gate;
          }
          return rows;
        };
      } else {
        signal(pid);
        await gate;
      }
    }
    return result;
  };
  return {
    ready: () =>
      Promise.race([
        ready,
        delay(6000, undefined, { ref: false }).then(() =>
          assert.fail('Guest read barrier not reached'),
        ),
      ]),
    resume,
    restore: () => {
      foundation.requireMember = original;
    },
  };
}

export async function verifyGuestRaces(base) {
  const ctx = await createGuestFixture(base);
  const { source, send, actors, root, team, a } = ctx;
  const runner = source.createQueryRunner();
  await runner.connect();
  let reading;
  try {
    // Revocation already owns the Workspace lock before a new request authorizes.
    await runner.startTransaction();
    const [{ pid }] = await runner.query('SELECT pg_backend_pid() AS pid');
    await runner.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [
      team.id,
    ]);
    await runner.query(
      'DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
      [team.id, actors.member],
    );
    reading = send('member', 'get', root).then((response) => response);
    await waitForBlocked(source, pid);
    await runner.commitTransaction();
    const denied = await reading;
    assert.equal(denied.status, 404);
    assert.equal(denied.body.message, 'Workspace not found');
    assert(!JSON.stringify(denied.body).includes('Alpha Guest'));
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await Promise.allSettled([reading].filter(Boolean));
    await runner.release();
  }
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [team.id, actors.member],
  );

  // A Board revocation between user paging and association/count queries cannot mix snapshots.
  let barrier = pauseRead(ctx, true);
  try {
    reading = send('member', 'get', `${root}?limit=2`).then(
      (response) => response,
    );
    await barrier.ready();
    await send(
      'admin',
      'delete',
      `/api/boards/${a.id}/members/${actors.member}`,
    ).expect(204);
    barrier.resume();
    const prior = await reading;
    assert.equal(prior.status, 200);
    assert.equal(prior.body.meta.total, 3);
    assert.equal(prior.body.data.length, 2);
    const guest = prior.body.data.find((row) => row.user.id === actors.guest);
    assert.equal(guest.visibleBoardCount, 2);
    assert(guest.boards.some((board) => board.boardId === a.id));
  } finally {
    barrier.restore();
    barrier.resume();
    await Promise.allSettled([reading].filter(Boolean));
  }
  const fresh = await send('member', 'get', root).expect(200);
  assert.equal(fresh.body.meta.total, 1);
  assert.equal(fresh.body.data[0].visibleBoardCount, 1);
  assert(!JSON.stringify(fresh.body).includes(a.id));
  assert(!JSON.stringify(fresh.body).includes(actors.guest2));
  assert.equal(
    (await send('member', 'get', `${root}?search=Same`).expect(200)).body.meta
      .total,
    0,
  );

  // A read that owns the grant first finishes before the Workspace removal can commit.
  barrier = pauseRead(ctx);
  let removing;
  try {
    reading = send('member', 'get', root).then((response) => response);
    const pid = await barrier.ready();
    removing = send(
      'admin',
      'delete',
      `/api/workspaces/${team.id}/members/${actors.member}`,
    ).then((response) => response);
    await waitForBlocked(source, pid);
    barrier.resume();
    assert.equal((await reading).status, 200);
    assert.equal((await removing).status, 204);
  } finally {
    barrier.restore();
    barrier.resume();
    await Promise.allSettled([reading, removing].filter(Boolean));
  }
  await send('member', 'get', root).expect(404);
  console.log(
    'PASS: Guest snapshot/page/count/association consistency during Board revocation, both Workspace read/removal lock orders, and fresh-request denial',
  );
}
