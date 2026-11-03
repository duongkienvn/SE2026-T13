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
import { ProductivityController } from '../../src/api/productivity/productivity.controller';
import { ProductivityService } from '../../src/api/productivity/productivity.service';
import { createValidationPipe } from '../../src/config/validation';
import { ApiResponseInterceptor } from '../../src/interceptors/api-response.interceptor';
import { GlobalExceptionFilter } from '../../src/filters/global-exception.filter';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => Inject('UserRepository'),
}));
const id = 'c6ba7134-97ef-4c1b-a342-001a982a7721';
const groupCounts = { OVERDUE: 0, NEXT_7_DAYS: 0, LATER: 0, NO_DUE_DATE: 1 };

describe('productivity authenticated HTTP and Swagger contract', () => {
  let app: INestApplication, jwt: JwtService, token: string;
  const user = { id, authVersion: 0, emailVerifiedAt: new Date() };
  const service = {
    tasks: jest.fn().mockResolvedValue({
      data: [
        {
          id,
          group: 'NO_DUE_DATE',
          labels: [{ id, name: 'Real', color: '#123456', secret: 'hidden' }],
          description: 'hidden',
        },
      ],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      groupCounts: { ...groupCounts, hidden: 9 },
    }),
    home: jest.fn().mockResolvedValue({
      summary: {
        assignedActiveCount: 1,
        overdueCount: 0,
        dueNext7DaysCount: 0,
        workspaceCount: 1,
        privateEmail: 'hidden',
      },
      upNext: [],
      starredBoards: [],
      recentBoards: [],
      fabricated: 42,
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
      controllers: [ProductivityController],
      providers: [
        AuthService,
        JwtAuthGuard,
        { provide: WelcomeOnboardingService, useValue: {} },
        {
          provide: WorkspacesService,
          useValue: { ensurePersonalWorkspace: jest.fn() },
        },
        { provide: EmailVerificationService, useValue: {} },
        { provide: 'UserRepository', useValue: { findOne: async () => user } },
        { provide: ProductivityService, useValue: service },
        { provide: Logger, useValue: { error: jest.fn() } },
      ],
    }).compile();
    jwt = module.get(JwtService);
    token = await jwt.signAsync({ sub: id });
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
  afterAll(async () => app?.close());
  beforeEach(() => jest.clearAllMocks());

  it('preserves flat data/meta/groupCounts and nested allowlists with no-store', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/users/me/tasks')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      success: true,
      statusCode: 200,
      data: [{ id }],
      groupCounts,
    });
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).not.toHaveProperty('description');
    expect(response.body.data[0].labels[0]).not.toHaveProperty('secret');
    expect(response.body.groupCounts).toEqual(groupCounts);
    expect(response.body.meta).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    expect(service.tasks).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        page: 1,
        limit: 20,
        group: 'ALL',
        sort: 'dueDate',
      }),
    );
  });

  it('serializes Home and uses the authenticated identity', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/users/me/home')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).not.toHaveProperty('fabricated');
    expect(response.body.data.summary).not.toHaveProperty('privateEmail');
    expect(service.home).toHaveBeenCalledWith(id);
  });

  it.each(['tasks', 'home'])(
    'rejects missing, expired, invalid and invalidated JWT for %s',
    async (endpoint) => {
      const url = `/api/users/me/${endpoint}`;
      await request(app.getHttpServer()).get(url).expect(401);
      for (const invalid of [
        'invalid',
        await jwt.signAsync({ sub: id }, { expiresIn: -1 }),
        await jwt.signAsync({ sub: id, authVersion: 999 }),
      ]) {
        await request(app.getHttpServer())
          .get(url)
          .auth(invalid, { type: 'bearer' })
          .expect(401);
      }
      expect(service.tasks).not.toHaveBeenCalled();
      expect(service.home).not.toHaveBeenCalled();
    },
  );

  it.each([
    'userId=other',
    'boardId=bad',
    'dueFrom=2026-02-30T00:00:00Z',
    'labelIds=',
    'page=0',
    'limit=101',
    'sort=secret',
    'group=DONE',
    `boardId=${id}&boardId=${id}`,
  ])('rejects malformed query %s before calling the service', async (query) => {
    const response = await request(app.getHttpServer())
      .get(`/api/users/me/tasks?${query}`)
      .auth(token, { type: 'bearer' })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(service.tasks).not.toHaveBeenCalled();
  });

  it('documents both endpoints, every filter, response fields and groupCounts', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    const tasks = doc.paths['/api/users/me/tasks'].get!;
    expect(tasks.security).toEqual([{ bearer: [] }]);
    expect(
      tasks.parameters!.map((parameter) =>
        'name' in parameter ? parameter.name : '',
      ),
    ).toEqual(
      expect.arrayContaining([
        'page',
        'limit',
        'group',
        'workspaceId',
        'boardId',
        'labelIds',
        'dueFrom',
        'dueTo',
        'sort',
      ]),
    );
    expect(JSON.stringify(tasks.responses['200'])).toContain('groupCounts');
    expect(doc.paths['/api/users/me/home'].get!.security).toEqual([
      { bearer: [] },
    ]);
    expect(doc.components!.schemas!.TaskCardSummaryDto).toMatchObject({
      properties: expect.objectContaining({ permalink: expect.anything() }),
    });
    expect(doc.components!.schemas!.HomeDashboardDto).toMatchObject({
      properties: expect.objectContaining({ recentBoards: expect.anything() }),
    });
  });
});
