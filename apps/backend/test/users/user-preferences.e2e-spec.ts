import {
  ClassSerializerInterceptor,
  Inject,
  type INestApplication,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { randomBytes } from 'node:crypto';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { AuthService } from '../../src/api/auth/auth.service';
import { WelcomeOnboardingService } from '../../src/api/auth/welcome-onboarding.service';
import { WorkspacesService } from '../../src/api/workspaces/workspaces.service';
import { EmailVerificationService } from '../../src/api/auth/email-verification.service';
import { JwtAuthGuard } from '../../src/api/auth/guards/jwt-auth.guard';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '../../src/api/auth/constants/auth.constants';
import { UserPreferencesController } from '../../src/api/users/user-preferences.controller';
import { UserPreferencesService } from '../../src/api/users/user-preferences.service';
import { DEFAULT_USER_PREFERENCES } from '../../src/api/users/user-preferences.constants';
import { createValidationPipe } from '../../src/config/validation';
import { ApiResponseInterceptor } from '../../src/interceptors/api-response.interceptor';
import { GlobalExceptionFilter } from '../../src/filters/global-exception.filter';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => Inject('UserRepository'),
}));

const A = '1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5';
const B = '2c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5';
const path = '/api/users/me/preferences';

describe('preferences HTTP contract (real JWT, mocked preferences service)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let token: string;
  const preferences = {
    get: jest.fn().mockResolvedValue({
      ...DEFAULT_USER_PREFERENCES,
      userId: A,
      passwordHash: 'private',
    }),
    update: jest.fn().mockResolvedValue({
      ...DEFAULT_USER_PREFERENCES,
      theme: 'dark',
      createdAt: new Date(),
    }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
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
      controllers: [UserPreferencesController],
      providers: [
        AuthService,
        { provide: WelcomeOnboardingService, useValue: {} },
        {
          provide: WorkspacesService,
          useValue: { ensurePersonalWorkspace: jest.fn() },
        },
        JwtAuthGuard,
        { provide: EmailVerificationService, useValue: {} },
        {
          provide: 'UserRepository',
          useValue: {
            findOne: async () => ({
              id: A,
              authVersion: 0,
              emailVerifiedAt: new Date(),
            }),
          },
        },
        { provide: UserPreferencesService, useValue: preferences },
        { provide: Logger, useValue: { error: jest.fn() } },
      ],
    }).compile();
    jwt = module.get(JwtService);
    token = await jwt.signAsync({ sub: A });
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new GlobalExceptionFilter(module.get(Logger)));
    const reflector = app.get(Reflector);
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(reflector),
      new ApiResponseInterceptor(reflector),
    );
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => jest.clearAllMocks());

  it('uses JWT identity even when query parameters try to select another account', async () => {
    const result = await request(app.getHttpServer())
      .get(`${path}?userId=${B}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(preferences.get).toHaveBeenCalledWith(A);
    expect(result.body).toMatchObject({
      success: true,
      statusCode: 200,
      data: DEFAULT_USER_PREFERENCES,
    });
    expect(Object.keys(result.body.data).sort()).toEqual(
      Object.keys(DEFAULT_USER_PREFERENCES).sort(),
    );
  });

  it('serializes only four public fields on update', async () => {
    const result = await request(app.getHttpServer())
      .patch(path)
      .auth(token, { type: 'bearer' })
      .send({ theme: 'dark' })
      .expect(200);
    expect(preferences.update).toHaveBeenCalledWith(A, { theme: 'dark' });
    expect(result.body.data).toEqual({
      ...DEFAULT_USER_PREFERENCES,
      theme: 'dark',
    });
  });

  it.each([
    {},
    { theme: null },
    { theme: 'Dark' },
    { timeZone: 'Fake/Zone' },
    { weekStartsOn: [] },
    { theme: 'dark', userId: B },
    [],
  ])(
    'returns VALIDATION_FAILED without calling persistence for %j',
    async (body) => {
      const result = await request(app.getHttpServer())
        .patch(path)
        .auth(token, { type: 'bearer' })
        .send(body)
        .expect(400);
      expect(result.body.code).toBe('VALIDATION_FAILED');
      expect(preferences.update).not.toHaveBeenCalled();
    },
  );

  it('returns VALIDATION_FAILED for a JSON null body', async () => {
    const result = await request(app.getHttpServer())
      .patch(path)
      .auth(token, { type: 'bearer' })
      .set('Content-Type', 'application/json')
      .send('null')
      .expect(400);
    expect(result.body.code).toBe('VALIDATION_FAILED');
    expect(preferences.update).not.toHaveBeenCalled();
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects the raw unknown key %s before persistence',
    async (key) => {
      const result = await request(app.getHttpServer())
        .patch(path)
        .auth(token, { type: 'bearer' })
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ theme: 'dark', [key]: { unexpected: true } }))
        .expect(400);
      expect(result.body.code).toBe('VALIDATION_FAILED');
      expect(preferences.update).not.toHaveBeenCalled();
    },
  );

  it.each(['get', 'patch'] as const)(
    'rejects missing, malformed and expired JWT for %s',
    async (method) => {
      const http = request(app.getHttpServer());
      await http[method](path).expect(401);
      await http[method](path).auth('invalid', { type: 'bearer' }).expect(401);
      const expired = await jwt.signAsync({ sub: A }, { expiresIn: -1 });
      await http[method](path).auth(expired, { type: 'bearer' }).expect(401);
      expect(preferences.get).not.toHaveBeenCalled();
      expect(preferences.update).not.toHaveBeenCalled();
    },
  );

  it('requires authentication before checking raw body keys', async () => {
    await request(app.getHttpServer())
      .patch(path)
      .send({ theme: 'dark', constructor: { unexpected: true } })
      .expect(401);
    expect(preferences.update).not.toHaveBeenCalled();
  });

  it('documents both JWT protected routes and all four response fields', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    expect(document.paths[path].get?.security).toEqual([{ bearer: [] }]);
    expect(document.paths[path].patch?.security).toEqual([{ bearer: [] }]);
    expect(
      document.components?.schemas?.UserPreferencesResponseDto,
    ).toMatchObject({
      required: ['theme', 'timeZone', 'dateFormat', 'weekStartsOn'],
    });
  });
});
