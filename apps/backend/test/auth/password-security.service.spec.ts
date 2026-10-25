import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { User } from '../../src/api/users/entities/user.entity';
import { PasswordResetToken } from '../../src/api/auth/entities/password-reset-token.entity';
import {
  PasswordSecurityService,
  recoveryHash,
  RECOVERY_TTL_MS,
} from '../../src/api/auth/password-security.service';
import { FakePasswordRecoveryMailer } from '../../src/mail/password-recovery-mailer';

describe('PasswordSecurityService decisions', () => {
  let user: User;
  let previous: Partial<PasswordResetToken> | null;
  let userRepo: { findOne: jest.Mock; findOneBy: jest.Mock; update: jest.Mock };
  let tokenRepo: {
    findOneBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let mailer: FakePasswordRecoveryMailer;
  let service: PasswordSecurityService;
  beforeEach(() => {
    user = Object.assign(new User(), {
      id: 'user',
      email: 'person@example.test',
      emailVerifiedAt: new Date(),
      passwordHash: null,
    });
    previous = null;
    userRepo = {
      findOne: jest.fn(async () => user),
      findOneBy: jest.fn(async () => user),
      update: jest.fn(),
    };
    tokenRepo = {
      findOneBy: jest.fn(async () => previous),
      create: jest.fn((input) => input),
      save: jest.fn(async (input) => ({ id: 'token', ...input })),
      update: jest.fn(),
    };
    const manager = {
      getRepository: (entity: unknown) =>
        entity === User ? userRepo : tokenRepo,
      query: jest.fn(),
    };
    const source = {
      getRepository: manager.getRepository,
      transaction: jest.fn((work) => work(manager)),
    } as unknown as DataSource;
    mailer = new FakePasswordRecoveryMailer();
    service = new PasswordSecurityService(
      source,
      mailer,
      new ConfigService({ PUBLIC_APP_URL: 'http://localhost:5173' }),
    );
  });
  it('issues separate random opaque proofs, stores only SHA-256 and uses the configured origin/TTL', async () => {
    await service.send(user.email);
    const link = new URL(mailer.deliveries[0].url);
    const plaintext = link.searchParams.get('token')!;
    expect(link.origin + link.pathname).toBe(
      'http://localhost:5173/reset-password',
    );
    expect(plaintext).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const saved = tokenRepo.save.mock.calls[0][0];
    expect(saved.tokenHash).toBe(recoveryHash(plaintext));
    expect(JSON.stringify(saved)).not.toContain(plaintext);
    expect(saved.expiresAt - saved.createdAt).toBe(RECOVERY_TTL_MS);
    await service.send(user.email);
    expect(mailer.deliveries[1].url).not.toBe(mailer.deliveries[0].url);
  });
  it('never sends recovery for unverified/unknown accounts', async () => {
    user.emailVerifiedAt = null;
    await service.send(user.email);
    userRepo.findOne.mockResolvedValue(null);
    await service.send('unknown@example.test');
    expect(mailer.deliveries).toHaveLength(0);
    expect(tokenRepo.save).not.toHaveBeenCalled();
  });
  it.each(['cooldown', 'quota'])(
    'suppresses sending during %s',
    async (state) => {
      previous = {
        createdAt: new Date(Date.now() - (state === 'cooldown' ? 0 : 61_000)),
        windowStartedAt: new Date(),
        attempts: state === 'quota' ? 5 : 1,
      };
      await service.send(user.email);
      expect(tokenRepo.save).not.toHaveBeenCalled();
      expect(mailer.deliveries).toHaveLength(0);
    },
  );
  it('keeps the issued proof after ambiguous delivery failure without retry', async () => {
    const send = jest
      .spyOn(mailer, 'send')
      .mockRejectedValue(new Error('secret provider response'));
    await expect(service.send(user.email)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(tokenRepo.save).toHaveBeenCalledTimes(1);
    expect(tokenRepo.update).not.toHaveBeenCalled();
  });
  it.each([null, {}, '', 'bad', 'A'.repeat(44)])(
    'maps malformed recovery proofs safely',
    async (token) => {
      await expect(service.reset(token, 'NewPass123!')).rejects.toMatchObject({
        status: 400,
        response: { code: 'INVALID_PASSWORD_RESET_TOKEN' },
      });
      expect(tokenRepo.findOneBy).not.toHaveBeenCalled();
    },
  );
  it('rejects an unknown well-shaped proof', async () => {
    await expect(
      service.reset('A'.repeat(43), 'NewPass123!'),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'INVALID_PASSWORD_RESET_TOKEN' },
    });
    expect(tokenRepo.findOneBy).toHaveBeenCalledWith({
      tokenHash: recoveryHash('A'.repeat(43)),
    });
  });
  it('does not accept Google-only JWT as password-setting proof', async () => {
    await expect(
      service.change(user.id, 0, 'arbitrary', 'NewPass123!'),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'PASSWORD_RECOVERY_REQUIRED' },
    });
    expect(userRepo.update).not.toHaveBeenCalled();
  });
  it('rejects old JWT version even if current password was supplied', async () => {
    user.authVersion = 1;
    await expect(
      service.change(user.id, 0, 'anything', 'NewPass123!'),
    ).rejects.toMatchObject({ status: 401 });
    expect(userRepo.update).not.toHaveBeenCalled();
  });
  it('maps wrong and reused passwords without updating any credential state', async () => {
    user.passwordHash = await argon2.hash('OldPass123!', {
      type: argon2.argon2id,
    });
    await expect(
      service.change(user.id, 0, 'incorrect', 'NewPass123!'),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'CURRENT_PASSWORD_INCORRECT' },
    });
    await expect(
      service.change(user.id, 0, 'OldPass123!', 'OldPass123!'),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'PASSWORD_REUSED' },
    });
    expect(userRepo.update).not.toHaveBeenCalled();
  });
});
