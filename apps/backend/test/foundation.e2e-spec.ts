import 'reflect-metadata';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  INestApplication,
  Module,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { LoggerModule } from 'nestjs-pino';
import request from 'supertest';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import { HealthController } from '../src/api/health/health.controller';
import { HealthService } from '../src/api/health/health.service';
import { PageQueryDto } from '../src/common/dto/page-query.dto';
import { pageOffset, paginate } from '../src/common/dto/paginated-response';
import { validateEnvironment } from '../src/config/environment';
import { loggerOptions } from '../src/logging/logger-options';
import { configureHttpApplication } from '../src/http-application';

class NestedDto {
  @IsString()
  @IsNotEmpty()
  title!: string;
}

class ProbeDto {
  @ValidateNested()
  @Type(() => NestedDto)
  nested!: NestedDto;
}

@ApiExcludeController()
@Controller('probe')
class ProbeController {
  @Get('list')
  list(@Query() query: PageQueryDto) {
    return query;
  }

  @Post()
  submit(@Body() body: ProbeDto) {
    return body;
  }

  @Get('missing')
  missing() {
    throw new EntityNotFoundError('Thing', { id: 1 });
  }

  @Get('conflict')
  conflict() {
    throw new QueryFailedError(
      'secret SQL',
      ['secret'],
      Object.assign(new Error('constraint'), { code: '23505' }),
    );
  }

  @Get('foreign-key')
  foreignKey() {
    throw new QueryFailedError(
      'secret SQL',
      ['secret'],
      Object.assign(new Error('constraint'), { code: '23503' }),
    );
  }

  @Get('forbidden')
  forbidden() {
    throw new ForbiddenException();
  }

  @Get('database-error')
  databaseError() {
    throw new QueryFailedError(
      'secret SQL',
      ['secret'],
      Object.assign(new Error('internal'), { code: '42P01' }),
    );
  }

  @Get('unexpected')
  unexpected() {
    throw new Error('secret internal detail');
  }
}

const environment = validateEnvironment({
  NODE_ENV: 'test',
  API_PORT: '3000',
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: '5432',
  DATABASE_NAME: 'test',
  DATABASE_USER: 'test',
  DATABASE_PASSWORD: 'secret',
  LOG_LEVEL: 'silent',
});

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: () => environment,
    }),
    LoggerModule.forRoot(loggerOptions(environment)),
  ],
  controllers: [HealthController, ProbeController],
  providers: [HealthService],
})
class TestModule {}

describe('backend foundation HTTP behavior', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [TestModule],
    }).compile();
    app = module.createNestApplication();
    configureHttpApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps liveness routes outside the API prefix and documents health', async () => {
    await request(app.getHttpServer()).get('/').expect(200);
    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer()).get('/api/health').expect(404);
    const spec = await request(app.getHttpServer())
      .get('/api-docs-json')
      .expect(200);
    expect(spec.body.info.title).toBe('Realtime Collaborative Kanban');
    expect(Object.keys(spec.body.paths)).toContain('/health');
    expect(spec.body.components.securitySchemes.bearer.type).toBe('http');
    await request(app.getHttpServer()).get('/api-docs').expect(200);
  });

  it('enforces nested DTO validation and a stable error response', async () => {
    const valid = await request(app.getHttpServer())
      .post('/api/probe')
      .send({ nested: { title: 'ok' } })
      .expect(201);
    expect(valid.body).toEqual({ nested: { title: 'ok' } });
    const invalid = await request(app.getHttpServer())
      .post('/api/probe')
      .send({ nested: { title: '', unwanted: true } })
      .expect(400);
    expect(invalid.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      path: '/api/probe',
    });
    expect(invalid.body.details).toEqual(
      expect.arrayContaining([
        expect.stringContaining('nested.title'),
        expect.stringContaining('nested.unwanted'),
      ]),
    );
    expect(new Date(invalid.body.timestamp).toString()).not.toBe(
      'Invalid Date',
    );
  });

  it('validates and transforms pagination query parameters', async () => {
    await request(app.getHttpServer())
      .get('/api/probe/list')
      .expect(200)
      .expect({ page: 1, limit: 20 });
    await request(app.getHttpServer())
      .get('/api/probe/list?page=2&limit=100')
      .expect(200)
      .expect({ page: 2, limit: 100 });
    const invalid = await request(app.getHttpServer())
      .get('/api/probe/list?page=0&limit=101')
      .expect(400);
    expect(invalid.body.code).toBe('VALIDATION_FAILED');
    expect(invalid.body.details).toEqual(
      expect.arrayContaining([
        expect.stringContaining('page'),
        expect.stringContaining('limit'),
      ]),
    );
  });

  it('maps database errors without exposing SQL or internal messages', async () => {
    const missing = await request(app.getHttpServer())
      .get('/api/probe/missing')
      .expect(404);
    expect(missing.body.code).toBe('NOT_FOUND');
    const conflict = await request(app.getHttpServer())
      .get('/api/probe/conflict')
      .expect(409);
    expect(conflict.body.code).toBe('CONFLICT');
    const foreignKey = await request(app.getHttpServer())
      .get('/api/probe/foreign-key')
      .expect(409);
    expect(foreignKey.body.code).toBe('CONFLICT');
    const forbidden = await request(app.getHttpServer())
      .get('/api/probe/forbidden')
      .expect(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');
    const databaseError = await request(app.getHttpServer())
      .get('/api/probe/database-error')
      .expect(500);
    const unexpected = await request(app.getHttpServer())
      .get('/api/probe/unexpected')
      .expect(500);
    for (const result of [conflict, foreignKey, databaseError, unexpected]) {
      expect(JSON.stringify(result.body)).not.toMatch(
        /secret|SQL|stack|query/i,
      );
    }
    expect(unexpected.body.message).toBe('Internal server error');
  });

  it('sets safe request IDs, CORS, and Helmet headers', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'http://localhost:5173')
      .set('X-Request-Id', 'trace-123')
      .expect(200);
    expect(response.headers['x-request-id']).toBe('trace-123');
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain(
      "'unsafe-inline'",
    );
    const blocked = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'https://not-allowed.example')
      .expect(200);
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
    const generated = await request(app.getHttpServer())
      .get('/api/probe/missing')
      .set('X-Request-Id', 'invalid request id with spaces')
      .expect(404);
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(generated.body.requestId).toBe(generated.headers['x-request-id']);
  });
});

describe('foundation helpers', () => {
  it('validates environment strictly', () => {
    expect(() =>
      validateEnvironment({ ...environment, SWAGGER_ENABLED: 'yes' }),
    ).toThrow('SWAGGER_ENABLED');
    expect(() =>
      validateEnvironment({ ...environment, API_PORT: '0' }),
    ).toThrow('API_PORT');
    expect(() =>
      validateEnvironment({
        ...environment,
        NODE_ENV: 'production',
        CORS_ORIGINS: '',
      }),
    ).toThrow('CORS_ORIGINS');
    expect(
      validateEnvironment({ ...environment, SWAGGER_ENABLED: 'false' })
        .SWAGGER_ENABLED,
    ).toBe(false);
    expect(
      validateEnvironment({
        ...environment,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://example.com',
        SWAGGER_ENABLED: undefined,
      }).SWAGGER_ENABLED,
    ).toBe(false);
  });

  it('provides correct offset pagination metadata', () => {
    const query = new PageQueryDto();
    expect(pageOffset(query)).toBe(0);
    expect(paginate(['item'], 21, { page: 2, limit: 20 })).toEqual({
      data: ['item'],
      meta: { page: 2, limit: 20, total: 21, totalPages: 2 },
    });
  });
});
