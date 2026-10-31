import assert from 'node:assert/strict';
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyBoardMemberAddedMail } from './board-member-added-mail.integration.mjs';

const require = createRequire(import.meta.url);
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { databaseOptions } = require('../../dist/database/database-options.js');
const {
  BoardMembersService,
} = require('../../dist/api/board-members/board-members.service.js');
const {
  BoardAuthorizationService,
} = require('../../dist/api/board-members/board-authorization.service.js');
const { Board } = require('../../dist/api/boards/entities/board.entity.js');
const {
  BoardRoomCoordinator,
} = require('../../dist/realtime/board-room-coordinator.service.js');
const {
  BoardPresenceService,
} = require('../../dist/realtime/board-presence.service.js');
const {
  BoardMember,
} = require('../../dist/api/board-members/entities/board-member.entity.js');

// Designated disposable local server only. Never load the application's .env.
const container = `kanvexa-members-test-${randomBytes(6).toString('hex')}`;
const password = randomBytes(32).toString('hex');
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    env: { ...process.env, POSTGRES_PASSWORD: password },
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
let source;
let started = false;

try {
  docker(
    'run',
    '--detach',
    '--rm',
    '--name',
    container,
    '--publish',
    '127.0.0.1::5432',
    '--env',
    'POSTGRES_PASSWORD',
    '--env',
    'POSTGRES_USER=member_test',
    '--env',
    'POSTGRES_DB=member_test',
    'postgres:16.15-alpine3.24',
  );
  started = true;
  const port = docker(
    'inspect',
    '--format',
    '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
    container,
  );
  Object.assign(process.env, {
    DATABASE_HOST: '127.0.0.1',
    DATABASE_PORT: port,
    DATABASE_NAME: 'member_test',
    DATABASE_USER: 'member_test',
    DATABASE_PASSWORD: password,
    DATABASE_SSL: 'false',
    NODE_ENV: 'test',
    API_PREFIX: 'api',
    LOG_LEVEL: 'silent',
    MAIL_TRANSPORT: 'fake',
    PUBLIC_APP_URL: 'https://boards.example.test',
    WORKSPACE_INVITATION_ACCEPT_PATH: '',
    AVATAR_STORAGE_DRIVER: 'disabled',
    GOOGLE_CLIENT_ID: '',
    RATE_LIMIT_MAX: '10000',
    JWT_SECRET: randomBytes(32).toString('hex'),
  });
  const options = databaseOptions(process.env);
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      source = await new DataSource(options).initialize();
      break;
    } catch (error) {
      if (attempt === 79) throw error;
      await delay(250);
    }
  }
  assert(source);
  await source.runMigrations();
  await verifyBoardMemberAddedMail(source);

  const boards = source.getRepository(Board);
  const members = source.getRepository(BoardMember);
  const users = source.getRepository('User');
  const authorization = new BoardAuthorizationService(members);
  const {
    ActivityWriterService,
  } = require('../../dist/api/activities/activity-writer.service.js');
  const service = new BoardMembersService(
    members,
    boards,
    authorization,
    new BoardRoomCoordinator(new BoardPresenceService()),
    { publish: async () => undefined },
    new ActivityWriterService(),
    { notify: async () => undefined },
  );
  const user = (name) =>
    users.save(
      users.create({
        email: `${name}@example.test`,
        displayName: name,
        passwordHash: 'integration-only-hash',
        avatarUrl: null,
      }),
    );
  const owner = await user('owner');
  const target = await user('target');
  const board = await boards.save(
    boards.create({ name: 'Members', createdById: owner.id }),
  );
  await members.save(
    members.create({ boardId: board.id, userId: owner.id, role: 'OWNER' }),
  );

  const added = await service.add(owner.id, board.id, {
    email: ` ${target.email.toUpperCase()} `,
  });
  assert.equal(added.role, 'MEMBER');
  await assert.rejects(
    service.add(owner.id, board.id, { email: target.email }),
    (error) => error.getStatus?.() === 409,
  );
  await service.updateRole(owner.id, board.id, target.id, { role: 'OWNER' });
  await service.updateRole(owner.id, board.id, target.id, { role: 'MEMBER' });

  const [column] = await source.query(
    `INSERT INTO board_columns (board_id, name, position) VALUES ($1, 'Todo', 100) RETURNING id`,
    [board.id],
  );
  const [activeCard] = await source.query(
    `INSERT INTO cards (board_id, column_id, created_by_id, title, position) VALUES ($1, $2, $3, 'Active', 100) RETURNING id`,
    [board.id, column.id, owner.id],
  );
  const [archivedCard] = await source.query(
    `INSERT INTO cards (board_id, column_id, created_by_id, title, position, is_archived) VALUES ($1, $2, $3, 'Archived', 200, true) RETURNING id`,
    [board.id, column.id, owner.id],
  );
  await source.query(
    'INSERT INTO card_assignees (card_id, user_id, assigned_by_id) VALUES ($1, $2, $3), ($4, $2, $3)',
    [activeCard.id, target.id, owner.id, archivedCard.id],
  );
  await service.remove(owner.id, board.id, target.id);
  assert.equal(
    await members.countBy({ boardId: board.id, userId: target.id }),
    0,
  );
  const [{ count }] = await source.query(
    'SELECT count(*)::int AS count FROM card_assignees WHERE user_id = $1 AND card_id IN ($2, $3)',
    [target.id, activeCard.id, archivedCard.id],
  );
  assert.equal(count, 0);
  await assert.rejects(
    service.list(target.id, board.id, { page: 1, limit: 20 }),
    (error) => error.getStatus?.() === 404,
  );
  console.log(
    'PostgreSQL member add, duplicate conflict, role transitions, multi-card cleanup and access revocation: PASS',
  );
} finally {
  if (source?.isInitialized) await source.destroy();
  if (started) docker('rm', '--force', container);
}
