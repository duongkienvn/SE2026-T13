import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import { LoggerModule } from 'nestjs-pino';
import request from 'supertest';
import { validateEnvironment } from '../../src/config/environment';
import { HttpThrottlerGuard } from '../../src/guards/http-throttler.guard';
import { configureHttpApplication } from '../../src/http-application';
import { loggerOptions } from '../../src/logging/logger-options';

const input = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  JWT_SECRET: 'proxy-test-only-secret-at-least-32-bytes',
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: '5432',
  DATABASE_USER: 'test',
  DATABASE_NAME: 'test',
  DATABASE_PASSWORD: 'test',
};

@Controller('proxy-probe')
class ProbeController {
  @Get()
  ip(@Req() req: Request) {
    return { ip: req.ip };
  }
}

describe('proxy configuration validation', () => {
  it('disables proxy trust by default', () => {
    expect(validateEnvironment(input).TRUST_PROXY_HOPS).toBe(0);
  });

  it.each(['', 'true', -1, 2, 1.5])('rejects unsupported hops %p', (hops) => {
    expect(() =>
      validateEnvironment({ ...input, TRUST_PROXY_HOPS: hops }),
    ).toThrow('TRUST_PROXY_HOPS');
  });
});

describe.each([0, 1] as const)('HTTP proxy trust with %i hops', (hops) => {
  let app: INestApplication;

  beforeAll(async () => {
    const environment = validateEnvironment({
      ...input,
      TRUST_PROXY_HOPS: hops,
    });
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: () => environment,
        }),
        LoggerModule.forRoot(loggerOptions(environment)),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 2 }]),
      ],
      controllers: [ProbeController],
      providers: [{ provide: APP_GUARD, useClass: HttpThrottlerGuard }],
    }).compile();
    app = module.createNestApplication();
    configureHttpApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('trusts only the configured hop and isolates rate limits accordingly', async () => {
    const url = '/api/proxy-probe';
    const forwarded = '198.51.100.50, 203.0.113.10';
    const response = await request(app.getHttpServer())
      .get(url)
      .set('X-Forwarded-For', forwarded)
      .expect(200);
    if (hops === 1) {
      expect(response.body.data.ip).toBe('203.0.113.10');
    } else {
      expect(response.body.data.ip).not.toBe('203.0.113.10');
      expect(response.body.data.ip).not.toBe('198.51.100.50');
    }
    await request(app.getHttpServer())
      .get(url)
      .set('X-Forwarded-For', forwarded)
      .expect(200);
    await request(app.getHttpServer())
      .get(url)
      .set('X-Forwarded-For', forwarded)
      .expect(429);
    await request(app.getHttpServer())
      .get(url)
      .set('X-Forwarded-For', '203.0.113.11')
      .expect(hops === 1 ? 200 : 429);
  });
});
