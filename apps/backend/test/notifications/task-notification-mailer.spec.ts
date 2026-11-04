import {
  FakeTaskNotificationMailer,
  ResendTaskNotificationMailer,
  taskNotificationContent,
} from '../../src/mail/task-notification-mailer';
import type { Resend } from 'resend';

const message = {
  recipient: 'test@example.test',
  boardId: '00000000-0000-4000-8000-000000000001',
  cardId: '00000000-0000-4000-8000-000000000002',
  outboxId: '00000000-0000-4000-8000-000000000003',
};

describe('task notification mail', () => {
  it('renders generic text and a safe internal link', () => {
    const content = taskNotificationContent(message, 'https://kanvexa.example');
    expect(content.text).toContain(
      `/boards/${message.boardId}/cards/${message.cardId}`,
    );
    expect(content.html).toContain('Sign in to view your task');
    expect(content.subject).not.toContain(message.recipient);
    expect(() =>
      taskNotificationContent(message, 'https://bad.example/path'),
    ).toThrow();
    expect(() =>
      taskNotificationContent(
        { ...message, cardId: '../bad' },
        'https://kanvexa.example',
      ),
    ).toThrow();
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
    expect(await mailer.send(message)).toBe('RETRY');
    expect(await mailer.send(message)).toBe('UNKNOWN');
  });
});
