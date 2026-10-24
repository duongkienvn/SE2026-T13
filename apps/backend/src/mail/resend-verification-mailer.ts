import { Resend } from 'resend';
import { VerificationMailer } from './verification-mailer';
import { verificationEmail } from './verification-email';

export class ResendVerificationMailer extends VerificationMailer {
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
        {
          from: this.from,
          to: [email],
          ...verificationEmail(url),
        },
        { idempotencyKey, signal: AbortSignal.timeout(this.timeoutMs) },
      );
      if (result.error || !result.data?.id)
        throw new Error('Provider rejected request');
    } catch {
      // Do not propagate SDK errors: they may contain request bodies or credentials.
      throw new Error('Verification email provider unavailable');
    }
  }
}
