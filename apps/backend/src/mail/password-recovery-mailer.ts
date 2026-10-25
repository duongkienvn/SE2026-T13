export abstract class PasswordRecoveryMailer {
  abstract send(
    email: string,
    url: string,
    idempotencyKey: string,
  ): Promise<void>;
}

/** Explicit fake delivery, held only in memory and never logged. */
export class FakePasswordRecoveryMailer extends PasswordRecoveryMailer {
  readonly deliveries: { email: string; url: string }[] = [];
  async send(email: string, url: string): Promise<void> {
    this.deliveries.push({ email, url });
    if (this.deliveries.length > 20) this.deliveries.shift();
  }
}
