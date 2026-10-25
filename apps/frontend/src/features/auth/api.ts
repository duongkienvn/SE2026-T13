import { apiRequest } from '../../lib/api-client';
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
