import {
  ClassSerializerInterceptor,
  INestApplication,
  Inject,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { Logger } from 'nestjs-pino';
import {
  ActivityActionType,
  ActivityEntityType,
} from '../../src/common/enums/database-enums';
import { paginate } from '../../src/common/dto/paginated-response';
import { AuthService } from '../../src/api/auth/auth.service';
import { WorkspacesService } from '../../src/api/workspaces/workspaces.service';
import { EmailVerificationService } from '../../src/api/auth/email-verification.service';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '../../src/api/auth/constants/auth.constants';
import { JwtAuthGuard } from '../../src/api/auth/guards/jwt-auth.guard';
import { ActivitiesController } from '../../src/api/activities/activities.controller';
import { ActivitiesService } from '../../src/api/activities/activities.service';
import { Activity } from '../../src/api/activities/entities/activity.entity';
import { createValidationPipe } from '../../src/config/validation';
import { GlobalExceptionFilter } from '../../src/filters/global-exception.filter';
import { ApiResponseInterceptor } from '../../src/interceptors/api-response.interceptor';
import { ApplicationException } from '../../src/exceptions/application.exception';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: (entity: { name: string }) =>
    Inject(`${entity.name}Repository`),
}));

const ID = {
  member: '1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5',
  board: 'c6ba7134-97ef-4c1b-a342-001a982a7721',
  activity: 'e6ba7134-97ef-4c1b-a342-001a982a7721',
};

describe('Activities HTTP API with real JWT and validation', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let token: string;
  const activity = Object.assign(new Activity(), {
    id: ID.activity,
    boardId: ID.board,
    actorId: ID.member,
    actionType: ActivityActionType.BOARD_UPDATED,
    entityType: ActivityEntityType.BOARD,
    entityId: null,
    metadata: null,
    createdAt: new Date('2026-10-16T12:00:00.000Z'),
    actor: { passwordHash: 'must-not-leak' },
    board: { name: 'must-not-leak' },
  });
  const activities = {
    list: jest
      .fn()
      .mockResolvedValue(paginate([activity], 1, { page: 1, limit: 20 })),
  };
  const users = {
    findOne: jest.fn().mockResolvedValue({
      id: ID.member,
      authVersion: 0,
      emailVerifiedAt: new Date(),
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
      controllers: [ActivitiesController],
      providers: [
        { provide: ActivitiesService, useValue: activities },
        AuthService,
        {
          provide: WorkspacesService,
          useValue: { ensurePersonalWorkspace: jest.fn() },
        },
        { provide: EmailVerificationService, useValue: { send: jest.fn() } },
        JwtAuthGuard,
        { provide: 'UserRepository', useValue: users },
      ],
    }).compile();
    jwt = module.get(JwtService);
    token = await jwt.signAsync({ sub: ID.member });
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

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    activities.list.mockClear();
  });

  it('requires a valid JWT', async () => {
    await request(app.getHttpServer())
      .get(`/api/boards/${ID.board}/activities`)
      .expect(HttpStatus.UNAUTHORIZED);
  });

  it('returns the success envelope and only public activity fields', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/boards/${ID.board}/activities`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    expect(response.body).toMatchObject({
      success: true,
      statusCode: 200,
      data: [
        {
          id: ID.activity,
          boardId: ID.board,
          actorId: ID.member,
          actionType: 'BOARD_UPDATED',
          entityType: 'BOARD',
          entityId: null,
          metadata: null,
          createdAt: '2026-10-16T12:00:00.000Z',
        },
      ],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    expect(response.body.data[0]).not.toHaveProperty('actor');
    expect(response.body.data[0]).not.toHaveProperty('board');
  });

  it.each([
    `/api/boards/${ID.board}/activities?page=0`,
    `/api/boards/${ID.board}/activities?limit=101`,
    '/api/boards/not-a-uuid/activities',
  ])('rejects invalid pagination or board IDs: %s', async (path) => {
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.BAD_REQUEST);
    expect(activities.list).not.toHaveBeenCalled();
  });

  it('keeps missing-board membership errors as safe 404s', async () => {
    activities.list.mockRejectedValueOnce(
      new ApplicationException(
        HttpStatus.NOT_FOUND,
        'NOT_FOUND',
        'Board not found',
      ),
    );

    await request(app.getHttpServer())
      .get(`/api/boards/${ID.board}/activities`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);
  });

  it('does not expose a public activity write endpoint', async () => {
    await request(app.getHttpServer())
      .post(`/api/boards/${ID.board}/activities`)
      .set('Authorization', `Bearer ${token}`)
      .send({ actorId: ID.member })
      .expect(HttpStatus.NOT_FOUND);
  });
});
