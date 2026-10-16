import {
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Module,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SkipThrottle, ThrottlerModule } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { GlobalExceptionFilter } from '../../src/filters/global-exception.filter';
import { HttpThrottlerGuard } from '../../src/guards/http-throttler.guard';

@Controller('rate')
class RateController {
  @Get('normal')
  normal() {
    return { ok: true };
  }

  @SkipThrottle()
  @Get('health')
  health() {
    return { ok: true };
  }
}

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 2 }])],
  controllers: [RateController],
  providers: [
    HttpThrottlerGuard,
    { provide: APP_GUARD, useClass: HttpThrottlerGuard },
  ],
})
class RateTestModule {}

describe('global HTTP rate limiting', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [RateTestModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(
      new GlobalExceptionFilter({ error: jest.fn() } as unknown as Logger),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('enforces the bound and ignores untrusted forwarded IP headers', async () => {
    await request(app.getHttpServer()).get('/rate/normal').expect(200);
    await request(app.getHttpServer()).get('/rate/normal').expect(200);
    const limited = await request(app.getHttpServer())
      .get('/rate/normal')
      .set('X-Forwarded-For', '203.0.113.10')
      .expect(429);
    expect(limited.body).toMatchObject({
      success: false,
      code: 'TOO_MANY_REQUESTS',
    });
  });

  it('allows repeated health requests via explicit opt-out', async () => {
    for (let index = 0; index < 4; index += 1) {
      await request(app.getHttpServer()).get('/rate/health').expect(200);
    }
  });

  it('does not apply the HTTP guard to WebSocket contexts', async () => {
    const guard = app.get(HttpThrottlerGuard);
    await expect(
      guard.canActivate({ getType: () => 'ws' } as ExecutionContext),
    ).resolves.toBe(true);
  });
});
