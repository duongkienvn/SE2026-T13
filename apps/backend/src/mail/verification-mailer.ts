export abstract class VerificationMailer {
  abstract send(
    email: string,
    url: string,
    idempotencyKey: string,
  ): Promise<void>;
}

/** Explicit development/test transport: captured in memory, never logged or sent. */
export class FakeVerificationMailer extends VerificationMailer {
  readonly deliveries: { email: string; url: string }[] = [];

  async send(email: string, url: string): Promise<void> {
    this.deliveries.push({ email, url });
    if (this.deliveries.length > 20) this.deliveries.shift();
  }
}
