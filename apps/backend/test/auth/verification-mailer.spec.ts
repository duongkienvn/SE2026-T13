import { Resend } from 'resend';
import { ResendVerificationMailer } from '../../src/mail/resend-verification-mailer';
import { FakeVerificationMailer } from '../../src/mail/verification-mailer';
import { verificationEmail } from '../../src/mail/verification-email';
import { validateEnvironment } from '../../src/config/environment';

describe('verification mail adapter', () => {
  it('centers a fluid card with cell padding and legacy-client layout fallbacks', () => {
    const { html } = verificationEmail(
      'https://example.invalid/verify-email?token=preview-only',
    );
    expect(html).not.toMatch(/<main\b|display\s*:\s*(?:flex|grid)/i);
    const tables = [...html.matchAll(/<table\b[^>]*>/g)].map(([tag]) => tag);
    expect(tables.length).toBeGreaterThanOrEqual(4);
    for (const table of tables) {
      expect(table).toContain('role="presentation"');
      expect(table).toContain('cellpadding="0"');
      expect(table).toContain('cellspacing="0"');
    }
    expect(
      tables.some(
        (table) =>
          table.includes('align="center"') &&
          table.includes('width="100%"') &&
          table.includes('max-width:580px') &&
          table.includes('table-layout:fixed'),
      ),
    ).toBe(true);
    expect(html).toMatch(
      /<td\b[^>]*align="center"[^>]*style="padding:32px 12px"/,
    );
    expect(html).toContain('<td style="padding:32px 24px">');
    expect(html).toContain('<!--[if mso]>');
    expect(tables.some((table) => table.includes('width="580"'))).toBe(true);
    expect(html).toContain('bgcolor="#ffffff"');
    expect(html).toContain('mso-padding-alt:16px 22px');
    expect(html).toContain('word-break:break-all;overflow-wrap:anywhere');
    expect(html).not.toMatch(/<script\b|<link\b|<iframe\b|@import|data:|cid:/i);
  });

  it('keeps subject, plain text and business wording unchanged', () => {
    const url =
      'https://example.invalid/verify-email?token=preview-only&source=unit';
    const email = verificationEmail(url);
    expect(email.subject).toBe('Verify your Kanvexa email address');
    expect(email.text).toBe(
      `Welcome to Kanvexa.\n\nVerify your email address: ${url}\n\nThis link expires in 24 hours and can be used once. If you did not create an account, ignore this email.`,
    );
    for (const wording of [
      'One step closer to your team',
      'Welcome! Confirm your email address to start organizing work and moving ideas forward.',
      'Verify Email Address',
      'This link expires in <strong>24 hours</strong> and can only be used once.',
      'If you did not create a Kanvexa account, you can safely ignore this email.',
      'Button not working? Copy this link:',
    ]) {
      expect(email.html).toContain(wording);
    }
    expect(email.html).toContain('@media (prefers-color-scheme: dark)');
    expect(email.html).toContain('color:#ffffff');
  });

  it.each([
    [
      'https://example.invalid/verify-email?token=a&source=b',
      'https://example.invalid/verify-email?token=a&amp;source=b',
    ],
    [
      'https://example.invalid/verify-email?token="<>&\'',
      'https://example.invalid/verify-email?token=&quot;&lt;&gt;&amp;&#39;',
    ],
    [
      'https://example.invalid/?token="><img src=x onerror="alert(1)">',
      'https://example.invalid/?token=&quot;&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
    ],
    [
      'https://example.invalid/?token=</a><script>alert(1)</script>',
      'https://example.invalid/?token=&lt;/a&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
    ],
  ])(
    'escapes both URLs and fallback text without introducing HTML: %s',
    (url, escaped) => {
      const { html, text } = verificationEmail(url);
      const links = [
        ...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g),
      ];
      expect(links).toHaveLength(2);
      expect(links.map((match) => match[1])).toEqual([escaped, escaped]);
      expect(links[0][2]).toBe('Verify Email Address');
      expect(links[1][2]).toBe(escaped);
      expect([...html.matchAll(/<img\b/g)]).toHaveLength(1);
      expect(html).not.toMatch(/<script\b|<img src=x|"\s+onerror=/i);
      expect(text).toContain(url);
    },
  );

  it('preserves encoded token bytes in both links, including a long fallback URL', () => {
    const token = `preview-only_${'A-b_'.repeat(100)}&"<>`;
    const url = `https://example.invalid/verify-email?token=${encodeURIComponent(token)}`;
    const { html, text } = verificationEmail(url);
    const hrefs = [...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map(
      (match) => match[1],
    );
    expect(hrefs).toEqual([url, url]);
    expect(
      hrefs.map((href) => new URL(href).searchParams.get('token')),
    ).toEqual([token, token]);
    expect(text).toContain(url);
  });

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

  it('uses public, recipient-independent PNG artwork and keeps verification links intact', () => {
    const url =
      'http://localhost:5173/verify-email?token=unit-only&source=mail';
    const email = verificationEmail(url);
    const images = [...email.html.matchAll(/<img\b[^>]*src="([^"]+)"[^>]*>/g)];
    expect(images).toHaveLength(1);
    const imageUrl = new URL(images[0][1]);
    expect(imageUrl.protocol).toBe('https:');
    expect(imageUrl.hostname).toBe('kanvexa.tech');
    expect(imageUrl.pathname).toBe('/branding/kanvexa-logo-v1.png');
    expect(imageUrl.search).toBe('');
    expect(images[0][0]).toContain('width="64" height="64" alt=""');
    expect(email.html).toContain('role="presentation"');
    // The wordmark remains text when remote images are blocked. Two links
    // (CTA and fallback) retain the same escaped verification URL.
    expect(email.html).toContain('>Kanvexa</td>');
    expect(
      email.html.match(
        /href="http:\/\/localhost:5173\/verify-email\?token=unit-only&amp;source=mail"/g,
      ),
    ).toHaveLength(2);
    expect(email.text).toContain(url);
    expect(email.text).not.toContain(imageUrl.href);
    expect(email.html).not.toMatch(/src="(?:data:|cid:|file:|\/)/);
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
