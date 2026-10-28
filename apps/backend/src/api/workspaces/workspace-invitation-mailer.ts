import type { WorkspaceRole } from '@kanban/shared';

export interface WorkspaceInvitationMail {
  readonly invitationId: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly recipient: string;
  readonly role: WorkspaceRole;
  readonly proof: string;
  readonly expiresAt: Date;
  /** Stable per proof; transport retries must reuse this provider idempotency key. */
  readonly idempotencyKey: string;
}

/** P2-10 supplies this port. Never log, persist, or return the payload/proof. */
export abstract class WorkspaceInvitationMailer {
  abstract send(
    payload: WorkspaceInvitationMail,
  ): Promise<'SENT' | 'FAILED' | 'UNKNOWN'>;
}

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITATION_COOLDOWN_MS = 60 * 1000;
export const INVITATION_DISPATCH_LEASE_MS = 5 * 60 * 1000;
export const INVITATION_SEND_STATES = [
  'UNAVAILABLE',
  'DISPATCHING',
  'SENT',
  'FAILED',
  'UNKNOWN',
] as const;
export type InvitationSendState = (typeof INVITATION_SEND_STATES)[number];
