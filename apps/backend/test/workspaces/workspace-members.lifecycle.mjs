import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function verifyMembers(ctx) {
  const { source, actors, send, http } = ctx;
  const created = await send('admin', 'post', '/api/workspaces')
    .send({ name: 'Membership lifecycle' })
    .expect(201);
  const team = (ctx.team = created.body.data);
  const root = `/api/workspaces/${team.id}`;
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN'),($1,$3,'MEMBER')`,
    [team.id, actors.admin2, actors.member],
  );
  await http.get(`${root}/members`).expect(401);
  const page = await send('member', 'get', `${root}/members?limit=2`).expect(
    200,
  );
  assert.equal(page.body.meta.total, 3);
  assert.equal(page.body.data.length, 2);
  assert.equal(page.headers['cache-control'], 'no-store');
  for (const member of page.body.data)
    assert.deepEqual(
      Object.keys(member).sort(),
      [
        'userId',
        'displayName',
        'avatarUrl',
        'avatarRevision',
        'role',
        'joinedAt',
      ].sort(),
    );
  assert.equal(
    (await send('admin', 'get', `${root}/members?role=ADMIN`).expect(200)).body
      .meta.total,
    2,
  );
  assert.equal(
    (await send('admin', 'get', `${root}/members?search=%25`).expect(200)).body
      .meta.total,
    0,
  );
  for (const actor of ['guest', 'outsider']) {
    await send(actor, 'get', `${root}/members`).expect(404);
    await send(actor, 'patch', `${root}/members/${actors.member}`)
      .send({ role: 'ADMIN' })
      .expect(404);
  }
  for (const method of ['patch']) {
    const req = send('member', method, `${root}/members/${actors.admin2}`);
    await (method === 'patch' ? req.send({ role: 'MEMBER' }) : req).expect(403);
  }
  await send('admin', 'patch', `${root}/members/${actors.member}`)
    .send({ role: 'OWNER' })
    .expect(400);
  await send('admin', 'patch', `${root}/members/${actors.member}`)
    .send({ role: 'ADMIN', userId: actors.admin })
    .expect(400);
  await send('admin', 'patch', `${root}/members/${actors.admin}`)
    .send({ role: 'MEMBER' })
    .expect(409);
  await send('admin', 'patch', `${root}/members/${randomUUID()}`)
    .send({ role: 'ADMIN' })
    .expect(404);
  await send('admin', 'patch', `${root}/members/${actors.member}`)
    .send({ role: 'ADMIN' })
    .expect(200);
  await send('admin', 'patch', `${root}/members/${actors.member}`)
    .send({ role: 'MEMBER' })
    .expect(200);
}
