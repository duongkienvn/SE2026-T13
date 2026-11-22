import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import { ApiError } from '../../infrastructure/api/errors.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { MAX_GOOGLE_CREDENTIAL_LENGTH } from '../auth/google-identity.ts';
import { confirmationError, passwordError } from '../auth/validation.ts';
import { decodeProviders, type Providers } from '../profile/email-change.ts';

export type { Providers };
export const CHANGE_PASSWORD_PATH = '/auth/change-password';
export const GOOGLE_LINK_PATH = '/auth/google/link';

/** Token-free, secret-free cache key for authoritative provider status. */
export const linkedProvidersKey = (identity: SessionIdentity) =>
  [...queryKeys.me(identity), 'linked-providers'] as const;

export interface PasswordDraft {
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly confirmation: string;
}
export type PasswordFieldErrors = Partial<Record<keyof PasswordDraft, string>>;

/** Mirrors ChangePasswordDto + NewPasswordField. Confirmation is client-only. */
export function passwordDraftErrors(draft: PasswordDraft): PasswordFieldErrors {
  const errors: PasswordFieldErrors = {};
  const current = passwordError(draft.currentPassword, false);
  if (current) errors.currentPassword = 'Enter your current password.';
  const next = passwordError(draft.newPassword);
  if (next) errors.newPassword = next;
  else if (draft.newPassword === draft.currentPassword)
    errors.newPassword = 'Choose a password different from your current one.';
  const confirmation = confirmationError(draft.newPassword, draft.confirmation);
  if (confirmation) errors.confirmation = confirmation;
  return errors;
}

const rejected = () =>
  new ApiError('http', { status: 400, requestStarted: false });

/** Exactly the backend body: never the confirmation, never a trimmed password. */
export function changePasswordBody(draft: PasswordDraft) {
  if (Object.keys(passwordDraftErrors(draft)).length) throw rejected();
  return {
    currentPassword: draft.currentPassword,
    newPassword: draft.newPassword,
  };
}

export function googleLinkBody(credential: string, password: string) {
  if (
    typeof credential !== 'string' ||
    !credential ||
    credential.length > MAX_GOOGLE_CREDENTIAL_LENGTH ||
    passwordError(password, false)
  )
    throw rejected();
  return { credential, password };
}

/** Session-scoped account security transport. No query cache for secrets. */
export function createSecurityApi(
  http: SessionHttpClient,
  identity: SessionIdentity,
) {
  return {
    providers: (signal: AbortSignal): Promise<Providers> =>
      http.json('/auth/linked-providers', decodeProviders, {
        identity,
        signal,
        retries: 0,
        expectedStatus: 200,
      }),
    /** 204 rotates authVersion on the server: the current JWT is now revoked. */
    changePassword: (draft: PasswordDraft, signal: AbortSignal) =>
      http.empty(CHANGE_PASSWORD_PATH, {
        identity,
        signal,
        method: 'POST',
        retries: 0,
        body: changePasswordBody(draft),
      }),
    /** 204 links Google without issuing or rotating a Kanvexa session. */
    linkGoogle: (credential: string, password: string, signal: AbortSignal) =>
      http.empty(GOOGLE_LINK_PATH, {
        identity,
        signal,
        method: 'POST',
        retries: 0,
        body: googleLinkBody(credential, password),
      }),
  };
}
export type SecurityApi = ReturnType<typeof createSecurityApi>;

/** The request may have reached the server; its outcome is unknown. */
export function isAmbiguous(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.requestStarted !== false &&
    (error.kind === 'timeout' ||
      error.kind === 'network' ||
      error.kind === 'invalid-response')
  );
}

export function changePasswordError(error: unknown): string {
  if (!(error instanceof ApiError))
    return 'Your password could not be changed. Please try again later.';
  if (error.code === 'CURRENT_PASSWORD_INCORRECT')
    return 'Your current password is incorrect. Your session is still active.';
  if (error.code === 'PASSWORD_RECOVERY_REQUIRED')
    return 'This account has no password yet. Use password recovery to set one.';
  if (error.code === 'PASSWORD_REUSED')
    return 'Choose a password different from your current password.';
  if (error.status === 400)
    return 'Check the password requirements and try again.';
  if (error.status === 429)
    return 'Too many attempts. Wait a few minutes before trying again.';
  if (error.status === 401) return 'Your session ended. Sign in again.';
  if (error.kind === 'offline')
    return 'You’re offline. Reconnect before changing your password.';
  if (isAmbiguous(error))
    return 'We could not confirm whether your password changed. Checking your session… Do not resubmit; if you are signed out, sign in with your new password.';
  if (error.kind === 'configuration')
    return 'The API is not configured. Contact your app administrator.';
  return 'Your password could not be changed. Please try again later.';
}

export function googleLinkError(error: unknown): string {
  if (!(error instanceof ApiError))
    return 'Google could not be connected. Please try again later.';
  if (error.code === 'GOOGLE_CANCELLED')
    return 'Google sign-in was canceled. Nothing was connected.';
  if (error.code === 'GOOGLE_BUSY')
    return 'Google sign-in is already open. Finish or cancel it first.';
  if (error.code === 'GOOGLE_PLAY_SERVICES')
    return 'Google Play services are unavailable or need an update on this device.';
  if (error.code === 'INVALID_GOOGLE_CREDENTIAL')
    return 'Google could not verify this sign-in. Try again with the Google account for your Kanvexa email.';
  if (
    error.code.startsWith('GOOGLE_') &&
    error.code !== 'GOOGLE_ACCOUNT_CONFLICT'
  )
    return error.status === 503
      ? 'Google sign-in is unavailable right now. Try again later.'
      : 'Google sign-in is unavailable in this build.';
  if (error.code === 'GOOGLE_ACCOUNT_CONFLICT' || error.status === 409)
    return 'Google could not be connected. Use the Google account with the same verified email that is not connected to another Kanvexa account.';
  if (error.status === 403)
    return 'Your current password is incorrect. Nothing was connected.';
  if (error.status === 400) return 'Check your password and try again.';
  if (error.status === 429)
    return 'Too many attempts. Wait a few minutes before trying again.';
  if (error.status === 503)
    return 'Google sign-in is unavailable right now. Try again later.';
  if (error.status === 401) return 'Your session ended. Sign in again.';
  if (error.kind === 'offline')
    return 'You’re offline. Reconnect before connecting Google.';
  if (isAmbiguous(error))
    return 'We could not confirm the connection. Checking status… Do not retry until the status refreshes.';
  if (error.kind === 'configuration')
    return 'Google sign-in is unavailable in this build.';
  return 'Google could not be connected. Please try again later.';
}
