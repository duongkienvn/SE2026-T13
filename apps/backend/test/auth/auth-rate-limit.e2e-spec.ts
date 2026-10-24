import {
  Controller,
  Get,
  INestApplication,
  Inject,
  Module,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { AuthController } from '../../src/api/auth/auth.controller';
import { AuthService } from '../../src/api/auth/auth.service';
import { EmailVerificationService } from '../../src/api/auth/email-verification.service';
import { createValidationPipe } from '../../src/config/validation';
import { GlobalExceptionFilter } from '../../src/filters/global-exception.filter';
import { HttpThrottlerGuard } from '../../src/guards/http-throttler.guard';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => Inject('UserRepository'),
}));

@Controller('probe')
class ProbeController {
  @Get()
  get(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
  controllers: [AuthController, ProbeController],
  providers: [
    {
      provide: EmailVerificationService,
      useValue: { send: jest.fn(), verify: jest.fn() },
    },
    {
      provide: AuthService,
      useValue: {
        register: jest.fn().mockResolvedValue({}),
        login: jest.fn().mockResolvedValue({}),
        authenticateAccessToken: jest
          .fn()
          .mockResolvedValue({ userId: 'user' }),
      },
    },
    HttpThrottlerGuard,
    { provide: APP_GUARD, useClass: HttpThrottlerGuard },
  ],
})
class AuthRateLimitTestModule {}

describe('authentication rate limits', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AuthRateLimitTestModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(
      new GlobalExceptionFilter({ error: jest.fn() } as unknown as Logger),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rate limits verification and resend per IP', async () => {
    // Validate throttling independently of provider latency by using malformed
    // bodies; add validation here so no mail call or response delay is reached.
    for (let i = 0; i < 10; i++)
      await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ token: 'bad' })
        .expect(400);
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: 'bad' })
      .expect(429);
    for (let i = 0; i < 5; i++)
      await request(app.getHttpServer())
        .post('/auth/resend-verification')
        .send({ email: 'bad' })
        .expect(400);
    await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email: 'bad' })
      .expect(429);
  });

  it('limits login to ten requests per minute while leaving the global probe available', async () => {
    for (let index = 0; index < 10; index += 1) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'ada@example.com', password: 'password123' })
        .expect(200);
    }
    const limited = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'ada@example.com', password: 'password123' })
      .expect(429);

    expect(limited.body).toMatchObject({
      success: false,
      code: 'TOO_MANY_REQUESTS',
    });

    for (let index = 0; index < 5; index += 1) {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: `user-${index}@example.com`,
          password: 'Kanvexa@2026',
          displayName: 'Test User',
        })
        .expect(201);
    }
    const registerLimited = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'user-5@example.com',
        password: 'Kanvexa@2026',
        displayName: 'Test User',
      })
      .expect(429);
    expect(registerLimited.body.code).toBe('TOO_MANY_REQUESTS');
    await request(app.getHttpServer()).get('/probe').expect(200);
  });
});
