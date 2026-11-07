// Bootstrap-only memory: the mailbox proof never reaches storage, router
// state, logs or telemetry, and the query string is removed before React mounts.
let incomingToken: string | null = null;

export const EMAIL_CHANGE_PATH = '/confirm-email-change';

export function captureEmailChangeLink(): void {
  if (window.location.pathname !== EMAIL_CHANGE_PATH) return;
  incomingToken = new URLSearchParams(window.location.search).get('token');
  window.history.replaceState(window.history.state, '', EMAIL_CHANGE_PATH);
}

export function readIncomingEmailChangeToken(): string | null {
  return incomingToken;
}

export function clearIncomingEmailChangeToken(): void {
  incomingToken = null;
}

/** The backend proof is 32 random bytes in base64url (43 characters). */
export function isEmailChangeToken(value: string | null): value is string {
  return !!value && /^[A-Za-z0-9_-]{43}$/.test(value);
}
