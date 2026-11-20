import { queryOptions } from '@tanstack/react-query';
import type { PushSchedule, UpdatePushSchedule } from '@kanban/shared';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../../infrastructure/query/keys.ts';
import { canRetryWorkspace } from '../../workspaces/status.ts';
import { decodeSchedule, validatePatch } from './model.ts';
import { guardScheduleCooldown, rememberScheduleFailure } from './cooldown.ts';
export const scheduleKey = (identity: SessionIdentity) =>
  [...queryKeys.scope(identity), 'me', 'push-schedule'] as const;
export function createScheduleApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
) {
  const options = (signal: AbortSignal) => ({
    identity,
    signal,
    resourceKey: scheduleKey(identity),
    expectedStatus: 200,
    retries: 0 as const,
  });
  return {
    get: (signal: AbortSignal) =>
      api.json('/users/me/push-schedule', decodeSchedule, options(signal)),
    patch: (patch: UpdatePushSchedule, signal: AbortSignal) =>
      api.json('/users/me/push-schedule', decodeSchedule, {
        ...options(signal),
        method: 'PATCH',
        body: validatePatch(patch),
      }),
  };
}
export function scheduleOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
) {
  const canWake = ({
    state,
  }: {
    state: { error: unknown; errorUpdatedAt: number };
  }) => canRetryWorkspace(state.error, state.errorUpdatedAt);
  return queryOptions<PushSchedule>({
    queryKey: scheduleKey(identity),
    staleTime: 1000,
    retry: false,
    refetchOnMount: (query) => (canWake(query) ? 'always' : false),
    refetchOnWindowFocus: canWake,
    refetchOnReconnect: canWake,
    queryFn: async ({ signal }) => {
      guardScheduleCooldown(data, identity);
      try {
        return await createScheduleApi(data.api, identity).get(signal);
      } catch (error) {
        throw rememberScheduleFailure(data, identity, error);
      }
    },
  });
}
