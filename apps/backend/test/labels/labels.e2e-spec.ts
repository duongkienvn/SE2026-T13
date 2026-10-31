import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { randomBytes } from 'node:crypto';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { AuthService } from '../../src/api/auth/auth.service';
import { JwtAuthGuard } from '../../src/api/auth/guards/jwt-auth.guard';
import { Board } from '../../src/api/boards/entities/board.entity';
import { Card } from '../../src/api/cards/entities/card.entity';
import {
  BoardLabelsController,
  CardLabelsController,
} from '../../src/api/labels/labels.controller';
import { LabelsService } from '../../src/api/labels/labels.service';
import { createValidationPipe } from '../../src/config/validation';
import { ApplicationException } from '../../src/exceptions/application.exception';
import { GlobalExceptionFilter } from '../../src/filters/global-exception.filter';
import { ApiResponseInterceptor } from '../../src/interceptors/api-response.interceptor';
import { labelsHarness, ID } from './labels.fixture';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
const base = `/api/boards/${ID.board}/labels`;
const cardBase = `/api/boards/${ID.board}/cards/${ID.card}/labels`;
describe('Board label HTTP contracts', () => {
  let app: INestApplication,
    h: ReturnType<typeof labelsHarness>,
    jwt: JwtService;
  const http = (userId = ID.owner) => {
    const bearer = { Authorization: `Bearer ${jwt.sign({ sub: userId })}` };
    return {
      get: (url: string) => request(app.getHttpServer()).get(url).set(bearer),
      post: (url: string) => request(app.getHttpServer()).post(url).set(bearer),
      patch: (url: string) =>
        request(app.getHttpServer()).patch(url).set(bearer),
      delete: (url: string) =>
        request(app.getHttpServer()).delete(url).set(bearer),
    };
  };
  beforeEach(async () => {
    h = labelsHarness();
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: randomBytes(32).toString('hex'),
          signOptions: { expiresIn: 60 },
        }),
      ],
      controllers: [BoardLabelsController, CardLabelsController],
      providers: [
        JwtAuthGuard,
        { provide: LabelsService, useValue: h.service },
        {
          provide: AuthService,
          useValue: {
            authenticateAccessToken: async (token: string) => {
              try {
                const payload = await jwt.verifyAsync<{ sub: string }>(token);
                return { userId: payload.sub };
              } catch {
                throw new ApplicationException(
                  401,
                  'UNAUTHORIZED',
                  'Unauthorized',
                );
              }
            },
          },
        },
      ],
    }).compile();
    jwt = module.get(JwtService);
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalInterceptors(new ApiResponseInterceptor(new Reflector()));
    app.useGlobalFilters(
      new GlobalExceptionFilter({ error: jest.fn() } as unknown as Logger),
    );
    await app.listen(0, '127.0.0.1');
  });
  afterEach(async () => {
    await app.close();
  });

  it('creates, pages, updates, assigns multiple labels, unassigns and deletes with current metadata', async () => {
    const bug = (
      await http()
        .post(base)
        .send({ name: ' Bug ', color: ' #aBcDeF ' })
        .expect(201)
    ).body.data;
    const docs = (
      await http(ID.member)
        .post(base)
        .send({ name: 'Docs', color: '#ABCDEF' })
        .expect(201)
    ).body.data;
    expect(bug).toMatchObject({ name: 'Bug', color: '#ABCDEF' });
    await http().post(base).send({ name: 'bug', color: '#111111' }).expect(409);
    await http().patch(`${base}/${docs.id}`).send({ name: 'BUG' }).expect(409);
    const assigned = await http(ID.guest)
      .post(cardBase)
      .send({ labelId: bug.id })
      .expect(201);
    expect(assigned.body).toMatchObject({
      success: true,
      statusCode: 201,
      data: { cardId: ID.card, labels: [{ id: bug.id }] },
    });
    await http().post(cardBase).send({ labelId: docs.id }).expect(201);
    await http().post(cardBase).send({ labelId: bug.id }).expect(409);
    await http()
      .patch(`${base}/${bug.id}`)
      .send({ name: 'Issue', color: '#ffffff' })
      .expect(200);
    const current = await http().get(cardBase).expect(200);
    expect(current.headers['cache-control']).toBe('no-store');
    expect(
      current.body.data.labels.map((row: { name: string }) => row.name),
    ).toEqual(['Docs', 'Issue']);
    expect(current.body.data.labels[1].color).toBe('#FFFFFF');
    const paged = await http().get(`${base}?page=2&limit=1`).expect(200);
    expect(paged.body.meta).toMatchObject({ total: 2, totalPages: 2, page: 2 });
    await http().delete(`${cardBase}/${docs.id}`).expect(204);
    await http().delete(`${cardBase}/${docs.id}`).expect(404);
    await http().delete(`${base}/${bug.id}`).expect(204);
    expect((await http().get(cardBase).expect(200)).body.data.labels).toEqual(
      [],
    );
    expect((await http().get(base).expect(200)).body.data).toHaveLength(1);
  });

  it('enforces Board guest and Workspace read-only/private access, and foreign resources', async () => {
    const label = (
      await http()
        .post(base)
        .send({ name: 'Bug', color: '#111111' })
        .expect(201)
    ).body.data;
    for (const actor of [ID.viewer, ID.admin, ID.outsider])
      await http(actor).get(base).expect(404);
    await http(ID.guest).get(base).expect(200);
    h.store(Board).get(ID.board)!.visibility = 'WORKSPACE_VISIBLE';
    for (const actor of [ID.viewer, ID.admin]) {
      await http(actor).get(base).expect(200);
      await http(actor).get(cardBase).expect(200);
      await http(actor)
        .post(base)
        .send({ name: 'No', color: '#111111' })
        .expect(404);
      await http(actor).post(cardBase).send({ labelId: label.id }).expect(404);
      await http(actor).delete(`${base}/${label.id}`).expect(404);
    }
    await http(ID.outsider).get(base).expect(404);
    await http().get(cardBase.replace(ID.card, ID.foreignCard)).expect(404);
    await http().post(cardBase).send({ labelId: ID.foreignCard }).expect(404);
    await http()
      .patch(`${base}/${ID.foreignCard}`)
      .send({ name: 'No' })
      .expect(404);
  });

  it('preserves archived Card reads, rejects association edits, permits catalog edits, and blocks archived Board writes', async () => {
    const label = (
      await http()
        .post(base)
        .send({ name: 'Bug', color: '#111111' })
        .expect(201)
    ).body.data;
    await http().post(cardBase).send({ labelId: label.id }).expect(201);
    h.store(Card).get(ID.card)!.isArchived = true;
    await http().get(cardBase).expect(200);
    await http().post(cardBase).send({ labelId: label.id }).expect(409);
    await http().delete(`${cardBase}/${label.id}`).expect(409);
    await http()
      .patch(`${base}/${label.id}`)
      .send({ name: 'Catalog edit' })
      .expect(200);
    h.store(Board).get(ID.board)!.isArchived = true;
    await http().get(base).expect(200);
    await http().get(cardBase).expect(200);
    for (const call of [
      http().post(base).send({ name: 'No', color: '#111111' }),
      http().patch(`${base}/${label.id}`).send({ color: '#FFFFFF' }),
      http().delete(`${base}/${label.id}`),
      http().post(cardBase).send({ labelId: label.id }),
      http().delete(`${cardBase}/${label.id}`),
    ])
      expect((await call.expect(409)).body.code).toBe('BOARD_ARCHIVED');
  });

  it('rejects invalid JWT/UUID/pagination, empty PATCH, nulls, malformed colors and unknown owner/position fields', async () => {
    await request(app.getHttpServer()).get(base).expect(401);
    await request(app.getHttpServer())
      .get(base)
      .set('Authorization', 'Bearer forged')
      .expect(401);
    const label = (
      await http()
        .post(base)
        .send({ name: 'Bug', color: '#111111' })
        .expect(201)
    ).body.data;
    for (const body of [
      {},
      { name: null },
      { name: ' ' },
      { name: 'x'.repeat(121) },
      { color: null },
      { color: 'red' },
      { color: '#FFF' },
      { color: '#11223344' },
      { color: '#GGHHII' },
      { name: 'OK', color: '#112233', boardId: ID.foreignBoard },
      { position: '100' },
    ])
      await http().patch(`${base}/${label.id}`).send(body).expect(400);
    for (const body of [
      {},
      { labelId: null },
      { labelId: 'bad' },
      { labelId: label.id, boardId: ID.foreignBoard },
      { labelId: label.id, cardId: ID.secondCard },
    ])
      await http().post(cardBase).send(body).expect(400);
    for (const query of [
      'page=0',
      'limit=101',
      'page=9007199254740991&limit=100',
      'search=x',
    ])
      await http().get(`${base}?${query}`).expect(400);
    await http().get(`${cardBase}?search=x`).expect(400);
    await http().get(base.replace(ID.board, 'bad')).expect(400);
    await http().delete(`${cardBase}/bad`).expect(400);
  });

  it('allowlists nested labels, suppresses effective no-ops, and documents all seven routes', async () => {
    const label = (
      await http()
        .post(base)
        .send({ name: 'Bug', color: '#111111' })
        .expect(201)
    ).body.data;
    Object.assign(h.labels.get(label.id)!, {
      passwordHash: 'secret',
      board: { private: 'secret' },
    });
    await http().post(cardBase).send({ labelId: label.id }).expect(201);
    expect(
      JSON.stringify((await http().get(cardBase).expect(200)).body),
    ).not.toMatch(/secret|passwordHash/);
    h.events.publish.mockClear();
    await http()
      .patch(`${base}/${label.id}`)
      .send({ name: ' Bug ', color: ' #111111 ' })
      .expect(200);
    expect(h.events.publish).not.toHaveBeenCalled();
    const swagger = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    const paths = Object.entries(swagger.paths).filter(([path]) =>
      path.includes('/labels'),
    );
    expect(
      paths.reduce((count, [, path]) => count + Object.keys(path).length, 0),
    ).toBe(7);
    expect(swagger.components!.schemas!.CardLabelsResponseDto).toHaveProperty(
      'properties.labels',
    );
    expect(swagger.components!.schemas!.LabelResponseDto).not.toHaveProperty(
      'properties.nameKey',
    );
  });
});
