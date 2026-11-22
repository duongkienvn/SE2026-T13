import { ApiError } from '../../infrastructure/api/errors.ts';
import { sameIdentity } from '../../infrastructure/api/session-client.ts';
import { queryOptions } from '@tanstack/react-query';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { canRetryWorkspace } from '../workspaces/status.ts';
import {
  decodePreferences,
  validatePatch,
  type Preferences,
  type Patch,
} from './model.ts';

const budgets = new WeakMap<
  SessionHttpClient,
  { identity: SessionIdentity; until: number }
>();
export function preferencesApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
) {
  const options = (signal: AbortSignal) => ({
    identity,
    signal,
    resourceKey: queryKeys.datePreferences(identity),
    expectedStatus: 200,
    retries: 0 as const,
  });
  async function request(patch: Patch | null, signal: AbortSignal) {
    const budget = budgets.get(api);
    if (
      budget &&
      sameIdentity(budget.identity, identity) &&
      budget.until > Date.now()
    )
      throw new ApiError('http', {
        status: 429,
        retryAfterMs: budget.until - Date.now(),
        requestStarted: false,
      });
    try {
      return await api.json(
        '/users/me/preferences',
        decodePreferences,
        patch
          ? { ...options(signal), method: 'PATCH', body: validatePatch(patch) }
          : options(signal),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        const delay =
          error.retryAfterMs !== undefined &&
          Number.isFinite(error.retryAfterMs)
            ? Math.max(0, error.retryAfterMs)
            : 60000;
        const current = budgets.get(api);
        const until = Math.max(
          Date.now() + delay,
          current && sameIdentity(current.identity, identity)
            ? current.until
            : 0,
        );
        budgets.set(api, { identity, until });
        throw new ApiError(error.kind, {
          ...error,
          retryAfterMs: until - Date.now(),
        });
      }
      throw error;
    }
  }
  return {
    get: (signal: AbortSignal) => request(null, signal),
    patch: (patch: Patch, signal: AbortSignal) =>
      request(validatePatch(patch), signal),
  };
}
export function preferencesOptions(
  api: SessionHttpClient,
  identity: SessionIdentity,
) {
  const ready = ({
    state,
  }: {
    state: { error: unknown; errorUpdatedAt: number };
  }) => canRetryWorkspace(state.error, state.errorUpdatedAt);
  return queryOptions<Preferences>({
    queryKey: queryKeys.datePreferences(identity),
    queryFn: ({ signal }) => preferencesApi(api, identity).get(signal),
    staleTime: 1000,
    retry: false,
    refetchOnMount: (query) => (ready(query) ? 'always' : false),
    refetchOnWindowFocus: ready,
    refetchOnReconnect: ready,
  });
}
