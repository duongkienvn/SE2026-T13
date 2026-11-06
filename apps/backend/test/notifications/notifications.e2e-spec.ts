import {
  ClassSerializerInterceptor,
  Inject,
  type INestApplication,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { randomBytes } from 'node:crypto';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { AuthService } from '../../src/api/auth/auth.service';
import { StarterBoardProvisioningService } from '../../src/api/boards/starter-board-provisioning.service';
import { WelcomeOnboardingService } from '../../src/api/auth/welcome-onboarding.service';
import { WorkspacesService } from '../../src/api/workspaces/workspaces.service';
import { EmailVerificationService } from '../../src/api/auth/email-verification.service';
import { JwtAuthGuard } from '../../src/api/auth/guards/jwt-auth.guard';
import {
  JWT_ISSUER,
  JWT_AUDIENCE,
} from '../../src/api/auth/constants/auth.constants';
import { NotificationsController } from '../../src/api/notifications/notifications.controller';
import { NotificationPreferencesController } from '../../src/api/notifications/notification-preferences.controller';
import { NotificationInboxService } from '../../src/api/notifications/notification-inbox.service';
import { NotificationPreferencesService } from '../../src/api/notifications/notification-preferences.service';
import { NotificationPreferencesBodyGuard } from '../../src/api/notifications/notification-preferences-body.guard';
import { NotificationReadBodyGuard } from '../../src/api/notifications/notification-read-body.guard';
import { toNotificationPreferences } from '../../src/api/notifications/notification-preferences';
import { ApiResponseInterceptor } from '../../src/interceptors/api-response.interceptor';
import { GlobalExceptionFilter } from '../../src/filters/global-exception.filter';
import { createValidationPipe } from '../../src/config/validation';
import { HttpThrottlerGuard } from '../../src/guards/http-throttler.guard';
import { paginate } from '../../src/common/dto/paginated-response';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => Inject('UserRepository'),
}));
const A = 'c6ba7134-97ef-4c1b-a342-001a982a7721',
  N = 'd6ba7134-97ef-4c1b-a342-001a982a7721';
const item = {
  id: N,
  kind: 'CARD_ASSIGNED',
  createdAt: '2026-01-01T00:00:00.000Z',
  readAt: null,
  actor: { id: A, displayName: 'Actor', email: 'private-email' },
  context: { workspaceId: A, boardId: A, cardId: A, secret: 'private' },
  target: { kind: 'card', path: `/boards/${A}/cards/${A}` },
  summary: 'You were assigned',
  isUnavailable: false,
  dedupeKey: 'private',
  recipientUserId: 'private',
};
const inbox = {
    list: jest.fn(),
    unreadCount: jest.fn(),
    read: jest.fn(),
    readAll: jest.fn(),
  },
  preferences = { get: jest.fn(), update: jest.fn() };
const user = { id: A, authVersion: 0, emailVerifiedAt: new Date() };
async function boot(limit = 10000) {
  const module = await Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot([{ ttl: 60000, limit }]),
      JwtModule.register({
        secret: randomBytes(32).toString('hex'),
        signOptions: {
          algorithm: 'HS256',
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
          expiresIn: 3600,
        },
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        },
      }),
    ],
    controllers: [NotificationsController, NotificationPreferencesController],
    providers: [
      AuthService,
      {
        provide: StarterBoardProvisioningService,
        useValue: { provision: jest.fn() },
      },
      JwtAuthGuard,
      NotificationPreferencesBodyGuard,
      NotificationReadBodyGuard,
      { provide: APP_GUARD, useClass: HttpThrottlerGuard },
      { provide: WelcomeOnboardingService, useValue: {} },
      { provide: WorkspacesService, useValue: {} },
      { provide: EmailVerificationService, useValue: {} },
      { provide: 'UserRepository', useValue: { findOne: async () => user } },
      { provide: NotificationInboxService, useValue: inbox },
      { provide: NotificationPreferencesService, useValue: preferences },
      { provide: Logger, useValue: { error: jest.fn() } },
    ],
  }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter(module.get(Logger)));
  const reflector = app.get(Reflector);
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(reflector),
    new ApiResponseInterceptor(reflector),
  );
  await app.init();
  const jwt = app.get(JwtService);
  return { app, jwt, token: await jwt.signAsync({ sub: A }) };
}
describe('notification HTTP contracts and validation', () => {
  let app: INestApplication, jwt: JwtService, token: string;
  beforeAll(async () => {
    ({ app, jwt, token } = await boot());
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    jest.clearAllMocks();
    user.authVersion = 0;
    inbox.list.mockResolvedValue(paginate([item], 1, { page: 1, limit: 20 }));
    inbox.unreadCount.mockResolvedValue({ count: 1, secret: 'private' });
    inbox.read.mockResolvedValue({ ...item, readAt: '2026-01-02T00:00:00Z' });
    inbox.readAll.mockResolvedValue({ updatedCount: 1 });
    preferences.get.mockResolvedValue(toNotificationPreferences());
    preferences.update.mockResolvedValue(toNotificationPreferences());
  });
  const send = (method: 'get' | 'patch' | 'post', path: string) =>
    request(app.getHttpServer())[method](path).auth(token, { type: 'bearer' });
  it('returns flat paginated history, safe nested allowlists and no-store on all routes', async () => {
    const response = await send(
      'get',
      '/api/notifications?filter=unread&page=1&limit=20',
    ).expect(200);
    expect(response.body).toMatchObject({
      success: true,
      statusCode: 200,
      data: [{ id: N }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    expect(inbox.list).toHaveBeenCalledWith(
      A,
      expect.objectContaining({ filter: 'unread', page: 1, limit: 20 }),
    );
    expect(JSON.stringify(response.body)).not.toContain('private');
    expect(response.headers['cache-control']).toBe('no-store');
    for (const [method, path] of [
      ['get', '/api/notifications/unread-count'],
      ['patch', `/api/notifications/${N}/read`],
      ['post', '/api/notifications/read-all'],
      ['get', '/api/users/me/notification-preferences'],
      ['patch', '/api/users/me/notification-preferences'],
    ] as const) {
      const operation = send(method, path);
      if (method === 'patch' && path.includes('preferences'))
        operation.send({ email: { dueReminder: true } });
      const result = await operation.expect(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body.success).toBe(true);
    }
    expect(inbox.read).toHaveBeenCalledWith(A, N);
    expect(inbox.readAll).toHaveBeenCalledWith(A);
  });
  it.each([
    'filter=read',
    'limit=101',
    'page=0',
    'filter=all&filter=unread',
    'userId=other',
  ])('rejects bad inbox query %s', async (query) => {
    await send('get', `/api/notifications?${query}`).expect(400);
    expect(inbox.list).not.toHaveBeenCalled();
  });
  it.each([
    {},
    null,
    [],
    { inApp: null },
    { email: { dueReminder: 'true' } },
    { inApp: { cardAssigned: null } },
    { email: { workspaceInvited: true } },
    { inApp: {} },
    { email: { mandatorySecurity: false } },
    { userId: A, inApp: { cardAssigned: true } },
    JSON.parse('{"inApp":{"constructor":true}}'),
  ])('rejects invalid preference patch %j', async (body) => {
    const call = send('patch', '/api/users/me/notification-preferences');
    if (body === null)
      call.set('Content-Type', 'application/json').send('null');
    else call.send(body);
    const response = await call.expect(400);
    expect(response.body.code).toBe(
      body === null ? 'BAD_REQUEST' : 'VALIDATION_FAILED',
    );
    expect(preferences.update).not.toHaveBeenCalled();
  });
  it('preserves explicit false and leaves omission for transactional persistence', async () => {
    await send('patch', '/api/users/me/notification-preferences')
      .send({ inApp: { cardAssigned: false }, email: { dueReminder: true } })
      .expect(200);
    expect(preferences.update).toHaveBeenCalledWith(
      A,
      expect.objectContaining({
        inApp: expect.objectContaining({ cardAssigned: false }),
        email: expect.objectContaining({ dueReminder: true }),
      }),
    );
  });
  it('rejects malformed UUIDs and forged read state bodies', async () => {
    await send('patch', '/api/notifications/not-uuid/read').expect(400);
    await send('patch', `/api/notifications/${N}/read`)
      .send({ readAt: '2000-01-01', userId: 'other' })
      .expect(400);
    await send('post', '/api/notifications/read-all')
      .send({ recipientUserId: A })
      .expect(400);
    expect(inbox.read).not.toHaveBeenCalled();
    expect(inbox.readAll).not.toHaveBeenCalled();
  });
  it('requires current JWT on every route and rejects invalidated sessions', async () => {
    for (const [method, path] of [
      ['get', '/api/notifications'],
      ['get', '/api/notifications/unread-count'],
      ['patch', `/api/notifications/${N}/read`],
      ['post', '/api/notifications/read-all'],
      ['get', '/api/users/me/notification-preferences'],
      ['patch', '/api/users/me/notification-preferences'],
    ] as const)
      await request(app.getHttpServer())[method](path).expect(401);
    for (const invalid of [
      'invalid',
      await jwt.signAsync({ sub: A }, { expiresIn: -1 }),
    ])
      await request(app.getHttpServer())
        .get('/api/notifications')
        .auth(invalid, { type: 'bearer' })
        .expect(401);
    user.authVersion = 1;
    await send('get', '/api/notifications').expect(401);
    expect(inbox.list).not.toHaveBeenCalled();
  });
  it('preserves HTTP 429 and documents all six operations and exact response models', async () => {
    const limited = await boot(1);
    try {
      await request(limited.app.getHttpServer())
        .get('/api/notifications')
        .auth(limited.token, { type: 'bearer' })
        .expect(200);
      await request(limited.app.getHttpServer())
        .get('/api/notifications')
        .auth(limited.token, { type: 'bearer' })
        .expect(429);
    } finally {
      await limited.app.close();
    }
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    for (const [path, method] of [
      ['/api/notifications', 'get'],
      ['/api/notifications/unread-count', 'get'],
      ['/api/notifications/{notificationId}/read', 'patch'],
      ['/api/notifications/read-all', 'post'],
      ['/api/users/me/notification-preferences', 'get'],
      ['/api/users/me/notification-preferences', 'patch'],
    ] as const)
      expect(doc.paths[path][method]!.security).toEqual([{ bearer: [] }]);
    expect(doc.components!.schemas!.NotificationResponseDto).toMatchObject({
      properties: {
        isUnavailable: { type: 'boolean' },
        context: { nullable: true },
        actor: { nullable: true },
      },
    });
  });
});
