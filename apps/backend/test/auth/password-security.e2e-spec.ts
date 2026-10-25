import { INestApplication, Inject } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { PasswordSecurityController } from '../../src/api/auth/password-security.controller';
import { PasswordSecurityService } from '../../src/api/auth/password-security.service';
import { AuthService } from '../../src/api/auth/auth.service';
import { createValidationPipe } from '../../src/config/validation';
import { HttpThrottlerGuard } from '../../src/guards/http-throttler.guard';
import { GlobalExceptionFilter } from '../../src/filters/global-exception.filter';
import { ApiResponseInterceptor } from '../../src/interceptors/api-response.interceptor';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => Inject('UserRepository'),
}));

describe('password security HTTP validation and throttling', () => {
  let app: INestApplication;
  const security = { send: jest.fn(), reset: jest.fn(), change: jest.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
      controllers: [PasswordSecurityController],
      providers: [
        { provide: PasswordSecurityService, useValue: security },
        {
          provide: AuthService,
          useValue: {
            authenticateAccessToken: jest.fn(async (token: string) => ({
              userId: token === 'other' ? 'other' : 'user',
              authVersion: 0,
              expiresAt: Date.now() + 60_000,
            })),
          },
        },
        { provide: APP_GUARD, useClass: HttpThrottlerGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(
      new GlobalExceptionFilter({ error: jest.fn() } as unknown as Logger),
    );
    app.useGlobalInterceptors(new ApiResponseInterceptor(app.get(Reflector)));
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('requires authentication for change', async () => {
    await request(app.getHttpServer())
      .post('/auth/change-password')
      .send({ currentPassword: 'Old1234!', newPassword: 'New1234!' })
      .expect(401);
    expect(security.change).not.toHaveBeenCalled();
  });
  it.each(['short', 'ABCDEFG1', 'abcdef1!', 'ABC1234 '])(
    'rejects policy-invalid new password %s before token consumption',
    async (newPassword) => {
      const response = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'A'.repeat(43), newPassword })
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(security.reset).not.toHaveBeenCalled();
    },
  );
  it('rejects extra properties', async () => {
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({
        token: 'A'.repeat(43),
        newPassword: 'New1234!',
        email: 'injected@example.test',
      })
      .expect(400);
    expect(security.reset).not.toHaveBeenCalled();
  });
  it('limits recovery requests per IP before mail or timing work', async () => {
    for (let i = 0; i < 5; i++)
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'invalid' })
        .expect(400);
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'invalid' })
      .expect(429);
    expect(security.send).not.toHaveBeenCalled();
  });
  it('limits authenticated password guesses by account across different IPs', async () => {
    for (let i = 0; i < 5; i++)
      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', 'Bearer user')
        .set('X-Forwarded-For', `192.0.2.${i + 1}`)
        .send({ currentPassword: 'old', newPassword: 'weak' })
        .expect(400);
    await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', 'Bearer user')
      .set('X-Forwarded-For', '192.0.2.10')
      .send({ currentPassword: 'old', newPassword: 'weak' })
      .expect(429);
    await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', 'Bearer other')
      .set('X-Forwarded-For', '192.0.2.11')
      .send({ currentPassword: 'old', newPassword: 'weak' })
      .expect(400);
    expect(security.change).not.toHaveBeenCalled();
  });
});
