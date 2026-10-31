import { Resend } from 'resend';
import {
  BoardMemberAddedMailer,
  type BoardMemberAddedMail,
  type BoardMemberAddedSendResult,
} from './board-member-added-mailer';
import { boardMemberAddedEmail } from './board-member-added-email';

export class ResendBoardMemberAddedMailer extends BoardMemberAddedMailer {
  constructor(
    private readonly client: Resend,
    private readonly from: string,
    private readonly appOrigin: string,
  ) {
    super();
    // Same per-client Resend 6.x privacy seam as invitation mail: SDK error
    // bodies may echo private content. Never silence the global console.
    Object.defineProperty(client, 'logError', { value: () => undefined });
  }

  async send(
    payload: BoardMemberAddedMail,
    signal: AbortSignal,
  ): Promise<BoardMemberAddedSendResult> {
    let content: ReturnType<typeof boardMemberAddedEmail>;
    try {
      content = boardMemberAddedEmail(payload, this.appOrigin);
    } catch {
      return 'FAILED';
    }
    if (signal.aborted) return 'UNKNOWN';
    try {
      const result = await this.client.emails.send(
        { from: this.from, to: [payload.recipient], ...content },
        {
          idempotencyKey: `board-member-added/${payload.membershipId}`,
          signal,
        },
      );
      if (!result.error && result.data?.id) return 'SENT';
      const status = result.error?.statusCode;
      return status &&
        status >= 400 &&
        status < 500 &&
        status !== 408 &&
        status !== 409
        ? 'FAILED'
        : 'UNKNOWN';
    } catch {
      return 'UNKNOWN';
    }
  }
}
