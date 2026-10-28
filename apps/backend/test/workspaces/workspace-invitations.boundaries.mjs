import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { waitForBlocked } from './workspace-invitations.concurrency.mjs';

const require = createRequire(import.meta.url);
const {
  WorkspaceInvitationsService,
} = require('../../dist/api/workspaces/workspace-invitations.service.js');
const {
  WorkspaceInvitationIssuanceService,
} = require('../../dist/api/workspaces/workspace-invitation-issuance.service.js');
const {
  WorkspaceMembersService,
} = require('../../dist/api/workspaces/workspace-members.service.js');

export async function verifyDispatchLease(ctx) {
  const { source, app, actors, team, fake, captured, send } = ctx;
  const email = 'lease@invitation-boundary.example.test';
  const [user] = await source.query(
    `INSERT INTO users(email,display_name,email_verified_at)
    VALUES ($1,'Lease recipient',clock_timestamp()) RETURNING id`,
    [email],
  );
  const issuance = app.get(WorkspaceInvitationIssuanceService);
  const invitations = app.get(WorkspaceInvitationsService);
  const normal = fake.send;
  let release, entered, payload;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  fake.send = async (value) => {
    if (value.recipient !== email || payload) return normal(value);
    payload = value;
    captured.push(value);
    entered();
    await gate;
    return 'SENT';
  };
  const pending = issuance.create(actors.admin, team.id, { email });
  let replacement;
  try {
    await Promise.race([started, pending]);
    assert.ok(
      payload,
      'The configured test mailer must receive the reservation',
    );
    await source.query(
      `UPDATE workspace_invitations SET created_at=clock_timestamp()-interval '2 minutes' WHERE id=$1`,
      [payload.invitationId],
    );
    await send('admin', 'post', `/api/workspaces/${team.id}/invitations`)
      .send({ email })
      .expect(429);
    const original = await source
      .getRepository('WorkspaceInvitation')
      .findOneByOrFail({ id: payload.invitationId });
    assert.equal(original.revokedAt, null);
    assert.equal(original.sendState, 'DISPATCHING');
    await source.query(
      `UPDATE workspace_invitations SET created_at=clock_timestamp()-interval '6 minutes' WHERE id=$1`,
      [payload.invitationId],
    );
    replacement = await issuance.create(actors.admin, team.id, { email });
    assert.equal(replacement.sendState, 'SENT');
    assert.notEqual(replacement.id, payload.invitationId);
  } finally {
    release();
    fake.send = normal;
    await pending.then(
      () => undefined,
      () => undefined,
    );
  }
  const old = await pending;
  assert.equal(old.status, 'REVOKED');
  await assert.rejects(
    invitations.accept(user.id, payload.proof),
    (error) => error.getStatus() === 410,
  );
  const delivered = captured.find(
    (value) => value.invitationId === replacement.id,
  );
  assert.equal(
    (await invitations.accept(user.id, delivered.proof)).userId,
    user.id,
  );
}

export async function verifyAcceptRemoval(ctx) {
  const { source, app, actors, send, captured, tokens, jwt } = ctx;
  const invitations = app.get(WorkspaceInvitationsService);
  const members = app.get(WorkspaceMembersService);
  for (const first of ['accept', 'remove']) {
    const email = `${first}@remove-race.example.test`;
    const [user] = await source.query(
      `INSERT INTO users(email,display_name,email_verified_at)
      VALUES ($1,'Removal recipient',clock_timestamp()) RETURNING id`,
      [email],
    );
    tokens[email] = await jwt.signAsync({ sub: user.id });
    const workspace = (
      await send('admin', 'post', '/api/workspaces')
        .send({ name: `Accept/remove ${first}` })
        .expect(201)
    ).body.data;
    await source.query(
      `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
      [workspace.id, user.id],
    );
    const board = (
      await send('admin', 'post', '/api/boards')
        .send({ name: 'Separate Board grant', workspaceId: workspace.id })
        .expect(201)
    ).body.data;
    await source.query(
      `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
      [board.id, user.id],
    );
    const invitation = (
      await send('admin', 'post', `/api/workspaces/${workspace.id}/invitations`)
        .send({ email })
        .expect(202)
    ).body.data;
    const payload = captured.find(
      (value) => value.invitationId === invitation.id,
    );
    const runner = source.createQueryRunner();
    const pending = [];
    const capture = (promise) =>
      promise.then(
        () => 200,
        (error) => error.getStatus?.() ?? 500,
      );
    try {
      await runner.startTransaction();
      const [{ pid: blocker }] = await runner.query(
        'SELECT pg_backend_pid() AS pid',
      );
      if (first === 'accept') {
        await runner.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [
          user.id,
        ]);
        pending.push(capture(invitations.accept(user.id, payload.proof)));
      } else {
        await runner.query(
          'SELECT id FROM workspace_invitations WHERE id=$1 FOR UPDATE',
          [invitation.id],
        );
        pending.push(
          capture(members.remove(actors.admin, workspace.id, user.id)),
        );
      }
      const firstPid = await waitForBlocked(source, blocker);
      pending.push(
        capture(
          first === 'accept'
            ? members.remove(actors.admin, workspace.id, user.id)
            : invitations.accept(user.id, payload.proof),
        ),
      );
      await waitForBlocked(source, firstPid);
      await runner.commitTransaction();
      assert.deepEqual(
        await Promise.all(pending),
        first === 'accept' ? [200, 200] : [200, 410],
      );
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      await Promise.allSettled(pending);
    }
    assert.equal(
      await source
        .getRepository('WorkspaceMember')
        .countBy({ workspaceId: workspace.id, userId: user.id }),
      0,
    );
    const terminal = await source
      .getRepository('WorkspaceInvitation')
      .findOneByOrFail({ id: invitation.id });
    assert.equal(Boolean(terminal.consumedAt), first === 'accept');
    assert.equal(Boolean(terminal.revokedAt), first === 'remove');
    await assert.rejects(
      invitations.accept(user.id, payload.proof),
      (error) => error.getStatus() === 410,
    );
    await send(email, 'get', `/api/workspaces/${workspace.id}/members`).expect(
      404,
    );
    await send(email, 'get', `/api/boards/${board.id}`).expect(200);
  }
}
