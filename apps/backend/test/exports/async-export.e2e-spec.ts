import { Inject, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ExportsController } from '../../src/api/exports/exports.controller';
import { BoardExportService } from '../../src/api/exports/board-export.service';
import { AccountExportService } from '../../src/api/exports/account-export.service';
import { ExportSnapshot } from '../../src/api/exports/export-snapshot';
import { ExportJobsService } from '../../src/api/exports/export-jobs.service';
import { JwtAuthGuard } from '../../src/api/auth/guards/jwt-auth.guard';
import { createValidationPipe } from '../../src/config/validation';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: (entity: { name: string }) =>
    Inject(`${entity.name}Repository`),
}));

const actor = {
  userId: '1bc98bc9-13de-4da7-9027-78eaee006611',
  authVersion: 0,
  expiresAt: Date.now() + 3_600_000,
};
const boardId = '291da68b-c50b-42cc-ad8d-3151ea006622';
const key = '39725ab4-df2b-4ffd-b048-1c2db7006633';

describe('VT-054 async Board export HTTP contract', () => {
  let app: INestApplication;
  const create = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ExportsController],
      providers: [
        { provide: BoardExportService, useValue: { create } },
        { provide: AccountExportService, useValue: {} },
        { provide: ExportSnapshot, useValue: {} },
        {
          provide: ExportJobsService,
          useValue: {
            start: jest.fn().mockResolvedValue({
              id: '4da6b7b2-61b7-4890-acb9-0a2538030044',
              state: 'PENDING',
              progress: 0,
            }),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: {
          switchToHttp: () => { getRequest: () => { user: typeof actor } };
        }) {
          context.switchToHttp().getRequest().user = actor;
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createValidationPipe());
    await app.init();
  });

  afterAll(async () => app?.close());

  it('TC01: acknowledges a valid operation as 202 with an observable job identity', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/boards/${boardId}/export-jobs`)
      .set('Idempotency-Key', key)
      .send({ format: 'json' });

    // This is a behavioral RED: the baseline has no async route and returns 404.
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      state: 'PENDING',
      progress: 0,
    });
    expect(response.body).not.toHaveProperty('body');
    expect(response.body).not.toHaveProperty('idempotencyKey');
  });
});
