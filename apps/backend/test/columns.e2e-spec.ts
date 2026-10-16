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
import { ErrorCode } from '../src/common/dto/api-error';
import { PAGINATED_RESULT } from '../src/common/dto/paginated-response';
import { BoardColumn } from '../src/api/columns/entities/board-column.entity';
import { ColumnsController } from '../src/api/columns/columns.controller';
import { ColumnsService } from '../src/api/columns/columns.service';
import { AuthService } from '../src/api/auth/auth.service';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '../src/api/auth/constants/auth.constants';
import { JwtAuthGuard } from '../src/api/auth/guards/jwt-auth.guard';
import { User } from '../src/api/users/entities/user.entity';
import { createValidationPipe } from '../src/config/validation';
import { GlobalExceptionFilter } from '../src/filters/global-exception.filter';
import { ApiResponseInterceptor } from '../src/interceptors/api-response.interceptor';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: (entity: { name: string }) =>
    Inject(`${entity.name}Repository`),
}));

const USER_ID = '1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5';
const BOARD_ID = 'c6ba7134-97ef-4c1b-a342-001a982a7721';
const COLUMN_ID = 'd6ba7134-97ef-4c1b-a342-001a982a7721';

describe('columns HTTP contract', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let token: string;
  const users = { findOne: jest.fn() };
  const columns = {
    list: jest.fn(),
    create: jest.fn(),
    rename: jest.fn(),
    move: jest.fn(),
    remove: jest.fn(),
  };

  const responseColumn = () =>
    Object.assign(new BoardColumn(), {
      id: COLUMN_ID,
      boardId: BOARD_ID,
      name: 'To Do',
      position: '100.0000000000',
      createdAt: new Date('2026-10-15T00:00:00.000Z'),
      updatedAt: new Date('2026-10-15T00:00:00.000Z'),
    });

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
      controllers: [ColumnsController],
      providers: [
        AuthService,
        JwtAuthGuard,
        { provide: ColumnsService, useValue: columns },
        { provide: 'UserRepository', useValue: users },
      ],
    }).compile();
    jwt = module.get(JwtService);
    token = await jwt.signAsync({ sub: USER_ID });
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
    users.findOne.mockResolvedValue(Object.assign(new User(), { id: USER_ID }));
    const column = responseColumn();
    columns.list.mockResolvedValue({
      data: [column],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      [PAGINATED_RESULT]: true,
    });
    columns.create.mockResolvedValue(column);
    columns.rename.mockResolvedValue(column);
    columns.move.mockResolvedValue(column);
    columns.remove.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects anonymous requests and returns paginated columns for members', async () => {
    await request(app.getHttpServer())
      .get(`/api/boards/${BOARD_ID}/columns`)
      .expect(401);
    const response = await request(app.getHttpServer())
      .get(`/api/boards/${BOARD_ID}/columns`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body).toMatchObject({
      success: true,
      data: [{ id: COLUMN_ID, boardId: BOARD_ID, position: '100.0000000000' }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    expect(columns.list).toHaveBeenCalledWith(USER_ID, BOARD_ID, {
      page: 1,
      limit: 20,
    });
  });

  it('maps create, rename, move and delete endpoints to the service contract', async () => {
    await request(app.getHttpServer())
      .post(`/api/boards/${BOARD_ID}/columns`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: ' New column ' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/boards/${BOARD_ID}/columns/${COLUMN_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/boards/${BOARD_ID}/columns/${COLUMN_ID}/move`)
      .set('Authorization', `Bearer ${token}`)
      .send({ beforeColumnId: null })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/boards/${BOARD_ID}/columns/${COLUMN_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    expect(columns.create).toHaveBeenCalledWith(USER_ID, BOARD_ID, {
      name: 'New column',
    });
    expect(columns.rename).toHaveBeenCalledWith(USER_ID, BOARD_ID, COLUMN_ID, {
      name: 'Renamed',
    });
    expect(columns.move).toHaveBeenCalledWith(USER_ID, BOARD_ID, COLUMN_ID, {
      beforeColumnId: null,
    });
    expect(columns.remove).toHaveBeenCalledWith(USER_ID, BOARD_ID, COLUMN_ID);
  });

  it('rejects invalid names and extra request fields at the HTTP boundary', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/boards/${BOARD_ID}/columns`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '   ', position: '1' })
      .expect(400);
    expect(response.body).toMatchObject({
      success: false,
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(columns.create).not.toHaveBeenCalled();
  });
});
