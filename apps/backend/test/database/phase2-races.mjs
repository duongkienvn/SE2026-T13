import assert from 'node:assert/strict';
import console from 'node:console';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { waitForBlocked } from '../workspaces/workspace-invitations.concurrency.mjs';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');
const outcome = (promise) =>
  promise.then(
    (value) => ({ code: 200, value }),
    (error) => ({ code: error.getStatus?.() ?? error.code, error }),
  );

async function waiters(source, pid, count) {
  for (let attempt = 0; attempt < 300; attempt++) {
    // A later row-lock waiter can be blocked by the earlier queued waiter,
    // rather than directly by our gate. Observe the complete blocking chain.
    const [{ n }] = await source.query(
      `WITH RECURSIVE wait_chain(pid) AS (
      SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))
      UNION SELECT a.pid FROM pg_stat_activity a JOIN wait_chain w ON w.pid=ANY(pg_blocking_pids(a.pid))
      WHERE a.datname=current_database()) SELECT count(*)::int AS n FROM wait_chain`,
      [pid],
    );
    if (n >= count) return;
    await delay(10);
  }
  assert.fail(`Expected ${count} real database lock waiters`);
}

/** All contenders use separate pools AND separate in-process coordinators. */
export async function verifyPhase2Races(source, build, owner) {
  const instances = [
    new DataSource({ ...source.options, poolSize: 3 }),
    new DataSource({ ...source.options, poolSize: 3 }),
  ];
  try {
    await Promise.all(instances.map((instance) => instance.initialize()));
    const [a, b] = instances.map(build);
    const team = (label) => a.api.create(owner.id, { name: label });
    for (const first of ['move', 'delete']) {
      const origin = await team(`Move race origin ${first}`),
        target = await team(`Move race target ${first}`);
      const board = await a.boards.create(owner.id, {
        name: 'Move/delete lock order',
        workspaceId: origin.id,
      });
      const blocker = source.createQueryRunner();
      const pending = [];
      try {
        await blocker.startTransaction();
        const [{ pid }] = await blocker.query('SELECT pg_backend_pid() AS pid');
        await blocker.query(
          'SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',
          [target.id],
        );
        const move = () => outcome(a.move.move(owner.id, board.id, target.id));
        const remove = () =>
          outcome(b.deletion.remove(owner.id, target.id, target.name));
        pending.push(first === 'move' ? move() : remove());
        await waitForBlocked(source, pid);
        pending.push(first === 'move' ? remove() : move());
        await waiters(source, pid, 2);
        await blocker.commitTransaction();
        const [firstResult, secondResult] = await Promise.all(pending);
        assert.deepEqual(
          [firstResult.code, secondResult.code],
          first === 'move' ? [200, 409] : [200, 404],
        );
        const [state] = await source.query(
          'SELECT workspace_id,activity_move_version FROM boards WHERE id=$1',
          [board.id],
        );
        assert.equal(
          state.workspace_id,
          first === 'move' ? target.id : origin.id,
        );
        assert.equal(state.activity_move_version, first === 'move' ? 1 : 0);
        assert.equal(
          (
            await source.query(
              'SELECT id FROM board_workspace_moves WHERE board_id=$1',
              [board.id],
            )
          ).length,
          first === 'move' ? 1 : 0,
        );
      } finally {
        if (blocker.isTransactionActive) await blocker.rollbackTransaction();
        await blocker.release();
        await Promise.allSettled(pending);
      }
    }

    const origin = await team('Two moves origin'),
      one = await team('Two moves one'),
      two = await team('Two moves two');
    const board = await a.boards.create(owner.id, {
      name: 'Independent instance moves',
      workspaceId: origin.id,
    });
    const results = await Promise.all([
      outcome(a.move.move(owner.id, board.id, one.id)),
      outcome(b.move.move(owner.id, board.id, two.id)),
    ]);
    assert.deepEqual(
      results.map((result) => result.code),
      [200, 200],
    );
    const [moved] = await source.query(
      'SELECT workspace_id,activity_move_version FROM boards WHERE id=$1',
      [board.id],
    );
    assert.equal(moved.activity_move_version, 2);
    const moves = await source.query(
      'SELECT source_workspace_id,destination_workspace_id FROM board_workspace_moves WHERE board_id=$1',
      [board.id],
    );
    assert.equal(moves.length, 2);
    const initial = moves.find(
      (move) => move.source_workspace_id === origin.id,
    );
    const final = moves.find((move) => move.source_workspace_id !== origin.id);
    assert.equal(initial.destination_workspace_id, final.source_workspace_id);
    assert.equal(final.destination_workspace_id, moved.workspace_id);
    assert.deepEqual(
      (
        await source.query(
          `SELECT board_move_version FROM workspace_activities WHERE board_id=$1 ORDER BY board_move_version`,
          [board.id],
        )
      ).map((row) => row.board_move_version),
      [1, 2],
    );
    const before = await source.query(
      'SELECT to_jsonb(b) AS row FROM boards b WHERE id=$1',
      [board.id],
    );
    const activityBefore = await source.query(
      'SELECT id FROM workspace_activities WHERE board_id=$1 ORDER BY id',
      [board.id],
    );
    const fault = {
      beforeInsert: (event) => {
        if (
          event.metadata.name === 'WorkspaceActivity' &&
          event.entity?.eventType === 'BOARD_MOVED'
        )
          throw new Error('synthetic final move failure');
      },
    };
    instances[0].subscribers.push(fault);
    try {
      await assert.rejects(
        a.move.move(owner.id, board.id, origin.id),
        /synthetic final move failure/,
      );
    } finally {
      instances[0].subscribers.splice(
        instances[0].subscribers.indexOf(fault),
        1,
      );
    }
    assert.deepEqual(
      await source.query(
        'SELECT to_jsonb(b) AS row FROM boards b WHERE id=$1',
        [board.id],
      ),
      before,
    );
    assert.deepEqual(
      await source.query(
        'SELECT id FROM workspace_activities WHERE board_id=$1 ORDER BY id',
        [board.id],
      ),
      activityBefore,
    );
    assert.equal(
      (
        await source.query(
          'SELECT id FROM board_workspace_moves WHERE board_id=$1',
          [board.id],
        )
      ).length,
      2,
    );

    // Invitation reservation vs deletion in BOTH lock orders, without a provider.
    for (const first of ['invite', 'delete']) {
      const target = await team(`Invitation deletion ${first}`);
      const blocker = source.createQueryRunner(),
        pending = [];
      const email = `${first}-delete@integrity.example.test`;
      try {
        await blocker.startTransaction();
        const [{ pid }] = await blocker.query('SELECT pg_backend_pid() AS pid');
        await blocker.query(
          'SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',
          [target.id],
        );
        const invite = () =>
          outcome(a.issuance.create(owner.id, target.id, { email }));
        const remove = () =>
          outcome(b.deletion.remove(owner.id, target.id, target.name));
        pending.push(first === 'invite' ? invite() : remove());
        await waitForBlocked(source, pid);
        pending.push(first === 'invite' ? remove() : invite());
        await waiters(source, pid, 2);
        await blocker.commitTransaction();
        const [head, tail] = await Promise.all(pending);
        assert.deepEqual(
          [head.code, tail.code],
          first === 'invite' ? [200, 200] : [200, 404],
        );
        assert.equal(
          (
            await source.query(
              'SELECT id FROM workspace_invitations WHERE workspace_id=$1',
              [target.id],
            )
          ).length,
          0,
        );
        assert.equal(
          (
            await source.query(
              "SELECT invitation_id FROM deleted_workspace_invitation_quota WHERE recipient_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",
              [email],
            )
          ).length,
          first === 'invite' ? 1 : 0,
        );
      } finally {
        if (blocker.isTransactionActive) await blocker.rollbackTransaction();
        await blocker.release();
        await Promise.allSettled(pending);
      }
    }

    // Parallel deletion of two Workspaces must not lose/double-count retained
    // quota. Each workspace has a different invitation PK for the same recipient.
    const quotaActor = (
      await source.query(
        `INSERT INTO users(email,display_name,email_verified_at) VALUES ('concurrent-delete@integrity.example.test','Quota actor',now()) RETURNING id`,
      )
    )[0];
    const quotaTeams = await Promise.all(
      ['A', 'B'].map((label) =>
        a.api.create(quotaActor.id, { name: `Quota deletion ${label}` }),
      ),
    );
    const recipient = 'concurrent-deleted-quota@example.test';
    for (const target of quotaTeams)
      for (let i = 0; i < 2; i++)
        await source.query(
          `INSERT INTO workspace_invitations(workspace_id,email,role,token_hash,invited_by_id,expires_at,revoked_at)
        VALUES ($1,$2,'MEMBER',$3,$4,now()+interval '1 day',now())`,
          [
            target.id,
            recipient,
            randomBytes(32).toString('hex'),
            quotaActor.id,
          ],
        );
    await Promise.all(
      quotaTeams.map((target, index) =>
        [a, b][index].deletion.remove(quotaActor.id, target.id, target.name),
      ),
    );
    assert.equal(
      (
        await source.query(
          'SELECT invitation_id FROM deleted_workspace_invitation_quota WHERE actor_id=$1',
          [quotaActor.id],
        )
      ).length,
      4,
    );
    const next = await a.api.create(quotaActor.id, {
      name: 'Quota after parallel deletion',
    });
    await a.issuance.create(quotaActor.id, next.id, { email: recipient });
    await assert.rejects(
      b.issuance.create(quotaActor.id, next.id, { email: recipient }),
      (error) => error.getStatus?.() === 429,
    );
    const [orphans] = await source.query(`SELECT
      (SELECT count(*) FROM boards b LEFT JOIN workspaces w ON w.id=b.workspace_id WHERE w.id IS NULL) AS boards,
      (SELECT count(*) FROM workspace_members m LEFT JOIN workspaces w ON w.id=m.workspace_id WHERE w.id IS NULL) AS members,
      (SELECT count(*) FROM workspace_invitations i LEFT JOIN workspaces w ON w.id=i.workspace_id WHERE w.id IS NULL) AS invitations`);
    assert.deepEqual(orphans, { boards: '0', members: '0', invitations: '0' });
    console.log(
      'PASS: independent-pool move/delete and invitation/delete in both forced lock orders; concurrent move version/history continuity; late move rollback; parallel quota retention and denial; zero live orphan references',
    );
  } finally {
    await Promise.all(
      instances.map((instance) =>
        instance.isInitialized ? instance.destroy() : undefined,
      ),
    );
  }
}
