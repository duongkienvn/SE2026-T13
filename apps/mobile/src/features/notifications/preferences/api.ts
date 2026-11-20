import { queryOptions } from '@tanstack/react-query';
import type {
  NotificationPreferences,
  UpdateNotificationPreferences,
} from '@kanban/shared';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../../infrastructure/query/keys.ts';
import { canRetryWorkspace } from '../../workspaces/status.ts';
import { decodePreferences, validatePatch } from './model.ts';
import {
  guardPreferencesCooldown,
  rememberPreferencesFailure,
} from './cooldown.ts';

export function createPreferencesApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
  emailEnabled: boolean,
) {
  const path = '/users/me/notification-preferences';
  const options = (signal: AbortSignal) => ({
    identity,
    signal,
    resourceKey: queryKeys.notificationPreferences(identity),
    expectedStatus: 200,
    retries: 0 as const,
  });
  return {
    get: (signal: AbortSignal) =>
      api.json(path, decodePreferences, options(signal)),
    patch: (patch: UpdateNotificationPreferences, signal: AbortSignal) =>
      api.json(path, decodePreferences, {
        ...options(signal),
        method: 'PATCH',
        body: validatePatch(patch, emailEnabled),
      }),
  };
}
export function preferencesOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
) {
  const canWake = ({
    state,
  }: {
    state: { error: unknown; errorUpdatedAt: number };
  }) => canRetryWorkspace(state.error, state.errorUpdatedAt);
  return queryOptions<NotificationPreferences>({
    queryKey: queryKeys.notificationPreferences(identity),
    staleTime: 1000,
    retry: false,
    refetchOnMount: (query) => (canWake(query) ? 'always' : false),
    refetchOnWindowFocus: canWake,
    refetchOnReconnect: canWake,
    queryFn: async ({ signal }) => {
      guardPreferencesCooldown(data, identity);
      try {
        return await createPreferencesApi(data.api, identity, false).get(
          signal,
        );
      } catch (error) {
        throw rememberPreferencesFailure(data, identity, error);
      }
    },
  });
}
