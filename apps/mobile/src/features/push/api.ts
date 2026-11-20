import type { PushPreferences, CurrentPushDevice } from '@kanban/shared';
import { invalidResponse } from '../../infrastructure/api/errors.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import type { SessionIdentity } from '../../infrastructure/api/session-client.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import type { PushApi } from './contracts.ts';
const preferences = (value: unknown): PushPreferences => {
  const v = value as Partial<PushPreferences> | null;
  if (
    !v ||
    typeof v.enabled !== 'boolean' ||
    typeof v.deliveryAvailable !== 'boolean'
  )
    throw invalidResponse(200);
  return { enabled: v.enabled, deliveryAvailable: v.deliveryAvailable };
};
export const pushKey = (identity: SessionIdentity) =>
  [...queryKeys.scope(identity), 'push-preferences'] as const;
export function createPushApi(
  data: MobileDataLayer,
  identity: SessionIdentity,
): PushApi {
  const options = (signal: AbortSignal) => ({
    identity,
    signal,
    expectedStatus: 200,
    retries: 0 as const,
  });
  return {
    get: (signal) =>
      data.queryClient.fetchQuery({
        queryKey: pushKey(identity),
        staleTime: 0,
        retry: false,
        queryFn: () =>
          data.api.json(
            '/users/me/push-preferences',
            preferences,
            options(signal),
          ),
      }),
    async patch(enabled, signal) {
      const result = await data.api.json(
        '/users/me/push-preferences',
        preferences,
        { ...options(signal), method: 'PATCH', body: { enabled } },
      );
      if (result.enabled !== enabled) throw invalidResponse(200);
      data.assertCurrent(identity);
      data.queryClient.setQueryData(pushKey(identity), result);
      return result;
    },
    async register(input, signal) {
      await data.api.json(
        '/users/me/push-devices',
        (value) => {
          const v = value as {
            installationId?: unknown;
            registered?: unknown;
          } | null;
          if (
            !v ||
            v.installationId !== input.installationId ||
            v.registered !== true
          )
            throw invalidResponse(200);
        },
        { ...options(signal), method: 'POST', body: input },
      );
    },
    current: (installationId, signal) =>
      data.api.json(
        '/users/me/push-devices/current',
        (value) => {
          const v = value as Partial<CurrentPushDevice> | null;
          if (
            !v ||
            typeof v.registered !== 'boolean' ||
            typeof v.eligible !== 'boolean'
          )
            throw invalidResponse(200);
          return { registered: v.registered, eligible: v.eligible };
        },
        { ...options(signal), query: { installationId } },
      ),
    remove: (installationId, signal) =>
      data.api.empty('/users/me/push-devices/' + installationId, {
        ...options(signal),
        method: 'DELETE',
        expectedStatus: 204,
      }),
  };
}
