import {
  ClassSerializerInterceptor,
  Inject,
  type INestApplication,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Logger } from 'nestjs-pino';
import { PushScheduleController } from '../../src/api/push/push-schedule.controller';
import { PushScheduleService } from '../../src/api/push/push-schedule.service';
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
describe('push schedule HTTP contract', () => {
  let app: INestApplication;
  const defaults = {
    enabled: false,
    startLocal: '22:00',
    endLocal: '07:00',
    timeZone: 'UTC',
  };
  const schedules = {
    get: jest.fn(async () => ({ ...defaults, userId: 'private' })),
    update: jest.fn(async (_user, input) => {
      if (Object.values(input).every((value) => value === undefined))
        throw new ApplicationException(
          400,
          'VALIDATION_FAILED',
          'At least one schedule field is required',
        );
      return {
        ...defaults,
        ...Object.fromEntries(
          Object.entries(input).filter(([, value]) => value !== undefined),
        ),
        userId: 'private',
      };
    }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PushScheduleController],
      providers: [
        PushRequestGuard,
        JwtAuthGuard,
        { provide: PushScheduleService, useValue: schedules },
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
  beforeEach(() => jest.clearAllMocks());
  const patch = (body: unknown) =>
    request(app.getHttpServer())
      .patch('/api/users/me/push-schedule')
      .auth('valid', { type: 'bearer' })
      .send(body as object);
  it('GET/PATCH require bearer, envelope only four fields, no-store and current-user identity', async () => {
    await request(app.getHttpServer())
      .get('/api/users/me/push-schedule')
      .expect(401);
    await request(app.getHttpServer())
      .patch('/api/users/me/push-schedule')
      .send({ enabled: true })
      .expect(401);
    const get = await request(app.getHttpServer())
      .get('/api/users/me/push-schedule')
      .auth('valid', { type: 'bearer' })
      .expect(200);
    expect(get.body.data).toEqual(defaults);
    expect(get.headers['cache-control']).toBe('no-store');
    const result = await patch({ startLocal: '23:45' }).expect(200);
    expect(result.body.data).toEqual({ ...defaults, startLocal: '23:45' });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(schedules.get).toHaveBeenCalledWith(ID);
    expect(schedules.update).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ID }),
      { startLocal: '23:45' },
    );
  });
  it.each([
    [],
    { enabled: null },
    { enabled: 'true' },
    { startLocal: null },
    { endLocal: null },
    { timeZone: 'UTC' },
    { userId: ID },
    { extra: true },
    { startLocal: '24:00' },
    { startLocal: '9:00' },
    { startLocal: '09:01' },
    { startLocal: '09:00:00' },
    { startLocal: ' 09:00' },
    { startLocal: '09:00\n' },
    { endLocal: 700 },
  ])('strictly rejects %j before service mutation', async (body) => {
    await patch(body).expect(400);
    expect(schedules.update).not.toHaveBeenCalled();
  });
  it('rejects empty PATCH and accepts all 96 exact quarter-hour clocks', async () => {
    await patch({}).expect(400);
    for (let minute = 0; minute < 1440; minute += 15) {
      const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      await patch({ startLocal: time }).expect(200);
    }
  });
});
