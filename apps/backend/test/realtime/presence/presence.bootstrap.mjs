import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { resolve } from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import { configureTestEnvironment } from '../realtime-checks.mjs';
import { seedBoardEvents } from '../board-events/board-events-checks.mjs';
import { boardEventsMemorySource } from '../board-events/board-events-memory-source.mjs';
import { runPresenceChecks } from './presence-checks.mjs';

const require = createRequire(import.meta.url);
require('reflect-metadata');
require('dotenv').config({
  path: resolve(fileURLToPath(new URL('../../../../../.env', import.meta.url))),
  quiet: true,
});
const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const { Client } = require('pg');
const {
  databaseOptions,
} = require('../../../src/database/database-options.ts');
const {
  configureHttpApplication,
} = require('../../../src/http-application.ts');
const {
  BoardPresenceService,
} = require('../../../src/realtime/board-presence.service.ts');
const databaseMode = process.argv.includes('--database');
const database = `kanban_presence_verify_${randomBytes(8).toString('hex')}`;
let source,
  admin,
  app,
  created = false;
try {
  if (databaseMode) {
    const options = databaseOptions(process.env);
    admin = new Client({ ...options, user: options.username });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    source = new DataSource({ ...options, database });
    await source.initialize();
    await source.runMigrations();
    assert.equal(source.options.synchronize, false);
  } else {
    Object.assign(process.env, {
      DATABASE_HOST: '127.0.0.1',
      DATABASE_PORT: '5432',
      DATABASE_NAME: 'presence_doubles_only',
      DATABASE_USER: 'unused',
      DATABASE_PASSWORD: 'unused',
      DATABASE_SSL: 'false',
    });
    source = boardEventsMemorySource();
  }
  await seedBoardEvents(source);
  configureTestEnvironment();
  if (databaseMode) process.env.DATABASE_NAME = database;
  const { AppModule } = require('../../../src/app.module.ts');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(source)
    .compile();
  app = module.createNestApplication();
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');
  const count = await runPresenceChecks(app, source, databaseMode);
  assert.equal(count, databaseMode ? 10 : 8);
  const presence = app.get(BoardPresenceService);
  await app.close();
  app = undefined;
  assert.equal(presence.boards.size, 0);
  assert.equal(presence.sockets.size, 0);
  console.log(
    `Presence ${databaseMode ? 'PostgreSQL + Socket.IO' : 'Socket.IO'}: ${count} groups PASS`,
  );
} finally {
  try {
    if (app) await app.close();
  } finally {
    if (source?.isInitialized) await source.destroy();
    try {
      if (created) await admin.query(`DROP DATABASE "${database}"`);
    } finally {
      if (admin) await admin.end();
    }
  }
}
