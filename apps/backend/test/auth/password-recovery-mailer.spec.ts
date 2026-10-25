import { Resend } from 'resend';
import { passwordRecoveryEmail } from '../../src/mail/password-recovery-email';
import { ResendPasswordRecoveryMailer } from '../../src/mail/resend-password-recovery-mailer';
import { FakePasswordRecoveryMailer } from '../../src/mail/password-recovery-mailer';

describe('password recovery mail', () => {
  const url = 'https://example.test/reset-password?token=opaque&other="unsafe"';
  it('has dedicated recovery copy, expiry, escaped links and no remote resources', () => {
    const content = passwordRecoveryEmail(url);
    expect(content.subject).toBe('Reset your Kanvexa password');
    expect(content.text).toContain('30 minutes');
    expect(content.html).toContain('token=opaque&amp;other=&quot;unsafe&quot;');
    expect(content.html).not.toMatch(/<img|<script|<link|verify-email/i);
  });
  it('uses fake transport without real delivery', async () => {
    const fake = new FakePasswordRecoveryMailer();
    await fake.send('person@example.test', url);
    expect(fake.deliveries).toEqual([{ email: 'person@example.test', url }]);
  });
  it('sends recovery copy with idempotency, deadline and no retry', async () => {
    const send = jest.fn().mockResolvedValue({ data: { id: 'accepted' } });
    const mailer = new ResendPasswordRecoveryMailer(
      { emails: { send } } as unknown as Resend,
      'Kanvexa <from@example.test>',
    );
    await mailer.send('person@example.test', url, 'recovery/hash');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Reset your Kanvexa password' }),
      expect.objectContaining({
        idempotencyKey: 'recovery/hash',
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it.each(['throw', 'rejected', 'missing'])(
    'sanitizes provider %s failures without retrying',
    async (failure) => {
      const send = jest.fn();
      if (failure === 'throw')
        send.mockRejectedValue(new Error('secret token details'));
      else
        send.mockResolvedValue(
          failure === 'rejected'
            ? { error: { message: 'secret' } }
            : { data: {} },
        );
      const mailer = new ResendPasswordRecoveryMailer(
        { emails: { send } } as unknown as Resend,
        'sender',
      );
      await expect(
        mailer.send('person@example.test', url, 'key'),
      ).rejects.toThrow('Password recovery email provider unavailable');
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
  it('aborts a stalled provider request at its deadline', async () => {
    const send = jest.fn(
      (_input, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(new Error('timeout with secret')),
          );
        }),
    );
    const mailer = new ResendPasswordRecoveryMailer(
      { emails: { send } } as unknown as Resend,
      'sender',
      10,
    );
    await expect(
      mailer.send('person@example.test', url, 'key'),
    ).rejects.toThrow('Password recovery email provider unavailable');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
