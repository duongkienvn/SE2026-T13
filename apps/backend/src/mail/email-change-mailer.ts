import { Resend } from 'resend';
import {
  emailChangedSecurityEmail,
  emailChangeProofEmail,
} from './email-change-email';

export abstract class EmailChangeMailer {
  abstract sendProof(
    email: string,
    url: string,
    idempotencyKey: string,
  ): Promise<void>;
  abstract sendSecurityAlert(
    email: string,
    idempotencyKey: string,
  ): Promise<void>;
}
/** Explicit fake transport only; captured secrets are never persisted or logged. */
export class FakeEmailChangeMailer extends EmailChangeMailer {
  readonly proofs: {
    email: string;
    url: string;
    message: ReturnType<typeof emailChangeProofEmail>;
  }[] = [];
  readonly alerts: {
    email: string;
    message: ReturnType<typeof emailChangedSecurityEmail>;
  }[] = [];
  constructor(private readonly appUrl = 'http://localhost:5173') {
    super();
  }
  async sendProof(email: string, url: string): Promise<void> {
    this.proofs.push({ email, url, message: emailChangeProofEmail(url) });
    if (this.proofs.length > 20) this.proofs.shift();
  }
  async sendSecurityAlert(email: string): Promise<void> {
    this.alerts.push({
      email,
      message: emailChangedSecurityEmail(this.appUrl),
    });
    if (this.alerts.length > 20) this.alerts.shift();
  }
}
export class ResendEmailChangeMailer extends EmailChangeMailer {
  constructor(
    private readonly client: Resend,
    private readonly from: string,
    private readonly appUrl: string,
    private readonly timeoutMs = 10_000,
  ) {
    super();
  }
  sendProof(email: string, url: string, idempotencyKey: string): Promise<void> {
    return this.send(email, emailChangeProofEmail(url), idempotencyKey);
  }
  sendSecurityAlert(email: string, idempotencyKey: string): Promise<void> {
    return this.send(
      email,
      emailChangedSecurityEmail(this.appUrl),
      idempotencyKey,
    );
  }
  private async send(
    email: string,
    message: ReturnType<typeof emailChangeProofEmail>,
    idempotencyKey: string,
  ): Promise<void> {
    try {
      const result = await this.client.emails.send(
        { from: this.from, to: [email], ...message },
        { idempotencyKey, signal: AbortSignal.timeout(this.timeoutMs) },
      );
      if (result.error || !result.data?.id)
        throw new Error('Provider rejected request');
    } catch {
      throw new Error('Email change mail provider unavailable');
    }
  }
}
