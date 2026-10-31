import { isApiError } from '../../../lib/api-client';
import type { InvitationSendState, WorkspaceInvitation } from './types';

export const STATUS_LABELS = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
  DECLINED: 'Declined',
} as const;

/** Only a pending invitation has a delivery state worth showing. */
export const SEND_STATE_LABELS: Record<InvitationSendState, string> = {
  SENT: 'Email provider accepted the send attempt; inbox delivery is not confirmed',
  DISPATCHING: 'Sending email…',
  UNAVAILABLE: 'Email not sent: delivery is unavailable',
  FAILED: 'Email failed to send',
  UNKNOWN: 'Email send outcome is unknown',
};

/** Honest result of a 202: the request was stored, the email maybe not. */
export function inviteOutcome(invitation: WorkspaceInvitation): {
  tone: 'success' | 'error';
  message: string;
} {
  switch (invitation.sendState) {
    case 'SENT':
      return {
        tone: 'success',
        message: `Invitation saved for ${invitation.email}. The email provider accepted the send attempt; inbox delivery is not confirmed.`,
      };
    case 'DISPATCHING':
      return {
        tone: 'success',
        message: `Invitation to ${invitation.email} is being sent. Check Invitations for the result.`,
      };
    case 'UNAVAILABLE':
      return {
        tone: 'error',
        message: `Invitation to ${invitation.email} was saved, but email delivery is not available yet, so no email was sent.`,
      };
    case 'FAILED':
      return {
        tone: 'error',
        message: `Invitation to ${invitation.email} was saved, but the email failed to send. Wait a minute, then try again from Invitations.`,
      };
    case 'UNKNOWN':
      return {
        tone: 'error',
        message: `Invitation to ${invitation.email} was saved, but the email send outcome is unknown. Check Invitations before trying again.`,
      };
  }
}

export function inviteError(error: unknown): {
  field?: string;
  form?: string;
} {
  if (!isApiError(error))
    return { form: 'Something went wrong. Please try again.' };
  if (error.status === 400) return { field: 'Enter a valid email address.' };
  if (error.status === 403)
    return { form: 'Only workspace admins can invite people.' };
  if (error.status === 429)
    return {
      form:
        error.message === 'Invitation request limit reached'
          ? 'Invitation limit reached. Try again in an hour.'
          : 'An invitation was recently requested for this address. Wait a minute before sending another.',
    };
  return {
    form: 'Could not confirm the invitation request. Check Invitations before trying again.',
  };
}
