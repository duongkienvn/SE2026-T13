import assert from 'node:assert/strict';
import console from 'node:console';
import { createRequire } from 'node:module';
import process from 'node:process';
import {
  configureTestEnvironment,
  ids,
  runRealtimeChecks,
} from './realtime-checks.mjs';

const require = createRequire(import.meta.url);
require('reflect-metadata');
configureTestEnvironment();
Object.assign(process.env, {
  DATABASE_HOST: '127.0.0.1',
  DATABASE_PORT: '5432',
  DATABASE_NAME: 'realtime_mock_only',
  DATABASE_USER: 'unused',
  DATABASE_PASSWORD: 'unused',
  DATABASE_SSL: 'false',
});
const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const argon2 = require('argon2');
const { AppModule } = require('../../src/app.module.ts');
const { configureHttpApplication } = require('../../src/http-application.ts');
const {
  RealtimeAuthService,
} = require('../../src/realtime/realtime-auth.service.ts');
const {
  BoardRoomCoordinator,
} = require('../../src/realtime/board-room-coordinator.service.ts');
const passwordHash = await argon2.hash('realtime-test-password');
const users = new Map(
  ['owner', 'member', 'other'].map((name) => [
    ids[name],
    {
      id: ids[name],
      email: `${name}@realtime.test`,
      displayName: name,
      passwordHash,
      avatarUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]),
);
const boards = new Map([
  [ids.a, { id: ids.a, createdById: ids.owner, isArchived: false }],
  [ids.b, { id: ids.b, createdById: ids.other, isArchived: false }],
  [
    ids.archived,
    { id: ids.archived, createdById: ids.owner, isArchived: true },
  ],
]);
const members = new Map([
  [
    `${ids.a}:${ids.owner}`,
    { id: 'a-owner', boardId: ids.a, userId: ids.owner, role: 'OWNER' },
  ],
  [
    `${ids.a}:${ids.member}`,
    { id: 'a-member', boardId: ids.a, userId: ids.member, role: 'MEMBER' },
  ],
  [
    `${ids.b}:${ids.other}`,
    { id: 'b-owner', boardId: ids.b, userId: ids.other, role: 'OWNER' },
  ],
  [
    `${ids.b}:${ids.member}`,
    { id: 'b-member', boardId: ids.b, userId: ids.member, role: 'MEMBER' },
  ],
  [
    `${ids.archived}:${ids.member}`,
    {
      id: 'archived-member',
      boardId: ids.archived,
      userId: ids.member,
      role: 'MEMBER',
    },
  ],
]);
const assignmentsQuery = {
  delete() {
    return this;
  },
  from() {
    return this;
  },
  where() {
    return this;
  },
  andWhere() {
    return this;
  },
  async execute() {
    return { affected: 0 };
  },
};
const repositories = {
  User: {
    async findOne({ where }) {
      return (
        [...users.values()].find((u) =>
          where.id ? u.id === where.id : u.email === where.email,
        ) ?? null
      );
    },
  },
  Board: {
    async findOne({ where }) {
      return boards.get(where.id) ?? null;
    },
  },
  BoardMember: {
    async findOne({ where }) {
      const value = members.get(`${where.boardId}:${where.userId}`);
      return value ? { ...value, board: boards.get(value.boardId) } : null;
    },
    async delete({ id }) {
      for (const [key, member] of members)
        if (member.id === id) members.delete(key);
      return { affected: 1 };
    },
  },
  CardAssignee: {
    createQueryBuilder() {
      return assignmentsQuery;
    },
  },
};
const source = {
  options: { type: 'postgres' },
  entityMetadatas: [],
  isInitialized: false,
  getRepository(entity) {
    return repositories[entity.name] ?? {};
  },
  manager: {
    async transaction(callback) {
      return callback(this);
    },
    getRepository(entity) {
      return repositories[entity.name] ?? {};
    },
  },
};
for (const repository of Object.values(repositories))
  repository.manager = source.manager;
const module = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(DataSource)
  .useValue(source)
  .compile();
const app = module.createNestApplication();
const socketAuth = app.get(RealtimeAuthService);
const coordinator = app.get(BoardRoomCoordinator);
try {
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');
  const count = await runRealtimeChecks(app, source);
  assert.equal(count, 16);
  console.log(
    `Realtime Socket.IO E2E: ${count} scenarios PASS (isolated repository doubles)`,
  );
} finally {
  await app.close();
  assert.equal(socketAuth.timers.size, 0);
  assert.equal(coordinator.server, undefined);
}
