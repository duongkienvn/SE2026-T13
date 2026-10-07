import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthController } from '../src/api/health/health.controller';
import { HealthService } from '../src/api/health/health.service';

describe('GET /', () => {
  it('returns API health', async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [HealthService],
    }).compile();
    const app = module.createNestApplication();
    await app.init();

    await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect({ name: 'Realtime Collaborative Kanban', status: 'ok' });

    await app.close();
  });
});
