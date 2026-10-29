import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function verifyBoardAccess(ctx) {
  const { source, send, http, actors, tokens, jwt } = ctx;
  const team = (
    await send('admin', 'post', '/api/workspaces')
      .send({ name: 'ACL matrix' })
      .expect(201)
  ).body.data;
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role)
    VALUES ($1,$2,'ADMIN'),($1,$3,'MEMBER'),($1,$4,'MEMBER')`,
    [team.id, actors.admin2, actors.member, actors.google],
  );
  const [owner2] =
    await source.query(`INSERT INTO users(email,display_name,email_verified_at)
    VALUES ('owner2@acl.example.test','Owner two',now()) RETURNING id`);
  actors.owner2 = owner2.id;
  tokens.owner2 = await jwt.signAsync({ sub: owner2.id });
  const create = async (name) =>
    (
      await send('admin', 'post', '/api/boards')
        .send({ name, workspaceId: team.id })
        .expect(201)
    ).body.data;
  const board = await create('Matrix secret');
  const other = await create('Unrelated private secret');
  assert.equal(board.visibility, 'PRIVATE');
  const root = `/api/boards/${board.id}`;
  for (const actor of ['google', 'guest', 'owner2']) {
    await source.query(
      `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,$3)`,
      [board.id, actors[actor], actor === 'owner2' ? 'OWNER' : 'MEMBER'],
    );
  }
  await send('admin', 'patch', `${root}/members/${actors.google}`)
    .send({ role: 'OWNER' })
    .expect(200);
  await send('admin', 'patch', `${root}/members/${actors.google}`)
    .send({ role: 'MEMBER' })
    .expect(200);
  const column = (
    await send('admin', 'post', `${root}/columns`)
      .send({ name: 'Column' })
      .expect(201)
  ).body.data;
  const card = (
    await send('admin', 'post', `${root}/cards`)
      .send({ title: 'Card', columnId: column.id })
      .expect(201)
  ).body.data;
  const comment = (
    await send('admin', 'post', `${root}/cards/${card.id}/comments`)
      .send({ content: 'Comment' })
      .expect(201)
  ).body.data;
  const otherColumn = (
    await send('admin', 'post', `/api/boards/${other.id}/columns`)
      .send({ name: 'Other' })
      .expect(201)
  ).body.data;
  const otherCard = (
    await send('admin', 'post', `/api/boards/${other.id}/cards`)
      .send({ title: 'Other', columnId: otherColumn.id })
      .expect(201)
  ).body.data;
  const writes = [
    ['post', '/columns', { name: 'Denied' }],
    ['patch', `/columns/${column.id}`, { name: 'Denied' }],
    ['patch', `/columns/${column.id}/move`, { beforeColumnId: null }],
    ['delete', `/columns/${column.id}`],
    ['post', '/cards', { title: 'Denied', columnId: column.id }],
    ['patch', `/cards/${card.id}`, { title: 'Denied' }],
    [
      'patch',
      `/cards/${card.id}/move`,
      { toColumnId: column.id, beforeCardId: null },
    ],
    ['post', `/cards/${card.id}/archive`],
    ['post', `/cards/${card.id}/restore`],
    ['post', `/cards/${card.id}/assignees`, { userId: actors.guest }],
    ['delete', `/cards/${card.id}/assignees/${actors.guest}`],
    ['post', `/cards/${card.id}/comments`, { content: 'Denied' }],
    [
      'patch',
      `/cards/${card.id}/comments/${comment.id}`,
      { content: 'Denied' },
    ],
    ['delete', `/cards/${card.id}/comments/${comment.id}`],
    ['post', '/members', { email: 'outsider@invitation.example.test' }],
    ['patch', `/members/${actors.guest}`, { role: 'OWNER' }],
    ['delete', `/members/${actors.guest}`],
    ['patch', '', { name: 'Denied' }],
    ['patch', '/visibility', { visibility: 'PRIVATE' }],
    ['post', '/archive'],
    ['post', '/restore'],
  ];
  for (const visibility of ['PRIVATE', 'WORKSPACE_VISIBLE']) {
    await send('admin', 'patch', `${root}/visibility`)
      .send({ visibility })
      .expect(200);
    for (const archived of [false, true]) {
      if (archived) await send('admin', 'post', `${root}/archive`).expect(200);
      for (const actor of [
        'admin',
        'owner2',
        'google',
        'guest',
        'admin2',
        'member',
        'outsider',
      ]) {
        const explicit = ['admin', 'owner2', 'google', 'guest'].includes(actor);
        const workspaceOnly = ['admin2', 'member'].includes(actor);
        const canRead =
          explicit || (workspaceOnly && visibility === 'WORKSPACE_VISIBLE');
        for (const suffix of [
          '',
          '/columns',
          '/cards',
          `/cards/${card.id}`,
          `/cards/${card.id}/comments`,
          '/activities',
        ]) {
          await send(actor, 'get', `${root}${suffix}`).expect(
            canRead ? 200 : 404,
          );
        }
        await send(actor, 'get', `${root}/members`).expect(
          explicit ? 200 : 404,
        );
        if (canRead) {
          const dto = (await send(actor, 'get', root).expect(200)).body.data;
          assert.equal(
            dto.currentUserRole,
            explicit
              ? ['admin', 'owner2'].includes(actor)
                ? 'OWNER'
                : 'MEMBER'
              : null,
          );
          assert.equal(dto.capabilities.canWriteBoard, explicit && !archived);
          assert.equal(
            dto.capabilities.canRestoreBoard,
            ['admin', 'owner2'].includes(actor) && archived,
          );
          assert.equal(
            dto.capabilities.canManageMembers,
            ['admin', 'owner2'].includes(actor) && !archived,
          );
          assert(!JSON.stringify(dto).includes('passwordHash'));
          if (!explicit) {
            const feed = (
              await send(actor, 'get', `${root}/activities`).expect(200)
            ).body;
            assert(!feed.data.some((item) => item.entityType === 'MEMBER'));
          }
        }
        if (!explicit) {
          for (const [method, suffix, body] of writes) {
            const req = send(actor, method, `${root}${suffix}`);
            await (body ? req.send(body) : req).expect(404);
          }
        } else if (archived) {
          await send(actor, 'patch', `${root}/cards/${card.id}`)
            .send({ title: 'Denied' })
            .expect(409);
          await send(actor, 'post', `${root}/columns`)
            .send({ name: 'Denied' })
            .expect(409);
          if (['admin', 'owner2'].includes(actor)) {
            await send(actor, 'patch', `${root}/visibility`)
              .send({ visibility })
              .expect(409);
            await send(actor, 'patch', root)
              .send({ name: 'Denied' })
              .expect(409);
          }
        }
      }
      for (const actor of ['admin2', 'member']) {
        const list = (
          await send(
            actor,
            'get',
            `/api/workspaces/${team.id}/boards?status=${archived ? 'archived' : 'active'}&limit=1`,
          ).expect(200)
        ).body;
        assert.equal(
          list.meta.total,
          visibility === 'WORKSPACE_VISIBLE' ? 1 : 0,
        );
        const filtered = (
          await send(
            actor,
            'get',
            `/api/workspaces/${team.id}/boards?search=Unrelated`,
          ).expect(200)
        ).body;
        assert.equal(filtered.meta.total, 0);
        const overview = (
          await send(
            actor,
            'get',
            `/api/workspaces/${team.id}/overview`,
          ).expect(200)
        ).body.data;
        assert.equal(
          overview.visibleBoardCount,
          visibility === 'WORKSPACE_VISIBLE' ? 1 : 0,
        );
        assert.equal(
          overview.archivedBoardCount,
          visibility === 'WORKSPACE_VISIBLE' && archived ? 1 : 0,
        );
        assert(!JSON.stringify(overview).includes(other.id));
        const global = (
          await send(
            actor,
            'get',
            `/api/boards?status=${archived ? 'archived' : 'active'}`,
          ).expect(200)
        ).body.data;
        assert.equal(
          global.some((item) => item.id === board.id),
          visibility === 'WORKSPACE_VISIBLE',
        );
        assert(!global.some((item) => item.id === other.id));
      }
      if (archived) await send('owner2', 'post', `${root}/restore`).expect(200);
    }
  }
  for (const visibility of ['PUBLIC', 'VIEWER', null, 1]) {
    await send('admin', 'patch', `${root}/visibility`)
      .send({ visibility })
      .expect(400);
  }
  await send('google', 'patch', `${root}/visibility`)
    .send({ visibility: 'PRIVATE' })
    .expect(403);
  await send('admin', 'patch', `${root}/visibility`)
    .send({ visibility: 'PRIVATE', role: 'OWNER' })
    .expect(400);
  await http.get(root).expect(401);
  await http
    .patch(`${root}/visibility`)
    .send({ visibility: 'PRIVATE' })
    .expect(401);
  for (const suffix of ['', `/cards/${card.id}`, '/activities'])
    await http.get(`${root}${suffix}`).expect(401);
  for (const actor of ['admin', 'member']) {
    await send(actor, 'get', `${root}/cards/${otherCard.id}`).expect(404);
    await send(actor, 'get', `${root}/cards/${otherCard.id}/comments`).expect(
      404,
    );
  }
  await send('admin', 'patch', `${root}/cards/${card.id}/move`)
    .send({ toColumnId: otherColumn.id, beforeCardId: null })
    .expect(404);
  await send(
    'admin',
    'patch',
    `${root}/cards/${card.id}/comments/${randomUUID()}`,
  )
    .send({ content: 'Cross' })
    .expect(404);
  await send('admin', 'post', `${root}/cards/${card.id}/archive`).expect(200);
  await send('google', 'patch', `${root}/cards/${card.id}`)
    .send({ title: 'Denied' })
    .expect(409);
  await send('admin', 'post', `${root}/cards/${card.id}/restore`).expect(200);
  await send('google', 'post', `${root}/cards`)
    .send({ title: 'Collaborator works', columnId: column.id })
    .expect(201);
  for (const path of ['', '/members', '/invitations'])
    await send('guest', 'get', `/api/workspaces/${team.id}${path}`).expect(404);
  ctx.access = { team, board, column, card, other };
}
