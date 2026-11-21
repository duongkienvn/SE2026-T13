import type {
  EmailChangeRequest,
  PendingEmailChangeSummary,
} from '@kanban/shared';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import { ApiError } from '../../infrastructure/api/errors.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import {
  hasIntendedAudience,
  type GoogleIdentityProvider,
} from '../auth/google-identity.ts';
import { emailError, passwordError } from '../auth/validation.ts';
import { date, exact, object } from './model.ts';

export const EMAIL_CHANGE_COOLDOWN_MS = 60_000;
export const EMAIL_CHANGE_TTL_MS = 30 * 60_000;
export const EMAIL_CHANGE_ACCEPTANCE =
  'If eligible, a confirmation link may arrive. Delivery may be delayed or unavailable.';
export const EMAIL_CHANGE_HANDOFF =
  'Open the confirmation email, follow the secure link and sign in on Kanvexa Web if prompted. Afterwards, sign in again in the mobile app.';
export type Providers = { hasPassword: boolean; googleLinked: boolean };
export function decodeProviders(input: unknown): Providers {
  const v = object(input);
  exact(v, ['hasPassword', 'googleLinked']);
  if (typeof v.hasPassword !== 'boolean' || typeof v.googleLinked !== 'boolean')
    throw new Error('Invalid providers');
  return { hasPassword: v.hasPassword, googleLinked: v.googleLinked };
}
export type ProofMethod = 'password' | 'google';
export function availableProofs(
  providers: Providers,
  googleConfigured: boolean,
): ProofMethod[] {
  return [
    ...(providers.hasPassword ? ['password' as const] : []),
    ...(providers.googleLinked && googleConfigured ? ['google' as const] : []),
  ];
}
export function validateEmailChange(
  input: unknown,
  currentEmail: string,
): EmailChangeRequest {
  const v = object(input);
  if (
    Object.keys(v).some(
      (key) =>
        !['newEmail', 'currentPassword', 'googleCredential'].includes(key),
    ) ||
    typeof v.newEmail !== 'string' ||
    emailError(v.newEmail) ||
    v.newEmail.trim().toLowerCase() === currentEmail.trim().toLowerCase() ||
    'currentPassword' in v === 'googleCredential' in v
  )
    throw new ApiError('http', { status: 400, requestStarted: false });
  const newEmail = v.newEmail.trim().toLowerCase();
  if ('currentPassword' in v) {
    if (
      typeof v.currentPassword !== 'string' ||
      passwordError(v.currentPassword, false)
    )
      throw new ApiError('http', { status: 400, requestStarted: false });
    return { newEmail, currentPassword: v.currentPassword };
  }
  if (
    typeof v.googleCredential !== 'string' ||
    !v.googleCredential ||
    v.googleCredential.length > 8192
  )
    throw new ApiError('http', { status: 400, requestStarted: false });
  return { newEmail, googleCredential: v.googleCredential };
}
export function decodePendingEmail(
  input: unknown,
): PendingEmailChangeSummary | null {
  if (input === null) return null;
  const v = object(input);
  exact(v, ['maskedNewEmail', 'issuedAt', 'expiresAt']);
  if (
    typeof v.maskedNewEmail !== 'string' ||
    !/^.{1}\*\*\*@.{1}\*\*\*$/u.test(v.maskedNewEmail) ||
    !date(v.issuedAt) ||
    !date(v.expiresAt) ||
    Date.parse(v.expiresAt) <= Date.parse(v.issuedAt) ||
    Date.parse(v.expiresAt) - Date.parse(v.issuedAt) > EMAIL_CHANGE_TTL_MS
  )
    throw new Error('Invalid pending change');
  return {
    maskedNewEmail: v.maskedNewEmail,
    issuedAt: v.issuedAt,
    expiresAt: v.expiresAt,
  };
}
export const emailChangeKey = (identity: SessionIdentity) =>
  [...queryKeys.me(identity), 'email-change'] as const;
export function createEmailChangeApi(
  http: SessionHttpClient,
  identity: SessionIdentity,
) {
  const options = (signal: AbortSignal) => ({
    identity,
    signal,
    retries: 0 as const,
    expectedStatus: 200,
  });
  return {
    providers: (signal: AbortSignal) =>
      http.json('/auth/linked-providers', decodeProviders, options(signal)),
    pending: (signal: AbortSignal) =>
      http.json(
        '/auth/email-change/pending',
        decodePendingEmail,
        options(signal),
      ),
    request: (
      input: EmailChangeRequest,
      currentEmail: string,
      signal: AbortSignal,
    ) =>
      http.json(
        '/auth/email-change/request',
        (value) => {
          if (value !== null) throw new Error('Invalid acceptance');
          return null;
        },
        {
          ...options(signal),
          method: 'POST',
          body: validateEmailChange(input, currentEmail),
          expectedStatus: 202,
          timeoutMs: 45_000,
        },
      ),
  };
}
/** Fresh action-specific token only, with no login exchange or token persistence. */
export async function freshGoogleProof(
  provider: GoogleIdentityProvider,
  check: () => void,
): Promise<string> {
  check();
  await provider.reset();
  check();
  try {
    const result = await provider.requestIdToken();
    check();
    if (result.kind !== 'token')
      throw new ApiError('http', {
        code: `GOOGLE_${result.kind.toUpperCase().replaceAll('-', '_')}`,
        requestStarted: false,
      });
    if (!hasIntendedAudience(result.idToken, provider.webClientId))
      throw new ApiError('http', {
        code: 'INVALID_GOOGLE_CREDENTIAL',
        requestStarted: false,
      });
    return result.idToken;
  } finally {
    await provider.reset();
  }
}
export function emailChangeError(error: unknown, method: ProofMethod) {
  if (!(error instanceof ApiError))
    return 'Your request could not be confirmed. Please try again later.';
  if (error.code === 'GOOGLE_CANCELLED')
    return 'Google verification canceled. No request was made.';
  if (error.code === 'GOOGLE_BUSY')
    return 'Google verification is already open. Finish or cancel it before retrying.';
  if (error.code.startsWith('GOOGLE_'))
    return 'Google verification is unavailable in this environment. Try your password or a configured native build.';
  if (error.code === 'INVALID_GOOGLE_CREDENTIAL')
    return 'Google could not verify this proof. Verify again with your linked Google account.';
  if (error.status === 403)
    return method === 'password'
      ? 'Your current password is incorrect.'
      : 'Use the Google account linked to your Kanvexa account.';
  if (error.status === 400)
    return 'Check the new email address and verification method.';
  if (error.status === 429)
    return 'Too many attempts. Wait before requesting again.';
  if (error.status === 503)
    return 'Identity verification is unavailable. Try another available method or try later.';
  if (error.kind === 'offline')
    return 'You’re offline. Reconnect before requesting a change.';
  if (['network', 'timeout', 'aborted'].includes(error.kind))
    return 'The request was not confirmed and may have been accepted. Check pending status; do not automatically resubmit.';
  if (error.status === 401) return 'Your session ended. Sign in again.';
  return 'Your request could not be confirmed. Please try again later.';
}
