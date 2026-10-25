import {
  ClassSerializerInterceptor,
  INestApplication,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { randomBytes, randomUUID } from 'node:crypto';
import { Logger } from 'nestjs-pino';
import { QueryFailedError } from 'typeorm';
import request from 'supertest';
import { AuthService } from '../../src/api/auth/auth.service';
import { EmailVerificationService } from '../../src/api/auth/email-verification.service';
import { ActivityWriterService } from '../../src/api/activities/activity-writer.service';
import { JwtAuthGuard } from '../../src/api/auth/guards/jwt-auth.guard';
import {
  JWT_ISSUER,
  JWT_AUDIENCE,
} from '../../src/api/auth/constants/auth.constants';
import { BoardAuthorizationService } from '../../src/api/board-members/board-authorization.service';
import { BoardMember } from '../../src/api/board-members/entities/board-member.entity';
import { Board } from '../../src/api/boards/entities/board.entity';
import { BoardColumn } from '../../src/api/columns/entities/board-column.entity';
import { Card } from '../../src/api/cards/entities/card.entity';
import { CardAssignee } from '../../src/api/cards/entities/card-assignee.entity';
import { CardsController } from '../../src/api/cards/cards.controller';
import { CardsService } from '../../src/api/cards/cards.service';
import { BoardEventPublisher } from '../../src/realtime/board-event-publisher.service';
import { createValidationPipe } from '../../src/config/validation';
import { GlobalExceptionFilter } from '../../src/filters/global-exception.filter';
import { ApiResponseInterceptor } from '../../src/interceptors/api-response.interceptor';
import { cardsHarness, cardFixture, CARD_IDS as ID } from './cards.fixture';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: (entity: { name: string }) =>
    Inject(`${entity.name}Repository`),
}));
const OUTSIDER = '3c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5';
const FOREIGN_BOARD = 'f6ba7134-97ef-4c1b-a342-001a982a7721';
const FOREIGN_COLUMN = 'b6ba7134-97ef-4c1b-a342-001a982a7721';
const FOREIGN_CARD = 'b7ba7134-97ef-4c1b-a342-001a982a7721';
const base = `/api/boards/${ID.board}/cards`;

describe('Card HTTP API with real JWT, authorization, services and envelopes', () => {
  let app: INestApplication;
  let h: ReturnType<typeof cardsHarness>;
  let token: Record<string, string>;
  let archivedBoard: boolean;
  let rows: Map<string, Card>;
  let assignments: Map<string, CardAssignee>;

  beforeEach(async () => {
    h = cardsHarness();
    archivedBoard = false;
    rows = new Map([
      [ID.card, cardFixture({ description: 'keep' })],
      [
        FOREIGN_CARD,
        cardFixture({
          id: FOREIGN_CARD,
          boardId: FOREIGN_BOARD,
          columnId: FOREIGN_COLUMN,
        }),
      ],
    ]);
    assignments = new Map();
    const attach = (card: Card) =>
      Object.assign(card, {
        assignees: [...assignments.values()].filter(
          (a) => a.cardId === card.id,
        ),
      });
    const matches = (row: Card, where: Partial<Card>) =>
      Object.entries(where).every(
        ([key, value]) => row[key as keyof Card] === value,
      );
    h.cards.findOne.mockImplementation(
      async ({ where }: { where: Partial<Card> }) => {
        const card = [...rows.values()]
          .filter((c) => matches(c, where))
          .sort((a, b) => Number(b.position) - Number(a.position))[0];
        return card ? attach(card) : null;
      },
    );
    h.cards.find.mockImplementation(
      async ({ where }: { where: Partial<Card> }) =>
        [...rows.values()]
          .filter((c) => matches(c, where))
          .sort((a, b) => Number(a.position) - Number(b.position)),
    );
    h.cards.create.mockImplementation((input) =>
      cardFixture({ id: randomUUID(), ...input }),
    );
    h.cards.save.mockImplementation(async (input) => {
      for (const card of Array.isArray(input) ? input : [input])
        rows.set(card.id, card);
      return input;
    });
    h.cards.createQueryBuilder.mockImplementation(() => {
      const where: Record<string, unknown> = {};
      const ordering: string[] = [];
      let skip = 0,
        take = 20;
      const builder = {
        leftJoinAndSelect: () => builder,
        where: (_sql: string, params: Record<string, unknown>) => {
          Object.assign(where, params);
          return builder;
        },
        andWhere: (_sql: string, params: Record<string, unknown>) => {
          Object.assign(where, params);
          return builder;
        },
        orderBy: (field: string) => {
          ordering.length = 0;
          ordering.push(field.split('.')[1]);
          return builder;
        },
        addOrderBy: (field: string) => {
          ordering.push(field.split('.')[1]);
          return builder;
        },
        skip: (value: number) => {
          skip = value;
          return builder;
        },
        take: (value: number) => {
          take = value;
          return builder;
        },
        getManyAndCount: async () => {
          const all = [...rows.values()]
            .filter((c) => matches(c, where))
            .sort((a, b) => {
              for (const field of ordering) {
                const result =
                  field === 'position'
                    ? Number(a.position) - Number(b.position)
                    : String(a[field as keyof Card]).localeCompare(
                        String(b[field as keyof Card]),
                      );
                if (result) return result;
              }
              return 0;
            });
          return [all.slice(skip, skip + take).map(attach), all.length];
        },
      };
      return builder;
    });
    h.columns.findOne.mockImplementation(
      async ({ where }: { where: { id: string; boardId: string } }) => {
        if (
          where.boardId === ID.board &&
          [ID.column, ID.secondColumn].includes(where.id)
        )
          return { ...where, id: where.id };
        return where.boardId === FOREIGN_BOARD && where.id === FOREIGN_COLUMN
          ? where
          : null;
      },
    );
    const board = (boardId: string) => ({
      id: boardId,
      createdById: ID.user,
      isArchived: boardId === ID.board && archivedBoard,
    });
    h.members.findOne.mockImplementation(
      async ({ where }: { where: { boardId: string; userId: string } }) => {
        const allowed =
          where.boardId === ID.board
            ? [ID.user, ID.target]
            : where.boardId === FOREIGN_BOARD
              ? [ID.user, OUTSIDER]
              : [];
        return allowed.includes(where.userId)
          ? Object.assign(new BoardMember(), {
              ...where,
              board: board(where.boardId),
              role: where.userId === ID.user ? 'OWNER' : 'MEMBER',
            })
          : null;
      },
    );
    h.assignees.findOne.mockImplementation(
      async ({ where }: { where: { cardId: string; userId: string } }) =>
        assignments.get(`${where.cardId}:${where.userId}`) ?? null,
    );
    h.assignees.save.mockImplementation(async (row) => {
      assignments.set(`${row.cardId}:${row.userId}`, row);
      return row;
    });
    h.assignees.delete.mockImplementation(
      async (where: { cardId: string; userId: string }) => ({
        affected: assignments.delete(`${where.cardId}:${where.userId}`) ? 1 : 0,
      }),
    );
    const boards = {
      ...h.boards,
      findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
        [ID.board, FOREIGN_BOARD].includes(where.id) ? board(where.id) : null,
      ),
    };
    h.manager.getRepository.mockImplementation((entity) =>
      entity === Board
        ? boards
        : entity === Card
          ? h.cards
          : entity === BoardColumn
            ? h.columns
            : entity === BoardMember
              ? h.members
              : h.assignees,
    );
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
      controllers: [CardsController],
      providers: [
        { provide: BoardEventPublisher, useValue: h.events },
        CardsService,
        { provide: ActivityWriterService, useValue: { record: jest.fn() } },
        AuthService,
        { provide: EmailVerificationService, useValue: { send: jest.fn() } },
        JwtAuthGuard,
        BoardAuthorizationService,
        { provide: 'CardRepository', useValue: h.cards },
        { provide: 'BoardRepository', useValue: boards },
        { provide: 'BoardColumnRepository', useValue: h.columns },
        { provide: 'BoardMemberRepository', useValue: h.members },
        {
          provide: 'UserRepository',
          useValue: {
            findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
              [ID.user, ID.target, OUTSIDER].includes(where.id)
                ? { id: where.id, authVersion: 0, emailVerifiedAt: new Date() }
                : null,
            ),
          },
        },
      ],
    }).compile();
    const jwt = module.get(JwtService);
    token = Object.fromEntries(
      await Promise.all(
        [ID.user, ID.target, OUTSIDER].map(async (id) => [
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
    await app.listen(0, '127.0.0.1');
  });
  afterEach(async () => {
    await app?.close();
  });
  const http = (actor = ID.user) => ({
    get: (path: string) =>
      request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${token[actor]}`),
    post: (path: string) =>
      request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${token[actor]}`),
    patch: (path: string) =>
      request(app.getHttpServer())
        .patch(path)
        .set('Authorization', `Bearer ${token[actor]}`),
    delete: (path: string) =>
      request(app.getHttpServer())
        .delete(path)
        .set('Authorization', `Bearer ${token[actor]}`),
  });

  it.each([ID.user, ID.target])(
    'supports all eight endpoints for OWNER/MEMBER %s',
    async (actor) => {
      const api = http(actor);
      const created = await api
        .post(base)
        .send({
          columnId: ID.column,
          title: ' New ',
          dueDate: '2000-01-01T07:00:00+07:00',
        })
        .expect(201);
      const id = created.body.data.id;
      expect(created.body).toMatchObject({
        success: true,
        statusCode: 201,
        data: {
          title: 'New',
          createdById: actor,
          position: '200.0000000000',
          dueDate: '2000-01-01T00:00:00.000Z',
        },
      });
      const listed = await api
        .get(`${base}?page=2&limit=1&columnId=${ID.column}`)
        .expect(200);
      expect(listed.body.meta).toMatchObject({ total: 2, page: 2, limit: 1 });
      expect(listed.body.data[0].id).toBe(id);
      await api.get(`${base}/${id}`).expect(200);
      const updated = await api
        .patch(`${base}/${id}`)
        .send({ description: null, dueDate: null })
        .expect(200);
      expect(updated.body.data).toMatchObject({
        title: 'New',
        dueDate: null,
        description: null,
      });
      await api
        .patch(`${base}/${id}/move`)
        .send({ toColumnId: ID.secondColumn, beforeCardId: null })
        .expect(200);
      const assigned = await api
        .post(`${base}/${id}/assignees`)
        .send({ userId: ID.target })
        .expect(201);
      expect(assigned.body.data).toEqual({
        userId: ID.target,
        assignedById: actor,
        createdAt: '2026-10-16T00:00:00.000Z',
      });
      await api
        .post(`${base}/${id}/assignees`)
        .send({ userId: ID.target })
        .expect(409);
      expect(
        (await api.delete(`${base}/${id}/assignees/${ID.target}`).expect(204))
          .text,
      ).toBe('');
      await api.delete(`${base}/${id}/assignees/${ID.target}`).expect(404);
      await api
        .post(`${base}/${id}/assignees`)
        .send({ userId: ID.target })
        .expect(201);
      const archived = await api.post(`${base}/${id}/archive`).expect(200);
      expect(archived.body.data).toMatchObject({
        isArchived: true,
        assignees: [{ userId: ID.target }],
      });
      expect(
        (await api.get(`${base}/${id}`).expect(200)).body.data.isArchived,
      ).toBe(true);
      expect(
        (await api.get(base).expect(200)).body.data.map(
          (row: { id: string }) => row.id,
        ),
      ).not.toContain(id);
      await api.patch(`${base}/${id}`).send({ title: 'Denied' }).expect(409);
      await api.post(`${base}/${id}/archive`).expect(409);
      await api
        .patch(`${base}/${id}/move`)
        .send({ toColumnId: ID.column, beforeCardId: null })
        .expect(409);
      await api
        .post(`${base}/${id}/assignees`)
        .send({ userId: actor })
        .expect(409);
      await api.delete(`${base}/${id}/assignees/${ID.target}`).expect(409);
    },
  );

  it('rejects nonmembers, cross-board resources and invalid anchors without disclosure', async () => {
    await http(OUTSIDER).get(base).expect(404);
    await http(OUTSIDER)
      .post(base)
      .send({ columnId: ID.column, title: 'No' })
      .expect(404);
    await http(OUTSIDER).get(`${base}/${ID.card}`).expect(404);
    await http().get(`${base}/${FOREIGN_CARD}`).expect(404);
    await http().get(`${base}?columnId=${FOREIGN_COLUMN}`).expect(404);
    await http()
      .post(base)
      .send({ columnId: FOREIGN_COLUMN, title: 'No' })
      .expect(404);
    await http()
      .patch(`${base}/${ID.card}/move`)
      .send({ toColumnId: FOREIGN_COLUMN, beforeCardId: null })
      .expect(404);
    await http()
      .patch(`${base}/${ID.card}/move`)
      .send({ toColumnId: ID.column, beforeCardId: FOREIGN_CARD })
      .expect(404);
    await http()
      .patch(`${base}/${ID.card}/move`)
      .send({ toColumnId: ID.column, beforeCardId: ID.card.toUpperCase() })
      .expect(400);
    await http()
      .post(`${base}/${ID.card}/assignees`)
      .send({ userId: OUTSIDER })
      .expect(404);
  });

  it('allows archived-board reads but denies all mutations', async () => {
    archivedBoard = true;
    await http().get(base).expect(200);
    await http().get(`${base}/${ID.card}`).expect(200);
    const calls = [
      http().post(base).send({ columnId: ID.column, title: 'No' }),
      http().patch(`${base}/${ID.card}`).send({ title: 'No' }),
      http().post(`${base}/${ID.card}/archive`),
      http()
        .patch(`${base}/${ID.card}/move`)
        .send({ toColumnId: ID.column, beforeCardId: null }),
      http().post(`${base}/${ID.card}/assignees`).send({ userId: ID.target }),
      http().delete(`${base}/${ID.card}/assignees/${ID.target}`),
    ];
    for (const call of calls)
      expect((await call.expect(409)).body.code).toBe('BOARD_ARCHIVED');
  });

  it('rejects missing/forged JWT, malformed input, empty PATCH and unknown fields', async () => {
    await request(app.getHttpServer()).get(base).expect(401);
    await request(app.getHttpServer())
      .get(base)
      .set('Authorization', 'Bearer forged')
      .expect(401);
    for (const value of [
      {},
      { title: null },
      { position: '1' },
      { description: 'x'.repeat(2001) },
      { dueDate: '2026-10-16' },
    ])
      await http().patch(`${base}/${ID.card}`).send(value).expect(400);
    await http()
      .post(base)
      .send({ columnId: ID.column, title: 'No', createdById: OUTSIDER })
      .expect(400);
    await http()
      .patch(`${base}/${ID.card}/move`)
      .send({ toColumnId: ID.column })
      .expect(400);
    for (const query of [
      'page=0',
      'limit=101',
      'page=9007199254740991&limit=100',
      'columnId=bad',
      'search=x',
    ])
      await http().get(`${base}?${query}`).expect(400);
    await http().get(`${base}/bad`).expect(400);
    await http().delete(`${base}/${ID.card}/assignees/bad`).expect(400);
    expect(h.cards.save).not.toHaveBeenCalled();
  });

  it('sanitizes database FK/UNIQUE errors and excludes ORM secrets', async () => {
    for (const code of ['23505', '23503']) {
      h.assignees.save.mockRejectedValueOnce(
        new QueryFailedError(
          'secret SQL',
          ['secret'],
          Object.assign(new Error('secret constraint'), { code }),
        ),
      );
      const response = await http()
        .post(`${base}/${ID.card}/assignees`)
        .send({ userId: ID.target })
        .expect(409);
      expect(JSON.stringify(response.body)).not.toMatch(
        /secret|SQL|constraint_name/,
      );
    }
    Object.assign(rows.get(ID.card)!, {
      createdBy: { passwordHash: 'secret' },
      comments: [{ content: 'private' }],
    });
    const response = await http().get(`${base}/${ID.card}`).expect(200);
    expect(response.body.data).not.toHaveProperty('comments');
    expect(JSON.stringify(response.body)).not.toMatch(
      /passwordHash|secret|private/,
    );
  });

  it('documents all routes, statuses and nested DTOs in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    const routes = document.paths;
    expect(routes['/api/boards/{boardId}/cards'].get!.responses).toHaveProperty(
      '200',
    );
    expect(
      routes['/api/boards/{boardId}/cards'].post!.responses,
    ).toHaveProperty('201');
    for (const suffix of [
      '',
      '/archive',
      '/move',
      '/assignees',
      '/assignees/{userId}',
    ])
      expect(routes).toHaveProperty(
        `/api/boards/{boardId}/cards/{cardId}${suffix}`,
      );
    expect(
      routes['/api/boards/{boardId}/cards/{cardId}/assignees/{userId}'].delete!
        .responses,
    ).toHaveProperty('204');
    expect(document.components!.schemas!.CardResponseDto).toHaveProperty(
      'properties.assignees',
    );
    expect(document.components!.schemas!.MoveCardDto).toMatchObject({
      required: ['toColumnId', 'beforeCardId'],
    });
  });
});
