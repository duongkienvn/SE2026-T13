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
import { CardAttachmentsController } from '../../src/api/cards/card-attachments.controller';
import { CardAttachmentsService } from '../../src/api/cards/card-attachments.service';
import { createValidationPipe } from '../../src/config/validation';
import { ApplicationException } from '../../src/exceptions/application.exception';
import { GlobalExceptionFilter } from '../../src/filters/global-exception.filter';
import { ApiResponseInterceptor } from '../../src/interceptors/api-response.interceptor';
import { attachmentHarness, ID } from './attachments.fixture';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));
const base = `/api/boards/${ID.board}/cards/${ID.card}/attachments`;
describe('Card attachment HTTP contracts', () => {
  let app: INestApplication,
    h: ReturnType<typeof attachmentHarness>,
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
    h = attachmentHarness();
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: randomBytes(32).toString('hex'),
          signOptions: { expiresIn: 60 },
        }),
      ],
      controllers: [CardAttachmentsController],
      providers: [
        JwtAuthGuard,
        { provide: CardAttachmentsService, useValue: h.service },
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

  it('creates, pages, edits, replays and removes URL metadata with exact envelopes', async () => {
    const key = '123e4567-e89b-42d3-a456-426614174000';
    const input = {
      kind: 'URL',
      url: 'HTTPS://Example.com:443/doc',
      displayName: 'Document',
    };
    const first = (
      await http()
        .post(base)
        .set('Idempotency-Key', key)
        .send(input)
        .expect(201)
    ).body.data;
    expect(first).toMatchObject({
      kind: 'URL',
      state: 'ACTIVE',
      displayName: 'Document',
      url: 'https://example.com/doc',
      revision: 1,
      originalFilename: null,
      mimeType: null,
      byteSize: null,
    });
    expect(
      (
        await http()
          .post(base)
          .set('Idempotency-Key', key)
          .send(input)
          .expect(201)
      ).body.data,
    ).toEqual(first);
    await http(ID.guest)
      .post(base)
      .send({ kind: 'URL', url: 'https://example.com/two' })
      .expect(201);
    const page = await http(ID.member)
      .get(base + '?limit=1')
      .expect(200);
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.body.meta).toMatchObject({
      total: 2,
      limit: 1,
      page: 1,
      totalPages: 2,
    });
    expect(page.body.data).toHaveLength(1);
    const changed = await http(ID.member)
      .patch(base + '/' + first.id)
      .send({ expectedRevision: 1, displayName: 'Renamed' })
      .expect(200);
    expect(changed.body.data).toMatchObject({
      revision: 2,
      displayName: 'Renamed',
    });
    await http()
      .patch(base + '/' + first.id)
      .send({ expectedRevision: 1, displayName: 'Stale' })
      .expect(409);
    await http()
      .delete(base + '/' + first.id + '?expectedRevision=1')
      .expect(409);
    await http(ID.guest)
      .delete(base + '/' + first.id + '?expectedRevision=2')
      .expect(204);
    await http()
      .delete(base + '/' + first.id)
      .expect(204);
    await http()
      .get(base + '/' + first.id)
      .expect(404);
    await http().post(base).set('Idempotency-Key', key).send(input).expect(409);
    expect(h.events.publish).toHaveBeenCalledTimes(4);
  });
  it('rejects unauthenticated, malformed and private field writes and unsafe queries', async () => {
    await request(app.getHttpServer()).get(base).expect(401);
    for (const input of [
      { kind: 'URL' },
      { kind: 'URL', url: 'http://example.com' },
      { kind: 'URL', url: 'https://example.com', uploaderId: ID.owner },
      { kind: 'URL', url: 'https://example.com', storageKey: 'secret' },
      { kind: 'URL', url: 'https://example.com', state: 'ACTIVE' },
      { kind: 'FILE', byteSize: 100 },
    ])
      await http().post(base).send(input).expect(400);
    for (const query of [
      'state=PENDING',
      'page=0',
      'limit=101',
      'page=1e2',
      'cardId=' + ID.secondCard,
    ])
      await http()
        .get(base + '?' + query)
        .expect(400);
    await http()
      .post(base)
      .set('Idempotency-Key', 'bad')
      .send({ kind: 'URL', url: 'https://example.com' })
      .expect(400);
    expect(h.rows.size).toBe(0);
    expect(h.events.publish).not.toHaveBeenCalled();
  });
  it('keeps PRIVATE Boards hidden, visible readers read-only, Guests scoped, and archive state preserved', async () => {
    const row = (
      await http()
        .post(base)
        .send({ kind: 'URL', url: 'https://example.com' })
        .expect(201)
    ).body.data;
    for (const actor of [ID.admin, ID.viewer, ID.outsider])
      await http(actor).get(base).expect(404);
    h.store(Board).get(ID.board)!.visibility = 'WORKSPACE_VISIBLE';
    await http(ID.viewer).get(base).expect(200);
    await http(ID.admin).get(base).expect(200);
    for (const actor of [ID.viewer, ID.admin]) {
      await http(actor)
        .post(base)
        .send({ kind: 'URL', url: 'https://example.com' })
        .expect(404);
      await http(actor)
        .patch(base + '/' + row.id)
        .send({ expectedRevision: 1, displayName: 'No' })
        .expect(404);
      await http(actor)
        .delete(base + '/' + row.id)
        .expect(404);
    }
    await http(ID.guest).get(base.replace(ID.card, ID.foreignCard)).expect(404);
    await http(ID.guest)
      .get(base.replace(ID.card, ID.secondCard) + '/' + row.id)
      .expect(404);
    h.store(Card).get(ID.card)!.isArchived = true;
    await http(ID.guest).get(base).expect(200);
    await http()
      .delete(base + '/' + row.id)
      .expect(409);
    h.store(Card).get(ID.card)!.isArchived = false;
    h.store(Board).get(ID.board)!.isArchived = true;
    await http().get(base).expect(200);
    await http()
      .patch(base + '/' + row.id)
      .send({ expectedRevision: 1, displayName: 'No' })
      .expect(409);
  });
  it('does not expose file intents or pretend unavailable file operations work', async () => {
    const response = await http(ID.member)
      .post(base)
      .send({ kind: 'FILE' })
      .expect(503);
    expect(response.body.code).toBe('ATTACHMENT_FILES_NOT_AVAILABLE');
    expect(JSON.stringify(response.body)).not.toMatch(
      /storageKey|signed|pendingKey/,
    );
    await http(ID.outsider).post(base).send({ kind: 'FILE' }).expect(404);
    expect(h.rows.size).toBe(0);
  });
  it('documents exact allowlists, pagination, revision and unavailable responses', () => {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    const path = doc.paths['/api/boards/{boardId}/cards/{cardId}/attachments'];
    expect(path.get?.responses['200']).toBeDefined();
    expect(path.post?.responses['503']).toBeDefined();
    expect(path.post?.security?.length).toBeGreaterThan(0);
    expect(doc.components?.schemas?.AttachmentResponseDto).not.toHaveProperty(
      'properties.storageKey',
    );
    expect(doc.components?.schemas?.AttachmentResponseDto).toHaveProperty(
      'properties.revision',
    );
    expect(doc.components?.schemas?.UpdateAttachmentDto).toMatchObject({
      required: expect.arrayContaining(['expectedRevision']),
    });
  });
});
