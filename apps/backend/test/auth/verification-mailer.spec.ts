import { Resend } from 'resend';
import { ResendVerificationMailer } from '../../src/mail/resend-verification-mailer';
import { FakeVerificationMailer } from '../../src/mail/verification-mailer';
import { verificationEmail } from '../../src/mail/verification-email';
import { validateEnvironment } from '../../src/config/environment';

describe('verification mail adapter', () => {
  it('aborts a stalled request through the actual SDK without making a network call', async () => {
    const sdkLog = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, options) =>
        new Promise((_resolve, reject) => {
          const signal = options?.signal;
          if (signal?.aborted)
            reject(new DOMException('aborted', 'AbortError'));
          else
            signal?.addEventListener(
              'abort',
              () => reject(new DOMException('aborted', 'AbortError')),
              { once: true },
            );
        }),
    );
    try {
      const adapter = new ResendVerificationMailer(
        new Resend('re_unit_test_only'),
        'Sender <sender@example.test>',
        5,
      );
      await expect(
        adapter.send(
          'recipient@example.test',
          'https://example.test/',
          'unit-request',
        ),
      ).rejects.toThrow('Verification email provider unavailable');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
      sdkLog.mockRestore();
    }
  });
  it('sends HTML/text with an idempotency key and an abort signal', async () => {
    const send = jest
      .fn()
      .mockResolvedValue({ data: { id: 'accepted' }, error: null });
    const mailer = new ResendVerificationMailer(
      { emails: { send } } as unknown as Resend,
      'Kanvexa <no-reply@kanvexa.tech>',
    );
    await mailer.send(
      'recipient@example.test',
      'https://kanvexa.tech/verify-email?token=placeholder',
      'request-id',
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Verify your Kanvexa email address',
        text: expect.stringContaining('24 hours'),
        html: expect.stringContaining('Verify Email Address'),
      }),
      expect.objectContaining({
        idempotencyKey: 'request-id',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    { error: { message: 'provider rejection' }, data: null },
    { error: null, data: null },
    new Error('network failure'),
    new DOMException('timeout', 'TimeoutError'),
  ])(
    'fails closed for SDK errors, missing IDs and transport failures',
    async (result) => {
      const send = jest.fn();
      if (result instanceof Error) send.mockRejectedValue(result);
      else send.mockResolvedValue(result);
      const mailer = new ResendVerificationMailer(
        { emails: { send } } as unknown as Resend,
        'Sender <sender@example.test>',
      );
      await expect(
        mailer.send(
          'recipient@example.test',
          'https://example.test/verify-email',
          'request',
        ),
      ).rejects.toThrow('Verification email provider unavailable');
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it('escapes dynamic HTML and captures development email without network access', async () => {
    expect(verificationEmail('https://example.test/?a="<&').html).not.toContain(
      'a="<&',
    );
    const fake = new FakeVerificationMailer();
    await fake.send('recipient@example.test', 'https://example.test/');
    expect(fake.deliveries).toHaveLength(1);
  });

  const base = {
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://kanvexa.tech',
    JWT_SECRET: 'configuration-only-at-least-32-bytes',
    DATABASE_HOST: 'localhost',
    DATABASE_PORT: '5432',
    DATABASE_NAME: 'test',
    DATABASE_USER: 'test',
    DATABASE_PASSWORD: 'test',
    RESEND_API_KEY: 're_configuration_only',
    MAIL_FROM: 'Kanvexa <no-reply@kanvexa.tech>',
    PUBLIC_APP_URL: 'https://kanvexa.tech',
  };
  it.each(['RESEND_API_KEY', 'MAIL_FROM', 'PUBLIC_APP_URL'])(
    'fails fast when production omits %s',
    (key) => {
      expect(() => validateEnvironment({ ...base, [key]: '' })).toThrow(key);
    },
  );
  it.each([
    'http://kanvexa.tech',
    'https://kanvexa.tech/path',
    'https://kanvexa.tech?x=y',
    'https://user:password@kanvexa.tech',
  ])('rejects unsafe application origins', (PUBLIC_APP_URL) => {
    expect(() => validateEnvironment({ ...base, PUBLIC_APP_URL })).toThrow(
      'PUBLIC_APP_URL',
    );
  });
  it('validates production and keeps test delivery fake even with a key', () => {
    expect(validateEnvironment(base).PUBLIC_APP_URL).toBe(
      'https://kanvexa.tech',
    );
    expect(
      validateEnvironment({ ...base, NODE_ENV: 'test' }).RESEND_API_KEY,
    ).toBe('');
  });
});
