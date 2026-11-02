import { INestApplication, Inject } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { BoardDiscoveryController } from '../../src/api/boards/board-discovery.controller';
import { BoardDiscoveryService } from '../../src/api/boards/board-discovery.service';
import { JwtAuthGuard } from '../../src/api/auth/guards/jwt-auth.guard';
import { createValidationPipe } from '../../src/config/validation';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: (entity: { name: string }) =>
    Inject(`${entity.name}Repository`),
}));

describe('board discovery HTTP validation', () => {
  let app: INestApplication;
  const discovery = {
    background: jest.fn().mockResolvedValue({}),
    setStar: jest.fn().mockResolvedValue({}),
    view: jest.fn().mockResolvedValue({}),
    state: jest.fn().mockResolvedValue({}),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [BoardDiscoveryController],
      providers: [{ provide: BoardDiscoveryService, useValue: discovery }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => { user: object } };
        }) => {
          context.switchToHttp().getRequest().user = { userId: 'owner' };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    await app.init();
  });
  afterAll(async () => app.close());

  it('serves the catalog and validates both kinds of preset', async () => {
    const id = 'c6ba7134-97ef-4c1b-a342-001a982a7721';
    await request(app.getHttpServer())
      .get('/boards/background-presets')
      .expect(200);
    for (const preset of ['teal', 'forest'])
      await request(app.getHttpServer())
        .patch(`/boards/${id}/background`)
        .send({ preset })
        .expect(200);
    for (const preset of ['https://example.test/image', 'invalid', null])
      await request(app.getHttpServer())
        .patch(`/boards/${id}/background`)
        .send({ preset })
        .expect(400);
    expect(discovery.background).toHaveBeenCalledTimes(2);
    await request(app.getHttpServer())
      .patch(`/boards/${id}/background`)
      .send({ preset: 'blue', expectedVersion: 2 })
      .expect(200);
    expect(discovery.background).toHaveBeenLastCalledWith(
      'owner',
      id,
      'blue',
      2,
    );
    for (const expectedVersion of [-1, 1.5, '2', null])
      await request(app.getHttpServer())
        .patch(`/boards/${id}/background`)
        .send({ preset: 'blue', expectedVersion })
        .expect(400);
  });
});
