import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { verifyDeclineRaces } from './workspace-invitation-decline.concurrency.mjs';

const require = createRequire(import.meta.url);
const {
  WorkspaceInvitationsService,
} = require('../../dist/api/workspaces/workspace-invitations.service.js');

export async function declineFixture(base) {
  const { source, http, jwt, captured } = base;
  const actors = {},
    tokens = {},
    emails = {};
  const user = async (key, verified = true) => {
    emails[key] = `${key}-${randomUUID()}@decline.example.test`;
    const [row] = await source.query(
      'INSERT INTO users(email,display_name,email_verified_at) VALUES ($1,$2,$3) RETURNING id',
      [emails[key], key, verified ? new Date() : null],
    );
    actors[key] = row.id;
    tokens[key] = await jwt.signAsync({ sub: row.id });
    return row.id;
  };
  for (const key of ['admin', 'recipient', 'wrong']) await user(key);
  await user('unverified', false);
  const send = (key, method, path) =>
    http[method](path).set('Authorization', `Bearer ${tokens[key]}`);
  const team = (
    await send('admin', 'post', '/api/workspaces')
      .send({ name: 'Decline lifecycle' })
      .expect(201)
  ).body.data;
  const root = `/api/workspaces/${team.id}/invitations`;
  const invite = async (key = 'recipient') => {
    const response = await send('admin', 'post', root)
      .send({ email: emails[key] })
      .expect(202);
    const payload = captured.find(
      (row) => row.invitationId === response.body.data.id,
    );
    assert(payload);
    return {
      id: response.body.data.id,
      proof: payload.proof,
      dto: response.body.data,
    };
  };
  const age = (id) =>
    source.query(
      `UPDATE workspace_invitations SET created_at=created_at-interval '2 minutes' WHERE id=$1`,
      [id],
    );
  const row = async (id) =>
    (
      await source.query('SELECT * FROM workspace_invitations WHERE id=$1', [
        id,
      ])
    )[0];
  const membershipCount = (key) =>
    source
      .getRepository('WorkspaceMember')
      .countBy({ workspaceId: team.id, userId: actors[key] });
  return {
    ...base,
    actors,
    tokens,
    emails,
    user,
    send,
    team,
    root,
    invite,
    age,
    row,
    membershipCount,
  };
}

export async function verifyDecline(base) {
  const ctx = await declineFixture(base);
  const {
    source,
    app,
    http,
    send,
    team,
    root,
    invite,
    age,
    user,
    actors,
    emails,
    row,
    membershipCount,
    captured,
  } = ctx;
  const endpoint = '/api/workspace-invitations/decline';
  const service = app.get(WorkspaceInvitationsService);
  const first = await invite();
  await http.post(endpoint).send({ proof: first.proof }).expect(401);
  for (const body of [
    {},
    { proof: null },
    { proof: 'a'.repeat(42) },
    { proof: '/'.repeat(43) },
    { proof: first.proof, email: emails.recipient },
  ])
    await send('recipient', 'post', endpoint).send(body).expect(400);
  const unknown = await send('recipient', 'post', endpoint)
    .send({ proof: randomBytes(32).toString('base64url') })
    .expect(410);
  const wrong = await send('wrong', 'post', endpoint)
    .send({ proof: first.proof })
    .expect(410);
  assert.equal(wrong.body.code, unknown.body.code);
  assert.equal(wrong.body.message, unknown.body.message);
  const unverifiedInvite = await invite('unverified');
  const unverified = await send('unverified', 'post', endpoint)
    .send({ proof: unverifiedInvite.proof })
    .expect(403);
  assert.equal(unverified.body.code, 'EMAIL_NOT_VERIFIED');
  await send('unverified', 'post', '/api/workspace-invitations/accept')
    .send({ proof: unverifiedInvite.proof })
    .expect(401); // Existing auth default unchanged.
  const mails = captured.length;
  const declined = await send('recipient', 'post', endpoint)
    .send({ proof: first.proof })
    .expect(204);
  assert.equal(declined.text, '');
  assert.equal(declined.headers['cache-control'], 'no-store');
  assert.equal(captured.length, mails);
  assert.equal(await membershipCount('recipient'), 0);
  const saved = await row(first.id);
  assert(saved.declined_at instanceof Date);
  assert.equal(saved.revoked_at, null);
  assert.equal(saved.consumed_at, null);
  assert.equal(saved.send_state, 'SENT');
  assert(!JSON.stringify(saved).includes(first.proof));
  for (const action of ['accept', 'decline']) {
    const replay = await send(
      'recipient',
      'post',
      `/api/workspace-invitations/${action}`,
    )
      .send({ proof: first.proof })
      .expect(410);
    assert.equal(replay.body.message, unknown.body.message);
  }
  await send('admin', 'delete', `${root}/${first.id}`).expect(409);
  assert.equal((await row(unverifiedInvite.id)).declined_at, null);
  await send('admin', 'post', root)
    .send({ email: emails.recipient })
    .expect(429);
  await age(first.id);
  const fresh = await invite();
  assert.notEqual(fresh.proof, first.proof);
  assert.notEqual((await row(fresh.id)).token_hash, saved.token_hash);
  assert.equal((await row(first.id)).revoked_at, null);
  await send('recipient', 'post', endpoint)
    .send({ proof: first.proof })
    .expect(410);
  await send('recipient', 'post', '/api/workspace-invitations/accept')
    .send({ proof: fresh.proof })
    .expect(200);
  assert.equal(await membershipCount('recipient'), 1);
  await send('recipient', 'post', endpoint)
    .send({ proof: fresh.proof })
    .expect(410);
  await send('admin', 'delete', `${root}/${fresh.id}`).expect(409);

  for (const state of ['UNAVAILABLE', 'DISPATCHING', 'FAILED', 'UNKNOWN']) {
    await user(`state-${state}`);
    const item = await invite(`state-${state}`);
    await source.query(
      'UPDATE workspace_invitations SET send_state=$1 WHERE id=$2',
      [state, item.id],
    );
    await send(`state-${state}`, 'post', endpoint)
      .send({ proof: item.proof })
      .expect(409);
    assert.equal((await row(item.id)).declined_at, null);
    assert.equal(await membershipCount(`state-${state}`), 0);
  }
  await user('expired');
  const expired = await invite('expired');
  await source.query(
    `UPDATE workspace_invitations SET created_at=created_at-interval '8 days',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,
    [expired.id],
  );
  await send('expired', 'post', endpoint)
    .send({ proof: expired.proof })
    .expect(410);
  await user('revoked');
  const revoked = await invite('revoked');
  for (let i = 0; i < 2; i++)
    await send('admin', 'delete', `${root}/${revoked.id}`).expect(204);
  await send('revoked', 'post', endpoint)
    .send({ proof: revoked.proof })
    .expect(410);
  // Terminal status wins when history is read after expiry (without changing terminal timestamps).
  await source.query(
    `UPDATE workspace_invitations SET expires_at=declined_at+interval '1 microsecond' WHERE id=$1`,
    [first.id],
  );
  await source.query('SELECT pg_sleep(0.001)');
  for (const status of [
    'DECLINED',
    'PENDING',
    'EXPIRED',
    'ACCEPTED',
    'REVOKED',
  ]) {
    const response = await send(
      'admin',
      'get',
      `${root}?status=${status}&limit=1`,
    ).expect(200);
    const all = await send(
      'admin',
      'get',
      `${root}?status=${status}&limit=100`,
    ).expect(200);
    assert.equal(response.body.meta.total, all.body.data.length);
    assert(all.body.data.every((item) => item.status === status));
    if (status === 'DECLINED') {
      assert.equal(all.body.meta.total, 1);
      assert.equal(
        all.body.data[0].declinedAt,
        saved.declined_at.toISOString(),
      );
    } else
      assert(
        all.body.data.every(
          (item) => item.id !== first.id && item.declinedAt === null,
        ),
      );
    assert(!JSON.stringify(all.body).includes(first.proof));
    assert(!JSON.stringify(all.body).includes('tokenHash'));
  }
  await send('recipient', 'get', `${root}?status=DECLINED`).expect(403);
  await send('wrong', 'get', `${root}?status=DECLINED`).expect(404);
  await send('admin', 'get', `${root}?status=DECLINED&page=2&limit=1`)
    .expect(200)
    .then((response) => assert.deepEqual(response.body.data, []));
  // Removal must not overwrite either terminal outcome for this recipient.
  await send(
    'admin',
    'delete',
    `/api/workspaces/${team.id}/members/${actors.recipient}`,
  ).expect(204);
  assert((await row(first.id)).declined_at);
  assert.equal((await row(first.id)).revoked_at, null);
  assert((await row(fresh.id)).consumed_at);
  await user('quota');
  for (let attempt = 0; attempt < 5; attempt++) {
    const item = await invite('quota');
    await service.decline(actors.quota, item.proof);
    await age(item.id);
  }
  await send('admin', 'post', root).send({ email: emails.quota }).expect(429);
  const swagger = (await http.get('/api-docs-json').expect(200)).body;
  const operation = swagger.paths['/api/workspace-invitations/decline'].post;
  for (const status of [204, 400, 401, 403, 409, 410, 429])
    assert(operation.responses[status]);
  assert(operation.security.length);
  assert(!operation.responses['204'].content);
  assert.deepEqual(
    Object.keys(
      swagger.components.schemas.DeclineWorkspaceInvitationDto.properties,
    ),
    ['proof'],
  );
  assert(
    swagger.components.schemas.WorkspaceInvitationResponseDto.properties.status.enum.includes(
      'DECLINED',
    ),
  );
  assert.equal(
    swagger.components.schemas.WorkspaceInvitationResponseDto.properties
      .declinedAt.nullable,
    true,
  );
  console.log(
    'PASS: Decline HTTP/Swagger, verified recipient binding, safe errors/replay, no membership/mail, terminal history/filtering, reinvite/cooldown/quota and member-removal preservation',
  );
  await verifyDeclineRaces(base, declineFixture);
}
