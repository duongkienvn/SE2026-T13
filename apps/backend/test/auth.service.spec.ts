import { Inject } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { QueryFailedError } from 'typeorm';
import { AuthService } from '../src/api/auth/auth.service';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '../src/api/auth/constants/auth.constants';
import { LoginRequestDto } from '../src/api/auth/dto/login-request.dto';
import { RegisterRequestDto } from '../src/api/auth/dto/register-request.dto';
import { User } from '../src/api/users/entities/user.entity';

jest.mock('argon2', () => {
  const actual = jest.requireActual<typeof argon2>('argon2');
  return { ...actual, verify: jest.fn(actual.verify) };
});

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => Inject('UserRepository'),
}));

const JWT_SECRET = 'test-secret-that-is-at-least-32-bytes-long';

function userFixture(passwordHash = 'password-hash'): User {
  return Object.assign(new User(), {
    id: '1c5e2d5b-1e13-4b31-9cc4-8e4f849d75e5',
    email: 'ada@example.com',
    passwordHash,
    displayName: 'Ada Lovelace',
    avatarUrl: null,
    createdAt: new Date('2026-10-12T00:00:00.000Z'),
    updatedAt: new Date('2026-10-12T00:00:00.000Z'),
  });
}

describe('AuthService', () => {
  let service: AuthService;
  let repository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let jwt: JwtService;

  beforeEach(async () => {
    repository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    jwt = new JwtService({
      secret: JWT_SECRET,
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
    });
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: 'UserRepository', useValue: repository },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('hashes Argon2id passwords and returns a public user on registration', async () => {
    const user = userFixture();
    repository.findOne.mockResolvedValue(null);
    repository.create.mockImplementation((input: Partial<User>) =>
      Object.assign(user, input),
    );
    repository.save.mockResolvedValue(user);

    const input: RegisterRequestDto = {
      email: 'ada@example.com',
      password: 'correct horse battery staple',
      displayName: 'Ada Lovelace',
    };
    const result = await service.register(input);

    await expect(
      argon2.verify(user.passwordHash, input.password),
    ).resolves.toBe(true);
    expect(user.passwordHash).toContain('$argon2id$');
    expect(result).not.toHaveProperty('passwordHash');
    expect(result.email).toBe(input.email);
  });

  it('returns EMAIL_ALREADY_EXISTS for a concurrent unique constraint conflict', async () => {
    repository.findOne.mockResolvedValue(null);
    repository.create.mockReturnValue(userFixture());
    repository.save.mockRejectedValue(
      new QueryFailedError(
        'insert user',
        [],
        Object.assign(new Error('duplicate'), { code: '23505' }),
      ),
    );

    await expect(
      service.register({
        email: 'ada@example.com',
        password: 'correct horse battery staple',
        displayName: 'Ada Lovelace',
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'EMAIL_ALREADY_EXISTS' },
    });
  });

  it('uses one invalid-credentials error for an unknown email and wrong password', async () => {
    const user = userFixture(
      await argon2.hash('correct password', { type: argon2.argon2id }),
    );
    repository.findOne.mockResolvedValueOnce(user).mockResolvedValueOnce(null);

    const wrongPassword: LoginRequestDto = {
      email: user.email,
      password: 'wrong password',
    };
    const unknownEmail: LoginRequestDto = {
      email: 'unknown@example.com',
      password: 'wrong password',
    };
    const wrongPasswordError = await service
      .login(wrongPassword)
      .catch((error: unknown) => error);
    const unknownEmailError = await service
      .login(unknownEmail)
      .catch((error: unknown) => error);

    expect(wrongPasswordError).toMatchObject({
      status: 401,
      response: { code: 'INVALID_CREDENTIALS' },
    });
    expect(unknownEmailError).toMatchObject({
      status: 401,
      response: { code: 'INVALID_CREDENTIALS' },
    });
  });

  it('verifies a dummy Argon2id hash for an unknown email', async () => {
    const verify = jest.mocked(argon2.verify);
    verify.mockClear();
    repository.findOne.mockResolvedValue(null);
    const input: LoginRequestDto = {
      email: 'unknown@example.com',
      password: 'wrong password',
    };

    await expect(service.login(input)).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_CREDENTIALS' },
    });
    expect(verify).toHaveBeenCalledWith(
      expect.stringMatching(/^\$argon2id\$/),
      input.password,
    );
  });

  it('issues a one-hour HS256 token with the required claims', async () => {
    const user = userFixture(
      await argon2.hash('correct password', { type: argon2.argon2id }),
    );
    repository.findOne.mockResolvedValue(user);

    const result = await service.login({
      email: user.email,
      password: 'correct password',
    });
    const claims = await jwt.verifyAsync(result.accessToken);

    expect(claims).toMatchObject({
      sub: user.id,
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
    });
    expect(result).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 3600,
    });
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(3600);
  });

  it('rejects a signed access token without a finite expiration', async () => {
    const signer = new JwtService({ secret: JWT_SECRET });
    const token = await signer.signAsync(
      { sub: userFixture().id },
      {
        algorithm: 'HS256',
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      },
    );
    await expect(service.authenticateAccessToken(token)).rejects.toMatchObject({
      status: 401,
    });
    expect(repository.findOne).not.toHaveBeenCalled();
  });

  it('verifies JWT claims and loads the authenticated user from the database', async () => {
    const user = userFixture();
    repository.findOne.mockResolvedValue(user);
    const token = await jwt.signAsync({ sub: user.id });

    await expect(service.authenticateAccessToken(token)).resolves.toEqual({
      userId: user.id,
      expiresAt: jwt.decode<{ exp: number }>(token).exp * 1000,
    });
    await expect(
      service.authenticateAccessToken(`${token}tampered`),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: 'UNAUTHORIZED' },
    });

    const wrongIssuer = await jwt.signAsync(
      { sub: user.id },
      { issuer: 'another-api' },
    );
    await expect(
      service.authenticateAccessToken(wrongIssuer),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: 'UNAUTHORIZED' },
    });

    const expired = await jwt.signAsync({ sub: user.id }, { expiresIn: -1 });
    await expect(
      service.authenticateAccessToken(expired),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: 'UNAUTHORIZED' },
    });
  });
});
