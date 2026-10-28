import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  WorkspaceInvitationIssuanceService: Issuance,
} = require('../../dist/api/workspaces/workspace-invitation-issuance.service.js');
const {
  WorkspaceInvitationsService: Invitations,
} = require('../../dist/api/workspaces/workspace-invitations.service.js');
const {
  WorkspacesService,
} = require('../../dist/api/workspaces/workspaces.service.js');

export async function verifyInvitations(ctx) {
  const { source, app, actors, send, captured, fake, team } = ctx;
  const root = `/api/workspaces/${team.id}/invitations`;
  const service = app.get(Invitations);
  const invite = (ctx.invite = async (email, actor = 'admin') => {
    const response = await send(actor, 'post', root)
      .send({ email })
      .expect(202);
    const payload = captured.find(
      (item) => item.invitationId === response.body.data.id,
    );
    return { response, payload };
  });
  const age = (ctx.age = async (id) =>
    source.query(
      `UPDATE workspace_invitations SET created_at=created_at-interval '10 minutes' WHERE id=$1`,
      [id],
    ));
  await send('member', 'post', root)
    .send({ email: 'target@example.test' })
    .expect(404);
  await send('admin', 'post', root)
    .send({ email: 'target@example.test', role: 'ADMIN' })
    .expect(400);
  await send('admin', 'post', root)
    .send({ email: 'target@example.test', invitedById: actors.outsider })
    .expect(400);
  const { response, payload } = await invite(
    ' MEMBER@invitation.example.test ',
  );
  const id = response.body.data.id;
  assert.equal(response.body.data.email, 'member@invitation.example.test');
  assert.equal(response.body.data.sendState, 'SENT');
  assert.equal(response.body.data.status, 'PENDING');
  assert.match(payload.proof, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(payload.idempotencyKey, `workspace-invitation/${id}`);
  assert.equal(payload.workspaceName, team.name);
  assert.equal(
    payload.expiresAt.getTime() -
      new Date(response.body.data.createdAt).getTime(),
    7 * 86400000,
  );
  assert(!JSON.stringify(response.body).includes(payload.proof));
  assert(!('tokenHash' in response.body.data));
  const [stored] = await source.query(
    'SELECT * FROM workspace_invitations WHERE id=$1',
    [id],
  );
  assert.equal(
    stored.token_hash,
    createHash('sha256').update(payload.proof).digest('hex'),
  );
  assert(!JSON.stringify(stored).includes(payload.proof));
  await send('admin', 'post', root)
    .send({ email: payload.recipient })
    .expect(429);
  await assert.rejects(
    service.accept(actors.outsider, payload.proof),
    (error) => error.getStatus() === 410,
  );
  await send('unverified', 'post', '/api/workspace-invitations/accept')
    .send({ proof: payload.proof })
    .expect(401);
  const unknown = randomBytes(32).toString('base64url');
  await assert.rejects(
    service.accept(actors.member, unknown),
    (error) => error.getStatus() === 410,
  );
  await assert.rejects(
    service.accept(actors.member, 'tampered'),
    (error) => error.getStatus() === 410,
  );
  const accepted = await send(
    'member',
    'post',
    '/api/workspace-invitations/accept',
  )
    .send({ proof: payload.proof })
    .expect(200);
  assert.equal(accepted.body.data.role, 'MEMBER');
  await send('member', 'post', '/api/workspace-invitations/accept')
    .send({ proof: payload.proof })
    .expect(410);
  await send('admin', 'delete', `${root}/${id}`).expect(409);
  const history = await send('admin', 'get', `${root}?status=ACCEPTED`).expect(
    200,
  );
  assert.equal(history.body.meta.total, 1);
  assert(!JSON.stringify(history.body).includes(payload.proof));
  assert(!JSON.stringify(history.body).includes(stored.token_hash));
  await send('member', 'get', root).expect(403);

  // Re-inviting an existing ADMIN never exposes account existence or downgrades the role.
  const existing = await invite('admin@invitation.example.test');
  assert.equal(
    (await service.accept(actors.admin, existing.payload.proof)).role,
    'ADMIN',
  );
  const missing = await invite('unknown-account@invitation.example.test');
  assert.equal(missing.response.status, existing.response.status);
  assert.equal(
    missing.response.body.data.sendState,
    existing.response.body.data.sendState,
  );
  assert.deepEqual(
    Object.keys(missing.response.body.data),
    Object.keys(existing.response.body.data),
  );
  await send(
    'admin',
    'delete',
    `${root}/${missing.response.body.data.id}`,
  ).expect(204);
  await send(
    'admin',
    'delete',
    `${root}/${missing.response.body.data.id}`,
  ).expect(204);
  const google = await invite('google@invitation.example.test');
  assert.equal(
    (await service.accept(actors.google, google.payload.proof)).userId,
    actors.google,
  );
  const unverified = await invite('unverified@invitation.example.test');
  await assert.rejects(
    service.accept(actors.unverified, unverified.payload.proof),
    (error) => error.getStatus() === 403,
  );
  const rotating = await invite('outsider@invitation.example.test');
  await age(rotating.response.body.data.id);
  const replacement = await invite('outsider@invitation.example.test');
  assert.notEqual(rotating.payload.proof, replacement.payload.proof);
  assert.notEqual(
    rotating.response.body.data.id,
    replacement.response.body.data.id,
  );
  await assert.rejects(
    service.accept(actors.outsider, rotating.payload.proof),
    (error) => error.getStatus() === 410,
  );
  await source.query(
    `UPDATE workspace_invitations SET created_at=clock_timestamp()-interval '2 days', expires_at=clock_timestamp()-interval '1 day'
    WHERE id=$1`,
    [replacement.response.body.data.id],
  );
  await assert.rejects(
    service.accept(actors.outsider, replacement.payload.proof),
    (error) => error.getStatus() === 410,
  );
  assert.equal(
    (await send('admin', 'get', `${root}?status=EXPIRED`).expect(200)).body.meta
      .total,
    1,
  );

  const noSender = new Issuance(
    source.getRepository('Workspace'),
    app.get(WorkspacesService),
  );
  const unavailable = await noSender.create(actors.admin, team.id, {
    email: 'not-wired@example.test',
  });
  assert.equal(unavailable.sendState, 'UNAVAILABLE');
  const originalSend = fake.send;
  fake.send = async (data) => {
    captured.push(data);
    return 'FAILED';
  };
  const failed = await invite('failed@example.test');
  assert.equal(failed.response.body.data.sendState, 'FAILED');
  const [failedUser] =
    await source.query(`INSERT INTO users(email,display_name,email_verified_at)
    VALUES ('failed@example.test','Failed recipient',now()) RETURNING id`);
  await assert.rejects(
    service.accept(failedUser.id, failed.payload.proof),
    (error) => error.getStatus() === 409,
  );
  fake.send = async (data) => {
    captured.push(data);
    throw new Error(data.proof);
  };
  const uncertain = await invite('uncertain@example.test');
  assert.equal(uncertain.response.body.data.sendState, 'UNKNOWN');
  assert(
    !JSON.stringify(uncertain.response.body).includes(uncertain.payload.proof),
  );
  fake.send = originalSend;

  // Removal cancels both targeted and authored open invitations without touching Board grants.
  await age(id);
  const pendingMember = await invite('member@invitation.example.test');
  await send(
    'admin',
    'delete',
    `/api/workspaces/${team.id}/members/${actors.member}`,
  ).expect(204);
  await assert.rejects(
    service.accept(actors.member, pendingMember.payload.proof),
    (error) => error.getStatus() === 410,
  );
  // Rejoin fixture for following concurrency checks.
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN')`,
    [team.id, actors.admin2],
  );
  const authored = await invite('authored@example.test', 'admin2');
  await send(
    'admin',
    'delete',
    `/api/workspaces/${team.id}/members/${actors.admin2}`,
  ).expect(204);
  assert(
    (
      await source
        .getRepository('WorkspaceInvitation')
        .findOneByOrFail({ id: authored.response.body.data.id })
    ).revokedAt,
  );
}
