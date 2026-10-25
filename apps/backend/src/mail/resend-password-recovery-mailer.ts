import { Resend } from 'resend';
import { PasswordRecoveryMailer } from './password-recovery-mailer';
import { passwordRecoveryEmail } from './password-recovery-email';

export class ResendPasswordRecoveryMailer extends PasswordRecoveryMailer {
  constructor(
    private readonly client: Resend,
    private readonly from: string,
    private readonly timeoutMs = 10_000,
  ) {
    super();
  }

  async send(
    email: string,
    url: string,
    idempotencyKey: string,
  ): Promise<void> {
    try {
      const result = await this.client.emails.send(
        { from: this.from, to: [email], ...passwordRecoveryEmail(url) },
        { idempotencyKey, signal: AbortSignal.timeout(this.timeoutMs) },
      );
      if (result.error || !result.data?.id)
        throw new Error('Provider rejected request');
    } catch {
      throw new Error('Password recovery email provider unavailable');
    }
  }
}
