import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';

// Explicit local opt-in; never read dotenv or reuse the development database.
assert.equal(process.env.EXPORT_DATABASE_TESTS, 'local-only');
assert.ok(
  ['127.0.0.1', 'localhost', '::1'].includes(process.env.DATABASE_HOST),
);
assert.notEqual(process.env.NODE_ENV, 'production');
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { Test } = require('@nestjs/testing');
const { JwtService } = require('@nestjs/jwt');
const request = require('supertest');
const { databaseOptions } = require('../../dist/database/database-options.js');
const {
  BoardExportService,
} = require('../../dist/api/exports/board-export.service.js');
const {
  AccountExportService,
} = require('../../dist/api/exports/account-export.service.js');
const {
  BOARD_EXPORT_CSV_HEADERS,
  DATA_EXPORT_BYTE_LIMIT,
} = require('@kanban/shared');
const options = databaseOptions(process.env);
const database = `kanban_exports_${randomBytes(8).toString('hex')}`;
const admin = new Client({ ...options, user: options.username });
let source,
  app,
  created = false,
  groups = 0;
const pass = (label) => {
  groups++;
  console.log(`PASS: ${label}`);
};
function privacy(response, status = 200) {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(response.headers.pragma, 'no-cache');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  if (status !== 200)
    assert.equal(response.headers['content-disposition'], undefined);
}
// Small independent RFC 4180 reader verifies records rather than splitting on newlines.
function parseCsv(text) {
  const rows = [];
  let row = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && char === ',') {
      row.push(cell);
      cell = '';
    } else if (!quoted && char === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += char;
  }
  assert.equal(quoted, false);
  assert.equal(cell, '');
  return rows;
}
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  source = await new DataSource({ ...options, database }).initialize();
  await source.runMigrations();
  assert.equal(source.options.synchronize, false);
  assert.equal(source.options.migrationsRun, false);
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
    ATTACHMENT_STORAGE_DRIVER: 'disabled',
    GOOGLE_CLIENT_ID: '',
    TASK_NOTIFICATION_EMAIL_ENABLED: 'false',
    TASK_NOTIFICATION_JOBS_ENABLED: 'false',
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
  const http = request(app.getHttpServer()),
    jwt = app.get(JwtService);
  const boardService = app.get(BoardExportService),
    accountService = app.get(AccountExportService);
  const users = {},
    tokens = {};
  for (const actor of [
    'owner',
    'member',
    'guest',
    'viewer',
    'admin',
    'outsider',
    'unverified',
  ]) {
    const [row] = await source.query(
      'INSERT INTO users(email,display_name,email_verified_at,password_hash) VALUES ($1,$2,$3,$4) RETURNING id',
      [
        `${actor}@export.test`,
        actor,
        actor === 'unverified' ? null : new Date(),
        'credential-sentinel',
      ],
    );
    users[actor] = row.id;
    tokens[actor] = await jwt.signAsync({ sub: row.id });
  }
  const send = (actor, path) =>
    http
      .get(path)
      .auth(tokens[actor], { type: 'bearer' })
      .timeout({ deadline: 30000 });
  const [workspace] = await source.query(
    "INSERT INTO workspaces(type,name,created_by_id) VALUES ('TEAM','Export workspace',$1) RETURNING id",
    [users.owner],
  );
  for (const actor of ['owner', 'member', 'viewer', 'admin'])
    await source.query(
      'INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,$3)',
      [
        workspace.id,
        users[actor],
        ['owner', 'admin'].includes(actor) ? 'ADMIN' : 'MEMBER',
      ],
    );
  const board = async (name, visibility = 'PRIVATE') => {
    const [row] = await source.query(
      'INSERT INTO boards(name,created_by_id,workspace_id,visibility) VALUES ($1,$2,$3,$4) RETURNING id',
      [name, users.owner, workspace.id, visibility],
    );
    await source.query(
      "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')",
      [row.id, users.owner],
    );
    const [column] = await source.query(
      "INSERT INTO board_columns(board_id,name,position) VALUES ($1,'Done',100.0000000001) RETURNING id",
      [row.id],
    );
    return { ...row, columnId: column.id };
  };
  const alpha = await board(' \t=Board, "name"'),
    visible = await board('Visible', 'WORKSPACE_VISIBLE'),
    empty = await board('Empty'),
    hidden = await board('Private hidden');
  for (const actor of ['member', 'guest'])
    await source.query(
      "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')",
      [alpha.id, users[actor]],
    );
  const card = async (parent, title = 'Card', position = '100.0000000001') =>
    (
      await source.query(
        'INSERT INTO cards(board_id,column_id,created_by_id,title,description,position,start_date,due_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [
          parent.id,
          parent.columnId,
          users.owner,
          title,
          '\u200b=SUM(1)\n"quoted", Tiếng Việt',
          position,
          '2026-01-01T01:00:00Z',
          '2026-01-02T01:00:00Z',
        ],
      )
    )[0].id;
  const first = await card(alpha, '\t@SUM(1)'),
    archived = await card(alpha, 'Archived', '200'),
    hiddenCard = await card(hidden, 'Secret'),
    visibleCard = await card(visible, 'Visible Card');
  await source.query(
    'UPDATE cards SET is_archived=true,archived_at=now() WHERE id=$1',
    [archived],
  );
  await source.query(
    'INSERT INTO card_assignees(card_id,user_id) VALUES ($1,$2)',
    [first, users.member],
  );
  const [label] = await source.query(
    "INSERT INTO board_labels(board_id,name,color) VALUES ($1,'@label','#112233') RETURNING id",
    [alpha.id],
  );
  await source.query(
    'INSERT INTO card_labels(board_id,card_id,label_id) VALUES ($1,$2,$3)',
    [alpha.id, first, label.id],
  );
  const [list] = await source.query(
    "INSERT INTO card_checklists(card_id,title,position) VALUES ($1,'List',100) RETURNING id",
    [first],
  );
  await source.query(
    "INSERT INTO card_checklist_items(checklist_id,text,position,is_checked) VALUES ($1,'Later',200,false),($1,'First',100,true)",
    [list.id],
  );
  const comment = async (cardId, author, content) =>
    (
      await source.query(
        'INSERT INTO comments(card_id,author_id,content) VALUES ($1,$2,$3) RETURNING id',
        [cardId, users[author], content],
      )
    )[0].id;
  const ownComment = await comment(first, 'owner', 'Hello @member');
  await source.query(
    'INSERT INTO comment_mentions(comment_id,user_id,start_offset,end_offset) VALUES ($1,$2,6,13)',
    [ownComment, users.member],
  );
  const deleted = await comment(first, 'owner', 'deleted-sentinel');
  await source.query('UPDATE comments SET deleted_at=now() WHERE id=$1', [
    deleted,
  ]);
  await comment(first, 'member', 'member-authored');
  await comment(hiddenCard, 'member', 'lost-access-sentinel');
  await comment(visibleCard, 'viewer', 'workspace-authored');
  await source.query(
    "INSERT INTO card_attachments(card_id,board_id,uploader_id,kind,state,display_name,url) VALUES($1,$2,$3,'URL','ACTIVE','Link','https://example.com/public')",
    [first, alpha.id, users.owner],
  );
  const fileId = randomUUID();
  for (const state of ['ACTIVE', 'PENDING', 'FAILED', 'REMOVED']) {
    const id = state === 'ACTIVE' ? fileId : randomUUID();
    await source.query(
      `INSERT INTO card_attachments(id,card_id,board_id,uploader_id,kind,state,display_name,original_filename,pending_key,storage_key,requested_mime_type,reserved_bytes,declared_bytes,mime_type,byte_size,verified_at,expires_at)
      VALUES($1::uuid,$2,$3,$4,'FILE',$5::varchar,'File','file.txt','attachments/v1/pending/'||$1::text,'attachments/v1/active/'||$1::text,'text/plain',5,5,CASE WHEN $5::varchar='ACTIVE' THEN 'text/plain' END,CASE WHEN $5::varchar='ACTIVE' THEN 5 END,CASE WHEN $5::varchar='ACTIVE' THEN now() END,now()+interval '15 minutes')`,
      [id, first, alpha.id, users.owner, state],
    );
  }
  for (const actor of ['member', 'guest'])
    for (const format of ['json', 'csv'])
      privacy(
        await send(actor, `/api/boards/${alpha.id}/export?format=${format}`),
        403,
      );
  for (const actor of ['viewer', 'admin', 'outsider'])
    for (const parent of [alpha, visible])
      privacy(await send(actor, `/api/boards/${parent.id}/export`), 404);
  privacy(await send('owner', `/api/boards/${randomUUID()}/export`), 404);
  pass(
    'explicit OWNER matrix: MEMBER/Guest 403; workspace viewer/admin and outsiders 404',
  );
  let response = await send(
    'owner',
    `/api/boards/${alpha.id}/export?format=json`,
  );
  privacy(response);
  assert.equal(
    response.headers['content-type'],
    'application/json; charset=utf-8',
  );
  assert.match(
    response.headers['content-disposition'],
    new RegExp(
      `^attachment; filename="kanvexa-board-${alpha.id}-[0-9-]+\\.json"$`,
    ),
  );
  const json = response.body;
  assert.deepEqual(Object.keys(json), [
    'schemaVersion',
    'generatedAt',
    'board',
    'columns',
    'cards',
    'labels',
    'boardMembers',
  ]);
  assert.equal(json.schemaVersion, 1);
  assert.match(json.generatedAt, /Z$/);
  assert.deepEqual(
    json.cards.map((row) => row.id),
    [first, archived],
  );
  assert.equal(json.cards[0].position, '100.0000000001');
  assert.equal(json.columns[0].position, '100.0000000001');
  assert.equal(json.cards[1].isArchived, true);
  assert.equal(json.board.archivedAt, null);
  assert.deepEqual(json.cards[0].assigneeIds, [users.member]);
  assert.deepEqual(json.cards[0].labelIds, [label.id]);
  assert.deepEqual(
    json.cards[0].checklists[0].items.map((row) => row.isChecked),
    [true, false],
  );
  assert.deepEqual(json.cards[0].comments.map((row) => row.content).sort(), [
    'Hello @member',
    'member-authored',
  ]);
  assert.deepEqual(
    json.cards[0].comments.find((row) => row.id === ownComment).mentions,
    [{ userId: users.member, start: 6, end: 13 }],
  );
  assert.equal(json.cards[0].attachments.length, 2);
  assert.equal(
    json.cards[0].attachments.find((row) => row.id === fileId).byteSize,
    '5',
  );
  const raw = JSON.stringify(json);
  for (const sentinel of [
    'credential-sentinel',
    '@export.test',
    'attachments/v1/',
    'deleted-sentinel',
    'googleSub',
    'storageKey',
    'authVersion',
    'pendingKey',
  ])
    assert.equal(raw.includes(sentinel), false, sentinel);
  const again = (await send('owner', `/api/boards/${alpha.id}/export`)).body;
  delete again.generatedAt;
  const stable = { ...json };
  delete stable.generatedAt;
  assert.deepEqual(again, stable);
  pass(
    'JSON reconstructs ordered nested/archive data, mentions and allowlisted private FILE metadata',
  );
  response = await send('owner', `/api/boards/${alpha.id}/export?format=csv`);
  privacy(response);
  assert.equal(response.headers['content-type'], 'text/csv; charset=utf-8');
  const rows = parseCsv(response.text);
  assert.deepEqual(rows[0], BOARD_EXPORT_CSV_HEADERS);
  assert.equal(rows.length, 3);
  const csvCard = Object.fromEntries(
    rows[0].map((key, index) => [key, rows[1][index]]),
  );
  assert.equal(csvCard.cardId, first);
  assert.ok(csvCard.boardName.startsWith("'"));
  assert.ok(csvCard.title.startsWith("'"));
  assert.ok(csvCard.description.startsWith("'"));
  assert.ok(csvCard.labels.startsWith("'"));
  assert.equal(csvCard.checklistDone, '1');
  assert.equal(csvCard.checklistTotal, '2');
  assert.equal(csvCard.attachmentCount, '2');
  assert.equal(csvCard.commentCount, '2');
  assert.equal(csvCard.position, '100.0000000001');
  assert.equal(csvCard.createdAt, json.cards[0].createdAt);
  assert.equal(
    (await send('owner', `/api/boards/${empty.id}/export?format=csv`)).text,
    BOARD_EXPORT_CSV_HEADERS.join(',') + '\r\n',
  );
  const emptyJson = (await send('owner', `/api/boards/${empty.id}/export`))
    .body;
  for (const key of ['cards', 'labels']) assert.deepEqual(emptyJson[key], []);
  await source.query(
    'UPDATE boards SET is_archived=true,archived_at=now() WHERE id=$1',
    [alpha.id],
  );
  for (const format of ['json', 'csv'])
    privacy(
      await send('owner', `/api/boards/${alpha.id}/export?format=${format}`),
    );
  pass(
    'CSV RFC4180, Unicode/formulas, header-only empty Board and archived Board downloads',
  );
  await source.query(
    'INSERT INTO google_identities(user_id,google_sub) VALUES ($1,$2)',
    [users.member, 'google-sub-sentinel'],
  );
  await source.query(
    "INSERT INTO user_preferences(user_id,theme,time_zone,date_format,week_starts_on) VALUES ($1,'dark','Asia/Bangkok','DD/MM/YYYY','sunday')",
    [users.member],
  );
  await source.query(
    'INSERT INTO notification_preferences(user_id,in_app_card_assigned,email_card_assigned) VALUES ($1,false,true)',
    [users.member],
  );
  await source.query(
    "INSERT INTO user_notifications(recipient_user_id,kind,dedupe_key,actor_user_id,workspace_id,board_id,card_id) VALUES ($1,'CARD_ASSIGNED','CARD_ASSIGNED:export-test',$2,$3,$4,$5)",
    [users.member, users.owner, workspace.id, hidden.id, hiddenCard],
  );
  const account = (await send('member', '/api/users/me/export')).body;
  assert.equal(account.profile.userId, users.member);
  assert.equal(account.profile.email, 'member@export.test');
  assert.deepEqual(account.linkedProviders, { password: true, google: true });
  assert.equal(account.preferences.theme, 'dark');
  assert.equal(account.preferences.timeZone, 'Asia/Bangkok');
  assert.equal(account.preferences.notifications.inApp.cardAssigned, false);
  assert.equal(account.preferences.notifications.email.cardAssigned, true);
  assert.deepEqual(
    account.boardMemberships.map((row) => row.boardId),
    [alpha.id],
  );
  assert.equal(account.workspaceMemberships.length, 1);
  assert.deepEqual(
    account.comments.map((row) => row.content),
    ['member-authored'],
  );
  assert.equal(account.notifications.length, 1);
  assert.equal(account.notifications[0].boardId, null);
  assert.equal(account.notifications[0].cardId, null);
  for (const sentinel of [
    'lost-access-sentinel',
    'google-sub-sentinel',
    'credential-sentinel',
    'owner@export.test',
    'dedupeKey',
    'actorUserId',
    'Secret',
  ])
    assert.equal(JSON.stringify(account).includes(sentinel), false, sentinel);
  const defaults = (await send('outsider', '/api/users/me/export')).body;
  assert.deepEqual(defaults.workspaceMemberships, []);
  assert.deepEqual(defaults.comments, []);
  assert.deepEqual(defaults.boardMemberships, []);
  assert.equal(defaults.preferences.theme, 'system');
  assert.equal(defaults.preferences.timeZone, 'UTC');
  assert.equal(defaults.preferences.dateFormat, 'YYYY-MM-DD');
  assert.equal(defaults.preferences.weekStartsOn, 'monday');
  assert.equal(defaults.preferences.notifications.email.cardAssigned, false);
  assert.deepEqual(
    (await send('viewer', '/api/users/me/export')).body.comments.map(
      (row) => row.content,
    ),
    ['workspace-authored'],
  );
  pass(
    'account self-only profile, current grants/authored comments, preferences/defaults and safe notification metadata',
  );
  for (const path of [
    `/api/boards/${alpha.id}/export?format=zip`,
    `/api/boards/${alpha.id}/export?format=csv&format=json`,
    `/api/boards/${alpha.id}/export?role=OWNER`,
    '/api/users/me/export?format=csv',
    '/api/users/me/export?userId=' + users.owner,
    '/api/users/me/export?format[foo]=json',
  ]) {
    const bad = await send('owner', path);
    privacy(bad, 400);
    assert.equal(bad.body.code, 'VALIDATION_FAILED');
  }
  for (const path of [
    `/api/boards/${alpha.id}/export`,
    '/api/users/me/export',
  ]) {
    privacy(await http.get(path), 401);
    privacy(await send('unverified', path), 401);
    const expired = await jwt.signAsync(
      { sub: users.owner },
      { expiresIn: -1 },
    );
    privacy(await http.get(path).auth(expired, { type: 'bearer' }), 401);
  }
  const swagger = (await http.get('/api-docs-json')).body;
  assert.equal(
    swagger.paths['/api/boards/{boardId}/export'].get.responses['200'].content[
      'text/csv'
    ].schema.format,
    'binary',
  );
  assert.ok(swagger.paths['/api/users/me/export'].get.responses['413']);
  pass(
    'JWT verification, malformed/unknown query rejection, failure privacy headers and Swagger binary contracts',
  );
  // Pause the actual implementation after a snapshot is complete, then commit revocation.
  const race = async (service, change, path, status, actor = 'member') => {
    const original = service.create;
    let started, release;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    service.create = async function (...args) {
      const result = await original.apply(this, args);
      started();
      await gate;
      return result;
    };
    try {
      const pending = send(actor, path).then((value) => value);
      await ready;
      await change();
      release();
      privacy(await pending, status);
    } finally {
      release();
      service.create = original;
    }
  };
  // A noncreator second OWNER can be revoked without changing creator protections.
  await source.query(
    "UPDATE board_members SET role='OWNER' WHERE board_id=$1 AND user_id=$2",
    [alpha.id, users.member],
  );
  await race(
    boardService,
    () =>
      source.query(
        "UPDATE board_members SET role='MEMBER' WHERE board_id=$1 AND user_id=$2",
        [alpha.id, users.member],
      ),
    `/api/boards/${alpha.id}/export`,
    403,
  );
  await race(
    accountService,
    () =>
      source.query(
        'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
        [alpha.id, users.member],
      ),
    '/api/users/me/export',
    403,
  );
  assert.deepEqual(
    (await send('member', '/api/users/me/export')).body.comments,
    [],
  );
  await source.query(
    "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')",
    [alpha.id, users.member],
  );
  await race(
    accountService,
    () =>
      source.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1', [
        users.member,
      ]),
    '/api/users/me/export',
    401,
  );
  tokens.member = await jwt.signAsync({ sub: users.member, authVersion: 1 });
  pass(
    'committed OWNER demotion, membership removal and session invalidation race never publishes stale downloads',
  );
  await race(
    accountService,
    () =>
      source.query(
        'DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
        [workspace.id, users.viewer],
      ),
    '/api/users/me/export',
    403,
    'viewer',
  );
  const revokedViewer = (await send('viewer', '/api/users/me/export')).body;
  assert.deepEqual(revokedViewer.workspaceMemberships, []);
  assert.deepEqual(revokedViewer.comments, []);
  pass(
    'Workspace-only comment access is revoked and discarded before Account publication',
  );
  const originalNested = boardService.nested;
  let mutated = false;
  boardService.nested = async function (...args) {
    if (!mutated) {
      mutated = true;
      await source.query("UPDATE cards SET title='New title' WHERE id=$1", [
        first,
      ]);
      await source.query(
        "UPDATE comments SET content='New comment' WHERE id=$1",
        [ownComment],
      );
      await source.query(
        'UPDATE boards SET is_archived=false,archived_at=NULL WHERE id=$1',
        [alpha.id],
      );
      await source.query(
        'UPDATE cards SET is_archived=true,archived_at=now() WHERE id=$1',
        [first],
      );
      await source.query('DELETE FROM cards WHERE id=$1', [archived]);
    }
    return originalNested.apply(this, args);
  };
  try {
    const consistent = (await send('owner', `/api/boards/${alpha.id}/export`))
      .body;
    assert.equal(consistent.cards[0].title, json.cards[0].title);
    assert.equal(consistent.board.isArchived, true);
    assert.equal(consistent.cards[0].isArchived, false);
    assert.deepEqual(
      consistent.cards.map((row) => row.id),
      [first, archived],
    );
    assert.equal(
      consistent.cards[0].comments.find((row) => row.id === ownComment).content,
      'Hello @member',
    );
  } finally {
    boardService.nested = originalNested;
  }
  pass(
    'concurrent edits, archive and Card deletion cannot tear the repeatable-read export snapshot',
  );
  const scale = await board('Scale');
  await source.query(
    "INSERT INTO cards(board_id,column_id,created_by_id,title,position) SELECT $1,$2,$3,'Card '||n,n FROM generate_series(1,10000) n",
    [scale.id, scale.columnId, users.owner],
  );
  for (const format of ['json', 'csv']) {
    const large = await send(
      'owner',
      `/api/boards/${scale.id}/export?format=${format}`,
    );
    privacy(large);
    assert.equal(
      format === 'json'
        ? large.body.cards.length
        : parseCsv(large.text).length - 1,
      10000,
    );
  }
  const extra = await card(scale, 'One too many', '10001');
  for (const format of ['json', 'csv']) {
    const tooMany = await send(
      'owner',
      `/api/boards/${scale.id}/export?format=${format}`,
    );
    privacy(tooMany, 413);
    assert.equal(tooMany.body.code, 'EXPORT_TOO_LARGE');
  }
  await source.query('DELETE FROM cards WHERE id=$1', [extra]);
  await source.query(
    "UPDATE cards SET description=repeat('x',$2) WHERE board_id=$1",
    [scale.id, 2200],
  );
  for (const format of ['json', 'csv']) {
    const tooBig = await send(
      'owner',
      `/api/boards/${scale.id}/export?format=${format}`,
    );
    privacy(tooBig, 413);
    assert.equal(tooBig.body.code, 'EXPORT_TOO_LARGE');
  }
  await source.query(
    "INSERT INTO comments(card_id,author_id,content) VALUES ($1,$2,repeat('x',$3))",
    [first, users.member, DATA_EXPORT_BYTE_LIMIT],
  );
  const tooBig = await send('member', '/api/users/me/export');
  privacy(tooBig, 413);
  assert.equal(tooBig.body.code, 'EXPORT_TOO_LARGE');
  pass(
    '10,000 Cards accepted in both formats; 10,001 Cards and Board/Account 20 MiB overflow return private 413',
  );
  const original = boardService.create;
  boardService.create = async () => {
    throw new Error('SQL secret-sentinel credential-sentinel');
  };
  try {
    const failure = await send('owner', `/api/boards/${alpha.id}/export`);
    privacy(failure, 500);
    assert.equal(failure.body.code, 'INTERNAL_ERROR');
    assert.equal(JSON.stringify(failure.body).includes('sentinel'), false);
  } finally {
    boardService.create = original;
  }
  assert.deepEqual(
    (await source.driver.createSchemaBuilder().log()).upQueries,
    [],
  );
  pass(
    'sanitized failures, no partial attachment headers, no schema drift or export persistence',
  );
  console.log(`Export PostgreSQL suite: ${groups} groups passed`);
} finally {
  if (app) await app.close();
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
