import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const {
  WorkspaceInvitationsService,
} = require('../../dist/api/workspaces/workspace-invitations.service.js');

async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) return;
    await delay(10);
  }
  assert.fail('Expected an observed dispatch/lock barrier');
}

export async function waitForBlocked(source, blocker) {
  let waiter;
  await until(async () => {
    [waiter] = await source.query(
      'SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))',
      [blocker],
    );
    return Boolean(waiter);
  });
  return waiter.pid;
}

export async function verifyInvitationRaces(ctx) {
  const { source, app, actors, send, captured, fake, team, invite, age } = ctx;
  const root = `/api/workspaces/${team.id}`;
  const invitations = app.get(WorkspaceInvitationsService);
  const proofStatus = (result) =>
    result.status === 'fulfilled' ? 200 : result.reason.getStatus();
  const race = await invite('outsider@invitation.example.test');
  const acceptances = await Promise.allSettled([
    invitations.accept(actors.outsider, race.payload.proof),
    invitations.accept(actors.outsider, race.payload.proof),
  ]);
  assert.deepEqual(acceptances.map(proofStatus).sort(), [200, 410]);
  assert.equal(
    await source
      .getRepository('WorkspaceMember')
      .countBy({ workspaceId: team.id, userId: actors.outsider }),
    1,
  );
  const duplicates = await Promise.all([
    send('admin', 'post', `${root}/invitations`).send({
      email: 'concurrent@example.test',
    }),
    send('admin', 'post', `${root}/invitations`).send({
      email: 'concurrent@example.test',
    }),
  ]);
  assert.deepEqual(
    duplicates.map((result) => result.status).sort(),
    [202, 429],
  );
  assert.equal(
    (
      await source.query(
        `SELECT count(*)::int AS n FROM workspace_invitations WHERE workspace_id=$1
    AND email='concurrent@example.test' AND consumed_at IS NULL AND revoked_at IS NULL`,
        [team.id],
      )
    )[0].n,
    1,
  );

  const revokeRace = await invite('guest@invitation.example.test');
  const results = await Promise.allSettled([
    invitations.accept(actors.guest, revokeRace.payload.proof),
    invitations.revoke(actors.admin, team.id, revokeRace.response.body.data.id),
  ]);
  const statuses = results.map(proofStatus);
  assert(
    (statuses[0] === 200 && statuses[1] === 409) ||
      (statuses[0] === 410 && statuses[1] === 200),
  );

  const normal = fake.send;
  const [inflightUser] =
    await source.query(`INSERT INTO users(email,display_name,email_verified_at)
    VALUES ('inflight@example.test','In flight recipient',now()) RETURNING id`);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  fake.send = async (payload) => {
    captured.push(payload);
    await gate;
    return 'SENT';
  };
  const pending = send('admin', 'post', `${root}/invitations`)
    .send({ email: 'inflight@example.test' })
    .then((response) => response);
  await until(() =>
    captured.some((payload) => payload.recipient === 'inflight@example.test'),
  );
  const payload = captured.find(
    (item) => item.recipient === 'inflight@example.test',
  );
  try {
    await assert.rejects(
      invitations.accept(inflightUser.id, payload.proof),
      (error) => error.getStatus() === 409,
    );
    // HTTP revoke completes while adapter waits: no DB lock is held across send.
    await send(
      'admin',
      'delete',
      `${root}/invitations/${payload.invitationId}`,
    ).expect(204);
    await age(payload.invitationId);
    fake.send = normal;
    const rotated = await invite(payload.recipient);
    assert.notEqual(rotated.payload.proof, payload.proof);
  } finally {
    release();
    fake.send = normal;
  }
  assert.equal((await pending).body.data.status, 'REVOKED');
  await assert.rejects(
    invitations.accept(actors.guest, payload.proof),
    (error) => error.getStatus() === 410,
  );

  const [expiringUser] =
    await source.query(`INSERT INTO users(email,display_name,email_verified_at)
    VALUES ('expiring-lock@example.test','Expiring recipient',now()) RETURNING id`);
  const expiring = await invite('expiring-lock@example.test');
  const runner = source.createQueryRunner();
  await runner.startTransaction();
  const [{ pid: blocker }] = await runner.query(
    'SELECT pg_backend_pid() AS pid',
  );
  let pendingAccept;
  try {
    await runner.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [
      expiringUser.id,
    ]);
    await source.query(
      `UPDATE workspace_invitations SET expires_at=clock_timestamp()+interval '1500 milliseconds' WHERE id=$1`,
      [expiring.response.body.data.id],
    );
    pendingAccept = invitations
      .accept(expiringUser.id, expiring.payload.proof)
      .then(
        () => 200,
        (error) => error.getStatus(),
      );
    await until(
      async () =>
        (
          await source.query(
            'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting',
            [blocker],
          )
        )[0].waiting,
    );
    await delay(1600);
    await runner.commitTransaction();
    assert.equal(await pendingAccept, 410);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
    if (pendingAccept) await pendingAccept;
  }
  assert.equal(
    await source
      .getRepository('WorkspaceMember')
      .countBy({ workspaceId: team.id, userId: expiringUser.id }),
    0,
  );

  // Last-admin exit and two cross-demotions/removals must serialize at the DB row.
  for (const mode of ['leave', 'demote', 'remove']) {
    const workspace = (
      await send('admin', 'post', '/api/workspaces')
        .send({ name: `Race ${mode}` })
        .expect(201)
    ).body.data;
    await source.query(
      `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN')`,
      [workspace.id, actors.admin2],
    );
    const prefix = `/api/workspaces/${workspace.id}`;
    const action = (actor, target) =>
      mode === 'leave'
        ? send(actor, 'post', `${prefix}/leave`)
        : mode === 'demote'
          ? send(actor, 'patch', `${prefix}/members/${actors[target]}`).send({
              role: 'MEMBER',
            })
          : send(actor, 'delete', `${prefix}/members/${actors[target]}`);
    const outcome = await Promise.all([
      action('admin', 'admin2'),
      action('admin2', 'admin'),
    ]);
    const statuses = outcome.map((response) => response.status).sort();
    assert.deepEqual(
      statuses,
      mode === 'leave'
        ? [204, 409]
        : mode === 'demote'
          ? [200, 403]
          : [204, 404],
    );
    const loser = outcome.find((response) => response.status >= 400);
    assert.equal(
      loser.body.code,
      mode === 'leave'
        ? 'CONFLICT'
        : mode === 'demote'
          ? 'FORBIDDEN'
          : 'NOT_FOUND',
    );
    assert.equal(
      await source
        .getRepository('WorkspaceMember')
        .countBy({ workspaceId: workspace.id, role: 'ADMIN' }),
      1,
    );
  }

  // Durable quotas use revoked history too, and work across Workspaces/instances.
  const quotaTeam = (
    await send('admin2', 'post', '/api/workspaces')
      .send({ name: 'Quota tests' })
      .expect(201)
  ).body.data;
  const seed = async (count, workspaceId, actor, email) => {
    for (let i = 0; i < count; i++)
      await source.query(
        `INSERT INTO workspace_invitations
      (workspace_id,email,role,token_hash,invited_by_id,created_at,expires_at,revoked_at)
      VALUES ($1,$2,'MEMBER',$3,$4,clock_timestamp()-interval '10 minutes',clock_timestamp()+interval '1 day',clock_timestamp())`,
        [
          workspaceId,
          email ?? `quota-${randomBytes(8).toString('hex')}@example.test`,
          randomBytes(32).toString('hex'),
          actor,
        ],
      );
  };
  await seed(5, quotaTeam.id, actors.admin2, 'recipient-quota@example.test');
  await send('admin', 'post', `${root}/invitations`)
    .send({ email: 'recipient-quota@example.test' })
    .expect(429);
  await seed(25, quotaTeam.id, actors.admin2);
  await send('admin2', 'post', `/api/workspaces/${quotaTeam.id}/invitations`)
    .send({ email: 'actor-quota@example.test' })
    .expect(429);
  const workspaceQuota = (
    await send('google', 'post', '/api/workspaces')
      .send({ name: 'Workspace quota' })
      .expect(201)
  ).body.data;
  await seed(100, workspaceQuota.id, actors.member);
  await send(
    'google',
    'post',
    `/api/workspaces/${workspaceQuota.id}/invitations`,
  )
    .send({ email: 'workspace-quota@example.test' })
    .expect(429);

  // Database uniqueness survives even a caller bypassing application serialization.
  const open = await invite('db-unique@example.test');
  await assert.rejects(
    source.query(
      `INSERT INTO workspace_invitations(workspace_id,email,role,token_hash,invited_by_id,expires_at)
    VALUES ($1,$2,'MEMBER',$3,$4,clock_timestamp()+interval '1 day')`,
      [
        team.id,
        open.payload.recipient,
        randomBytes(32).toString('hex'),
        actors.admin,
      ],
    ),
    (error) => error.driverError?.code === '23505',
  );
}
