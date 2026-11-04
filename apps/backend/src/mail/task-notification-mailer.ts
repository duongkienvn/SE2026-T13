import { Resend } from 'resend';
import { escapeHtml } from './verification-email';

export type TaskMailResult = 'SENT' | 'RETRY' | 'FAILED' | 'UNKNOWN';
export interface TaskMail {
  recipient: string;
  boardId: string;
  cardId: string;
  outboxId: string;
}

export abstract class TaskNotificationMailer {
  abstract send(message: TaskMail): Promise<TaskMailResult>;
}

export function taskNotificationContent(message: TaskMail, appOrigin: string) {
  const origin = new URL(appOrigin);
  if (
    origin.origin !== appOrigin ||
    (origin.protocol !== 'https:' &&
      (origin.protocol !== 'http:' ||
        !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))
  )
    throw new Error('Invalid application origin');
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(message.boardId) || !uuid.test(message.cardId))
    throw new Error('Invalid task link');
  const url = new URL(
    `/boards/${message.boardId}/cards/${message.cardId}`,
    origin,
  ).toString();
  return {
    subject: 'You have a task update on Kanvexa',
    text: `You have a task update on Kanvexa. Sign in to view it: ${url}\n\nThe Kanvexa Team`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Task update</title></head><body style="font-family:Arial,sans-serif;color:#172038"><main><h1>Kanvexa</h1><p>You have a task update.</p><p><a href="${escapeHtml(url)}">Sign in to view your task</a></p><p>The Kanvexa Team</p></main></body></html>`,
  };
}

export class FakeTaskNotificationMailer extends TaskNotificationMailer {
  readonly deliveries: TaskMail[] = [];
  async send(message: TaskMail): Promise<TaskMailResult> {
    if (!this.deliveries.some((item) => item.outboxId === message.outboxId))
      this.deliveries.push({ ...message });
    return 'SENT';
  }
}

export class ResendTaskNotificationMailer extends TaskNotificationMailer {
  constructor(
    private readonly client: Resend,
    private readonly from: string,
    private readonly origin: string,
  ) {
    super();
    Object.defineProperty(client, 'logError', { value: () => undefined });
  }
  async send(message: TaskMail): Promise<TaskMailResult> {
    let content: ReturnType<typeof taskNotificationContent>;
    try {
      content = taskNotificationContent(message, this.origin);
    } catch {
      return 'FAILED';
    }
    try {
      const result = await this.client.emails.send(
        { from: this.from, to: [message.recipient], ...content },
        {
          idempotencyKey: `task-notification/${message.outboxId}`,
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!result.error && result.data?.id) return 'SENT';
      const code = result.error?.statusCode;
      if (code === 429) return 'RETRY';
      if (code && code >= 400 && code < 500 && code !== 408 && code !== 409)
        return 'FAILED';
      return 'UNKNOWN';
    } catch {
      return 'UNKNOWN';
    }
  }
}
