import assert from 'node:assert/strict';
import console from 'node:console';
import { createRequire } from 'node:module';
import process from 'node:process';
import { configureTestEnvironment } from './realtime-checks.mjs';
import {
  seedBoardEvents,
  runBoardEventChecks,
} from './board-events-checks.mjs';
import { boardEventsMemorySource } from './board-events-memory-source.mjs';

const require = createRequire(import.meta.url);
require('reflect-metadata');
configureTestEnvironment();
Object.assign(process.env, {
  DATABASE_HOST: '127.0.0.1',
  DATABASE_PORT: '5432',
  DATABASE_NAME: 'events_doubles_only',
  DATABASE_USER: 'unused',
  DATABASE_PASSWORD: 'unused',
  DATABASE_SSL: 'false',
});
const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const { AppModule } = require('../src/app.module.ts');
const { configureHttpApplication } = require('../src/http-application.ts');
const source = boardEventsMemorySource();
await seedBoardEvents(source);
const module = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(DataSource)
  .useValue(source)
  .compile();
const app = module.createNestApplication();
try {
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');
  const count = await runBoardEventChecks(app, source);
  assert.equal(count, 7);
  console.log(
    `Board events Socket.IO E2E: ${count} groups PASS (repository doubles; real REST/services/JWT/Socket.IO)`,
  );
} finally {
  await app.close();
}
