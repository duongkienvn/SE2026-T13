import {
  ClassSerializerInterceptor,
  INestApplication,
  Inject,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { GoogleAuthController } from '../../src/api/auth/google-auth.controller';
import { GoogleAuthService } from '../../src/api/auth/google-auth.service';
import { AuthService } from '../../src/api/auth/auth.service';
import { JwtAuthGuard } from '../../src/api/auth/guards/jwt-auth.guard';
import { HttpThrottlerGuard } from '../../src/guards/http-throttler.guard';
import { createValidationPipe } from '../../src/config/validation';
import { GlobalExceptionFilter } from '../../src/filters/global-exception.filter';
import { ApiResponseInterceptor } from '../../src/interceptors/api-response.interceptor';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => Inject('UserRepository'),
}));

describe('Google authentication HTTP contracts and throttles', () => {
  let app: INestApplication;
  const google = {
    signIn: jest.fn().mockResolvedValue({
      accessToken: 'kanvexa-jwt',
      tokenType: 'Bearer',
      expiresIn: 3600,
      user: { id: 'user', email: 'ada@gmail.com' },
      googleSub: 'private',
    }),
    link: jest.fn().mockResolvedValue(undefined),
    linkedProviders: jest.fn().mockResolvedValue({
      googleLinked: true,
      hasPassword: true,
      googleSub: 'private',
      passwordHash: 'private',
    }),
  };
  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
      controllers: [GoogleAuthController],
      providers: [
        { provide: GoogleAuthService, useValue: google },
        {
          provide: AuthService,
          useValue: {
            authenticateAccessToken: jest
              .fn()
              .mockResolvedValue({ userId: 'current-user' }),
          },
        },
        JwtAuthGuard,
        { provide: APP_GUARD, useClass: HttpThrottlerGuard },
      ],
    }).compile();
    app = module.createNestApplication();
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
  afterEach(async () => app.close());

  it('returns the same public Kanvexa login contract', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/google')
      .send({ credential: 'google-id-token' })
      .expect(200);
    expect(response.body.data).toMatchObject({
      accessToken: 'kanvexa-jwt',
      tokenType: 'Bearer',
      expiresIn: 3600,
    });
    expect(response.body.data).not.toHaveProperty('googleSub');
    expect(google.signIn).toHaveBeenCalledWith('google-id-token');
  });
  it('protects both account endpoints and serializes only status booleans', async () => {
    await request(app.getHttpServer())
      .get('/auth/linked-providers')
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/google/link')
      .send({ credential: 'token', password: 'pass' })
      .expect(401);
    const status = await request(app.getHttpServer())
      .get('/auth/linked-providers')
      .set('Authorization', 'Bearer kanvexa')
      .expect(200);
    expect(status.body.data).toEqual({ googleLinked: true, hasPassword: true });
    await request(app.getHttpServer())
      .post('/auth/google/link')
      .set('Authorization', 'Bearer kanvexa')
      .send({ credential: 'token', password: 'legacy' })
      .expect(204);
    expect(google.link).toHaveBeenCalledWith('current-user', 'token', 'legacy');
  });
  it.each([
    {},
    { credential: '' },
    { credential: 123 },
    { credential: 'a'.repeat(8193) },
    { credential: 'token', audience: 'attacker' },
  ])('rejects invalid or extra credential fields', async (body) => {
    await request(app.getHttpServer())
      .post('/auth/google')
      .send(body)
      .expect(400);
    expect(google.signIn).not.toHaveBeenCalled();
  });
  it('requires a bounded current password and rejects caller-supplied user identity', async () => {
    for (const body of [
      { credential: 'token' },
      { credential: 'token', password: 'a'.repeat(129) },
      { credential: 'token', password: 'pass', userId: 'victim' },
    ]) {
      await request(app.getHttpServer())
        .post('/auth/google/link')
        .set('Authorization', 'Bearer kanvexa')
        .send(body)
        .expect(400);
    }
    expect(google.link).not.toHaveBeenCalled();
  });
  it('limits Google sign-in to 10/minute and linking to 5/5 minutes', async () => {
    for (let i = 0; i < 10; i++)
      await request(app.getHttpServer())
        .post('/auth/google')
        .send({})
        .expect(400);
    await request(app.getHttpServer())
      .post('/auth/google')
      .send({})
      .expect(429);
    for (let i = 0; i < 5; i++)
      await request(app.getHttpServer())
        .post('/auth/google/link')
        .set('Authorization', 'Bearer kanvexa')
        .send({})
        .expect(400);
    await request(app.getHttpServer())
      .post('/auth/google/link')
      .set('Authorization', 'Bearer kanvexa')
      .send({})
      .expect(429);
  });
});
