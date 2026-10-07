import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';

describe('GET /', () => {
  it('returns API health', async () => {
    const module = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
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
