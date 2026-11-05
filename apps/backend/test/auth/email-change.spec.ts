import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource } from 'typeorm';
import { AuthService } from '../../src/api/auth/auth.service';
import { RequestEmailChangeDto } from '../../src/api/auth/dto/email-change.dto';
import { EmailChangeReauthenticationService } from '../../src/api/auth/email-change-reauthentication.service';
import { GoogleTokenVerifier } from '../../src/api/auth/google-token-verifier.service';
import { GoogleIdentity } from '../../src/api/auth/entities/google-identity.entity';
import { PendingEmailChange } from '../../src/api/auth/entities/pending-email-change.entity';
import { ApplicationException } from '../../src/exceptions/application.exception';
import {
  EmailChangeService,
  emailChangeHash,
  maskEmail,
  EMAIL_CHANGE_TTL_MS,
} from '../../src/api/auth/email-change.service';
import { FakeEmailChangeMailer } from '../../src/mail/email-change-mailer';
import { BoardRoomCoordinator } from '../../src/realtime/board-room-coordinator.service';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: (entity: { name: string }) =>
    Inject(`${entity.name}Repository`),
}));
const user = {
  id: 'user',
  email: 'old@example.test',
  authVersion: 2,
  emailVerifiedAt: new Date(),
  passwordHash: 'trusted-hash',
};
const identity = () => ({
  userId: user.id,
  authVersion: user.authVersion,
  expiresAt: Date.now() + 60_000,
});
const body = (patch: Record<string, unknown>) =>
  plainToInstance(RequestEmailChangeDto, patch);

describe('email-change request validation', () => {
  it('normalizes email exactly like registration and preserves password bytes', async () => {
    const input = body({
      newEmail: ' New@Example.test ',
      currentPassword: '  Password1!  ',
    });
    expect(await validate(input)).toEqual([]);
    expect(input.newEmail).toBe('new@example.test');
    expect(input.currentPassword).toBe('  Password1!  ');
  });
  it.each([
    { newEmail: 'new@example.test' },
    {
      newEmail: 'new@example.test',
      currentPassword: 'secret',
      googleCredential: 'credential',
    },
    { newEmail: 'not-email', currentPassword: 'secret' },
    { newEmail: 'new@example.test', currentPassword: null },
    { newEmail: 'new@example.test', googleCredential: null },
    { newEmail: 'new@example.test', currentPassword: '' },
    { newEmail: 'new@example.test', currentPassword: 'x'.repeat(129) },
    { newEmail: 'new@example.test', googleCredential: 'x'.repeat(8193) },
  ])('rejects invalid proof shape %#', async (patch) =>
    expect(await validate(body(patch))).not.toHaveLength(0),
  );
  it('rejects arbitrary selectors and proof fields', async () => {
    expect(
      await validate(
        body({
          newEmail: 'new@example.test',
          currentPassword: 'secret',
          userId: 'other',
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).not.toHaveLength(0);
  });
});
describe('fresh reauthentication binds identity, never email claims', () => {
  const linked = { userId: 'user', googleSub: 'linked-subject' };
  let reauthenticate: jest.Mock,
    verify: jest.Mock,
    service: EmailChangeReauthenticationService;
  beforeEach(() => {
    reauthenticate = jest.fn().mockResolvedValue({ ...user });
    verify = jest.fn().mockResolvedValue({
      sub: linked.googleSub,
      email: 'different-google@gmail.com',
    });
    const source = {
      getRepository: (entity: unknown) => ({
        findOneBy: jest
          .fn()
          .mockResolvedValue(entity === GoogleIdentity ? linked : user),
      }),
    };
    service = new EmailChangeReauthenticationService(
      source as unknown as DataSource,
      { reauthenticate } as unknown as AuthService,
      { verify } as unknown as GoogleTokenVerifier,
    );
  });
  it('supports password reauthentication without retaining plaintext', async () => {
    const proof = await service.verify(
      identity(),
      body({ newEmail: 'new@example.test', currentPassword: 'Secret1!' }),
    );
    expect(proof).toMatchObject({
      passwordHash: 'trusted-hash',
      email: user.email,
    });
    expect(JSON.stringify(proof)).not.toContain('Secret1!');
    expect(verify).not.toHaveBeenCalled();
  });
  it('uses matching linked subject even when Google email differs', async () => {
    const proof = await service.verify(
      identity(),
      body({ newEmail: 'new@example.test', googleCredential: 'google-secret' }),
    );
    expect(verify).toHaveBeenCalledWith('google-secret', 300);
    expect(proof.googleSub).toBe(linked.googleSub);
    expect(JSON.stringify(proof)).not.toContain('google-secret');
  });
  it('rejects a same-email token with a different subject', async () => {
    verify.mockResolvedValue({ sub: 'attacker-subject', email: user.email });
    await expect(
      service.verify(identity(), body({ googleCredential: 'credential' })),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('maps wrong password to 403 after JWT authentication', async () => {
    reauthenticate.mockRejectedValue(
      new ApplicationException(
        401,
        'INVALID_CREDENTIALS',
        'Invalid credentials',
      ),
    );
    await expect(
      service.verify(identity(), body({ currentPassword: 'wrong' })),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'INVALID_CREDENTIALS' },
    });
  });
  it.each([{ authVersion: 1 }, { expiresAt: 0 }])(
    'rejects changed or expired sessions %j',
    async (patch) => {
      await expect(
        service.verify(
          { ...identity(), ...patch },
          body({ currentPassword: 'secret' }),
        ),
      ).rejects.toMatchObject({ status: 401 });
    },
  );
  it('requires exactly one method even for internal callers', async () => {
    await expect(
      service.verify(
        identity(),
        body({ currentPassword: 'secret', googleCredential: 'google' }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(service.verify(identity(), body({}))).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('email change issuance security', () => {
  function setup(
    previous: Partial<PendingEmailChange> | null = null,
    occupied = false,
  ) {
    const now = new Date();
    const mailer = new FakeEmailChangeMailer('https://kanvexa.test');
    const tokens = {
      existsBy: jest.fn().mockResolvedValue(true),
      findOne: jest.fn().mockResolvedValue(previous),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'intent', ...value })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const users = {
      findOne: jest.fn().mockResolvedValue({ ...user }),
      existsBy: jest.fn().mockResolvedValue(occupied),
    };
    const manager = {
      getRepository: (entity: unknown) =>
        entity === PendingEmailChange ? tokens : users,
      query: jest.fn(async (sql: string) =>
        sql.startsWith('SELECT') ? [{ now }] : [],
      ),
    };
    const source = {
      transaction: jest.fn(async (read) => read(manager)),
      getRepository: () => tokens,
    };
    const service = new EmailChangeService(
      source as unknown as DataSource,
      mailer,
      new ConfigService({ PUBLIC_APP_URL: 'https://kanvexa.test' }),
      {} as BoardRoomCoordinator,
    );
    return { service, mailer, tokens, users, source, now, manager };
  }
  const proof = () => ({
    ...identity(),
    email: user.email,
    passwordHash: user.passwordHash,
  });
  it('uses 32-byte opaque proofs, SHA256-only persistence and exact 30-minute TTL', async () => {
    const { service, mailer, tokens, manager } = setup();
    await service.request(proof(), 'new@example.test');
    const token = new URL(mailer.proofs[0].url).searchParams.get('token')!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    const saved = tokens.save.mock.calls[0][0];
    expect(saved.tokenHash).toBe(emailChangeHash(token));
    expect(JSON.stringify(saved)).not.toContain(token);
    expect(saved.expiresAt.getTime() - saved.createdAt.getTime()).toBe(
      EMAIL_CHANGE_TTL_MS,
    );
    expect(saved.issuanceAttempts).toHaveLength(1);
    expect(new URL(mailer.proofs[0].url).pathname).toBe(
      '/confirm-email-change',
    );
    expect(manager.query).toHaveBeenCalledWith("SET LOCAL lock_timeout = '2s'");
    expect(tokens.update).toHaveBeenCalledWith(
      { userId: user.id, tokenHash: saved.tokenHash },
      { sentAt: expect.any(Date) },
    );
  });
  it('persists a pending-shaped occupied-target intent without sending mail', async () => {
    const { service, mailer, tokens } = setup(null, true);
    await service.request(proof(), 'occupied@example.test');
    expect(tokens.save).toHaveBeenCalledTimes(1);
    expect(mailer.proofs).toHaveLength(0);
  });
  it('does not rotate within cooldown, including after consumed or ambiguous delivery', async () => {
    const { service, mailer, tokens } = setup({
      createdAt: new Date(),
      consumedAt: new Date(),
      issuanceAttempts: [new Date()],
    });
    await service.request(proof(), 'new@example.test');
    expect(tokens.save).not.toHaveBeenCalled();
    expect(mailer.proofs).toHaveLength(0);
  });
  it('keeps a true rolling-hour quota instead of resetting at a fixed window boundary', async () => {
    const clock = Date.now();
    const attempts = [-59, -45, -30, -15, -2].map(
      (minutes) => new Date(clock + minutes * 60_000),
    );
    const { service, tokens } = setup({
      createdAt: attempts[4],
      issuanceAttempts: attempts,
    });
    await service.request(proof(), 'new@example.test');
    expect(tokens.save).not.toHaveBeenCalled();
  });
  it('prunes only attempts older than the rolling hour when rotating', async () => {
    const clock = Date.now();
    const attempts = [-61, -45, -30, -15, -2].map(
      (minutes) => new Date(clock + minutes * 60_000),
    );
    const { service, tokens } = setup({
      id: 'retained',
      createdAt: attempts[4],
      issuanceAttempts: attempts,
    });
    await service.request(proof(), 'new@example.test');
    expect(tokens.save.mock.calls[0][0].issuanceAttempts).toHaveLength(5);
    expect(tokens.save.mock.calls[0][0].id).toBe('retained');
  });
  it('retains the proof and quota on ambiguous provider failure, without marking sent', async () => {
    const { service, mailer, tokens } = setup();
    jest
      .spyOn(mailer, 'sendProof')
      .mockRejectedValue(new Error('private-provider-secret'));
    await expect(
      service.request(proof(), 'new@example.test'),
    ).resolves.toBeUndefined();
    expect(tokens.save).toHaveBeenCalled();
    expect(tokens.update).not.toHaveBeenCalled();
  });
  it('rejects reauthentication snapshots changed before the transaction', async () => {
    const { service, users, tokens } = setup();
    users.findOne.mockResolvedValue({ ...user, passwordHash: 'changed' });
    await expect(
      service.request(proof(), 'new@example.test'),
    ).rejects.toMatchObject({ status: 403 });
    expect(tokens.save).not.toHaveBeenCalled();
  });
  it.each([null, 42, {}, [], '', 'short', 'a'.repeat(44), '!'.repeat(43)])(
    'rejects malformed confirmation %# before database lookup',
    async (token) => {
      const { service, source } = setup();
      await expect(service.confirm(identity(), token)).rejects.toMatchObject({
        status: 400,
        response: { code: 'INVALID_EMAIL_CHANGE_TOKEN' },
      });
      expect(source.transaction).not.toHaveBeenCalled();
    },
  );
  it('masks both the destination local part and domain', () => {
    expect(maskEmail('private-name@private-domain.test')).toBe('p***@p***');
  });
});
