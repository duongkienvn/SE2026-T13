import { Resend } from 'resend';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MailModule } from '../../src/mail/mail.module';
import { validateEnvironment } from '../../src/config/environment';
import { boardMemberAddedEmail } from '../../src/mail/board-member-added-email';
import {
  BoardMemberAddedMailer,
  FakeBoardMemberAddedMailer,
} from '../../src/mail/board-member-added-mailer';
import { ResendBoardMemberAddedMailer } from '../../src/mail/resend-board-member-added-mailer';

const payload = {
  membershipId: 'member-1',
  boardId: 'c6ba7134-97ef-4c1b-a342-001a982a7721',
  boardName: 'Dự án 東京 & <Board>',
  actorDisplayName: 'Owner <script> & "name"',
  recipient: 'target@example.test',
  recipientDisplayName: 'Target',
};
const from = 'Kanvexa <no-reply@example.test>';
const origin = 'https://example.test';
const signal = () => new AbortController().signal;
const adapter = (send: jest.Mock, appOrigin = origin) =>
  new ResendBoardMemberAddedMailer(
    { emails: { send } } as unknown as Resend,
    from,
    appOrigin,
  );

describe('Board member added content and transport (no real mail)', () => {
  it.each([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://staging.example.test',
    'https://kanvexa.tech',
  ])(
    'renders branded escaped HTML and plain text using configured %s',
    (appOrigin) => {
      const content = boardMemberAddedEmail(payload, appOrigin);
      expect(content.subject).toBe("You've been added to a board on Kanvexa");
      expect(content.html).toContain('Dự án 東京 &amp; &lt;Board&gt;');
      expect(content.html).toContain(
        'Owner &lt;script&gt; &amp; &quot;name&quot;',
      );
      expect(content.html).not.toContain('<script>');
      expect(content.html).toContain('kanvexa-logo-v1.png');
      expect(content.html).toContain('Open Board');
      expect(content.html).toContain(`${appOrigin}/boards/${payload.boardId}`);
      expect(content.html).not.toContain(payload.recipient);
      expect(content.text).toContain(
        `${payload.actorDisplayName} added you to “${payload.boardName}”`,
      );
      const url = new URL(content.text.match(/Open Board: (\S+)/)![1]);
      expect(url.origin).toBe(appOrigin);
      expect(url.pathname).toBe(`/boards/${payload.boardId}`);
      expect(url.search + url.hash).toBe('');
      expect(content.text).not.toMatch(/Workspace|invitation|token/);
    },
  );

  it('handles missing names and bounds long/control-character content in both parts', () => {
    const fallback = boardMemberAddedEmail(
      {
        ...payload,
        actorDisplayName: null,
        recipientDisplayName: '',
        boardName: '',
      },
      origin,
    );
    expect(fallback.text).toContain('Hello there,');
    expect(fallback.text).toContain('A board owner added you to “Board”');
    const hostile = '\r\n\u202e<script>' + '😀'.repeat(1000);
    const content = boardMemberAddedEmail(
      {
        ...payload,
        actorDisplayName: hostile,
        boardName: hostile,
        recipientDisplayName: hostile,
      },
      origin,
    );
    expect(content.html).not.toMatch(/<script>|\u202e/);
    expect(content.text).not.toContain('\r');
    expect(content.text).not.toContain('😀'.repeat(201));
    expect(content.text).toContain('…');
    expect(content.subject).toBe(fallback.subject);
  });

  it.each([
    '',
    'not-url',
    'https://user:pass@example.test',
    'https://example.test/path',
    'https://example.test?secret=1',
    'https://example.test#hash',
    'http://remote.example.test',
    'javascript:alert(1)',
  ])('rejects unsafe origin %s before provider IO', async (appOrigin) => {
    const send = jest.fn();
    expect(await adapter(send, appOrigin).send(payload, signal())).toBe(
      'FAILED',
    );
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects path injection from an invalid Board ID', () => {
    expect(() =>
      boardMemberAddedEmail({ ...payload, boardId: '../workspaces' }, origin),
    ).toThrow();
  });
  it('uses stable membership key, sender, recipient, content and cancellation signal', async () => {
    const send = jest.fn().mockResolvedValue({ data: { id: 'accepted' } });
    const abortSignal = signal();
    expect(await adapter(send).send(payload, abortSignal)).toBe('SENT');
    expect(send).toHaveBeenCalledWith(
      {
        from,
        to: [payload.recipient],
        ...boardMemberAddedEmail(payload, origin),
      },
      { idempotencyKey: 'board-member-added/member-1', signal: abortSignal },
    );
  });
  it.each([400, 401, 403, 422, 429, 408, 409, 500, 503, undefined])(
    'handles provider HTTP %s with no retry',
    async (statusCode) => {
      const send = jest.fn().mockResolvedValue({
        error: { statusCode, message: payload.recipient },
      });
      expect(await adapter(send).send(payload, signal())).toBe(
        statusCode && statusCode < 500 && ![408, 409].includes(statusCode)
          ? 'FAILED'
          : 'UNKNOWN',
      );
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
  it('treats malformed acceptance and thrown network failure as uncertain', async () => {
    for (const send of [
      jest.fn().mockResolvedValue({ data: {} }),
      jest.fn().mockRejectedValue(new Error(payload.recipient)),
    ]) {
      expect(await adapter(send).send(payload, signal())).toBe('UNKNOWN');
      expect(send).toHaveBeenCalledTimes(1);
    }
  });
  it('does not send after abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const send = jest.fn();
    expect(await adapter(send).send(payload, controller.signal)).toBe(
      'UNKNOWN',
    );
    expect(send).not.toHaveBeenCalled();
  });
  it('silences real SDK private error bodies and cancels a stalled request', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch');
    const log = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const prior = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const mailer = new ResendBoardMemberAddedMailer(
        new Resend('re_synthetic_test_only'),
        from,
        origin,
      );
      fetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: 'validation_error',
            statusCode: 422,
            message: JSON.stringify(payload),
          }),
          { status: 422 },
        ),
      );
      expect(await mailer.send(payload, signal())).toBe('FAILED');
      fetch.mockImplementation(
        async (_url, options) =>
          new Promise((_resolve, reject) => {
            const abort = options?.signal;
            if (abort?.aborted) reject(abort.reason);
            else
              abort?.addEventListener('abort', () => reject(abort.reason), {
                once: true,
              });
          }),
      );
      expect(await mailer.send(payload, AbortSignal.timeout(5))).toBe(
        'UNKNOWN',
      );
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(log).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = prior;
      fetch.mockRestore();
      log.mockRestore();
    }
  });
  it('captures bounded fake mail and deduplicates the same event', async () => {
    const fake = new FakeBoardMemberAddedMailer(from, origin);
    await fake.send(payload, signal());
    await fake.send(payload, signal());
    expect(fake.deliveries).toHaveLength(1);
    expect(fake.deliveries[0].message.to).toBe(payload.recipient);
    for (let i = 0; i < 25; i++)
      await fake.send(
        { ...payload, membershipId: `member-${i + 2}` },
        signal(),
      );
    expect(fake.deliveries).toHaveLength(20);
  });
  it('wires the existing validated fake transport even when a test requests Resend', async () => {
    const config = validateEnvironment({
      NODE_ENV: 'test',
      MAIL_TRANSPORT: 'resend',
      PUBLIC_APP_URL: origin,
      JWT_SECRET: 'synthetic-unit-secret-'.repeat(3),
      DATABASE_HOST: '127.0.0.1',
      DATABASE_PORT: '5432',
      DATABASE_NAME: 'test',
      DATABASE_USER: 'test',
      DATABASE_PASSWORD: 'test',
    });
    const module = await Test.createTestingModule({ imports: [MailModule] })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(config))
      .compile();
    try {
      expect(module.get(BoardMemberAddedMailer)).toBeInstanceOf(
        FakeBoardMemberAddedMailer,
      );
    } finally {
      await module.close();
    }
  });
});
