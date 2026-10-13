import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);
require('reflect-metadata');
Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: randomBytes(32).toString('hex'),
  LOG_LEVEL: 'silent',
  DATABASE_HOST: '127.0.0.1',
  DATABASE_PORT: '5432',
  DATABASE_NAME: 'boards_wiring_only',
  DATABASE_USER: 'wiring_test',
  DATABASE_PASSWORD: 'unused',
  DATABASE_SSL: 'false',
  API_PREFIX: 'api',
  SWAGGER_ENABLED: 'true',
});
const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const { AuthService } = require('../src/api/auth/auth.service.ts');
const { JwtAuthGuard } = require('../src/api/auth/guards/jwt-auth.guard.ts');
const { BoardsService } = require('../src/api/boards/boards.service.ts');
const { BoardsController } = require('../src/api/boards/boards.controller.ts');
const { AppModule } = require('../src/app.module.ts');
const { configureHttpApplication } = require('../src/http-application.ts');
const request = require('supertest');

// Only persistence is replaced: Nest imports, exports, repositories and guards are real.
const source = {
  options: { type: 'postgres' },
  entityMetadatas: [],
  isInitialized: false,
  getRepository: () => ({ findOne: async () => null }),
};
const module = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(DataSource)
  .useValue(source)
  .compile();
const app = module.createNestApplication();
try {
  configureHttpApplication(app);
  await app.init();
  assert.ok(app.get(AuthService) instanceof AuthService);
  assert.ok(app.get(JwtAuthGuard) instanceof JwtAuthGuard);
  assert.ok(app.get(BoardsService) instanceof BoardsService);
  assert.ok(app.get(BoardsController) instanceof BoardsController);
  for (const [method, path] of [
    ['post', '/api/boards'],
    ['get', '/api/boards'],
    ['get', '/api/boards/c6ba7134-97ef-4c1b-a342-001a982a7721'],
    ['patch', '/api/boards/c6ba7134-97ef-4c1b-a342-001a982a7721'],
    ['post', '/api/boards/c6ba7134-97ef-4c1b-a342-001a982a7721/archive'],
  ]) {
    await request(app.getHttpServer())[method](path).expect(401);
  }
  await request(app.getHttpServer()).get('/api-docs-json').expect(200);
  console.log(
    'AppModule/BoardsModule/AuthModule real DI and protected routes: PASS (mock DataSource)',
  );
} finally {
  await app.close();
}
