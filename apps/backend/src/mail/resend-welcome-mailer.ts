import { Resend } from 'resend';
import { WelcomeMailer, WelcomeMessage } from './welcome-mailer';

export class ResendWelcomeMailer extends WelcomeMailer {
  constructor(
    private readonly client: Resend,
    private readonly timeoutMs = 10_000,
  ) {
    super();
  }

  async send(message: WelcomeMessage, idempotencyKey: string): Promise<void> {
    try {
      const { to, ...content } = message;
      const result = await this.client.emails.send(
        { ...content, to: [to] },
        { idempotencyKey, signal: AbortSignal.timeout(this.timeoutMs) },
      );
      if (result.error || !result.data?.id) throw new Error('Request rejected');
    } catch {
      // Provider errors can include credentials, recipients or message bodies.
      throw new Error('Welcome email provider unavailable');
    }
  }
}
