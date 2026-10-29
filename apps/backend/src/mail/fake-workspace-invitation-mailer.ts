import {
  WorkspaceInvitationMailer,
  type WorkspaceInvitationMail,
} from '../api/workspaces/workspace-invitation-mailer';
import { workspaceInvitationEmail } from './workspace-invitation-email';

/** Bounded, process-local QA capture, like the existing FakeWelcomeMailer.
 * Contains ephemeral links: never log, persist or expose via an HTTP endpoint.
 */
export class FakeWorkspaceInvitationMailer extends WorkspaceInvitationMailer {
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
    private readonly acceptPath: string,
  ) {
    super();
  }

  async send(payload: WorkspaceInvitationMail): Promise<'SENT' | 'FAILED'> {
    try {
      if (
        this.deliveries.some(
          (item) => item.idempotencyKey === payload.idempotencyKey,
        )
      )
        return 'SENT';
      const content = workspaceInvitationEmail(
        payload,
        this.appOrigin,
        this.acceptPath,
      );
      this.deliveries.push({
        message: { from: this.from, to: payload.recipient, ...content },
        idempotencyKey: payload.idempotencyKey,
      });
      if (this.deliveries.length > 20) this.deliveries.shift();
      return 'SENT';
    } catch {
      return 'FAILED';
    }
  }
}
