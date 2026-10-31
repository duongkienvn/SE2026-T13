import { boardMemberAddedEmail } from './board-member-added-email';

export interface BoardMemberAddedMail {
  readonly membershipId: string;
  readonly boardId: string;
  readonly boardName: string;
  readonly recipient: string;
  readonly recipientDisplayName?: string | null;
  readonly actorDisplayName?: string | null;
}

export type BoardMemberAddedSendResult = 'SENT' | 'FAILED' | 'UNKNOWN';

export abstract class BoardMemberAddedMailer {
  abstract send(
    payload: BoardMemberAddedMail,
    signal: AbortSignal,
  ): Promise<BoardMemberAddedSendResult>;
}

/** Process-local, bounded QA capture only; never exposed through an endpoint. */
export class FakeBoardMemberAddedMailer extends BoardMemberAddedMailer {
  readonly deliveries: {
    message: {
      from: string;
      to: string;
      subject: string;
      html: string;
      text: string;
    };
    idempotencyKey: string;
  }[] = [];

  constructor(
    private readonly from: string,
    private readonly appOrigin: string,
  ) {
    super();
  }

  async send(
    payload: BoardMemberAddedMail,
    signal: AbortSignal,
  ): Promise<BoardMemberAddedSendResult> {
    try {
      if (signal.aborted) return 'UNKNOWN';
      const idempotencyKey = `board-member-added/${payload.membershipId}`;
      if (
        this.deliveries.some((item) => item.idempotencyKey === idempotencyKey)
      )
        return 'SENT';
      const content = boardMemberAddedEmail(payload, this.appOrigin);
      this.deliveries.push({
        message: { from: this.from, to: payload.recipient, ...content },
        idempotencyKey,
      });
      if (this.deliveries.length > 20) this.deliveries.shift();
      return 'SENT';
    } catch {
      return 'FAILED';
    }
  }
}
