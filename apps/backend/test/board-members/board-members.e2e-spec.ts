import {
  ClassSerializerInterceptor,
  INestApplication,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { BoardAuthorizationService } from '../../src/api/board-members/board-authorization.service';
import { BoardMembersController } from '../../src/api/board-members/board-members.controller';
import { BoardMembersService } from '../../src/api/board-members/board-members.service';
import { ActivityWriterService } from '../../src/api/activities/activity-writer.service';
import { BoardMember } from '../../src/api/board-members/entities/board-member.entity';
import { Board } from '../../src/api/boards/entities/board.entity';
import { AuthService } from '../../src/api/auth/auth.service';
import { EmailVerificationService } from '../../src/api/auth/email-verification.service';
import { JwtAuthGuard } from '../../src/api/auth/guards/jwt-auth.guard';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '../../src/api/auth/constants/auth.constants';
import { createValidationPipe } from '../../src/config/validation';
import { ApiResponseInterceptor } from '../../src/interceptors/api-response.interceptor';
import { GlobalExceptionFilter } from '../../src/filters/global-exception.filter';
import { BoardMemberRole } from '../../src/common/enums/database-enums';
import { User } from '../../src/api/users/entities/user.entity';
import { RealtimeAccessModule } from '../../src/realtime/realtime-access.module';
import { BoardEventPublisher } from '../../src/realtime/board-event-publisher.service';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: (entity: { name: string }) =>
    Inject(`${entity.name}Repository`),
}));

const OWNER = '1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5';
const MEMBER = '2c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5';
const OUTSIDER = '3c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5';
const BOARD_ID = 'c6ba7134-97ef-4c1b-a342-001a982a7721';

describe('board-members HTTP contract', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let tokens: Record<string, string>;
  const board = Object.assign(new Board(), {
    id: BOARD_ID,
    createdById: OWNER,
    isArchived: false,
  });
  const memberUser = Object.assign(new User(), {
    id: MEMBER,
    email: 'member@example.com',
    displayName: 'Member',
    avatarUrl: null,
    authVersion: 0,
    emailVerifiedAt: new Date(),
    createdAt: new Date('2026-10-13T00:00:00Z'),
    updatedAt: new Date('2026-10-13T00:00:00Z'),
  });
  const newUser = Object.assign(memberUser, {
    id: OUTSIDER,
    email: 'new@example.com',
  });
  const roles = new Map([
    [OWNER, BoardMemberRole.OWNER],
    [MEMBER, BoardMemberRole.MEMBER],
  ]);
  const txMembers = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    count: jest.fn(),
    delete: jest.fn(),
  };
  const txUsers = { findOne: jest.fn() };
  const boards = { manager: { transaction: jest.fn() } };
  const members = { findOne: jest.fn(), createQueryBuilder: jest.fn() };
  const users = { findOne: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        RealtimeAccessModule,
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
      controllers: [BoardMembersController],
      providers: [
        { provide: BoardEventPublisher, useValue: { publish: jest.fn() } },
        BoardMembersService,
        { provide: ActivityWriterService, useValue: { record: jest.fn() } },
        BoardAuthorizationService,
        AuthService,
        { provide: EmailVerificationService, useValue: { send: jest.fn() } },
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
          await jwt.signAsync({ sub: id }),
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
    users.findOne.mockImplementation(
      async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.email === memberUser.email) return memberUser;
        return where.id && [OWNER, MEMBER, OUTSIDER].includes(where.id)
          ? { id: where.id, authVersion: 0, emailVerifiedAt: new Date() }
          : null;
      },
    );
    const findMember = async ({
      where,
    }: {
      where: { boardId: string; userId: string };
    }) =>
      where.boardId === BOARD_ID && roles.has(where.userId)
        ? Object.assign(new BoardMember(), {
            id: `${where.userId}-row`,
            board,
            userId: where.userId,
            role: roles.get(where.userId),
            user: memberUser,
          })
        : null;
    members.findOne.mockImplementation(findMember);
    txMembers.findOne.mockImplementation(findMember);
    txMembers.count.mockResolvedValue(2);
    txMembers.create.mockImplementation((value) =>
      Object.assign(value, {
        id: 'new-row',
        joinedAt: new Date('2026-10-14T00:00:00Z'),
      }),
    );
    txMembers.save.mockImplementation(async (value) => value);
    txMembers.delete.mockResolvedValue({ affected: 1 });
    txUsers.findOne.mockResolvedValue(newUser);
    boards.manager.transaction.mockImplementation(async (callback) =>
      callback({
        getRepository: (entity: unknown) => {
          if (entity === Board)
            return { findOne: jest.fn().mockResolvedValue(board) };
          if (entity === User) return txUsers;
          return txMembers;
        },
      }),
    );
    const memberRows = [
      Object.assign(new BoardMember(), {
        id: 'owner-row',
        userId: OWNER,
        role: BoardMemberRole.OWNER,
        user: memberUser,
        joinedAt: new Date('2026-10-13T00:00:00Z'),
      }),
      Object.assign(new BoardMember(), {
        id: 'member-row',
        userId: MEMBER,
        role: BoardMemberRole.MEMBER,
        user: memberUser,
        joinedAt: new Date('2026-10-14T00:00:00Z'),
      }),
    ];
    const builder = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      clone: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([memberRows, 2]),
      expressionMap: {
        mainAlias: {
          name: 'member',
          metadata: {
            findColumnWithPropertyPath: () => ({ propertyPath: 'joinedAt' }),
            primaryColumns: [{ propertyPath: 'id' }],
          },
        },
      },
    };
    members.createQueryBuilder.mockReturnValue(builder);
  });

  it('lists members for MEMBER and returns a paginated public response', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/boards/${BOARD_ID}/members`)
      .set('Authorization', `Bearer ${tokens[MEMBER]}`)
      .expect(200);
    expect(response.body).toMatchObject({
      success: true,
      meta: { page: 1, limit: 20, total: 2 },
      data: [{ role: 'OWNER' }, { role: 'MEMBER' }],
    });
    expect(response.body.data[0].user).not.toHaveProperty('passwordHash');
  });

  it('allows OWNER to add a registered user and defaults the role to MEMBER', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/boards/${BOARD_ID}/members`)
      .set('Authorization', `Bearer ${tokens[OWNER]}`)
      .send({ email: ' NEW@EXAMPLE.COM ' })
      .expect(201);
    expect(response.body.data.role).toBe('MEMBER');
    expect(txUsers.findOne).toHaveBeenCalledWith({
      where: { email: 'new@example.com' },
    });
  });

  it('rejects MEMBER mutation and non-member reads with the shared policy', async () => {
    await request(app.getHttpServer())
      .post(`/api/boards/${BOARD_ID}/members`)
      .set('Authorization', `Bearer ${tokens[MEMBER]}`)
      .send({ email: memberUser.email })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/boards/${BOARD_ID}/members`)
      .set('Authorization', `Bearer ${tokens[OUTSIDER]}`)
      .expect(404);
  });
});
