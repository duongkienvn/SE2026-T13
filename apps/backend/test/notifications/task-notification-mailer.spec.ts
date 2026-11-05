import {
  FakeTaskNotificationMailer,
  ResendTaskNotificationMailer,
  taskNotificationContent,
} from '../../src/mail/task-notification-mailer';
import type { Resend } from 'resend';
import { NotificationKind } from '@kanban/shared';
import type { TaskMail } from '../../src/mail/task-notification-mailer';
import { escapeHtml } from '../../src/mail/verification-email';

const message: TaskMail = {
  kind: NotificationKind.CARD_ASSIGNED,
  recipient: 'test@example.test',
  boardId: '00000000-0000-4000-8000-000000000001',
  cardId: '00000000-0000-4000-8000-000000000002',
  outboxId: '00000000-0000-4000-8000-000000000003',
};

describe('task notification mail', () => {
  const events = [
    {
      kind: NotificationKind.CARD_ASSIGNED,
      subject: "You've been assigned to a card on Kanvexa",
      heading: "You've been assigned to a card!",
      description:
        'A new task has been assigned to you. Open Kanvexa to view the details and get started.',
      action: 'View your task',
    },
    {
      kind: NotificationKind.COMMENT_MENTIONED,
      subject: 'Someone mentioned you on Kanvexa',
      heading: 'You were mentioned in a comment!',
      description:
        'Someone mentioned you in a card discussion. Open Kanvexa to see the conversation.',
      action: 'View conversation',
    },
    {
      kind: NotificationKind.DUE_REMINDER,
      subject: 'A task deadline is approaching on Kanvexa',
      heading: 'You have an upcoming deadline!',
      description:
        'A task assigned to you is approaching its due date. Open Kanvexa to review the details and plan your next steps.',
      action: 'View your task',
    },
  ];
  it.each(events)(
    'renders $kind with branded HTML and text parity',
    (event) => {
      const content = taskNotificationContent(
        { ...message, kind: event.kind },
        'https://kanvexa.example',
      );
      const url = `https://kanvexa.example/boards/${message.boardId}/cards/${message.cardId}`;
      expect(content.subject).toBe(event.subject);
      expect(content.html).toContain(`>${escapeHtml(event.heading)}</h1>`);
      expect(content.html).toContain(escapeHtml(event.description));
      expect(content.html).toContain(`>${event.action}</a>`);
      expect(content.html.match(/href="([^"]+)"/g)).toEqual([
        `href="${url}"`,
        `href="${url}"`,
      ]);
      expect(content.html).toContain(`>${url}</a>`);
      expect(content.text).toContain(event.heading);
      expect(content.text).toContain(event.description);
      expect(content.text).toContain(`${event.action}: ${url}`);
      expect(content.text).not.toMatch(/<[^>]+>|&(?:amp|quot|#39);/);
      for (const part of [content.text, content.html]) {
        expect(part).toContain('Kanvexa');
        expect(part).toContain('The Kanvexa Team');
        expect(part).toContain('Access follows your current permissions.');
        expect(part).not.toContain(message.recipient);
        expect(part).not.toContain(message.outboxId);
      }
      expect(content.html).toContain('max-width:600px');
      expect(content.html).toContain('<!--[if mso]>');
      expect(content.html).toContain('mso-padding-alt:');
      expect(content.html).toContain('role="presentation"');
      expect(content.html).toContain('max-width:480px');
      expect(content.html).toContain('prefers-color-scheme: dark');
      expect(content.html).toContain('overflow-wrap:anywhere');
      expect(content.html).toContain('background-color:#615CF7');
      // The existing static brand asset carries no recipient identifiers or tracking.
      expect(content.html.match(/src="([^"]+)"/g)).toEqual([
        'src="https://kanvexa.tech/branding/kanvexa-logo-v1.png"',
      ]);
      const privatePayload = {
        ...message,
        kind: event.kind,
        recipient: 'private-account@example.test',
        outboxId: 'internal-delivery-id',
        cardTitle: '<script>private card</script>',
        boardName: 'private board',
        workspaceName: 'private workspace',
        commentText: 'private mention excerpt',
        actorName: 'private actor',
        assigneeName: 'private assignee',
        dueDate: '2099-01-01T00:00:00Z',
      };
      expect(
        taskNotificationContent(privatePayload, 'https://kanvexa.example'),
      ).toEqual(content);
    },
  );

  it.each([
    'https://bad.example/path',
    'https://bad.example/',
    'https://bad.example?token=secret',
    'https://bad.example#fragment',
    'https://user:password@bad.example',
    'http://public.example',
    'javascript:alert(1)',
    '//bad.example',
    'not a URL',
  ])('rejects unsafe application origin %s', (origin) => {
    expect(() => taskNotificationContent(message, origin)).toThrow();
  });

  it.each([
    'https://kanvexa.example',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://[::1]:5173',
  ])('preserves allowed application origin %s', (origin) => {
    expect(taskNotificationContent(message, origin).text).toContain(
      `${origin}/boards/`,
    );
  });

  it.each([
    '../bad',
    'not-a-uuid',
    `${message.cardId}?token=secret`,
    `${message.cardId}" onclick="alert(1)`,
  ])('rejects unsafe Board and Card IDs %s', (id) => {
    for (const field of ['boardId', 'cardId'])
      expect(() =>
        taskNotificationContent(
          { ...message, [field]: id },
          'https://kanvexa.example',
        ),
      ).toThrow('Invalid task link');
  });

  it('escapes the validated URL in both link attributes and visible fallback', () => {
    const content = taskNotificationContent(
      message,
      "https://kan&'vexa.example",
    );
    const url = `https://kan&'vexa.example/boards/${message.boardId}/cards/${message.cardId}`;
    expect(content.text).toContain(url);
    expect(content.html).toContain(`href="${escapeHtml(url)}"`);
    expect(content.html).toContain(`>${escapeHtml(url)}</a>`);
    expect(content.html).not.toContain(url);
  });

  it.each([
    undefined,
    null,
    '',
    'BOARD_INVITED',
    'UNKNOWN',
    '__proto__',
    'constructor',
  ])('rejects unsupported runtime kind %s without sending', async (kind) => {
    const invalid = { ...message };
    Object.defineProperty(invalid, 'kind', { value: kind });
    expect(() =>
      taskNotificationContent(invalid, 'https://kanvexa.example'),
    ).toThrow('Unsupported task email kind');
    const fake = new FakeTaskNotificationMailer();
    expect(await fake.send(invalid)).toBe('FAILED');
    expect(fake.deliveries).toEqual([]);
    const send = jest.fn();
    const mailer = new ResendTaskNotificationMailer(
      { emails: { send } } as unknown as Resend,
      'from@example.test',
      'https://kanvexa.example',
    );
    expect(await mailer.send(invalid)).toBe('FAILED');
    expect(send).not.toHaveBeenCalled();
  });
  it('deduplicates fake sends and never needs a network', async () => {
    const fake = new FakeTaskNotificationMailer();
    await fake.send(message);
    await fake.send(message);
    expect(fake.deliveries).toHaveLength(1);
  });
  it('uses provider idempotency and distinguishes known and ambiguous results', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ data: { id: 'id' } })
      .mockResolvedValueOnce({ error: { statusCode: 429 } })
      .mockRejectedValueOnce(new Error('timeout'));
    const client = { emails: { send } } as unknown as Resend;
    const mailer = new ResendTaskNotificationMailer(
      client,
      'from@example.test',
      'https://kanvexa.example',
    );
    expect(await mailer.send(message)).toBe('SENT');
    expect(send.mock.calls[0][1].idempotencyKey).toBe(
      `task-notification/${message.outboxId}`,
    );
    expect(send.mock.calls[0][0]).toEqual({
      from: 'from@example.test',
      to: [message.recipient],
      ...taskNotificationContent(message, 'https://kanvexa.example'),
    });
    expect(await mailer.send(message)).toBe('RETRY');
    expect(await mailer.send(message)).toBe('UNKNOWN');
  });

  it.each([
    [{ error: { statusCode: 400 } }, 'FAILED'],
    [{ error: { statusCode: 408 } }, 'UNKNOWN'],
    [{ error: { statusCode: 409 } }, 'UNKNOWN'],
    [{ error: { statusCode: 500 } }, 'UNKNOWN'],
    [{ data: null }, 'UNKNOWN'],
  ])('preserves provider outcome handling for %j', async (result, expected) => {
    const send = jest.fn().mockResolvedValue(result);
    const mailer = new ResendTaskNotificationMailer(
      { emails: { send } } as unknown as Resend,
      'from@example.test',
      'https://kanvexa.example',
    );
    expect(await mailer.send(message)).toBe(expected);
  });
});
