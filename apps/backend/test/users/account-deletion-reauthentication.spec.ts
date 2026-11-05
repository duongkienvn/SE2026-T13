import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AccountDeletionReauthenticationService } from '../../src/api/users/account-deletion/account-deletion-reauthentication.service';
import { EmailChangeReauthenticationService } from '../../src/api/auth/email-change-reauthentication.service';
import { DeleteAccountDto } from '../../src/api/users/account-deletion/delete-account.dto';

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => undefined,
}));

describe('Account deletion proof boundary', () => {
  const identity = {
    userId: 'user',
    authVersion: 1,
    expiresAt: Date.now() + 60_000,
  };
  const verify = jest
    .fn()
    .mockResolvedValue({ ...identity, passwordHash: 'snapshot' });
  const service = new AccountDeletionReauthenticationService({
    verify,
  } as unknown as EmailChangeReauthenticationService);
  beforeEach(() => verify.mockClear());

  it.each(['delete', ' DELETE', 'DELETE ', '', null, undefined])(
    'rejects nonliteral confirmation %s',
    async (confirmation) => {
      const input = plainToInstance(DeleteAccountDto, {
        confirmation,
        currentPassword: 'secret',
      });
      expect(await validate(input)).not.toHaveLength(0);
      await expect(service.verify(identity, input)).rejects.toMatchObject({
        response: { code: 'VALIDATION_FAILED' },
      });
      expect(verify).not.toHaveBeenCalled();
    },
  );

  it('rejects JWT-only deletion with safe reauthentication failure', async () => {
    await expect(
      service.verify(identity, { confirmation: 'DELETE' }),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_CREDENTIALS' },
      status: 403,
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it.each([{ currentPassword: 'secret' }, { googleCredential: 'fresh' }])(
    'delegates fresh proof verification without changing it',
    async (method) => {
      const input = { confirmation: 'DELETE' as const, ...method };
      await expect(service.verify(identity, input)).resolves.toMatchObject(
        identity,
      );
      expect(verify).toHaveBeenCalledWith(identity, input);
      expect(
        await validate(plainToInstance(DeleteAccountDto, input)),
      ).toHaveLength(0);
    },
  );

  it.each([
    { currentPassword: null },
    { googleCredential: null },
    { currentPassword: 12 },
    { googleCredential: 'x'.repeat(8193) },
  ])('rejects malformed proof values', async (method) => {
    expect(
      await validate(
        plainToInstance(DeleteAccountDto, {
          confirmation: 'DELETE',
          ...method,
        }),
      ),
    ).not.toHaveLength(0);
  });
});
