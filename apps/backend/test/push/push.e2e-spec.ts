import {
  ClassSerializerInterceptor,
  Inject,
  type INestApplication,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Logger } from 'nestjs-pino';
import { PushController } from '../../src/api/push/push.controller';
import { PushRegistryService } from '../../src/api/push/push-registry.service';
import { PushRequestGuard } from '../../src/api/push/push-request.guard';
import { JwtAuthGuard } from '../../src/api/auth/guards/jwt-auth.guard';
import { AuthService } from '../../src/api/auth/auth.service';
import { ApplicationException } from '../../src/exceptions/application.exception';
import { ApiResponseInterceptor } from '../../src/interceptors/api-response.interceptor';
import { GlobalExceptionFilter } from '../../src/filters/global-exception.filter';
import { createValidationPipe } from '../../src/config/validation';
const ID = '14f2550e-9359-4c06-a642-6257cb384b53';
jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => Inject('UserRepository'),
}));
describe('push HTTP contracts', () => {
  let app: INestApplication;
  const registry = {
    get: jest.fn(),
    update: jest.fn(),
    register: jest.fn(),
    current: jest.fn(),
    remove: jest.fn(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PushController],
      providers: [
        PushRequestGuard,
        JwtAuthGuard,
        { provide: PushRegistryService, useValue: registry },
        {
          provide: AuthService,
          useValue: {
            authenticateAccessToken: async (token: string) => {
              if (token !== 'valid')
                throw new ApplicationException(
                  401,
                  'UNAUTHORIZED',
                  'Unauthorized',
                );
              return {
                userId: ID,
                authVersion: 0,
                expiresAt: Date.now() + 3600_000,
              };
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(
      new GlobalExceptionFilter({ error: jest.fn() } as unknown as Logger),
    );
    const reflector = app.get(Reflector);
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(reflector),
      new ApiResponseInterceptor(reflector),
    );
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
    registry.get.mockResolvedValue({
      enabled: false,
      deliveryAvailable: true,
      encryptedToken: 'private',
    });
    registry.update.mockResolvedValue({
      enabled: true,
      deliveryAvailable: true,
    });
    registry.register.mockResolvedValue({
      installationId: ID,
      registered: true,
      expoPushToken: 'private',
    });
    registry.current.mockResolvedValue({
      registered: true,
      eligible: true,
      token: 'private',
    });
  });
  const send = (method: 'get' | 'patch' | 'post' | 'delete', path: string) =>
    request(app.getHttpServer())
      [method]('/api/users/me/' + path)
      .auth('valid', { type: 'bearer' });
  it('envelopes allowlisted responses, no-store, fixed status and bodyless 204', async () => {
    const get = await send('get', 'push-preferences').expect(200);
    expect(get.body.data).toEqual({ enabled: false, deliveryAvailable: true });
    expect(get.headers['cache-control']).toBe('no-store');
    const post = await send('post', 'push-devices')
      .send({
        installationId: ID,
        projectId: ID,
        platform: 'ios',
        appEnvironment: 'preview',
        expoPushToken: 'ExpoPushToken[abcdefghijklmnop]',
      })
      .expect(200);
    expect(post.body.data).toEqual({ installationId: ID, registered: true });
    const current = await send(
      'get',
      'push-devices/current?installationId=' + ID,
    ).expect(200);
    expect(current.body.data).toEqual({ registered: true, eligible: true });
    const deleted = await send('delete', 'push-devices/' + ID).expect(204);
    expect(deleted.text).toBe('');
  });
  it.each([
    {},
    [],
    { enabled: null },
    { enabled: 'true' },
    { enabled: true, userId: ID },
  ])('rejects strict PATCH body %j', async (body) => {
    await send('patch', 'push-preferences').send(body).expect(400);
    expect(registry.update).not.toHaveBeenCalled();
  });
  it('accepts real booleans and rejects extra query/body/IDs', async () => {
    await send('patch', 'push-preferences').send({ enabled: true }).expect(200);
    await send(
      'get',
      'push-devices/current?installationId=' + ID + '&userId=' + ID,
    ).expect(400);
    await send('delete', 'push-devices/not-uuid').expect(400);
    await send('delete', 'push-devices/' + ID)
      .send({ enabled: false })
      .expect(400);
  });
  it.each(['push-preferences', 'push-devices/current?installationId=' + ID])(
    'requires authenticated bearer on %s',
    async (path) => {
      await request(app.getHttpServer())
        .get('/api/users/me/' + path)
        .expect(401);
    },
  );
});
