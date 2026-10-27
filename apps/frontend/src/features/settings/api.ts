import { apiRequest } from '../../lib/api-client';
import type { UpdatePreferencesRequest, UserPreferences } from './types';

export function getPreferences(
  accessToken: string,
  signal?: AbortSignal,
): Promise<UserPreferences> {
  return apiRequest<UserPreferences>('/users/me/preferences', {
    accessToken,
    signal,
  });
}

export function updatePreferences(
  accessToken: string,
  patch: UpdatePreferencesRequest,
): Promise<UserPreferences> {
  return apiRequest<UserPreferences>('/users/me/preferences', {
    method: 'PATCH',
    body: patch,
    accessToken,
  });
}
