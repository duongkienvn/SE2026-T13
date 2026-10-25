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
const { AuthService } = require('../../src/api/auth/auth.service.ts');
const { JwtAuthGuard } = require('../../src/api/auth/guards/jwt-auth.guard.ts');
const { BoardsService } = require('../../src/api/boards/boards.service.ts');
const {
  BoardsController,
} = require('../../src/api/boards/boards.controller.ts');
const {
  BoardMembersController,
} = require('../../src/api/board-members/board-members.controller.ts');
const { AppModule } = require('../../src/app.module.ts');
const { CardsService } = require('../../src/api/cards/cards.service.ts');
const { RealtimeGateway } = require('../../src/realtime/realtime.gateway.ts');
const {
  BoardRoomService,
} = require('../../src/realtime/board-room.service.ts');
const {
  BoardRoomCoordinator,
} = require('../../src/realtime/board-room-coordinator.service.ts');
const {
  RealtimeAuthService,
} = require('../../src/realtime/realtime-auth.service.ts');
const {
  RealtimeBroadcastService,
} = require('../../src/realtime/realtime-broadcast.service.ts');
const {
  BoardMembersService,
} = require('../../src/api/board-members/board-members.service.ts');
const { configureHttpApplication } = require('../../src/http-application.ts');
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
  assert.ok(app.get(BoardMembersController) instanceof BoardMembersController);
  assert.ok(app.get(CardsService) instanceof CardsService);
  const coordinator = app.get(BoardRoomCoordinator);
  const {
    BoardPresenceService,
  } = require('../../src/realtime/board-presence.service.ts');
  const {
    RealtimeAccessModule,
  } = require('../../src/realtime/realtime-access.module.ts');
  const presence = app.get(BoardPresenceService);
  assert.equal(coordinator.presence, presence);
  assert.equal(
    app
      .select(RealtimeAccessModule)
      .get(BoardPresenceService, { strict: true }),
    presence,
  );
  const broadcaster = app.get(RealtimeBroadcastService);
  const gateway = app.get(RealtimeGateway);
  const rooms = app.get(BoardRoomService);
  assert.equal(gateway.coordinator, coordinator);
  assert.equal(rooms.coordinator, coordinator);
  assert.equal(broadcaster.coordinator, coordinator);
  assert.equal(app.get(BoardMembersService).realtimeAccess, coordinator);
  assert.equal(rooms.coordinator.presence, presence);
  assert.equal(gateway.coordinator.presence, presence);
  assert.equal(app.get(BoardMembersService).realtimeAccess.presence, presence);
  const {
    BoardEventPublisher,
  } = require('../../src/realtime/board-event-publisher.service.ts');
  const {
    ColumnsService,
  } = require('../../src/api/columns/columns.service.ts');
  const publisher = app.get(BoardEventPublisher);
  assert.equal(publisher.broadcast, broadcaster);
  for (const Service of [ColumnsService, CardsService, BoardMembersService]) {
    assert.equal(app.get(Service).events, publisher);
  }
  const {
    ActivityWriterService,
  } = require('../../src/api/activities/activity-writer.service.ts');
  const {
    ActivitiesService,
  } = require('../../src/api/activities/activities.service.ts');
  const {
    CommentsService,
  } = require('../../src/api/comments/comments.service.ts');
  const writer = app.get(ActivityWriterService);
  for (const Service of [
    BoardsService,
    BoardMembersService,
    ColumnsService,
    CardsService,
    CommentsService,
  ]) {
    assert.equal(app.get(Service).activities, writer);
  }
  assert.equal(app.get(ActivitiesService).writer, writer);
  assert.equal(gateway.auth, app.get(RealtimeAuthService));
  assert.equal(rooms.auth, gateway.auth);
  assert.equal(broadcaster.auth, gateway.auth);
  assert.equal(gateway.auth.coordinator, coordinator);
  for (const [method, path] of [
    ['get', '/api/users/me/preferences'],
    ['post', '/api/boards'],
    ['get', '/api/boards'],
    ['get', '/api/boards/c6ba7134-97ef-4c1b-a342-001a982a7721'],
    ['patch', '/api/boards/c6ba7134-97ef-4c1b-a342-001a982a7721'],
    ['post', '/api/boards/c6ba7134-97ef-4c1b-a342-001a982a7721/archive'],
    ['get', '/api/boards/c6ba7134-97ef-4c1b-a342-001a982a7721/members'],
    ['post', '/api/boards/c6ba7134-97ef-4c1b-a342-001a982a7721/members'],
    [
      'patch',
      '/api/boards/c6ba7134-97ef-4c1b-a342-001a982a7721/members/c6ba7134-97ef-4c1b-a342-001a982a7721',
    ],
    [
      'delete',
      '/api/boards/c6ba7134-97ef-4c1b-a342-001a982a7721/members/c6ba7134-97ef-4c1b-a342-001a982a7721',
    ],
  ]) {
    await request(app.getHttpServer())[method](path).expect(401);
  }
  const cardsPath = '/api/boards/c6ba7134-97ef-4c1b-a342-001a982a7721/cards';
  const cardPath = `${cardsPath}/a6ba7134-97ef-4c1b-a342-001a982a7721`;
  for (const [method, path] of [
    ['get', cardsPath],
    ['post', cardsPath],
    ['get', cardPath],
    ['patch', cardPath],
    ['post', `${cardPath}/archive`],
    ['patch', `${cardPath}/move`],
    ['post', `${cardPath}/assignees`],
    ['delete', `${cardPath}/assignees/1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5`],
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
