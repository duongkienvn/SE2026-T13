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
  return {
    get: (signal: AbortSignal) =>
      api.json('/users/me/preferences', decodePreferences, options(signal)),
    patch: (patch: Patch, signal: AbortSignal) =>
      api.json('/users/me/preferences', decodePreferences, {
        ...options(signal),
        method: 'PATCH',
        body: validatePatch(patch),
      }),
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
