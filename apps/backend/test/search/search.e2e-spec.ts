import {
  ClassSerializerInterceptor,
  Inject,
  type INestApplication,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ThrottlerModule } from '@nestjs/throttler';
import { randomBytes } from 'node:crypto';
import { Logger } from 'nestjs-pino';
import { QueryFailedError } from 'typeorm';
import request from 'supertest';
import { AuthService } from '../../src/api/auth/auth.service';
import { StarterBoardProvisioningService } from '../../src/api/boards/starter-board-provisioning.service';
import { WelcomeOnboardingService } from '../../src/api/auth/welcome-onboarding.service';
import { WorkspacesService } from '../../src/api/workspaces/workspaces.service';
import { EmailVerificationService } from '../../src/api/auth/email-verification.service';
import { JwtAuthGuard } from '../../src/api/auth/guards/jwt-auth.guard';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '../../src/api/auth/constants/auth.constants';
import { SearchController } from '../../src/api/search/search.controller';
import { SearchService } from '../../src/api/search/search.service';
import { createValidationPipe } from '../../src/config/validation';
import { ApiResponseInterceptor } from '../../src/interceptors/api-response.interceptor';
import { GlobalExceptionFilter } from '../../src/filters/global-exception.filter';
import { HttpThrottlerGuard } from '../../src/guards/http-throttler.guard';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => Inject('UserRepository'),
}));
const id = 'c6ba7134-97ef-4c1b-a342-001a982a7721';
const user: { id: string; authVersion: number; emailVerifiedAt: Date | null } =
  { id, authVersion: 0, emailVerifiedAt: new Date() };
const service = { search: jest.fn() },
  logger = { error: jest.fn() };

async function boot(limit = 10000) {
  const module = await Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot([{ ttl: 60000, limit }]),
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
    controllers: [SearchController],
    providers: [
      AuthService,
      {
        provide: StarterBoardProvisioningService,
        useValue: { provision: jest.fn() },
      },
      JwtAuthGuard,
      { provide: APP_GUARD, useClass: HttpThrottlerGuard },
      { provide: WelcomeOnboardingService, useValue: {} },
      { provide: WorkspacesService, useValue: {} },
      { provide: EmailVerificationService, useValue: {} },
      { provide: 'UserRepository', useValue: { findOne: async () => user } },
      { provide: SearchService, useValue: service },
      { provide: Logger, useValue: logger },
    ],
  }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter(module.get(Logger)));
  const reflector = app.get(Reflector);
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(reflector),
    new ApiResponseInterceptor(reflector),
  );
  await app.init();
  const jwt = app.get(JwtService),
    token = await jwt.signAsync({ sub: id });
  return { app, jwt, token };
}

describe('global search authenticated HTTP contract', () => {
  let app: INestApplication, jwt: JwtService, token: string;
  beforeAll(async () => {
    ({ app, jwt, token } = await boot());
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    jest.clearAllMocks();
    user.authVersion = 0;
    user.emailVerifiedAt = new Date();
    service.search.mockImplementation(async (_actor, input) => ({
      query: input.q,
      type: input.type,
      private: 'secret',
      groups: {
        workspaces: {
          items: [
            {
              type: 'workspace',
              id,
              title: 'Visible',
              subtitle: null,
              path: `/workspaces/${id}`,
              email: 'private',
            },
          ],
          total: 1,
          hasMore: false,
        },
        boards: { items: [], total: 0, hasMore: false },
        cards: {
          items: [
            {
              type: 'card',
              id,
              title: 'Card',
              boardId: id,
              boardName: 'Board',
              workspaceId: id,
              workspaceName: null,
              subtitle: 'Safe snippet',
              path: `/boards/${id}/cards/${id}`,
              description: 'PRIVATE DESCRIPTION',
              fragment: 'internal',
              rank: 0,
            },
          ],
          total: 1,
          hasMore: false,
        },
      },
    }));
  });
  const send = (query = '') =>
    request(app.getHttpServer())
      .get(`/api/search${query}`)
      .auth(token, { type: 'bearer' });

  it('uses JWT identity, trims text, serializes nested allowlists and sends no-store', async () => {
    const response = await send(
      '?q=%20literal%20&type=cards&page=2&limit=3',
    ).expect(200);
    expect(service.search).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        q: 'literal',
        type: 'cards',
        page: 2,
        limit: 3,
      }),
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      success: true,
      statusCode: 200,
      message: 'OK',
      data: { query: 'literal', type: 'cards' },
    });
    const json = JSON.stringify(response.body);
    for (const value of [
      'PRIVATE DESCRIPTION',
      'fragment',
      'rank',
      'email',
      'secret',
    ])
      expect(json).not.toContain(value);
    expect(Object.keys(response.body.data).sort()).toEqual([
      'groups',
      'query',
      'type',
    ]);
    expect(
      Object.keys(response.body.data.groups.cards.items[0]).sort(),
    ).toEqual(
      [
        'type',
        'id',
        'title',
        'boardId',
        'boardName',
        'workspaceId',
        'workspaceName',
        'subtitle',
        'path',
      ].sort(),
    );
  });

  it.each([
    '?q=x&type=all&boardId=' + id,
    '?q=x&type=boards&boardId=' + id,
    '?q=x&type=workspaces&boardId=' + id,
    '?q=x&type=cards&boardId=not-a-uuid',
    '?q=x&type=cards&boardId=',
    '?q=x&type=cards&boardId=' + id + '&boardId=' + id,
    '?q=x&type=cards&boardId[x]=y',
    '?page=1',
    '?type=all&page=1',
    '?limit=11',
    '?type=cards&limit=51',
    '?type=nope',
    '?q=x&q=y',
    '?q[x]=y',
    '?type=cards&page=0',
    '?userId=other',
    '?offset=1',
    '?pageSize=50',
    '?pageNumber=2',
    '?q=%00',
    '?q=' + 'x'.repeat(121),
  ])('rejects malformed query %s', async (query) => {
    const response = await send(query).expect(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(service.search).not.toHaveBeenCalled();
  });

  it('forwards optional Board scope with transformed pagination through the HTTP boundary', async () => {
    await send(`?q=needle&type=cards&boardId=${id}&page=2&limit=1`).expect(200);
    expect(service.search).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        q: 'needle',
        type: 'cards',
        boardId: id,
        page: 2,
        limit: 1,
      }),
    );
  });

  it('accepts supplementary Unicode at the 120-character boundary', async () => {
    await send(`?q=${encodeURIComponent('😀'.repeat(120))}`).expect(200);
    await send(`?q=${encodeURIComponent('😀'.repeat(121))}`).expect(400);
  });

  it('requires valid, current, verified authentication', async () => {
    await request(app.getHttpServer()).get('/api/search?q=x').expect(401);
    for (const value of [
      'invalid',
      await jwt.signAsync({ sub: id }, { expiresIn: -1 }),
      await jwt.signAsync({ sub: id, authVersion: 99 }),
    ])
      await request(app.getHttpServer())
        .get('/api/search?q=x')
        .auth(value, { type: 'bearer' })
        .expect(401);
    user.authVersion = 1;
    await send('?q=x').expect(401);
    user.authVersion = 0;
    user.emailVerifiedAt = null;
    await send('?q=x').expect(401);
    expect(service.search).not.toHaveBeenCalled();
  });

  it('retains real HTTP rate limiting and a standard 429 envelope', async () => {
    const limited = await boot(1);
    try {
      await request(limited.app.getHttpServer())
        .get('/api/search?q=x')
        .auth(limited.token, { type: 'bearer' })
        .expect(200);
      const response = await request(limited.app.getHttpServer())
        .get('/api/search?q=x')
        .auth(limited.token, { type: 'bearer' })
        .expect(429);
      expect(response.body).toMatchObject({
        success: false,
        statusCode: 429,
        code: 'TOO_MANY_REQUESTS',
      });
    } finally {
      await limited.app.close();
    }
  });

  it('sanitizes unexpected SQL failures and logs without query parameters or DB contents', async () => {
    service.search.mockRejectedValueOnce(
      new QueryFailedError(
        'SELECT confidential FROM cards WHERE title=$1',
        ['SECRET MATCH'],
        new Error('password=private'),
      ),
    );
    const response = await send('?q=public').expect(500);
    for (const secret of [
      'SELECT',
      'confidential',
      'SECRET MATCH',
      'password=private',
    ]) {
      expect(JSON.stringify(response.body)).not.toContain(secret);
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secret);
    }
  });

  it('documents every query, type-specific results, privacy, bounds and error statuses', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    const get = doc.paths['/api/search'].get!;
    expect(get.security).toEqual([{ bearer: [] }]);
    expect(
      get.parameters!.map((p) => ('name' in p ? p.name : '')).sort(),
    ).toEqual(['boardId', 'limit', 'page', 'q', 'type']);
    expect(get.parameters).toContainEqual(
      expect.objectContaining({
        name: 'boardId',
        in: 'query',
        required: false,
      }),
    );
    for (const status of ['200', '400', '401', '429', '500'])
      expect(get.responses[status]).toBeDefined();
    expect(doc.components!.schemas!.CardSearchResultDto).toMatchObject({
      properties: {
        subtitle: { maxLength: 160, type: 'string' },
        workspaceName: { nullable: true, type: 'string' },
        type: { enum: ['card'] },
      },
    });
    expect(
      JSON.stringify(doc.components!.schemas!.CardSearchResultDto),
    ).not.toContain('description":"PRIVATE');
  });
});
