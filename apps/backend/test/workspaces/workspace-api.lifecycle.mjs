import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function verifyLifecycle(ctx) {
  const { source, send, http, jwt, actors, tokens } = ctx;
  await http.get('/api/workspaces').expect(401);
  const expired = await jwt.signAsync({ sub: actors.admin }, { expiresIn: -1 });
  await http
    .get('/api/workspaces')
    .set('Authorization', `Bearer ${expired}`)
    .expect(401);
  const personals = await Promise.all(
    Array.from({ length: 6 }, () =>
      send('admin', 'get', '/api/workspaces/personal').expect(200),
    ),
  );
  assert.equal(new Set(personals.map((r) => r.body.data.id)).size, 1);
  const personal = personals[0].body.data;
  assert.equal(personals[0].headers['cache-control'], 'no-store');
  assert.equal(personal.type, 'PERSONAL');
  assert.equal(personal.role, 'ADMIN');
  const teamResponse = await send('admin', 'post', '/api/workspaces')
    .send({ name: ' Team ', description: ' Description ', icon: 'users' })
    .expect(201);
  const team = teamResponse.body.data;
  ctx.team = team;
  assert.equal(team.name, 'Team');
  assert.equal(team.description, 'Description');
  assert.equal(team.type, 'TEAM');
  assert.equal(team.canManage, true);
  assert.equal(
    await source
      .getRepository('WorkspaceMember')
      .countBy({ workspaceId: team.id }),
    1,
  );
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [team.id, actors.member],
  );
  const list = await send('admin', 'get', '/api/workspaces?limit=1').expect(
    200,
  );
  assert.equal(list.body.meta.total, 2);
  const next = await send(
    'admin',
    'get',
    '/api/workspaces?page=2&limit=1',
  ).expect(200);
  assert.notEqual(list.body.data[0].id, next.body.data[0].id);
  const member = await send(
    'member',
    'get',
    `/api/workspaces/${team.id}`,
  ).expect(200);
  assert.equal(member.body.data.role, 'MEMBER');
  assert.equal(member.body.data.canManage, false);
  assert.equal(member.body.data.canCreateBoards, true);
  await send('member', 'patch', `/api/workspaces/${team.id}`)
    .send({ name: 'Escalation' })
    .expect(403);
  await send('admin', 'patch', `/api/workspaces/${team.id}`)
    .send({ description: null, icon: null })
    .expect(200);
  const patched = await send(
    'admin',
    'get',
    `/api/workspaces/${team.id}`,
  ).expect(200);
  assert.equal(patched.body.data.name, 'Team');
  assert.equal(patched.body.data.description, null);
  assert.equal(patched.body.data.icon, null);
  for (const input of [
    {},
    { name: null },
    { name: ' ' },
    { icon: 'javascript:alert(1)' },
    { role: 'ADMIN' },
    { createdById: actors.outsider },
    { type: 'PERSONAL' },
    { allowBoardCreation: true },
  ]) {
    await send('admin', 'patch', `/api/workspaces/${team.id}`)
      .send(input)
      .expect(400);
  }
  for (const input of [
    { name: 'Team', role: 'ADMIN' },
    { name: 'Team', type: 'PERSONAL' },
    { name: 'a'.repeat(121) },
  ]) {
    await send('admin', 'post', '/api/workspaces').send(input).expect(400);
  }
  for (const suffix of ['', '/boards', '/overview']) {
    const missing = await send(
      'outsider',
      'get',
      `/api/workspaces/${randomUUID()}${suffix}`,
    ).expect(404);
    const forbidden = await send(
      'outsider',
      'get',
      `/api/workspaces/${team.id}${suffix}`,
    ).expect(404);
    assert.equal(missing.body.code, 'NOT_FOUND');
    assert.equal(forbidden.body.code, missing.body.code);
    assert.equal(forbidden.body.message, missing.body.message);
    assert.equal(forbidden.body.success, false);
    await send('admin', 'get', `/api/workspaces/invalid${suffix}`).expect(400);
  }
  for (const query of [
    'limit=101',
    'page=1000001',
    'page=1e3',
    'sort=invalid',
    'cursor=arbitrary',
    'status=all',
    'search=' + 'x'.repeat(121),
  ]) {
    await send(
      'admin',
      'get',
      `/api/workspaces/${team.id}/boards?${query}`,
    ).expect(400);
  }
  await send('guest', 'post', '/api/boards')
    .send({ name: 'Denied', workspaceId: team.id })
    .expect(404);
  await send('admin', 'post', '/api/boards')
    .send({ name: 'Missing', workspaceId: randomUUID() })
    .expect(404);
  const legacy = await send('admin', 'post', '/api/boards')
    .send({ name: 'Legacy' })
    .expect(201);
  const savedLegacy = await source
    .getRepository('Board')
    .findOneByOrFail({ id: legacy.body.data.id });
  assert.equal(savedLegacy.workspaceId, personal.id);
  assert.equal(savedLegacy.visibility, 'PRIVATE');
  assert.equal(legacy.body.data.currentUserRole, 'OWNER');
  const forged = await jwt.signAsync({
    sub: actors.member,
    role: 'ADMIN',
    currentUserRole: 'OWNER',
  });
  await http
    .patch(`/api/workspaces/${team.id}`)
    .set('Authorization', `Bearer ${forged}`)
    .send({ name: 'Spoof' })
    .expect(403);
  const changedSession = await http
    .get(`/api/workspaces/${team.id}`)
    .set('Authorization', `Bearer ${tokens.outsider}`)
    .expect(404);
  assert.equal(changedSession.body.data, undefined);
  const docs = await http.get('/api-docs-json').expect(200);
  assert.ok(docs.body.paths['/api/workspaces/{workspaceId}/overview']);
  assert.ok(docs.body.components.schemas.WorkspaceOverviewDto);
  assert.equal(
    docs.body.components.schemas.WorkspaceBoardResponseDto.properties
      .memberCount.nullable,
    true,
  );
  assert.equal(
    docs.body.components.schemas.WorkspaceOverviewDto.properties.memberCount
      .type,
    'number',
  );
}
