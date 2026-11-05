import { INestApplication, Inject } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { setTimeout as delay } from 'node:timers/promises';
import {
  EmailChangeController,
  EMAIL_CHANGE_ACKNOWLEDGEMENT,
} from '../../src/api/auth/email-change.controller';
import { EmailChangeService } from '../../src/api/auth/email-change.service';
import { EmailChangeReauthenticationService } from '../../src/api/auth/email-change-reauthentication.service';
import { AuthService } from '../../src/api/auth/auth.service';
import { ApplicationException } from '../../src/exceptions/application.exception';
import { createValidationPipe } from '../../src/config/validation';
import { HttpThrottlerGuard } from '../../src/guards/http-throttler.guard';
import { GlobalExceptionFilter } from '../../src/filters/global-exception.filter';
import { ApiResponseInterceptor } from '../../src/interceptors/api-response.interceptor';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => Inject('UserRepository'),
}));
jest.mock('node:timers/promises', () => ({
  setTimeout: jest.fn().mockResolvedValue(undefined),
}));
const identity = {
  userId: 'user',
  authVersion: 0,
  expiresAt: Date.now() + 60_000,
};
const proof = { ...identity, email: 'old@example.test', passwordHash: 'hash' };
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
describe('email change acknowledgement timing boundary', () => {
  it('proves reauthentication before any work or conditional acknowledgement', async () => {
    const verify = jest
      .fn()
      .mockRejectedValue(
        new ApplicationException(
          403,
          'INVALID_CREDENTIALS',
          'Could not verify identity',
        ),
      );
    const changes = { request: jest.fn() };
    const controller = new EmailChangeController(
      changes as unknown as EmailChangeService,
      { verify } as unknown as EmailChangeReauthenticationService,
    );
    jest.mocked(delay).mockClear();
    await expect(
      controller.request(identity, {
        newEmail: 'new@example.test',
        currentPassword: 'wrong',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(changes.request).not.toHaveBeenCalled();
    expect(delay).not.toHaveBeenCalled();
  });
  it.each(['pending provider', 'synchronous failure', 'late failure'])(
    'timer controls the response for %s',
    async (outcome) => {
      let release!: () => void, reject!: (error: Error) => void;
      const job = new Promise<void>((_resolve, fail) => {
        reject = fail;
      });
      const changes = {
        request: jest.fn(() => {
          if (outcome === 'synchronous failure')
            throw new Error('private-target sentinel');
          return job;
        }),
      };
      const controller = new EmailChangeController(
        changes as unknown as EmailChangeService,
        {
          verify: jest.fn().mockResolvedValue(proof),
        } as unknown as EmailChangeReauthenticationService,
      );
      const log = jest.spyOn(controller['logger'], 'warn').mockImplementation();
      jest.mocked(delay).mockReturnValueOnce(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      let complete = false;
      const response = controller
        .request(identity, {
          newEmail: 'new@example.test',
          currentPassword: 'secret',
        })
        .then((value) => {
          complete = true;
          return value;
        });
      await nextTurn();
      expect(complete).toBe(false);
      expect(delay).toHaveBeenLastCalledWith(10_500);
      release();
      await expect(response).resolves.toBeNull();
      expect(changes.request).toHaveBeenCalledTimes(1);
      if (outcome !== 'synchronous failure')
        reject(new Error('private-provider sentinel'));
      await nextTurn();
      if (outcome !== 'pending provider')
        expect(log.mock.calls.flat().join(' ')).not.toContain('sentinel');
      log.mockRestore();
    },
  );
});
describe('email change HTTP contracts and IP throttles', () => {
  let app: INestApplication;
  let nextIp = 1;
  const changes = {
    request: jest.fn().mockResolvedValue(undefined),
    pending: jest.fn(),
    confirm: jest.fn().mockResolvedValue(undefined),
  };
  const verify = jest.fn().mockResolvedValue(proof);
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
      controllers: [EmailChangeController],
      providers: [
        { provide: EmailChangeService, useValue: changes },
        { provide: EmailChangeReauthenticationService, useValue: { verify } },
        {
          provide: AuthService,
          useValue: {
            authenticateAccessToken: jest.fn(async (token: string) => ({
              ...identity,
              userId: token === 'rate-jwt' ? 'rate-user' : identity.userId,
            })),
          },
        },
        { provide: APP_GUARD, useClass: HttpThrottlerGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(
      new GlobalExceptionFilter({ error: jest.fn() } as unknown as Logger),
    );
    app.useGlobalInterceptors(new ApiResponseInterceptor(app.get(Reflector)));
    await app.init();
  });
  afterAll(async () => app.close());
  const post = (path: string) =>
    request(app.getHttpServer())
      .post('/auth/email-change/' + path)
      .auth('jwt', { type: 'bearer' })
      .set('X-Forwarded-For', `192.0.2.${nextIp++}`);
  it.each(['request', 'confirm'])('requires JWT for %s', async (path) => {
    await request(app.getHttpServer())
      .post('/auth/email-change/' + path)
      .send({})
      .expect(401);
  });
  it('requires JWT for pending', async () => {
    await request(app.getHttpServer())
      .get('/auth/email-change/pending')
      .expect(401);
  });
  it.each([
    { newEmail: 'new@example.test' },
    {
      newEmail: 'new@example.test',
      currentPassword: 'secret',
      googleCredential: 'google',
    },
    { newEmail: 'bad', currentPassword: 'secret' },
    {
      newEmail: 'new@example.test',
      currentPassword: 'secret',
      userId: 'other',
    },
  ])('rejects invalid request DTO %#', async (input) => {
    const response = await post('request').send(input).expect(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });
  it('returns exactly the conditional 202 envelope without proof data', async () => {
    const response = await post('request')
      .send({ newEmail: 'NEW@example.test', currentPassword: 'secret' })
      .expect(202);
    expect(response.body).toEqual({
      success: true,
      statusCode: 202,
      message: EMAIL_CHANGE_ACKNOWLEDGEMENT,
      data: null,
    });
    expect(verify).toHaveBeenLastCalledWith(
      identity,
      expect.objectContaining({ newEmail: 'new@example.test' }),
    );
  });
  it('allowlists pending and supports null', async () => {
    changes.pending.mockResolvedValueOnce({
      maskedNewEmail: 'n***@e***',
      issuedAt: '2026-11-05T00:00:00.000Z',
      expiresAt: '2026-11-05T00:30:00.000Z',
      newEmail: 'private@example.test',
      tokenHash: 'secret',
    });
    const response = await request(app.getHttpServer())
      .get('/auth/email-change/pending')
      .auth('jwt', { type: 'bearer' })
      .expect(200);
    expect(Object.keys(response.body.data)).toEqual([
      'maskedNewEmail',
      'issuedAt',
      'expiresAt',
    ]);
    expect(response.headers['cache-control']).toBe('private, no-store');
    changes.pending.mockResolvedValueOnce(null);
    expect(
      (
        await request(app.getHttpServer())
          .get('/auth/email-change/pending')
          .auth('jwt', { type: 'bearer' })
      ).body.data,
    ).toBeNull();
  });
  it('confirms with a bodyless 204 and rejects extra selectors', async () => {
    const response = await post('confirm')
      .send({ token: 'a'.repeat(43) })
      .expect(204);
    expect(response.text).toBe('');
    expect(changes.confirm).toHaveBeenLastCalledWith(identity, 'a'.repeat(43));
    expect(
      (await post('confirm').send({ token: 'a'.repeat(43), userId: 'other' }))
        .status,
    ).toBe(400);
  });
  it('also throttles reauthentication guesses by account across IPs', async () => {
    for (let i = 1; i <= 5; i++)
      await request(app.getHttpServer())
        .post('/auth/email-change/request')
        .auth('rate-jwt', { type: 'bearer' })
        .set('X-Forwarded-For', `203.0.113.${i}`)
        .send({})
        .expect(400);
    await request(app.getHttpServer())
      .post('/auth/email-change/request')
      .auth('rate-jwt', { type: 'bearer' })
      .set('X-Forwarded-For', '203.0.113.10')
      .send({})
      .expect(429);
  });
  it.each([
    ['request', 5],
    ['confirm', 10],
  ] as const)(
    'throttles %s by IP before credential work',
    async (path, limit) => {
      for (let i = 0; i < limit; i++)
        await request(app.getHttpServer())
          .post('/auth/email-change/' + path)
          .set('X-Forwarded-For', '198.51.100.1')
          .send({})
          .expect(401);
      await request(app.getHttpServer())
        .post('/auth/email-change/' + path)
        .set('X-Forwarded-For', '198.51.100.1')
        .send({})
        .expect(429);
    },
  );
});
