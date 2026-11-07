import type {
  DeleteAccountRequest,
  EmailChangeRequest,
  PendingEmailChangeSummary,
} from '@kanban/shared';
import { apiRequest, isApiError } from '../../lib/api-client';
import type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  UpdateProfileRequest,
  User,
} from './types';

export function register(input: RegisterRequest): Promise<User> {
  return apiRequest<User>('/auth/register', { method: 'POST', body: input });
}

export function login(input: LoginRequest): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/auth/login', {
    method: 'POST',
    body: input,
  });
}

export function googleSignIn(credential: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/auth/google', {
    method: 'POST',
    body: { credential },
  });
}

export interface LinkedProviders {
  googleLinked: boolean;
  hasPassword: boolean;
}

export function getLinkedProviders(
  accessToken: string,
  signal?: AbortSignal,
): Promise<LinkedProviders> {
  return apiRequest<LinkedProviders>('/auth/linked-providers', {
    accessToken,
    signal,
  });
}

export function linkGoogle(
  accessToken: string,
  credential: string,
  password: string,
): Promise<void> {
  return apiRequest<void>('/auth/google/link', {
    method: 'POST',
    accessToken,
    body: { credential, password },
  });
}

export function verifyEmail(token: string): Promise<void> {
  return apiRequest<void>('/auth/verify-email', {
    method: 'POST',
    body: { token },
  });
}

export function resendVerification(email: string): Promise<null> {
  return apiRequest<null>('/auth/resend-verification', {
    method: 'POST',
    body: { email },
  });
}

export function logout(accessToken: string): Promise<void> {
  return apiRequest<void>('/auth/logout', { method: 'POST', accessToken });
}

export function forgotPassword(email: string): Promise<null> {
  return apiRequest<null>('/auth/forgot-password', {
    method: 'POST',
    body: { email },
  });
}

export function resetPassword(
  token: string,
  newPassword: string,
): Promise<void> {
  return apiRequest<void>('/auth/reset-password', {
    method: 'POST',
    body: { token, newPassword },
  });
}

export function changePassword(
  accessToken: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  return apiRequest<void>('/auth/change-password', {
    method: 'POST',
    accessToken,
    body: { currentPassword, newPassword },
  });
}

export function getCurrentUser(
  accessToken: string,
  signal?: AbortSignal,
): Promise<User> {
  return apiRequest<User>('/users/me', { accessToken, signal });
}

export function updateCurrentUser(
  accessToken: string,
  input: UpdateProfileRequest,
): Promise<User> {
  return apiRequest<User>('/users/me', {
    method: 'PATCH',
    body: input,
    accessToken,
  });
}

/**
 * A rejected fresh Google proof answers `401 INVALID_GOOGLE_CREDENTIAL`.
 * Unlike an expired JWT it must not end the session, so it is rethrown as
 * this error, which `runAuthorized` does not treat as a sign-out.
 */
export class GoogleProofRejectedError extends Error {
  constructor() {
    super('Google could not confirm your identity.');
    this.name = 'GoogleProofRejectedError';
  }
}

async function keepSessionOnGoogleRejection<T>(
  request: Promise<T>,
): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (
      isApiError(error) &&
      error.status === 401 &&
      error.code === 'INVALID_GOOGLE_CREDENTIAL'
    )
      throw new GoogleProofRejectedError();
    throw error;
  }
}

/** Generic 202 after fresh reauthentication: not a delivery or intent receipt. */
export function requestEmailChange(
  accessToken: string,
  input: EmailChangeRequest,
): Promise<void> {
  return keepSessionOnGoogleRejection(
    apiRequest<void>('/auth/email-change/request', {
      method: 'POST',
      accessToken,
      body: input,
      expectedStatus: 202,
    }),
  );
}

export function getPendingEmailChange(
  accessToken: string,
  signal?: AbortSignal,
): Promise<PendingEmailChangeSummary | null> {
  return apiRequest<unknown>('/auth/email-change/pending', {
    accessToken,
    signal,
  }).then(toPendingSummary);
}

/** Keeps only the documented masked fields; anything else reads as none. */
function toPendingSummary(data: unknown): PendingEmailChangeSummary | null {
  if (!data || typeof data !== 'object') return null;
  const { maskedNewEmail, issuedAt, expiresAt } = data as Record<
    string,
    unknown
  >;
  if (
    typeof maskedNewEmail !== 'string' ||
    typeof issuedAt !== 'string' ||
    typeof expiresAt !== 'string' ||
    Number.isNaN(Date.parse(expiresAt))
  )
    return null;
  return { maskedNewEmail, issuedAt, expiresAt };
}

/** 204 only on a real confirmation; no JWT is returned. */
export function confirmEmailChange(
  accessToken: string,
  token: string,
): Promise<void> {
  return apiRequest<void>('/auth/email-change/confirm', {
    method: 'POST',
    accessToken,
    body: { token },
    expectedStatus: 204,
  });
}

/** 204 means the deletion has committed (#218). */
export function deleteAccount(
  accessToken: string,
  input: DeleteAccountRequest,
): Promise<void> {
  return keepSessionOnGoogleRejection(
    apiRequest<void>('/users/me', {
      method: 'DELETE',
      accessToken,
      body: input,
      expectedStatus: 204,
    }),
  );
}
