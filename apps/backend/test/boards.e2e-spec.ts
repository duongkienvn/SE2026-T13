import {
  ClassSerializerInterceptor,
  INestApplication,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { randomBytes } from 'node:crypto';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { BoardsController } from '../src/api/boards/boards.controller';
import { BoardsService } from '../src/api/boards/boards.service';
import { BoardAuthorizationService } from '../src/api/board-members/board-authorization.service';
import { Board } from '../src/api/boards/entities/board.entity';
import { AuthService } from '../src/api/auth/auth.service';
import { JwtAuthGuard } from '../src/api/auth/guards/jwt-auth.guard';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '../src/api/auth/constants/auth.constants';
import { createValidationPipe } from '../src/config/validation';
import { ApiResponseInterceptor } from '../src/interceptors/api-response.interceptor';
import { GlobalExceptionFilter } from '../src/filters/global-exception.filter';
import { BoardMemberRole } from '../src/common/enums/database-enums';
import { User } from '../src/api/users/entities/user.entity';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: (entity: { name: string }) =>
    Inject(`${entity.name}Repository`),
}));

const OWNER = '1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5';
const MEMBER = '2c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5';
const OUTSIDER = '3c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5';
const BOARD_ID = 'c6ba7134-97ef-4c1b-a342-001a982a7721';
const MISSING = 'd6ba7134-97ef-4c1b-a342-001a982a7721';
const PUBLIC_FIELDS = [
  'id',
  'name',
  'description',
  'createdById',
  'isArchived',
  'archivedAt',
  'createdAt',
  'updatedAt',
  'currentUserRole',
];

describe('boards HTTP contract (mock repositories, real service and JWT)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let board: Board;
  let tokens: Record<string, string>;
  let roles: Map<string, BoardMemberRole>;
  const txBoards = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
  const txMembers = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
  const members = { findOne: jest.fn() };
  const boards = {
    manager: { transaction: jest.fn() },
    createQueryBuilder: jest.fn(),
  };
  const users = { findOne: jest.fn() };

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
      controllers: [BoardsController],
      providers: [
        BoardsService,
        BoardAuthorizationService,
        AuthService,
        JwtAuthGuard,
        { provide: 'BoardRepository', useValue: boards },
        { provide: 'BoardMemberRepository', useValue: members },
        { provide: 'UserRepository', useValue: users },
      ],
    }).compile();
    jwt = module.get(JwtService);
    tokens = Object.fromEntries(
      await Promise.all(
        [OWNER, MEMBER, OUTSIDER].map(async (id) => [
          id,
          await jwt.signAsync({ sub: id, currentUserRole: 'OWNER' }),
        ]),
      ),
    );
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

  beforeEach(() => {
    jest.clearAllMocks();
    roles = new Map([
      [OWNER, BoardMemberRole.OWNER],
      [MEMBER, BoardMemberRole.MEMBER],
    ]);
    board = Object.assign(new Board(), {
      id: BOARD_ID,
      name: 'Board',
      description: 'Keep',
      createdById: OWNER,
      isArchived: false,
      archivedAt: null,
      createdAt: new Date('2026-10-13T00:00:00Z'),
      updatedAt: new Date('2026-10-13T00:00:00Z'),
      createdBy: Object.assign(new User(), { passwordHash: 'never-expose' }),
      columns: [],
      cards: [],
    });
    users.findOne.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        [OWNER, MEMBER, OUTSIDER].includes(where.id) ? { id: where.id } : null,
    );
    const findMember = async ({
      where,
    }: {
      where: { boardId: string; userId: string };
    }) =>
      where.boardId === BOARD_ID && roles.has(where.userId)
        ? { board, role: roles.get(where.userId) }
        : null;
    members.findOne.mockImplementation(findMember);
    txMembers.findOne.mockImplementation(findMember);
    txBoards.findOne.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        where.id === BOARD_ID ? board : null,
    );
    txBoards.create.mockImplementation((value) => value);
    txBoards.save.mockImplementation(async (value) =>
      Object.assign(board, value),
    );
    txMembers.create.mockImplementation((value) => value);
    txMembers.save.mockImplementation(async (value) => value);
    boards.manager.transaction.mockImplementation(async (callback) =>
      callback({
        getRepository: (entity: unknown) =>
          entity === Board ? txBoards : txMembers,
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string, user = OWNER) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${tokens[user]}`);
  const patch = (user: string, input: object, id = BOARD_ID) =>
    request(app.getHttpServer())
      .patch(`/api/boards/${id}`)
      .set('Authorization', `Bearer ${tokens[user]}`)
      .send(input);
  const archive = (user: string, id = BOARD_ID) =>
    request(app.getHttpServer())
      .post(`/api/boards/${id}/archive`)
      .set('Authorization', `Bearer ${tokens[user]}`);

  it('creates with 201, authenticated creator, one OWNER and the public envelope', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/boards')
      .set('Authorization', `Bearer ${tokens[OWNER]}`)
      .send({ name: ' New board ', description: null })
      .expect(201);
    expect(response.body).toMatchObject({
      success: true,
      statusCode: 201,
      message: 'Created',
      data: {
        name: 'New board',
        description: null,
        createdById: OWNER,
        currentUserRole: 'OWNER',
      },
    });
    expect(Object.keys(response.body.data).sort()).toEqual(
      [...PUBLIC_FIELDS].sort(),
    );
    expect(txMembers.save).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['post', '/api/boards'],
    ['get', '/api/boards'],
    ['get', `/api/boards/${BOARD_ID}`],
    ['patch', `/api/boards/${BOARD_ID}`],
    ['post', `/api/boards/${BOARD_ID}/archive`],
  ] as const)(
    'protects %s %s with real JWT verification',
    async (method, path) => {
      for (const authorization of [
        '',
        'Bearer invalid-token',
        `Bearer ${await jwt.signAsync({ sub: OWNER }, { expiresIn: -1 })}`,
        `Bearer ${tokens[OWNER]}tampered`,
      ]) {
        const client = request(app.getHttpServer());
        const response = await client[method](path)
          .set('Authorization', authorization)
          .send({ name: 'Board' })
          .expect(401);
        expect(response.body).toMatchObject({
          success: false,
          statusCode: 401,
          code: 'UNAUTHORIZED',
          path,
        });
        expect(response.body.timestamp).toEqual(expect.any(String));
      }
      expect(txBoards.save).not.toHaveBeenCalled();
    },
  );

  it('rejects a valid token whose user no longer exists', async () => {
    users.findOne.mockResolvedValue(null);
    await get(`/api/boards/${BOARD_ID}`).expect(401);
  });

  it('rejects creator spoofing before transaction and sanitizes persistence errors', async () => {
    await request(app.getHttpServer())
      .post('/api/boards')
      .set('Authorization', `Bearer ${tokens[OWNER]}`)
      .send({ name: 'Board', createdById: OUTSIDER })
      .expect(400);
    expect(boards.manager.transaction).not.toHaveBeenCalled();
    txMembers.save.mockRejectedValueOnce(new Error('private SQL and password'));
    const failure = await request(app.getHttpServer())
      .post('/api/boards')
      .set('Authorization', `Bearer ${tokens[OWNER]}`)
      .send({ name: 'Board' })
      .expect(500);
    expect(failure.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(failure.body)).not.toContain('private SQL');
  });

  it.each([OWNER, MEMBER])(
    'returns detail with role from PostgreSQL rather than JWT for %s',
    async (user) => {
      const response = await get(`/api/boards/${BOARD_ID}`, user).expect(200);
      expect(response.body.data.currentUserRole).toBe(roles.get(user));
      expect(Object.keys(response.body.data).sort()).toEqual(
        [...PUBLIC_FIELDS].sort(),
      );
      expect(response.body.data.createdAt).toBe('2026-10-13T00:00:00.000Z');
    },
  );

  it('returns identical 404 envelopes for absent board and non-member', async () => {
    for (const [id, user] of [
      [BOARD_ID, OUTSIDER],
      [MISSING, OWNER],
    ]) {
      const response = await get(`/api/boards/${id}`, user).expect(404);
      expect(response.body).toMatchObject({
        success: false,
        code: 'NOT_FOUND',
        message: 'Board not found',
      });
    }
  });

  it('rejects invalid UUIDs on detail, update and archive before querying boards', async () => {
    await get('/api/boards/invalid').expect(400);
    await patch(OWNER, { name: 'Board' }, 'invalid').expect(400);
    await archive(OWNER, 'invalid').expect(400);
    expect(members.findOne).not.toHaveBeenCalled();
    expect(txBoards.findOne).not.toHaveBeenCalled();
  });

  it('updates OWNER fields, preserves omitted description and clears explicit null', async () => {
    const response = await patch(OWNER, { name: ' Updated ' }).expect(200);
    expect(response.body).toMatchObject({
      success: true,
      statusCode: 200,
      message: 'Board updated',
      data: { name: 'Updated', description: 'Keep' },
    });
    const cleared = await patch(OWNER, { description: null }).expect(200);
    expect(cleared.body.data.description).toBeNull();
  });

  it.each([
    {},
    { name: null },
    { name: '  ' },
    { name: 'x'.repeat(121) },
    { description: 'x'.repeat(2001) },
    { isArchived: true },
    { members: [] },
    { createdAt: '2020-01-01' },
  ])('rejects invalid or empty patch %p', async (input) => {
    const response = await patch(OWNER, input).expect(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      success: false,
    });
    expect(txBoards.save).not.toHaveBeenCalled();
  });

  it.each([
    [MEMBER, 403],
    [OUTSIDER, 404],
  ] as const)(
    'rejects update and archive for %s with %s',
    async (user, status) => {
      await patch(user, { name: 'Forbidden' }).expect(status);
      await archive(user).expect(status);
      expect(txBoards.save).not.toHaveBeenCalled();
    },
  );

  it('returns 404 for owner operations on an absent board', async () => {
    await patch(OWNER, { name: 'Missing' }, MISSING).expect(404);
    await archive(OWNER, MISSING).expect(404);
  });

  it('archives with 200 and an ISO timestamp; blocks repetition/update but retains read access', async () => {
    const response = await archive(OWNER).expect(200);
    expect(response.body).toMatchObject({
      success: true,
      statusCode: 200,
      message: 'Board archived',
      data: { isArchived: true },
    });
    const archivedAt = response.body.data.archivedAt;
    expect(new Date(archivedAt).toISOString()).toBe(archivedAt);
    await archive(OWNER)
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('BOARD_ARCHIVED'));
    await patch(OWNER, { name: 'No' }).expect(409);
    await get(`/api/boards/${BOARD_ID}`, MEMBER).expect(200);
    expect(txBoards.save).toHaveBeenCalledTimes(1);
  });

  it.each([
    '?page=0',
    '?limit=101',
    '?limit=no',
    '?page=1.2',
    '?search=board',
    '?isArchived=true',
    '?page=9007199254740991&limit=100',
  ])('rejects pagination or out-of-scope query %s', async (query) => {
    await get(`/api/boards${query}`).expect(400);
    expect(boards.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('wraps list data and pagination meta without serializing relations', async () => {
    const builder = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      clone: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([
        [
          Object.assign(board, {
            members: [{ role: BoardMemberRole.MEMBER }],
          }),
        ],
        3,
      ]),
      expressionMap: {
        mainAlias: {
          name: 'board',
          metadata: {
            findColumnWithPropertyPath: () => ({ propertyPath: 'createdAt' }),
            primaryColumns: [{ propertyPath: 'id' }],
          },
        },
      },
    };
    boards.createQueryBuilder.mockReturnValue(builder);
    const response = await get('/api/boards?page=2&limit=1', MEMBER).expect(
      200,
    );
    expect(response.body).toMatchObject({
      success: true,
      statusCode: 200,
      meta: { page: 2, limit: 1, total: 3, totalPages: 3 },
    });
    expect(response.body.data[0].currentUserRole).toBe('MEMBER');
    expect(Object.keys(response.body.data[0]).sort()).toEqual(
      [...PUBLIC_FIELDS].sort(),
    );
  });

  it('documents the five exact routes, bearer auth, UUID params and envelopes', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    expect(Object.keys(document.paths).sort()).toEqual([
      '/api/boards',
      '/api/boards/{boardId}',
      '/api/boards/{boardId}/archive',
    ]);
    const operations = [
      document.paths['/api/boards'].get!,
      document.paths['/api/boards'].post!,
      document.paths['/api/boards/{boardId}'].get!,
      document.paths['/api/boards/{boardId}'].patch!,
      document.paths['/api/boards/{boardId}/archive'].post!,
    ];
    for (const operation of operations) {
      expect(operation.security).toEqual([{ bearer: [] }]);
      expect(operation.responses['401']).toBeDefined();
    }
    expect(document.paths['/api/boards'].post!.responses['201']).toBeDefined();
    expect(
      document.paths['/api/boards/{boardId}/archive'].post!.responses['200'],
    ).toBeDefined();
    expect(document.paths['/api/boards/{boardId}'].get!.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'boardId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        }),
      ]),
    );
    const schemas = document.components!.schemas!;
    expect(schemas.BoardResponseDto).toMatchObject({
      properties: Object.fromEntries(
        PUBLIC_FIELDS.map((field) => [field, expect.any(Object)]),
      ),
    });
    expect(schemas.CreateBoardDto).toMatchObject({
      required: ['name'],
      properties: { description: { nullable: true } },
    });
    expect(
      JSON.stringify(document.paths['/api/boards'].get!.responses['200']),
    ).toContain('PaginationMetaDto');
  });
});
