import assert from 'node:assert/strict';
import console from 'node:console';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const {
  WorkspaceInvitationsService,
} = require('../../dist/api/workspaces/workspace-invitations.service.js');
const {
  WorkspaceInvitationIssuanceService,
} = require('../../dist/api/workspaces/workspace-invitation-issuance.service.js');

async function waitFor(source, predicate) {
  for (let i = 0; i < 400; i++) {
    if (await predicate()) return;
    await delay(10);
  }
  assert.fail('Expected a real PostgreSQL lock or dispatch waiter');
}

export async function verifyDeclineRaces(base, fixture) {
  for (const [firstAction, secondAction] of [
    ['accept', 'decline'],
    ['decline', 'accept'],
    ['revoke', 'decline'],
    ['decline', 'revoke'],
    ['decline', 'decline'],
    ['reinvite', 'decline'],
    ['decline', 'reinvite'],
  ]) {
    const ctx = await fixture(base);
    const {
      source,
      app,
      actors,
      emails,
      team,
      invite,
      age,
      row,
      membershipCount,
    } = ctx;
    const service = app.get(WorkspaceInvitationsService);
    const issuance = app.get(WorkspaceInvitationIssuanceService);
    const invitation = await invite();
    await age(invitation.id);
    const run = async (action) => {
      try {
        if (action === 'accept') {
          await service.accept(actors.recipient, invitation.proof);
          return 200;
        }
        if (action === 'decline') {
          await service.decline(actors.recipient, invitation.proof);
          return 204;
        }
        if (action === 'revoke') {
          await service.revoke(actors.admin, team.id, invitation.id);
          return 204;
        }
        await issuance.create(actors.admin, team.id, {
          email: emails.recipient,
        });
        return 202;
      } catch (error) {
        return error.getStatus?.() ?? 500;
      }
    };
    const runner = source.createQueryRunner();
    await runner.connect();
    let first, second;
    try {
      await runner.startTransaction();
      const [{ pid }] = await runner.query('SELECT pg_backend_pid() AS pid');
      await runner.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [
        team.id,
      ]);
      const blocked = async (minimum) => {
        const [{ n }] = await source.query(
          `WITH RECURSIVE waiters(pid) AS (
            SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))
            UNION
            SELECT activity.pid FROM pg_stat_activity activity JOIN waiters ON waiters.pid=ANY(pg_blocking_pids(activity.pid))
          ) SELECT count(*)::int AS n FROM waiters`,
          [pid],
        );
        return n >= minimum;
      };
      first = run(firstAction);
      await waitFor(source, () => blocked(1));
      second = run(secondAction);
      await waitFor(source, () => blocked(2));
      await runner.commitTransaction();
      const results = await Promise.all([first, second]);
      const expected =
        firstAction === 'accept'
          ? [200, 410]
          : firstAction === 'revoke'
            ? [204, 410]
            : firstAction === 'reinvite'
              ? [202, 410]
              : secondAction === 'revoke'
                ? [204, 409]
                : secondAction === 'reinvite'
                  ? [204, 202]
                  : [204, 410];
      assert.deepEqual(
        results,
        expected,
        `${firstAction} then ${secondAction}`,
      );
      const stored = await row(invitation.id);
      assert.equal(
        [stored.consumed_at, stored.revoked_at, stored.declined_at].filter(
          Boolean,
        ).length,
        1,
      );
      assert.equal(
        await membershipCount('recipient'),
        firstAction === 'accept' ? 1 : 0,
      );
      if (firstAction === 'decline') assert(stored.declined_at);
      for (const action of ['accept', 'decline'])
        await assert.rejects(
          service[action](actors.recipient, invitation.proof),
          (error) => error.getStatus() === 410,
        );
      if (firstAction === 'reinvite' || secondAction === 'reinvite') {
        const replacement = await source.query(
          'SELECT * FROM workspace_invitations WHERE workspace_id=$1 AND id<>$2',
          [team.id, invitation.id],
        );
        assert.equal(replacement.length, 1);
        assert.notEqual(replacement[0].token_hash, stored.token_hash);
        assert.equal(replacement[0].declined_at, null);
      }
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await Promise.allSettled([first, second].filter(Boolean));
      await runner.release();
    }
  }
  const ctx = await fixture(base);
  const { source, app, actors, team, invite, row, fake, captured, emails } =
    ctx;
  const service = app.get(WorkspaceInvitationsService);
  const expiring = await invite();
  const runner = source.createQueryRunner();
  await runner.connect();
  let pending;
  try {
    await source.query(
      `UPDATE workspace_invitations SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE id=$1`,
      [expiring.id],
    );
    await runner.startTransaction();
    await runner.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [
      team.id,
    ]);
    pending = service.decline(actors.recipient, expiring.proof).then(
      () => 204,
      (error) => error.getStatus(),
    );
    await runner.query('SELECT pg_sleep(0.6)');
    await runner.commitTransaction();
    assert.equal(await pending, 410);
    assert.equal((await row(expiring.id)).declined_at, null);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await Promise.allSettled([pending].filter(Boolean));
    await runner.release();
  }
  await ctx.user('late');
  const normal = fake.send;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  fake.send = async (payload) => {
    captured.push(payload);
    await gate;
    return 'SENT';
  };
  let sending;
  try {
    sending = ctx
      .send('admin', 'post', ctx.root)
      .send({ email: emails.late })
      .then((response) => response);
    await waitFor(source, async () =>
      captured.some((payload) => payload.recipient === emails.late),
    );
    const payload = captured.find(
      (payload) => payload.recipient === emails.late,
    );
    await assert.rejects(
      service.decline(actors.late, payload.proof),
      (error) => error.getStatus() === 409,
    );
    // Simulate an already-confirmed concurrent delivery, then a delayed stale callback.
    await source.query(
      `UPDATE workspace_invitations SET send_state='SENT' WHERE id=$1`,
      [payload.invitationId],
    );
    await service.decline(actors.late, payload.proof);
    // Persisted terminal state must independently defeat even a stale DISPATCHING marker.
    await source.query(
      `UPDATE workspace_invitations SET send_state='DISPATCHING' WHERE id=$1`,
      [payload.invitationId],
    );
    release();
    const completed = await sending;
    assert.equal(completed.status, 202);
    assert.equal(completed.body.data.status, 'DECLINED');
    assert.equal(completed.body.data.sendState, 'DISPATCHING');
    assert((await row(payload.invitationId)).declined_at);
    await assert.rejects(
      service.accept(actors.late, payload.proof),
      (error) => error.getStatus() === 410,
    );
  } finally {
    fake.send = normal;
    release();
    if (sending) await sending;
  }
  console.log(
    'PASS: Decline vs Accept/Revoke/reinvite in both lock orders, repeated decline, expiry while waiting, no double membership and late dispatch terminal fencing',
  );
}
