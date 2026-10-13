import 'reflect-metadata';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  INestApplication,
  Module,
  Post,
  Query,
  Redirect,
  StreamableFile,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApiProperty } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { Expose, Type } from 'class-transformer';
import { IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { LoggerModule } from 'nestjs-pino';
import request from 'supertest';
import { DataSource, EntityNotFoundError, QueryFailedError } from 'typeorm';
import { HealthController } from '../src/api/health/health.controller';
import { HealthService } from '../src/api/health/health.service';
import { ReadinessService } from '../src/api/health/readiness.service';
import { PageQueryDto } from '../src/common/dto/page-query.dto';
import { apiSuccess } from '../src/common/dto/api-success';
import { cursorResult } from '../src/common/dto/cursor-result';
import { pageOffset, paginate } from '../src/common/dto/paginated-response';
import { validateEnvironment } from '../src/config/environment';
import { loggerOptions } from '../src/logging/logger-options';
import { configureHttpApplication } from '../src/http-application';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiNoContent,
  ApiPaginated,
  ApiSuccess,
} from '../src/decorators/swagger-response.decorators';
import {
  ResponseMessage,
  SerializeResponse,
  SkipResponseWrap,
} from '../src/decorators/response.decorators';
import { ApplicationException } from '../src/exceptions/application.exception';

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

class PublicProfileDto {
  @Expose()
  @ApiProperty()
  city!: string;
}

class PublicDto {
  @Expose()
  @ApiProperty()
  userName!: string;

  @Expose()
  @Type(() => PublicProfileDto)
  @ApiProperty({ type: PublicProfileDto })
  profile!: PublicProfileDto;
}

@Controller('probe')
class ProbeController {
  @Get('ok')
  ok() {
    return { value: 1 };
  }

  @Get('already')
  already() {
    return apiSuccess({ value: 1 }, 200, 'Explicit');
  }

  @Get('data-key')
  dataKey() {
    return { data: 'business value' };
  }

  @Get('cursor')
  cursor() {
    return cursorResult([{ value: 1 }], 2, null);
  }

  @Get('raw')
  @SkipResponseWrap()
  raw() {
    return { value: 1 };
  }

  @Get('empty')
  @HttpCode(204)
  @ApiNoContent({ summary: 'Empty result' })
  empty() {
    return undefined;
  }

  @Get('stream')
  stream() {
    return new StreamableFile(Buffer.from('binary response'));
  }

  @Get('redirect')
  @Redirect('/health', 302)
  redirect() {
    return undefined;
  }

  @Get('secure')
  @SerializeResponse(PublicDto)
  @ResponseMessage('Loaded')
  @ApiSuccess({ type: PublicDto, summary: 'Safe response DTO' })
  @ApiCommonErrors([400, 500])
  @ApiBearerToken()
  secure() {
    return {
      userName: 'Alice',
      passwordHash: 'secret',
      profile: { city: 'Hanoi', passwordHash: 'secret nested' },
    };
  }

  @Get('paginated')
  @SerializeResponse(PublicDto)
  @ApiPaginated(PublicDto)
  paginated() {
    return paginate(
      [
        {
          userName: 'Alice',
          passwordHash: 'secret',
          profile: { city: 'Hanoi', passwordHash: 'secret nested' },
        },
      ],
      21,
      { page: 2, limit: 20 },
    );
  }

  @Get('application-error')
  applicationError() {
    throw new ApplicationException(
      409,
      'EXAMPLE_CONFLICT',
      'A public conflict',
    );
  }

  @Get('list')
  list(@Query() query: PageQueryDto) {
    return query;
  }

  @Post()
  @ApiSuccess({ type: ProbeDto, status: 201, summary: 'Submit probe' })
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
  JWT_SECRET: 'test-secret-that-is-at-least-32-bytes-long',
  LOG_LEVEL: 'silent',
});

const databaseQuery = jest.fn().mockResolvedValue([{ result: 1 }]);
const queryRunner = {
  isTransactionActive: false,
  connect: jest.fn().mockResolvedValue(undefined),
  startTransaction: jest.fn().mockImplementation(async () => {
    queryRunner.isTransactionActive = true;
  }),
  query: jest.fn((sql: string) =>
    sql === 'SELECT 1' ? databaseQuery() : Promise.resolve([]),
  ),
  rollbackTransaction: jest.fn().mockImplementation(async () => {
    queryRunner.isTransactionActive = false;
  }),
  release: jest.fn().mockResolvedValue(undefined),
};
const createQueryRunner = jest.fn(() => queryRunner);

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
  providers: [
    HealthService,
    ReadinessService,
    {
      provide: DataSource,
      useValue: { isInitialized: true, createQueryRunner },
    },
  ],
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
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect({ status: 'ok', database: 'ok' });
    expect(queryRunner.query).toHaveBeenCalledWith(
      'SET LOCAL statement_timeout = 1000',
    );
    expect(queryRunner.query).toHaveBeenCalledWith('SELECT 1');
    expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
    databaseQuery.mockRejectedValueOnce(new Error('secret connection detail'));
    const unavailable = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);
    expect(unavailable.body).toMatchObject({
      success: false,
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(JSON.stringify(unavailable.body)).not.toContain('secret');
    let completeStalledQuery:
      ((rows: { result: number }[]) => void) | undefined;
    databaseQuery.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeStalledQuery = resolve;
        }),
    );
    const queryCount = databaseQuery.mock.calls.length;
    const runnerCount = createQueryRunner.mock.calls.length;
    const [timedOut, concurrentTimeout] = await Promise.all([
      request(app.getHttpServer()).get('/health/ready').expect(503),
      request(app.getHttpServer()).get('/health/ready').expect(503),
    ]);
    expect(timedOut.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(concurrentTimeout.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(databaseQuery).toHaveBeenCalledTimes(queryCount + 1);
    expect(createQueryRunner).toHaveBeenCalledTimes(runnerCount + 1);
    completeStalledQuery?.([{ result: 1 }]);
    await request(app.getHttpServer()).get('/api/health').expect(404);
    const spec = await request(app.getHttpServer())
      .get('/api-docs-json')
      .expect(200);
    expect(spec.body.info.title).toBe('Realtime Collaborative Kanban');
    expect(Object.keys(spec.body.paths)).toContain('/health');
    expect(Object.keys(spec.body.paths)).toContain('/health/ready');
    expect(spec.body.components.securitySchemes.bearer.type).toBe('http');
    await request(app.getHttpServer()).get('/api-docs').expect(200);
  });

  it('wraps 200/201 and pagination without changing health, opt-out, 204 or stream responses', async () => {
    await request(app.getHttpServer())
      .get('/api/probe/ok')
      .expect(200)
      .expect({
        success: true,
        statusCode: 200,
        message: 'OK',
        data: { value: 1 },
      });
    await request(app.getHttpServer())
      .get('/api/probe/already')
      .expect(200)
      .expect({
        success: true,
        statusCode: 200,
        message: 'Explicit',
        data: { value: 1 },
      });
    await request(app.getHttpServer())
      .get('/api/probe/data-key')
      .expect(200)
      .expect({
        success: true,
        statusCode: 200,
        message: 'OK',
        data: { data: 'business value' },
      });
    await request(app.getHttpServer())
      .get('/api/probe/cursor')
      .expect(200)
      .expect({
        success: true,
        statusCode: 200,
        message: 'OK',
        data: [{ value: 1 }],
        meta: { limit: 2, nextCursor: null },
      });
    await request(app.getHttpServer())
      .get('/api/probe/raw')
      .expect(200)
      .expect({ value: 1 });
    await request(app.getHttpServer())
      .get('/api/probe/empty')
      .expect(204)
      .expect('');
    const stream = await request(app.getHttpServer())
      .get('/api/probe/stream')
      .expect(200);
    expect(stream.body.toString()).toBe('binary response');
    await request(app.getHttpServer())
      .get('/api/probe/redirect')
      .expect(302)
      .expect('Location', '/health');
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ name: 'Realtime Collaborative Kanban', status: 'ok' });
    await request(app.getHttpServer())
      .get('/api/probe/paginated')
      .expect(200)
      .expect({
        success: true,
        statusCode: 200,
        message: 'OK',
        data: [{ userName: 'Alice', profile: { city: 'Hanoi' } }],
        meta: { page: 2, limit: 20, total: 21, totalPages: 2 },
      });
  });

  it('serializes nested response DTOs and documents the envelope schemas', async () => {
    const safe = await request(app.getHttpServer())
      .get('/api/probe/secure')
      .expect(200);
    expect(safe.body).toEqual({
      success: true,
      statusCode: 200,
      message: 'Loaded',
      data: { userName: 'Alice', profile: { city: 'Hanoi' } },
    });
    expect(JSON.stringify(safe.body)).not.toContain('passwordHash');
    const spec = (
      await request(app.getHttpServer()).get('/api-docs-json').expect(200)
    ).body;
    const secure = spec.paths['/api/probe/secure'].get;
    expect(
      secure.responses['200'].content['application/json'].schema.allOf[1]
        .properties.data.$ref,
    ).toContain('PublicDto');
    expect(
      secure.responses['400'].content['application/json'].schema.$ref,
    ).toContain('ApiErrorResponseDto');
    expect(secure.security[0].bearer).toEqual([]);
    const page = spec.paths['/api/probe/paginated'].get;
    expect(
      page.responses['200'].content['application/json'].schema.allOf[1]
        .properties.meta.$ref,
    ).toContain('PaginationMetaDto');
    expect(
      page.responses['200'].content['application/json'].schema.allOf[1]
        .properties.data.items.$ref,
    ).toContain('PublicDto');
    expect(
      spec.paths['/api/probe'].post.responses['201'].content['application/json']
        .schema.allOf[1].properties.data.$ref,
    ).toContain('ProbeDto');
    expect(
      spec.paths['/api/probe/empty'].get.responses['204'].content,
    ).toBeUndefined();
  });

  it('enforces nested DTO validation and a stable error response', async () => {
    const valid = await request(app.getHttpServer())
      .post('/api/probe')
      .send({ nested: { title: 'ok' } })
      .expect(201);
    expect(valid.body).toEqual({
      success: true,
      statusCode: 201,
      message: 'Created',
      data: { nested: { title: 'ok' } },
    });
    const invalid = await request(app.getHttpServer())
      .post('/api/probe')
      .send({ nested: { title: '', unwanted: true } })
      .expect(400);
    expect(invalid.body).toMatchObject({
      success: false,
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
      .expect({
        success: true,
        statusCode: 200,
        message: 'OK',
        data: { page: 1, limit: 20 },
      });
    await request(app.getHttpServer())
      .get('/api/probe/list?page=2&limit=100')
      .expect(200)
      .expect({
        success: true,
        statusCode: 200,
        message: 'OK',
        data: { page: 2, limit: 100 },
      });
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
    const unsafePage = await request(app.getHttpServer())
      .get('/api/probe/list?page=9007199254740993')
      .expect(400);
    expect(unsafePage.body.code).toBe('VALIDATION_FAILED');
    expect(unsafePage.body.details).toEqual(
      expect.arrayContaining([expect.stringContaining('page')]),
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
    const applicationError = await request(app.getHttpServer())
      .get('/api/probe/application-error')
      .expect(409);
    expect(applicationError.body).toMatchObject({
      success: false,
      code: 'EXAMPLE_CONFLICT',
      message: 'A public conflict',
    });
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
      validateEnvironment({ ...environment, DATABASE_POOL_SIZE: '101' }),
    ).toThrow('DATABASE_POOL_SIZE');
    expect(() =>
      validateEnvironment({ ...environment, DATABASE_SSL: 'yes' }),
    ).toThrow('DATABASE_SSL');
    expect(() =>
      validateEnvironment({ ...environment, RATE_LIMIT_MAX: '0' }),
    ).toThrow('RATE_LIMIT_MAX');
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
    expect(pageOffset({ page: Number.MAX_SAFE_INTEGER, limit: 1 })).toBe(
      Number.MAX_SAFE_INTEGER - 1,
    );
    expect(() =>
      pageOffset({ page: Number.MAX_SAFE_INTEGER, limit: 2 }),
    ).toThrow(RangeError);
    expect(() =>
      pageOffset({ page: Number.MAX_SAFE_INTEGER + 1, limit: 1 }),
    ).toThrow(RangeError);
    expect(paginate(['item'], 21, { page: 2, limit: 20 })).toEqual({
      data: ['item'],
      meta: { page: 2, limit: 20, total: 21, totalPages: 2 },
    });
  });
});
