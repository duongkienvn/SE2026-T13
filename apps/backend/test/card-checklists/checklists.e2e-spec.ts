import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { randomBytes } from 'node:crypto';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { QueryFailedError } from 'typeorm';
import { AuthService } from '../../src/api/auth/auth.service';
import { JwtAuthGuard } from '../../src/api/auth/guards/jwt-auth.guard';
import { Board } from '../../src/api/boards/entities/board.entity';
import { Card } from '../../src/api/cards/entities/card.entity';
import { CardChecklistItem } from '../../src/api/cards/entities/card-checklist-item.entity';
import { CardChecklistsController } from '../../src/api/cards/card-checklists.controller';
import { CardChecklistsService } from '../../src/api/cards/card-checklists.service';
import { createValidationPipe } from '../../src/config/validation';
import { ApplicationException } from '../../src/exceptions/application.exception';
import { GlobalExceptionFilter } from '../../src/filters/global-exception.filter';
import { ApiResponseInterceptor } from '../../src/interceptors/api-response.interceptor';
import { checklistHarness, ID } from './checklists.fixture';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
const base = `/api/boards/${ID.board}/cards/${ID.card}/checklists`;

describe('Checklist HTTP contracts (real controllers, JWT guard, services and Board authorization)', () => {
  let app: INestApplication,
    h: ReturnType<typeof checklistHarness>,
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
    h = checklistHarness();
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: randomBytes(32).toString('hex'),
          signOptions: { expiresIn: 60 },
        }),
      ],
      controllers: [CardChecklistsController],
      providers: [
        JwtAuthGuard,
        { provide: CardChecklistsService, useValue: h.service },
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

  it('exercises every route, trimming, nested allowlists, progress and deletion envelopes', async () => {
    const first = (
      await http().post(base).send({ title: '  Release  ' }).expect(201)
    ).body.data;
    const second = (
      await http(ID.member).post(base).send({ title: 'Second' }).expect(201)
    ).body.data;
    expect(first).toMatchObject({
      title: 'Release',
      checkedItems: 0,
      totalItems: 0,
      completionPercentage: 0,
    });
    await http()
      .patch(`${base}/${second.id}`)
      .send({ title: 'Renamed' })
      .expect(200);
    await http()
      .patch(`${base}/${second.id}/move`)
      .send({ beforeChecklistId: first.id })
      .expect(200);
    const a = (
      await http(ID.guest)
        .post(`${base}/${first.id}/items`)
        .send({ text: '  Ship  ' })
        .expect(201)
    ).body.data.items[0];
    const b = (
      await http()
        .post(`${base}/${first.id}/items`)
        .send({ text: 'Verify' })
        .expect(201)
    ).body.data.items[1];
    const checked = (
      await http()
        .patch(`${base}/${first.id}/items/${a.id}`)
        .send({ text: 'Shipped', isChecked: true })
        .expect(200)
    ).body.data;
    expect(checked).toMatchObject({
      checkedItems: 1,
      totalItems: 2,
      completionPercentage: 50,
    });
    await http()
      .patch(`${base}/${first.id}/items/${b.id}/move`)
      .send({ beforeItemId: a.id })
      .expect(200);
    const response = await http().get(base).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      success: true,
      statusCode: 200,
      data: { checkedItems: 1, totalItems: 2 },
    });
    expect(
      response.body.data.checklists.map((row: { id: string }) => row.id),
    ).toEqual([second.id, first.id]);
    expect(
      response.body.data.checklists[1].items.map(
        (row: { id: string }) => row.id,
      ),
    ).toEqual([b.id, a.id]);
    expect((await http().get(`${base}/summary`).expect(200)).body.data).toEqual(
      {
        cardId: ID.card,
        checkedItems: 1,
        totalItems: 2,
        completionPercentage: 50,
      },
    );
    expect(
      (await http().delete(`${base}/${first.id}/items/${b.id}`).expect(204))
        .text,
    ).toBe('');
    await http().delete(`${base}/${first.id}`).expect(204);
    await http().delete(`${base}/${first.id}`).expect(404);
    expect(JSON.stringify(response.body)).not.toMatch(
      /password|boardId|createdBy/,
    );
  });

  it('enforces Board guest, Workspace viewer/admin, outsider and private Board boundaries', async () => {
    const first = (
      await http().post(base).send({ title: 'Private' }).expect(201)
    ).body.data;
    await http(ID.outsider).get(base).expect(404);
    await http(ID.admin).get(base).expect(404);
    await http(ID.guest).get(base).expect(200);
    h.store(Board).get(ID.board)!.visibility = 'WORKSPACE_VISIBLE';
    for (const actor of [ID.viewer, ID.admin]) {
      await http(actor).get(base).expect(200);
      await http(actor).get(`${base}/summary`).expect(200);
      await http(actor).post(base).send({ title: 'No' }).expect(404);
      await http(actor).delete(`${base}/${first.id}`).expect(404);
    }
    await http().get(base.replace(ID.card, ID.foreignCard)).expect(404);
    await http()
      .patch(`${base.replace(ID.card, ID.secondCard)}/${first.id}`)
      .send({ title: 'No' })
      .expect(404);
  });

  it.each(['card', 'board'])(
    'allows archived %s reads but blocks all checklist and item commands',
    async (target) => {
      const list = (await http().post(base).send({ title: 'Keep' }).expect(201))
        .body.data;
      const item = (
        await http()
          .post(`${base}/${list.id}/items`)
          .send({ text: 'Keep' })
          .expect(201)
      ).body.data.items[0];
      h
        .store(target === 'card' ? Card : Board)
        .get(target === 'card' ? ID.card : ID.board)!.isArchived = true;
      await http().get(base).expect(200);
      await http().get(`${base}/summary`).expect(200);
      for (const call of [
        http().post(base).send({ title: 'No' }),
        http().patch(`${base}/${list.id}`).send({ title: 'No' }),
        http()
          .patch(`${base}/${list.id}/move`)
          .send({ beforeChecklistId: null }),
        http().delete(`${base}/${list.id}`),
        http().post(`${base}/${list.id}/items`).send({ text: 'No' }),
        http()
          .patch(`${base}/${list.id}/items/${item.id}`)
          .send({ isChecked: true }),
        http()
          .patch(`${base}/${list.id}/items/${item.id}/move`)
          .send({ beforeItemId: null }),
        http().delete(`${base}/${list.id}/items/${item.id}`),
      ])
        expect((await call.expect(409)).body.code).toBe(
          target === 'card' ? 'CARD_ARCHIVED' : 'BOARD_ARCHIVED',
        );
    },
  );

  it('rejects unauthenticated, malformed UUIDs, unsupported fields, nulls, overlong/blank text and invalid moves', async () => {
    await request(app.getHttpServer()).get(base).expect(401);
    await request(app.getHttpServer())
      .get(base)
      .set('Authorization', 'Bearer forged')
      .expect(401);
    const first = (await http().post(base).send({ title: 'Valid' }).expect(201))
      .body.data;
    const item = (
      await http()
        .post(`${base}/${first.id}/items`)
        .send({ text: 'Valid' })
        .expect(201)
    ).body.data.items[0];
    for (const body of [
      {},
      { title: null },
      { title: ' ' },
      { title: 'x'.repeat(121) },
      { title: 'Valid', cardId: ID.secondCard },
      { title: 'Valid', position: '1' },
    ])
      await http().post(base).send(body).expect(400);
    for (const body of [
      {},
      { isChecked: null },
      { isChecked: 'yes' },
      { text: ' ' },
      { text: 'x'.repeat(256) },
      { text: null },
      { text: 'Valid', checklistId: first.id },
    ])
      await http()
        .patch(`${base}/${first.id}/items/${item.id}`)
        .send(body)
        .expect(400);
    for (const body of [
      {},
      { beforeChecklistId: 'bad' },
      { beforeChecklistId: first.id.toUpperCase() },
      { beforeChecklistId: null, position: '1' },
    ])
      await http().patch(`${base}/${first.id}/move`).send(body).expect(400);
    await http()
      .patch(`${base}/${first.id}/move`)
      .send({ beforeChecklistId: ID.foreignCard })
      .expect(404);
    await http()
      .patch(`${base}/${first.id}/items/${item.id}/move`)
      .send({ beforeItemId: item.id.toUpperCase() })
      .expect(400);
    await http().get(`${base}?anything=x`).expect(400);
    await http().get(base.replace(ID.card, 'bad')).expect(400);
    await http().delete(`${base}/${first.id}/items/bad`).expect(400);
    await http()
      .delete(`${base}/${first.id}/items/${ID.foreignCard}`)
      .expect(404);
  });

  it('sanitizes constraint failures and whitelists nested item properties', async () => {
    const first = (await http().post(base).send({ title: 'Valid' }).expect(201))
      .body.data;
    const item = (
      await http()
        .post(`${base}/${first.id}/items`)
        .send({ text: 'Valid' })
        .expect(201)
    ).body.data.items[0];
    h.store(CardChecklistItem).get(item.id)!.passwordHash = 'secret';
    expect(
      JSON.stringify((await http().get(base).expect(200)).body),
    ).not.toMatch(/passwordHash|secret/);
    h.repository(CardChecklistItem).save.mockRejectedValueOnce(
      new QueryFailedError(
        'secret SQL',
        [],
        Object.assign(new Error('secret constraint'), { code: '23505' }),
      ),
    );
    const response = await http()
      .patch(`${base}/${first.id}/items/${item.id}`)
      .send({ isChecked: true })
      .expect(409);
    expect(JSON.stringify(response.body)).not.toMatch(/secret|SQL/);
  });

  it('documents all ten operations, validation, nested DTOs and envelopes in Swagger', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    const paths = Object.entries(document.paths).filter(([path]) =>
      path.includes('/checklists'),
    );
    expect(
      paths.reduce((count, [, path]) => count + Object.keys(path).length, 0),
    ).toBe(10);
    const schemas = document.components!.schemas!;
    expect(schemas.CardChecklistsResponseDto).toHaveProperty(
      'properties.checklists',
    );
    expect(schemas.ChecklistResponseDto).toHaveProperty('properties.items');
    expect(schemas.MoveChecklistDto).toMatchObject({
      required: ['beforeChecklistId'],
    });
  });
});
