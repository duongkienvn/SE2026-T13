import {
  ClassSerializerInterceptor,
  INestApplication,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { Logger } from 'nestjs-pino';
import { AuthService } from '../../src/api/auth/auth.service';
import { EmailVerificationService } from '../../src/api/auth/email-verification.service';
import { ActivityWriterService } from '../../src/api/activities/activity-writer.service';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '../../src/api/auth/constants/auth.constants';
import { JwtAuthGuard } from '../../src/api/auth/guards/jwt-auth.guard';
import { BoardAuthorizationService } from '../../src/api/board-members/board-authorization.service';
import { BoardMember } from '../../src/api/board-members/entities/board-member.entity';
import { Board } from '../../src/api/boards/entities/board.entity';
import { Card } from '../../src/api/cards/entities/card.entity';
import { Comment } from '../../src/api/comments/entities/comment.entity';
import { CommentsController } from '../../src/api/comments/comments.controller';
import { CommentsService } from '../../src/api/comments/comments.service';
import { BoardEventPublisher } from '../../src/realtime/board-event-publisher.service';
import { createValidationPipe } from '../../src/config/validation';
import { GlobalExceptionFilter } from '../../src/filters/global-exception.filter';
import { ApiResponseInterceptor } from '../../src/interceptors/api-response.interceptor';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: (entity: { name: string }) =>
    Inject(`${entity.name}Repository`),
}));

const ID = {
  owner: '1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5',
  member: '2c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5',
  outsider: '3c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5',
  board: 'c6ba7134-97ef-4c1b-a342-001a982a7721',
  card: 'a6ba7134-97ef-4c1b-a342-001a982a7721',
  comment: 'b6ba7134-97ef-4c1b-a342-001a982a7721',
  createdComment: 'd6ba7134-97ef-4c1b-a342-001a982a7721',
};

describe('Comments HTTP API with real JWT, validation and envelopes', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let tokens: Record<string, string>;
  let archivedCard = false;
  const comments = new Map<string, Comment>();
  const cards = {
    findOne: jest.fn(async ({ where }: { where: Partial<Card> }) =>
      where.id === ID.card && where.boardId === ID.board
        ? Object.assign(new Card(), {
            id: ID.card,
            boardId: ID.board,
            isArchived: archivedCard,
          })
        : null,
    ),
    create: jest.fn(),
    save: jest.fn(),
  };
  const commentRepository = {
    findOne: jest.fn(async ({ where }: { where: Partial<Comment> }) => {
      const row = comments.get(where.id ?? '');
      return row && row.cardId === where.cardId && !row.deletedAt ? row : null;
    }),
    create: jest.fn((input: Partial<Comment>) =>
      Object.assign(new Comment(), {
        id: ID.createdComment,
        createdAt: new Date('2026-10-16T00:00:00Z'),
        updatedAt: new Date('2026-10-16T00:00:00Z'),
        deletedAt: null,
        ...input,
      }),
    ),
    save: jest.fn(async (row: Comment) => {
      comments.set(row.id, row);
      return row;
    }),
    softRemove: jest.fn(async (row: Comment) => {
      row.deletedAt = new Date('2026-10-16T01:00:00Z');
      comments.set(row.id, row);
      return row;
    }),
    createQueryBuilder: jest.fn(() => {
      const builder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn(async () => {
          const active = [...comments.values()].filter(
            (comment) => comment.cardId === ID.card && !comment.deletedAt,
          );
          return [active, active.length];
        }),
      };
      return builder;
    }),
  };
  const members = {
    findOne: jest.fn(
      async ({ where }: { where: { boardId: string; userId: string } }) =>
        where.boardId === ID.board &&
        [ID.owner, ID.member].includes(where.userId)
          ? Object.assign(new BoardMember(), {
              boardId: ID.board,
              userId: where.userId,
              role: where.userId === ID.owner ? 'OWNER' : 'MEMBER',
              board: Object.assign(new Board(), {
                id: ID.board,
                isArchived: false,
              }),
            })
          : null,
    ),
  };
  const txBoards = {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
      where.id === ID.board
        ? Object.assign(new Board(), { id: ID.board, isArchived: false })
        : null,
    ),
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) =>
      entity === Board
        ? txBoards
        : entity === BoardMember
          ? members
          : entity === Card
            ? cards
            : commentRepository,
    ),
  };
  const boards = {
    manager: {
      transaction: jest.fn(async (callback) => callback(manager)),
    },
  };
  const users = {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
      [ID.owner, ID.member, ID.outsider].includes(where.id)
        ? { id: where.id, authVersion: 0, emailVerifiedAt: new Date() }
        : null,
    ),
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
      controllers: [CommentsController],
      providers: [
        CommentsService,
        { provide: BoardEventPublisher, useValue: { publish: jest.fn() } },
        { provide: ActivityWriterService, useValue: { record: jest.fn() } },
        BoardAuthorizationService,
        AuthService,
        { provide: EmailVerificationService, useValue: { send: jest.fn() } },
        JwtAuthGuard,
        { provide: 'CommentRepository', useValue: commentRepository },
        { provide: 'CardRepository', useValue: cards },
        { provide: 'BoardRepository', useValue: boards },
        { provide: 'BoardMemberRepository', useValue: members },
        { provide: 'UserRepository', useValue: users },
      ],
    }).compile();
    jwt = module.get(JwtService);
    tokens = Object.fromEntries(
      await Promise.all(
        [ID.owner, ID.member, ID.outsider].map(async (id) => [
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
    archivedCard = false;
    comments.clear();
    comments.set(
      ID.comment,
      Object.assign(new Comment(), {
        id: ID.comment,
        cardId: ID.card,
        authorId: ID.owner,
        content: 'Original',
        createdAt: new Date('2026-10-16T00:00:00Z'),
        updatedAt: new Date('2026-10-16T00:00:00Z'),
        deletedAt: null,
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const url = `/api/boards/${ID.board}/cards/${ID.card}/comments`;
  const auth = (user: string) => ({ Authorization: `Bearer ${tokens[user]}` });

  it('requires JWT and returns the documented list envelope', async () => {
    await request(app.getHttpServer()).get(url).expect(401);
    const response = await request(app.getHttpServer())
      .get(`${url}?page=1&limit=20`)
      .set(auth(ID.member))
      .expect(200);
    expect(response.body).toMatchObject({
      success: true,
      statusCode: 200,
      data: [expect.objectContaining({ id: ID.comment, authorId: ID.owner })],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    expect(response.body.data[0]).not.toHaveProperty('deletedAt');
  });

  it('creates, rejects controlled fields, enforces author-only edit, and soft-deletes with 204', async () => {
    const created = await request(app.getHttpServer())
      .post(url)
      .set(auth(ID.member))
      .send({ content: ' New comment ', authorId: ID.owner })
      .expect(400);
    expect(created.body.code).toBe('VALIDATION_FAILED');

    const response = await request(app.getHttpServer())
      .post(url)
      .set(auth(ID.member))
      .send({ content: ' New comment ' })
      .expect(201);
    expect(response.body.data).toMatchObject({
      cardId: ID.card,
      authorId: ID.member,
      content: 'New comment',
    });

    await request(app.getHttpServer())
      .patch(`${url}/${ID.comment}`)
      .set(auth(ID.member))
      .send({ content: 'Denied' })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`${url}/${ID.comment}`)
      .set(auth(ID.owner))
      .expect(204)
      .expect((res) => expect(res.text).toBe(''));
    expect(comments.get(ID.comment)?.deletedAt).not.toBeNull();
    await request(app.getHttpServer())
      .get(url)
      .set(auth(ID.owner))
      .expect(200)
      .expect((res) => expect(res.body.data).toHaveLength(1));
  });

  it('keeps archived cards readable and rejects their mutations', async () => {
    archivedCard = true;
    await request(app.getHttpServer()).get(url).set(auth(ID.owner)).expect(200);
    await request(app.getHttpServer())
      .post(url)
      .set(auth(ID.owner))
      .send({ content: 'No' })
      .expect(409);
  });
});
