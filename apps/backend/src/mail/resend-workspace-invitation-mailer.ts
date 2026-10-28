import { Resend } from 'resend';
import {
  WorkspaceInvitationMailer,
  type WorkspaceInvitationMail,
} from '../api/workspaces/workspace-invitation-mailer';
import { workspaceInvitationEmail } from './workspace-invitation-email';

export class ResendWorkspaceInvitationMailer extends WorkspaceInvitationMailer {
  constructor(
    private readonly client: Resend,
    private readonly from: string,
    private readonly appOrigin: string,
    private readonly acceptPath: string,
    private readonly timeoutMs = 10_000,
  ) {
    super();
    // Installed Resend 6.x logs raw provider error bodies outside production.
    // It has no public logger option. Silence its per-client hook, never the
    // global console; real-SDK regression tests guard this version-specific seam.
    Object.defineProperty(client, 'logError', { value: () => undefined });
  }

  async send(
    payload: WorkspaceInvitationMail,
  ): Promise<'SENT' | 'FAILED' | 'UNKNOWN'> {
    let content: ReturnType<typeof workspaceInvitationEmail>;
    try {
      content = workspaceInvitationEmail(
        payload,
        this.appOrigin,
        this.acceptPath,
      );
    } catch {
      // Rendering/configuration failed before any provider request.
      return 'FAILED';
    }
    try {
      const result = await this.client.emails.send(
        { from: this.from, to: [payload.recipient], ...content },
        {
          idempotencyKey: payload.idempotencyKey,
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
      if (!result.error && result.data?.id) return 'SENT';
      const status = result.error?.statusCode;
      // Definite client rejection (including rate limit) was not accepted.
      // Timeouts, conflicting in-flight idempotency requests, 5xx and malformed
      // responses cannot establish non-acceptance. Never retry an uncertain send.
      return status &&
        status >= 400 &&
        status < 500 &&
        status !== 408 &&
        status !== 409
        ? 'FAILED'
        : 'UNKNOWN';
    } catch {
      // Neither return nor log SDK errors: bodies can contain the proof/key.
      return 'UNKNOWN';
    }
  }
}
