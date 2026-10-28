import { WelcomeEmailContent } from './welcome-email';

/** Frozen on first eligibility, including sender, so retries keep the same body. */
export interface WelcomeMessage extends WelcomeEmailContent {
  from: string;
  to: string;
}

export abstract class WelcomeMailer {
  abstract send(message: WelcomeMessage, idempotencyKey: string): Promise<void>;
}

/** Same explicit fake transport as verification/recovery: no network or logging. */
export class FakeWelcomeMailer extends WelcomeMailer {
  readonly deliveries: { message: WelcomeMessage; idempotencyKey: string }[] =
    [];

  async send(message: WelcomeMessage, idempotencyKey: string): Promise<void> {
    if (this.deliveries.some((item) => item.idempotencyKey === idempotencyKey))
      return;
    this.deliveries.push({ message: { ...message }, idempotencyKey });
    if (this.deliveries.length > 20) this.deliveries.shift();
  }
}
