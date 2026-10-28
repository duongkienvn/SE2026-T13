import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function verifyMembers(ctx) {
  const { source, actors, send, http, jwt, tokens } = ctx;
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
  for (const method of ['patch', 'delete']) {
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
  await send('admin', 'delete', `${root}/members/${actors.admin}`).expect(409);
  await send('admin', 'patch', `${root}/members/${randomUUID()}`)
    .send({ role: 'ADMIN' })
    .expect(404);
  await send('admin', 'patch', `${root}/members/${actors.member}`)
    .send({ role: 'ADMIN' })
    .expect(200);
  await send('admin', 'patch', `${root}/members/${actors.member}`)
    .send({ role: 'MEMBER' })
    .expect(200);
  const privateBoard = (
    await send('member', 'post', '/api/boards')
      .send({ name: 'Member private Board', workspaceId: team.id })
      .expect(201)
  ).body.data;
  const boardId = (ctx.boardId = privateBoard.id);
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [boardId, actors.guest],
  );
  const column = (
    await send('member', 'post', `/api/boards/${boardId}/columns`)
      .send({ name: 'Todo' })
      .expect(201)
  ).body.data;
  const card = (
    await send('member', 'post', `/api/boards/${boardId}/cards`)
      .send({ title: 'Private content', columnId: column.id })
      .expect(201)
  ).body.data;
  for (const path of [
    `/api/boards/${boardId}`,
    `/api/boards/${boardId}/cards`,
    `/api/boards/${boardId}/cards/${card.id}/comments`,
  ])
    await send('admin', 'get', path).expect(404);
  await send('guest', 'get', `/api/boards/${boardId}`).expect(200);
  await send('guest', 'get', `${root}/members`).expect(404);
  await send('admin', 'delete', `${root}/members/${actors.member}`).expect(204);
  await send('admin', 'delete', `${root}/members/${actors.member}`).expect(204);
  await send('member', 'post', `${root}/leave`).expect(204);
  await send('member', 'get', `${root}/members`).expect(404);
  await send('member', 'get', `/api/boards/${boardId}`).expect(200);
  await send('member', 'get', `/api/boards/${boardId}/cards/${card.id}`).expect(
    200,
  );
  assert(await source.getRepository('User').findOneBy({ id: actors.member }));
  assert(await source.getRepository('Card').findOneBy({ id: card.id }));
  await send('admin2', 'post', `${root}/leave`).expect(204);
  await send('admin2', 'post', `${root}/leave`).expect(204);
  await send('admin', 'post', `${root}/leave`).expect(409);
  await send('admin', 'post', `/api/workspaces/${randomUUID()}/leave`).expect(
    204,
  );
  const personal = (
    await send('admin', 'get', '/api/workspaces/personal').expect(200)
  ).body.data;
  for (const [method, suffix, body] of [
    ['post', '/leave', {}],
    ['patch', `/members/${actors.admin}`, { role: 'MEMBER' }],
    ['delete', `/members/${actors.member}`, {}],
  ])
    await send('admin', method, `/api/workspaces/${personal.id}${suffix}`)
      .send(body)
      .expect(403);
  const expired = await jwt.signAsync({ sub: actors.admin }, { expiresIn: -1 });
  await http
    .get(`${root}/members`)
    .set('Authorization', `Bearer ${expired}`)
    .expect(401);
  const invalidated = tokens.admin;
  await source.query(
    'UPDATE users SET auth_version=auth_version+1 WHERE id=$1',
    [actors.admin],
  );
  await http
    .get(`${root}/members`)
    .set('Authorization', `Bearer ${invalidated}`)
    .expect(401);
  tokens.admin = await jwt.signAsync({ sub: actors.admin, authVersion: 1 });
}
