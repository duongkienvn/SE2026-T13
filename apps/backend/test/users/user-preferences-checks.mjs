import assert from 'node:assert/strict';

export async function checkPreferencesHttp({ app, source, legacy, require }) {
  const { AuthService } = require('../../dist/api/auth/auth.service.js');
  const {
    UserPreferencesService,
  } = require('../../dist/api/users/user-preferences.service.js');
  const {
    DEFAULT_USER_PREFERENCES: defaults,
  } = require('../../dist/api/users/user-preferences.constants.js');
  const { User } = require('../../dist/api/users/entities/user.entity.js');
  const { JwtService } = require('@nestjs/jwt');
  const http = require('supertest')(app.getHttpServer());
  const path = '/api/users/me/preferences';
  const auth = app.get(AuthService);
  const users = source.getRepository(User);
  const service = app.get(UserPreferencesService);
  const a = await users.findOneByOrFail({ id: legacy.id });
  const b = await users.save(
    users.create({
      email: 'second@example.test',
      displayName: 'Second',
      passwordHash: null,
      emailVerifiedAt: new Date(),
    }),
  );
  const login = async (user) =>
    (await auth.issueLoginResponse(user)).accessToken;
  const tokenA = await login(a);
  const tokenB = await login(b);
  const get = (token = tokenA) =>
    http.get(path).auth(token, { type: 'bearer' });
  const patch = (body, token = tokenA) =>
    http.patch(path).auth(token, { type: 'bearer' }).send(body);
  const reservedBodies = ['__proto__', 'constructor', 'prototype'].map(
    (key) => ({ theme: 'light', [key]: { unexpected: true } }),
  );
  assert.deepEqual((await get().expect(200)).body.data, defaults);
  assert.equal(
    (await source.query('SELECT count(*)::int AS n FROM user_preferences'))[0]
      .n,
    0,
    'GET is side-effect free',
  );
  for (const body of [
    {},
    { theme: null },
    { timeZone: [] },
    { timeZone: {} },
    { timeZone: 1 },
    { theme: 'DARK' },
    { dateFormat: 'yyyy-mm-dd' },
    { weekStartsOn: 'Monday' },
    { timeZone: 'Invalid/Zone' },
    { timeZone: 'a'.repeat(101) },
    { theme: 'dark', userId: b.id },
    ...reservedBodies,
    [],
  ]) {
    assert.equal(
      (await patch(body).expect(400)).body.code,
      'VALIDATION_FAILED',
    );
  }
  assert.equal(
    (
      await http
        .patch(path)
        .auth(tokenA, { type: 'bearer' })
        .set('Content-Type', 'application/json')
        .send('null')
        .expect(400)
    ).body.code,
    'VALIDATION_FAILED',
  );
  assert.equal(
    (await source.query('SELECT count(*)::int AS n FROM user_preferences'))[0]
      .n,
    0,
    'Invalid input never inserts',
  );
  const first = await Promise.all([
    patch({ theme: 'dark' }).expect(200),
    patch({ timeZone: 'Asia/Ho_Chi_Minh' }).expect(200),
  ]);
  const expected = { ...defaults, theme: 'dark', timeZone: 'Asia/Ho_Chi_Minh' };
  assert.deepEqual(
    (await get().expect(200)).body.data,
    expected,
    'Concurrent first saves merge fields',
  );
  assert(
    first.some(
      (response) =>
        JSON.stringify(response.body.data) === JSON.stringify(expected),
    ),
  );
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM user_preferences WHERE user_id=$1',
        [a.id],
      )
    )[0].n,
    1,
  );
  await Promise.all([
    patch({ dateFormat: 'MM/DD/YYYY' }).expect(200),
    patch({ weekStartsOn: 'sunday' }).expect(200),
  ]);
  expected.dateFormat = 'MM/DD/YYYY';
  expected.weekStartsOn = 'sunday';
  assert.deepEqual(
    (await get().expect(200)).body.data,
    expected,
    'Existing-row updates merge fields',
  );
  const beforeRepeat = await source.query(
    'SELECT * FROM user_preferences WHERE user_id=$1',
    [a.id],
  );
  assert.deepEqual(
    (await patch({ theme: 'dark' }).expect(200)).body.data,
    expected,
  );
  assert.deepEqual(
    await source.query('SELECT * FROM user_preferences WHERE user_id=$1', [
      a.id,
    ]),
    beforeRepeat,
    'Repeated payload has no write side effect',
  );
  for (const body of reservedBodies) {
    assert.equal(
      (await patch(body).expect(400)).body.code,
      'VALIDATION_FAILED',
    );
  }
  assert.deepEqual(
    (await get().expect(200)).body.data,
    expected,
    'Rejected keys never update an existing row',
  );
  assert.deepEqual((await get(tokenB).expect(200)).body.data, defaults);
  assert.deepEqual(
    (
      await http
        .get(`${path}?userId=${b.id}`)
        .auth(tokenA, { type: 'bearer' })
        .expect(200)
    ).body.data,
    expected,
  );
  await patch(
    {
      theme: 'light',
      timeZone: 'UTC',
      dateFormat: 'DD/MM/YYYY',
      weekStartsOn: 'monday',
    },
    tokenB,
  ).expect(200);
  assert.deepEqual((await get().expect(200)).body.data, expected);
  const profile = await http
    .get('/api/users/me')
    .auth(tokenA, { type: 'bearer' })
    .expect(200);
  assert(!('preferences' in profile.body.data));
  assert(!('passwordHash' in profile.body.data));
  await http
    .patch('/api/users/me')
    .auth(tokenA, { type: 'bearer' })
    .send({ displayName: 'Updated Profile' })
    .expect(200);
  assert.deepEqual((await get().expect(200)).body.data, expected);
  for (const method of ['get', 'patch']) {
    await http[method](path).expect(401);
    await http[method](path).auth('invalid', { type: 'bearer' }).expect(401);
    const expired = await app
      .get(JwtService)
      .signAsync({ sub: a.id }, { expiresIn: -1 });
    await http[method](path).auth(expired, { type: 'bearer' }).expect(401);
  }
  const missing = '00000000-0000-4000-8000-000000000001';
  await assert.rejects(
    service.get(missing),
    (error) => error.getStatus() === 404,
  );
  await assert.rejects(
    service.update(missing, { theme: 'dark' }),
    (error) => error.getStatus() === 404,
  );
  const constraint = (sql, parameters, code) =>
    assert.rejects(
      source.query(sql, parameters),
      (error) => error.driverError?.code === code,
    );
  await constraint(
    'INSERT INTO user_preferences(user_id) VALUES($1)',
    [a.id],
    '23505',
  );
  await constraint(
    'INSERT INTO user_preferences(user_id) VALUES($1)',
    [missing],
    '23503',
  );
  for (const column of ['theme', 'date_format', 'week_starts_on']) {
    await constraint(
      `UPDATE user_preferences SET ${column}='invalid' WHERE user_id=$1`,
      [a.id],
      '23514',
    );
  }
  await constraint('DELETE FROM users WHERE id=$1', [b.id], '23503');
  const swagger = await http.get('/api-docs-json').expect(200);
  assert(swagger.body.paths[path].get.security);
  assert(swagger.body.paths[path].patch.security);
  assert.deepEqual(
    Object.keys(
      swagger.body.components.schemas.UserPreferencesResponseDto.properties,
    ).sort(),
    Object.keys(defaults).sort(),
  );
}
