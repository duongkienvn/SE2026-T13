import { Resend } from 'resend';
import { welcomeEmail } from '../../src/mail/welcome-email';
import { FakeWelcomeMailer } from '../../src/mail/welcome-mailer';
import { ResendWelcomeMailer } from '../../src/mail/resend-welcome-mailer';

const message = {
  from: 'Kanvexa <no-reply@example.test>',
  to: 'recipient@example.test',
  ...welcomeEmail('https://example.test'),
};

describe('welcome mail adapters', () => {
  it('passes the frozen HTML/text/sender/recipient, stable key and abort signal to Resend', async () => {
    const send = jest
      .fn()
      .mockResolvedValue({ data: { id: 'mock' }, error: null });
    const mailer = new ResendWelcomeMailer({
      emails: { send },
    } as unknown as Resend);
    await mailer.send(message, 'welcome/user');
    expect(send).toHaveBeenCalledWith(
      { ...message, to: [message.to] },
      { idempotencyKey: 'welcome/user', signal: expect.any(AbortSignal) },
    );
  });

  it.each([
    { data: null, error: { message: 'SECRET recipient/provider body' } },
    { data: null, error: null },
    new Error('SECRET network error'),
  ])('sanitizes failed provider requests', async (result) => {
    const send =
      result instanceof Error
        ? jest.fn().mockRejectedValue(result)
        : jest.fn().mockResolvedValue(result);
    const mailer = new ResendWelcomeMailer({
      emails: { send },
    } as unknown as Resend);
    await expect(mailer.send(message, 'welcome/user')).rejects.toThrow(
      /^Welcome email provider unavailable$/,
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('aborts a stalled SDK request without using the network', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(
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
    const log = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      await expect(
        new ResendWelcomeMailer(new Resend('re_unit_only'), 5).send(
          message,
          'welcome/user',
        ),
      ).rejects.toThrow('Welcome email provider unavailable');
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      fetch.mockRestore();
      log.mockRestore();
    }
  });

  it('captures bounded fake deliveries with no network and deduplicates retries', async () => {
    const fake = new FakeWelcomeMailer();
    const fetch = jest.spyOn(globalThis, 'fetch');
    try {
      await fake.send(message, 'welcome/user');
      await fake.send(message, 'welcome/user');
      expect(fake.deliveries).toEqual([
        { message, idempotencyKey: 'welcome/user' },
      ]);
      expect(fetch).not.toHaveBeenCalled();
      for (let i = 0; i < 25; i++) await fake.send(message, `welcome/${i}`);
      expect(fake.deliveries).toHaveLength(20);
    } finally {
      fetch.mockRestore();
    }
  });
});
