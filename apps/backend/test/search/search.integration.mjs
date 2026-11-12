import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { URLSearchParams } from 'node:url';
import { verifySearchScaleAndSnapshots } from './search-scale.mjs';

// Never infer a migration target or load dotenv. All fixtures live in a random DB.
assert.equal(process.env.SEARCH_DATABASE_TESTS, 'local-only');
assert.ok(
  ['127.0.0.1', 'localhost', '::1'].includes(process.env.DATABASE_HOST),
);
assert.notEqual(process.env.NODE_ENV, 'production');
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { Client } = require('pg'),
  { DataSource } = require('typeorm'),
  { Test } = require('@nestjs/testing'),
  { JwtService } = require('@nestjs/jwt');
const request = require('supertest');
const { databaseOptions } = require('../../dist/database/database-options.js');
const { SearchService } = require('../../dist/api/search/search.service.js');
const {
  SearchQueryDto,
} = require('../../dist/api/search/dto/search-query.dto.js');
const { plainToInstance } = require('class-transformer');
const options = databaseOptions(process.env),
  database = `kanban_search_${randomBytes(8).toString('hex')}`;
const admin = new Client({ ...options, user: options.username });
let source,
  app,
  created = false,
  groups = 0;
const pass = (name) => {
  groups++;
  console.log(`PASS: ${name}`);
};

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  source = await new DataSource({ ...options, database }).initialize();
  await source.runMigrations();
  assert.equal(source.options.synchronize, false);
  assert.equal(source.options.migrationsRun, false);
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries,
    [],
  );
  Object.assign(process.env, {
    DATABASE_NAME: database,
    NODE_ENV: 'test',
    JWT_SECRET: randomBytes(32).toString('hex'),
    LOG_LEVEL: 'silent',
    API_PREFIX: 'api',
    SWAGGER_ENABLED: 'true',
    RATE_LIMIT_MAX: '10000',
    MAIL_TRANSPORT: 'fake',
    AVATAR_STORAGE_DRIVER: 'disabled',
    GOOGLE_CLIENT_ID: '',
  });
  const { AppModule } = require('../../dist/app.module.js');
  const {
    configureHttpApplication,
  } = require('../../dist/http-application.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(source)
    .compile();
  app = module.createNestApplication();
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');
  const jwt = app.get(JwtService),
    service = app.get(SearchService),
    actors = {},
    tokens = {};
  for (const name of [
    'owner',
    'member',
    'guest',
    'viewer',
    'admin',
    'outsider',
  ]) {
    const [user] = await source.query(
      `INSERT INTO users(email,display_name,email_verified_at) VALUES ($1,$1,now()) RETURNING id`,
      [`${name}@search.test`],
    );
    actors[name] = user.id;
    tokens[name] = await jwt.signAsync({ sub: user.id });
  }
  const http = request(app.getHttpServer());
  const send = (actor, method, path) =>
    http[method](path)
      .auth(tokens[actor], { type: 'bearer' })
      .timeout({ deadline: 10000 });
  const search = async (actor, query = {}) =>
    (
      await send(
        actor,
        'get',
        `/api/search?${new URLSearchParams(query)}`,
      ).expect(200)
    ).body.data;
  const direct = (actor, query = {}) =>
    service.search(actors[actor], plainToInstance(SearchQueryDto, query));
  const workspace = async (name, personal = false) => {
    const [row] = await source.query(
      `INSERT INTO workspaces(type,name,created_by_id) VALUES ($1,$2,$3) RETURNING id`,
      [personal ? 'PERSONAL' : 'TEAM', name, actors.owner],
    );
    await source.query(
      `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'ADMIN')`,
      [row.id, actors.owner],
    );
    return row.id;
  };
  const board = async (name, workspaceId, visibility = 'PRIVATE') => {
    const [row] = await source.query(
      `INSERT INTO boards(name,workspace_id,created_by_id,visibility) VALUES ($1,$2,$3,$4) RETURNING id`,
      [name, workspaceId, actors.owner, visibility],
    );
    await source.query(
      `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')`,
      [row.id, actors.owner],
    );
    const [column] = await source.query(
      `INSERT INTO board_columns(board_id,name,position) VALUES ($1,'Done',100) RETURNING id`,
      [row.id],
    );
    return { id: row.id, columnId: column.id, workspaceId };
  };
  let position = 0;
  const card = async (parent, title, description = null) => {
    const [row] = await source.query(
      `INSERT INTO cards(board_id,column_id,created_by_id,title,description,position) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        parent.id,
        parent.columnId,
        actors.owner,
        title,
        description,
        ++position * 100,
      ],
    );
    return row.id;
  };
  const first = await workspace('Needle Space A'),
    second = await workspace('Needle Space B');
  await workspace('Needle Personal', true);
  for (const actor of ['member', 'viewer', 'admin'])
    await source.query(
      `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,$3)`,
      [first, actors[actor], actor === 'admin' ? 'ADMIN' : 'MEMBER'],
    );
  const alpha = await board('Needle Alpha', first),
    visible = await board('Needle Visible', first, 'WORKSPACE_VISIBLE'),
    hidden = await board('Needle Confidential', first),
    beta = await board('Needle Beta', second);
  for (const actor of ['member', 'guest'])
    await source.query(
      `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
      [alpha.id, actors[actor]],
    );
  const alphaCard = await card(
      alpha,
      'Needle Alpha Card',
      '<b>Needle</b> context',
    ),
    visibleCard = await card(visible, 'Needle Visible Card'),
    secret = await card(
      hidden,
      'Needle Confidential Card',
      'vaultsecret-188 unique confidential description',
    ),
    betaCard = await card(beta, 'Needle Beta Card');
  const archivedCard = await card(alpha, 'Needle Archived Card');
  await source.query(
    'UPDATE cards SET is_archived=true,archived_at=now() WHERE id=$1',
    [archivedCard],
  );
  const archived = await board('Needle Archived Board', first);
  await card(archived, 'Needle Archived Board Card');
  await source.query(
    'UPDATE boards SET is_archived=true,archived_at=now() WHERE id=$1',
    [archived.id],
  );
  // Many assignments never multiply search hits or gate eligibility on assignment.
  for (const userId of Object.values(actors))
    await source.query(
      'INSERT INTO card_assignees(card_id,user_id) VALUES ($1,$2)',
      [alphaCard, userId],
    );
  for (const name of ['One', 'Two']) {
    const [label] = await source.query(
      `INSERT INTO board_labels(board_id,name,color) VALUES ($1,$2,'#123456') RETURNING id`,
      [alpha.id, name],
    );
    await source.query(
      'INSERT INTO card_labels(card_id,board_id,label_id) VALUES ($1,$2,$3)',
      [alphaCard, alpha.id, label.id],
    );
  }
  const matrix = {
    owner: [3, 4, 4],
    member: [1, 2, 2],
    guest: [0, 1, 1],
    viewer: [1, 1, 1],
    admin: [1, 1, 1],
    outsider: [0, 0, 0],
  };
  for (const [actor, expected] of Object.entries(matrix)) {
    const result = await search(actor, { q: 'needle' });
    assert.equal(result.query, 'needle');
    assert.equal(result.type, 'all');
    assert.deepEqual(
      Object.values(result.groups).map((group) => group.total),
      expected,
      actor,
    );
    for (const group of Object.values(result.groups)) {
      assert.equal(group.items.length, group.total);
      assert.equal(
        new Set(group.items.map((item) => item.id)).size,
        group.total,
      );
      assert.equal(group.hasMore, false);
    }
    const discoveries = (
      await send(actor, 'get', '/api/boards?limit=100').expect(200)
    ).body.data.map((item) => item.id);
    assert.deepEqual(
      new Set(result.groups.boards.items.map((item) => item.id)),
      new Set(discoveries),
    );
    if (actor !== 'owner')
      assert.ok(!JSON.stringify(result).includes('Confidential'));
    for (const item of [
      ...result.groups.boards.items,
      ...result.groups.cards.items,
    ]) {
      await send(actor, 'get', `/api${item.path}`).expect(200);
      assert.equal(
        item.workspaceName,
        actor === 'guest'
          ? null
          : item.workspaceId === second
            ? 'Needle Space B'
            : 'Needle Space A',
      );
    }
    for (const item of result.groups.workspaces.items) {
      assert.equal(item.subtitle, null);
      await send(actor, 'get', `/api${item.path}`).expect(200);
    }
  }
  // VT-053 consumer contract: absent boardId remains byte-shape-compatible;
  // an optional boardId only narrows authorized Cards, not other groups.
  const legacyCards = await search('owner', {
    q: 'needle', type: 'cards', page: '1', limit: '20',
  });
  assert.equal(legacyCards.groups.cards.total, 4);
  const alphaScoped = await search('owner', {
    q: 'needle', type: 'cards', boardId: alpha.id, page: '1', limit: '1',
  });
  assert.equal(alphaScoped.groups.cards.total, 1);
  assert.deepEqual(alphaScoped.groups.cards.items.map(({ id }) => id), [alphaCard]);
  assert.equal(alphaScoped.groups.cards.hasMore, false);
  assert.deepEqual(alphaScoped.groups.boards, { items: [], total: 0, hasMore: false });
  assert.deepEqual(alphaScoped.groups.workspaces, { items: [], total: 0, hasMore: false });
  assert.deepEqual(Object.keys(alphaScoped.groups.cards.items[0]).sort(),
    Object.keys(legacyCards.groups.cards.items[0]).sort());
  assert.equal((await search('owner', {
    q: 'needle', type: 'cards', boardId: beta.id,
  })).groups.cards.items[0].id, betaCard);
  for (const [actor, inaccessibleBoard] of [
    ['outsider', alpha.id], ['guest', hidden.id],
  ]) {
    const denied = await search(actor, {
      q: 'needle', type: 'cards', boardId: inaccessibleBoard,
    });
    assert.equal(denied.groups.cards.total, 0);
    assert.deepEqual(denied.groups.cards.items, []);
  }
  for (const invalid of [
    `type=all&boardId=${alpha.id}`,
    `type=boards&boardId=${alpha.id}`,
    'type=cards&boardId=not-a-uuid',
    'type=cards&boardId=',
  ]) {
    const res = await send('owner', 'get', `/api/search?q=needle&${invalid}`).expect(400);
    assert.equal(res.body.code, 'VALIDATION_FAILED');
  }
  pass('VT-053 Board-filtered Cards, legacy wire shape, authorization and invalid scopes');

  const guest = await search('guest', { q: 'needle' });
  assert.equal(guest.groups.boards.items[0].subtitle, null);
  assert.equal(guest.groups.cards.items[0].subtitle, 'Needle context');
  assert.ok(!JSON.stringify(guest).includes('Needle Space A'));
  await send('guest', 'get', `/api/workspaces/${first}`).expect(404);
  // Membership in one Workspace must never reveal the name of a different
  // Workspace reached only through an independent Board Guest grant.
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [beta.id, actors.member],
  );
  const crossWorkspace = await search('member', { q: 'Needle Beta' });
  assert.deepEqual(
    Object.values(crossWorkspace.groups).map((group) => group.total),
    [0, 1, 1],
  );
  assert.equal(crossWorkspace.groups.boards.items[0].workspaceName, null);
  assert.equal(crossWorkspace.groups.boards.items[0].subtitle, null);
  assert.equal(crossWorkspace.groups.cards.items[0].workspaceName, null);
  assert.equal(crossWorkspace.groups.cards.items[0].subtitle, 'Needle Beta');
  assert.ok(!JSON.stringify(crossWorkspace).includes('Needle Space B'));
  await send('member', 'get', `/api/workspaces/${second}`).expect(404);
  await source.query(
    'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
    [beta.id, actors.member],
  );
  assert.ok(
    Object.values((await search('member', { q: 'Needle Beta' })).groups).every(
      (group) => group.total === 0,
    ),
  );
  for (const actor of ['admin', 'guest', 'viewer', 'outsider']) {
    const result = await search(actor, { q: 'vaultsecret-188' });
    assert.ok(Object.values(result.groups).every((group) => group.total === 0));
    assert.ok(!JSON.stringify(result).includes('confidential description'));
  }
  assert.equal(
    (await search('owner', { q: 'vaultsecret-188', type: 'cards' })).groups
      .cards.items[0].id,
    secret,
  );
  pass(
    'full Workspace/Board ACL matrix, Guest directory privacy, cross-Workspace isolation, deduplication and deep-link/discovery parity',
  );

  await source.query('DELETE FROM card_assignees WHERE card_id=$1', [
    alphaCard,
  ]);
  assert.equal((await search('guest', { q: 'needle' })).groups.cards.total, 1);
  await send('owner', 'patch', `/api/boards/${hidden.id}/visibility`)
    .send({ visibility: 'WORKSPACE_VISIBLE' })
    .expect(200);
  assert.equal(
    (await search('admin', { q: 'vaultsecret-188' })).groups.cards.total,
    1,
  );
  await send('owner', 'patch', `/api/boards/${hidden.id}/visibility`)
    .send({ visibility: 'PRIVATE' })
    .expect(200);
  assert.equal(
    (await search('admin', { q: 'vaultsecret-188' })).groups.cards.total,
    0,
  );
  await source.query(
    'DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
    [first, actors.member],
  );
  const retained = await search('member', { q: 'needle' });
  assert.deepEqual(
    Object.values(retained.groups).map((group) => group.total),
    [0, 1, 1],
  );
  assert.equal(retained.groups.boards.items[0].workspaceName, null);
  assert.equal(retained.groups.cards.items[0].workspaceName, null);
  await source.query(
    'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
    [alpha.id, actors.guest],
  );
  assert.ok(
    Object.values((await search('guest', { q: 'needle' })).groups).every(
      (group) => group.total === 0,
    ),
  );
  await source.query(
    'DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
    [first, actors.viewer],
  );
  assert.ok(
    Object.values((await search('viewer', { q: 'needle' })).groups).every(
      (group) => group.total === 0,
    ),
  );
  await send(
    'owner',
    'post',
    `/api/boards/${alpha.id}/cards/${alphaCard}/archive`,
  ).expect(200);
  assert.equal((await search('owner', { q: 'needle' })).groups.cards.total, 3);
  await send(
    'owner',
    'post',
    `/api/boards/${alpha.id}/cards/${alphaCard}/restore`,
  ).expect(200);
  await send('owner', 'post', `/api/boards/${beta.id}/archive`).expect(200);
  assert.equal((await search('owner', { q: 'needle' })).groups.cards.total, 3);
  assert.equal((await search('owner', { q: 'needle' })).groups.boards.total, 3);
  await send('owner', 'post', `/api/boards/${beta.id}/restore`).expect(200);
  assert.equal((await search('owner', { q: 'needle' })).groups.cards.total, 4);
  assert.equal(
    (await search('owner', { q: 'needle' })).groups.cards.items.some(
      (item) => item.id === betaCard,
    ),
    true,
  );
  assert.equal(
    (await search('admin', { q: 'needle' })).groups.cards.items[0].id,
    visibleCard,
  );
  pass(
    'visibility changes, independent Board grants after Workspace removal, revoked membership, assignment independence and archive/restore',
  );

  const rankingParent = await workspace('Ranking Parent'),
    rankingBoard = await board('Ranking container', rankingParent);
  const ranked = { workspaces: [], boards: [], cards: [] };
  for (const [type, create, table] of [
    ['workspaces', async (title) => workspace(title), 'workspaces'],
    [
      'boards',
      async (title) => (await board(title, rankingParent)).id,
      'boards',
    ],
    ['cards', async (title) => card(rankingBoard, title), 'cards'],
  ]) {
    const exact = [];
    for (const title of ['RANK188', 'rank188']) {
      const id = await create(title);
      exact.push(id);
      await source.query(
        `UPDATE ${table} SET updated_at='2026-01-01T00:00:00Z' WHERE id=$1`,
        [id],
      );
    }
    exact.sort();
    const olderPrefix = await create('rank188 prefix older'),
      newerPrefix = await create('rank188 prefix newer'),
      contains = await create('contains rank188 suffix');
    await source.query(
      `UPDATE ${table} SET updated_at='2026-02-01T00:00:00Z' WHERE id=$1`,
      [olderPrefix],
    );
    await source.query(
      `UPDATE ${table} SET updated_at='2026-03-01T00:00:00Z' WHERE id=$1`,
      [newerPrefix],
    );
    await source.query(
      `UPDATE ${table} SET updated_at='2030-01-01T00:00:00Z' WHERE id=$1`,
      [contains],
    );
    ranked[type] = [...exact, newerPrefix, olderPrefix, contains];
  }
  const descriptionOnly = await card(
    rankingBoard,
    'Unrelated title',
    'prefix '.repeat(100) +
      'rank188 ' +
      '<b>matched</b> [link](https://evil.test) **text** ' +
      'ending '.repeat(100),
  );
  await source.query(
    "UPDATE cards SET updated_at='2031-01-01T00:00:00Z' WHERE id=$1",
    [descriptionOnly],
  );
  ranked.cards.push(descriptionOnly);
  for (const type of ['workspaces', 'boards', 'cards']) {
    const ids = [];
    for (let page = 1; page <= 4; page++) {
      const result = await search('owner', {
        q: '  RaNk188  ',
        type,
        page: String(page),
        limit: '2',
      });
      assert.equal(result.query, 'RaNk188');
      assert.equal(result.groups[type].total, ranked[type].length);
      assert.equal(result.groups[type].hasMore, ranked[type].length > page * 2);
      ids.push(...result.groups[type].items.map((item) => item.id));
      for (const other of ['workspaces', 'boards', 'cards'].filter(
        (name) => name !== type,
      ))
        assert.deepEqual(result.groups[other], {
          items: [],
          total: 0,
          hasMore: false,
        });
    }
    assert.deepEqual(ids, ranked[type], type);
    const beyond = await search('owner', {
      q: 'rank188',
      type,
      page: '100000000',
      limit: '50',
    });
    assert.equal(beyond.groups[type].items.length, 0);
    assert.equal(beyond.groups[type].total, ranked[type].length);
    assert.equal(beyond.groups[type].hasMore, false);
  }
  const grouped = await search('owner', { q: 'rank188' });
  for (const type of ['workspaces', 'boards', 'cards']) {
    assert.equal(grouped.groups[type].items.length, 5);
    assert.equal(grouped.groups[type].total, ranked[type].length);
  }
  assert.equal(grouped.groups.cards.hasMore, true);
  const snippet = (
    await search('owner', { q: 'rank188', type: 'cards', limit: '50' })
  ).groups.cards.items.find((item) => item.id === descriptionOnly).subtitle;
  assert.ok(snippet.includes('rank188'));
  assert.ok(!/[<>\n]/.test(snippet));
  assert.ok([...snippet].length <= 160);
  assert.ok(!snippet.includes('evil.test'));
  pass(
    'exact/prefix/title-substring/description-only rank, timestamp and UUID ties, independent grouped totals and stable pagination',
  );

  const literalName = 'Literal %_\\ token';
  const literalWs = await workspace(literalName),
    literalBoard = await board(literalName, literalWs),
    literalCard = await card(literalBoard, literalName);
  for (const q of ['%', '_', '\\', '%_\\']) {
    const response = await search('owner', { q });
    assert.deepEqual(
      response.groups.workspaces.items.map((item) => item.id),
      [literalWs],
    );
    assert.deepEqual(
      response.groups.boards.items.map((item) => item.id),
      [literalBoard.id],
    );
    assert.deepEqual(
      response.groups.cards.items.map((item) => item.id),
      [literalCard],
    );
  }
  const unicode = await card(literalBoard, 'Đường CAFÉ 😀 中文');
  for (const q of ['đường', 'café', '😀', '中文'])
    assert.equal(
      (await search('owner', { q, type: 'cards' })).groups.cards.items[0].id,
      unicode,
    );
  const injection = "'; DROP TABLE users; --",
    injectionCard = await card(literalBoard, injection);
  assert.equal(
    (await search('owner', { q: injection, type: 'cards' })).groups.cards
      .items[0].id,
    injectionCard,
  );
  assert.equal(
    Number(
      (await source.query('SELECT count(*) AS total FROM users'))[0].total,
    ),
    6,
  );
  const markup = await card(
    literalBoard,
    'Markup',
    '<script>alert(1)</script><b>safehit</b> [shown](javascript:evil)\n\u202Etext',
  );
  assert.equal(
    (await search('owner', { q: 'safehit', type: 'cards' })).groups.cards
      .items[0].id,
    markup,
  );
  const minimal = await search('owner', { q: 'safehit', type: 'cards' });
  assert.ok(!JSON.stringify(minimal).includes('<script>'));
  assert.ok(!minimal.groups.cards.items[0].subtitle.includes('javascript:'));
  for (const query of ['', ' ', '\t\n'])
    assert.ok(
      Object.values((await search('owner', { q: query })).groups).every(
        (group) => group.total === 0,
      ),
    );
  pass(
    'literal wildcard/backslash and injection strings, Unicode case, long matched snippets and empty-query behavior',
  );

  await verifySearchScaleAndSnapshots({
    source,
    service,
    direct,
    search,
    workspace,
    board,
    card,
    actors,
    pass,
  });
  await http.get('/api/search?q=needle').expect(401);
  for (const query of [
    'page=1',
    'type=all&page=1',
    'limit=11',
    'type=cards&limit=51',
    'type=bad',
    'q=%00',
    'q=x&q=y',
    'userId=other',
    'pageSize=5',
    'type=cards&page=9007199254740991&limit=50',
    'q=' + 'a'.repeat(121),
  ]) {
    const response = await send('owner', 'get', `/api/search?${query}`).expect(
      400,
    );
    assert.equal(response.body.code, 'VALIDATION_FAILED');
  }
  const response = await send('owner', 'get', '/api/search?q=needle').expect(
    200,
  );
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.body.success, true);
  const sample = await search('owner', { q: 'needle' });
  assert.deepEqual(
    Object.keys(sample.groups.workspaces.items[0]).sort(),
    ['type', 'id', 'title', 'subtitle', 'path'].sort(),
  );
  assert.deepEqual(
    Object.keys(sample.groups.boards.items[0]).sort(),
    [
      'type',
      'id',
      'title',
      'workspaceId',
      'workspaceName',
      'subtitle',
      'path',
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(sample.groups.cards.items[0]).sort(),
    [
      'type',
      'id',
      'title',
      'boardId',
      'boardName',
      'workspaceId',
      'workspaceName',
      'subtitle',
      'path',
    ].sort(),
  );
  const swagger = (await http.get('/api-docs-json').expect(200)).body;
  assert.ok(swagger.paths['/api/search'].get);
  await source.query(
    'UPDATE users SET auth_version=auth_version+1 WHERE id=$1',
    [actors.owner],
  );
  await send('owner', 'get', '/api/search?q=needle').expect(401);
  pass(
    'compiled AppModule HTTP, exact allowlisted fields, JWT/session invalidation, validation, no-store and Swagger',
  );
  console.log(`Global Search PostgreSQL integration: ${groups} groups passed`);
} finally {
  if (app) await app.close();
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${database}"`);
  await admin.end();
}
