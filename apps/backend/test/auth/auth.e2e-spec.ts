import {
  ClassSerializerInterceptor,
  INestApplication,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { AuthController } from '../../src/api/auth/auth.controller';
import { AuthService } from '../../src/api/auth/auth.service';
import { EmailVerificationService } from '../../src/api/auth/email-verification.service';
import { JwtAuthGuard } from '../../src/api/auth/guards/jwt-auth.guard';
import { UsersController } from '../../src/api/users/users.controller';
import { UsersService } from '../../src/api/users/users.service';
import { createValidationPipe } from '../../src/config/validation';
import { ApiResponseInterceptor } from '../../src/interceptors/api-response.interceptor';
import { GlobalExceptionFilter } from '../../src/filters/global-exception.filter';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => Inject('UserRepository'),
}));

const USER_ID = '1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5';
const user = {
  id: USER_ID,
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  avatarUrl: null,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
};

describe('authentication and profile HTTP contract', () => {
  let app: INestApplication;
  let authService: {
    register: jest.Mock;
    login: jest.Mock;
    authenticateAccessToken: jest.Mock;
  };
  let usersService: {
    getCurrentUser: jest.Mock;
    updateCurrentUser: jest.Mock;
  };

  beforeAll(async () => {
    authService = {
      register: jest.fn().mockResolvedValue(user),
      login: jest.fn().mockResolvedValue({
        accessToken: 'signed-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        user,
      }),
      authenticateAccessToken: jest.fn().mockResolvedValue({ userId: USER_ID }),
    };
    usersService = {
      getCurrentUser: jest.fn().mockResolvedValue(user),
      updateCurrentUser: jest.fn().mockResolvedValue({
        ...user,
        displayName: 'Grace Hopper',
      }),
    };
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
      controllers: [AuthController, UsersController],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: EmailVerificationService,
          useValue: { send: jest.fn(), verify: jest.fn() },
        },
        { provide: UsersService, useValue: usersService },
        JwtAuthGuard,
      ],
    }).compile();
    app = module.createNestApplication();
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

  afterAll(async () => {
    await app.close();
  });

  it('registers without issuing a token and wraps the public user response', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'ADA@EXAMPLE.COM',
        password: 'Kanvexa@2026',
        displayName: ' Ada Lovelace ',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      success: true,
      statusCode: 201,
      data: user,
    });
    expect(response.body.data).not.toHaveProperty('passwordHash');
    expect(authService.register).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'Kanvexa@2026',
      displayName: 'Ada Lovelace',
    });
    expect(response.body.data).not.toHaveProperty('accessToken');
  });

  it('returns a bearer access token from login', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'ada@example.com',
        password: 'correct horse battery staple',
      })
      .expect(200);

    expect(response.body.data).toMatchObject({
      accessToken: 'signed-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
      user,
    });
  });

  it('requires authentication for profile and returns a stateless 204 logout', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', 'Bearer signed-token')
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toEqual(user);
      });
    const logout = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', 'Bearer signed-token')
      .expect(204);
    expect(logout.text).toBe('');
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', 'Bearer signed-token')
      .expect(200);
  });

  it('rejects fields outside the profile contract', async () => {
    const response = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', 'Bearer signed-token')
      .send({ email: 'other@example.com' })
      .expect(400);

    expect(response.body).toMatchObject({
      success: false,
      code: 'VALIDATION_FAILED',
    });
    expect(usersService.updateCurrentUser).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', 'Bearer signed-token')
      .send({ avatarUrl: 'http://example.com/avatar.png' })
      .expect(400);
  });
});
