import { Resend } from 'resend';
import {
  isTaskEmailKind,
  type TaskEmailKind,
} from '../api/notifications/task-email-outbox';
import { taskNotificationContent } from './task-notification-email';

export { taskNotificationContent } from './task-notification-email';

export type TaskMailResult = 'SENT' | 'RETRY' | 'FAILED' | 'UNKNOWN';
export interface TaskMail {
  kind: TaskEmailKind;
  recipient: string;
  boardId: string;
  cardId: string;
  outboxId: string;
}

export abstract class TaskNotificationMailer {
  abstract send(message: TaskMail): Promise<TaskMailResult>;
}

export class FakeTaskNotificationMailer extends TaskNotificationMailer {
  readonly deliveries: TaskMail[] = [];
  async send(message: TaskMail): Promise<TaskMailResult> {
    if (!isTaskEmailKind(message.kind)) return 'FAILED';
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
