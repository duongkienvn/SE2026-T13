import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { waitForBlocked } from './workspace-invitations.concurrency.mjs';

const require = createRequire(import.meta.url);
const {
  WorkspaceInvitationIssuanceService,
} = require('../../dist/api/workspaces/workspace-invitation-issuance.service.js');
const {
  WorkspaceInvitationsService,
} = require('../../dist/api/workspaces/workspace-invitations.service.js');
const {
  WorkspaceDeletionService,
} = require('../../dist/api/workspaces/workspace-deletion.service.js');

export async function verifyDeletedWorkspaceInvitations({
  source,
  app,
  jwt,
  tokens,
  send,
  fake,
}) {
  const [user] =
    await source.query(`INSERT INTO users(email,display_name,email_verified_at)
    VALUES ('delete-quota-actor@example.test','Deletion quota actor',clock_timestamp()) RETURNING id`);
  tokens.deleteQuota = await jwt.signAsync({ sub: user.id });
  const workspace = async () =>
    (
      await send('deleteQuota', 'post', '/api/workspaces')
        .send({ name: 'Disposable invitation team' })
        .expect(201)
    ).body.data;
  const remove = (team) =>
    send('deleteQuota', 'delete', `/api/workspaces/${team.id}`)
      .send({ confirmationName: team.name })
      .expect(204);
  const recipient = 'quota-delete-recipient@example.test';
  let liveTeam;
  for (let index = 0; index < 5; index++) {
    const team = await workspace();
    await send('deleteQuota', 'post', `/api/workspaces/${team.id}/invitations`)
      .send({ email: recipient })
      .expect(202);
    if (index === 4) liveTeam = team;
    else await remove(team);
  }
  const next = await workspace();
  await send('deleteQuota', 'post', `/api/workspaces/${next.id}/invitations`)
    .send({ email: recipient })
    .expect(429);
  await remove(liveTeam);
  const [history] = await source.query(
    `SELECT count(*)::int AS count FROM deleted_workspace_invitation_quota
     WHERE recipient_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
    [recipient],
  );
  assert.equal(history.count, 5);
  const expiredId = randomUUID();
  await source.query(
    `INSERT INTO deleted_workspace_invitation_quota
    (invitation_id,actor_id,recipient_hash,created_at)
    VALUES ($1,$2,repeat('a',64),clock_timestamp()-interval '2 hours')`,
    [expiredId, user.id],
  );
  await remove(next);
  const [expired] = await source.query(
    'SELECT count(*)::int AS count FROM deleted_workspace_invitation_quota WHERE invitation_id=$1',
    [expiredId],
  );
  assert.equal(expired.count, 0);

  const concurrentRecipient = 'quota-deletion-race@example.test';
  const concurrentTeam = await workspace();
  const otherTeam = await workspace();
  for (let index = 0; index < 5; index++)
    await source.query(
      `INSERT INTO workspace_invitations
      (workspace_id,email,role,token_hash,invited_by_id,expires_at,revoked_at)
      VALUES ($1,$2,'MEMBER',$3,$4,clock_timestamp()+interval '1 day',clock_timestamp())`,
      [
        concurrentTeam.id,
        concurrentRecipient,
        randomBytes(32).toString('hex'),
        user.id,
      ],
    );
  const blocker = source.createQueryRunner();
  let removal;
  try {
    await blocker.startTransaction();
    const [{ pid }] = await blocker.query('SELECT pg_backend_pid() AS pid');
    await blocker.query(
      'SELECT id FROM workspace_invitations WHERE workspace_id=$1 FOR UPDATE',
      [concurrentTeam.id],
    );
    removal = app
      .get(WorkspaceDeletionService)
      .remove(user.id, concurrentTeam.id, concurrentTeam.name);
    await waitForBlocked(source, pid);
    await send(
      'deleteQuota',
      'post',
      `/api/workspaces/${otherTeam.id}/invitations`,
    )
      .send({ email: concurrentRecipient })
      .expect(429);
    await blocker.commitTransaction();
    await removal;
    await send(
      'deleteQuota',
      'post',
      `/api/workspaces/${otherTeam.id}/invitations`,
    )
      .send({ email: concurrentRecipient })
      .expect(429);
  } finally {
    if (blocker.isTransactionActive) await blocker.rollbackTransaction();
    await blocker.release();
    if (removal) await removal.catch(() => undefined);
  }

  const [actor] =
    await source.query(`INSERT INTO users(email,display_name,email_verified_at)
    VALUES ('deleted-workspace-actor-limit@example.test','Actor quota',clock_timestamp()) RETURNING id`);
  tokens.actorQuota = await jwt.signAsync({ sub: actor.id });
  const teamWithHistory = (
    await send('actorQuota', 'post', '/api/workspaces')
      .send({ name: 'Actor quota history' })
      .expect(201)
  ).body.data;
  for (let index = 0; index < 29; index++)
    await source.query(
      `INSERT INTO workspace_invitations
      (workspace_id,email,role,token_hash,invited_by_id,expires_at)
      VALUES ($1,$2,'MEMBER',$3,$4,clock_timestamp()+interval '1 day')`,
      [
        teamWithHistory.id,
        `actor-history-${index}@example.test`,
        randomBytes(32).toString('hex'),
        actor.id,
      ],
    );
  await send('actorQuota', 'delete', `/api/workspaces/${teamWithHistory.id}`)
    .send({ confirmationName: teamWithHistory.name })
    .expect(204);
  const finalTeam = (
    await send('actorQuota', 'post', '/api/workspaces')
      .send({ name: 'Actor quota new team' })
      .expect(201)
  ).body.data;
  await send(
    'actorQuota',
    'post',
    `/api/workspaces/${finalTeam.id}/invitations`,
  )
    .send({ email: 'actor-limit-30@example.test' })
    .expect(202);
  await send(
    'actorQuota',
    'post',
    `/api/workspaces/${finalTeam.id}/invitations`,
  )
    .send({ email: 'actor-limit-31@example.test' })
    .expect(429);

  const team = await workspace();
  const email = 'delete-during-dispatch@example.test';
  let resume = () => {};
  let started = () => {};
  const gate = new Promise((resolve) => {
    resume = resolve;
  });
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const normalSend = fake.send;
  let payload;
  fake.send = async (mail) => {
    if (mail.recipient !== email) return normalSend(mail);
    payload = mail;
    started();
    await gate;
    return 'SENT';
  };
  const pending = app
    .get(WorkspaceInvitationIssuanceService)
    .create(user.id, team.id, { email });
  try {
    await Promise.race([entered, pending]);
    assert.ok(payload);
    await remove(team);
  } finally {
    resume();
    fake.send = normalSend;
  }
  await assert.rejects(pending, (error) => error.getStatus?.() === 409);
  await assert.rejects(
    app.get(WorkspaceInvitationsService).accept(user.id, payload.proof),
    (error) => error.getStatus?.() === 410,
  );
}
