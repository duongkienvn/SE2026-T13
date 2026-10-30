// Shared PostgreSQL setup for the VT-052 import checks: a throw-away database
// with real migrations, compiled services from dist/ and explicit cleanup.
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const require = createRequire(import.meta.url);
require('reflect-metadata');
require('dotenv').config({
  path: resolve(
    fileURLToPath(new URL('../../', import.meta.url)),
    '../../.env',
  ),
  quiet: true,
});
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const argon2 = require('argon2');
const { databaseOptions } = require('../../dist/database/database-options.js');
const { CardsService } = require('../../dist/api/cards/cards.service.js');
const { ColumnsService } = require('../../dist/api/columns/columns.service.js');
const {
  BoardAuthorizationService,
} = require('../../dist/api/board-members/board-authorization.service.js');
const {
  ActivityWriterService,
} = require('../../dist/api/activities/activity-writer.service.js');
const { Board } = require('../../dist/api/boards/entities/board.entity.js');
const {
  BoardMember,
} = require('../../dist/api/board-members/entities/board-member.entity.js');
const {
  BoardColumn,
} = require('../../dist/api/columns/entities/board-column.entity.js');
const { Card } = require('../../dist/api/cards/entities/card.entity.js');

export const PASSWORD = 'cards-import-password';

export async function withImportDatabase(prefix, run) {
  const options = databaseOptions(process.env);
  const database = `${prefix}_${randomBytes(8).toString('hex')}`;
  const admin = new Client({
    host: options.host,
    port: options.port,
    user: options.username,
    password: options.password,
    database: options.database,
    ssl: options.ssl,
    connectionTimeoutMillis: options.connectTimeoutMS,
  });
  let created = false;
  let source;
  const closers = [];
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    source = new DataSource({ ...options, database });
    await source.initialize();
    await source.runMigrations();
    const repos = {
      users: source.getRepository('User'),
      boards: source.getRepository(Board),
      members: source.getRepository(BoardMember),
      columns: source.getRepository(BoardColumn),
      cards: source.getRepository(Card),
      activities: source.getRepository('Activity'),
    };
    const authorization = new BoardAuthorizationService(repos.members);
    const published = [];
    const events = {
      publish: async (event, payload) => published.push(event, payload),
    };
    const makeCards = (activityWriter = new ActivityWriterService()) =>
      new CardsService(
        repos.cards,
        repos.boards,
        repos.columns,
        authorization,
        events,
        activityWriter,
      );
    const columnService = new ColumnsService(
      repos.columns,
      repos.boards,
      repos.cards,
      authorization,
      { publish: async () => undefined },
      new ActivityWriterService(),
    );
    const passwordHash = await argon2.hash(PASSWORD);
    const user = (name) =>
      repos.users.save(
        repos.users.create({
          email: `${name}@import.test`,
          displayName: name,
          passwordHash,
          emailVerifiedAt: new Date(),
          authVersion: 0,
          avatarUrl: null,
        }),
      );
    const board = async (name, owner, others = []) => {
      const saved = await repos.boards.save(
        repos.boards.create({ name, createdById: owner.id }),
      );
      await repos.members.save([
        repos.members.create({
          boardId: saved.id,
          userId: owner.id,
          role: 'OWNER',
        }),
        ...others.map((other) =>
          repos.members.create({
            boardId: saved.id,
            userId: other.id,
            role: 'MEMBER',
          }),
        ),
      ]);
      return saved;
    };
    await run({
      database,
      source,
      repos,
      published,
      makeCards,
      columnService,
      user,
      board,
      onClose: (closer) => closers.push(closer),
    });
  } finally {
    try {
      for (const close of closers.reverse()) await close();
    } finally {
      if (source?.isInitialized) await source.destroy();
      try {
        if (created) await admin.query(`DROP DATABASE "${database}"`);
      } finally {
        await admin.end();
      }
    }
  }
}
