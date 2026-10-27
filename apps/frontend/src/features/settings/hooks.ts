import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { retryUnlessClientError } from '../../lib/query-client';
import {
  useAuthSession,
  type AuthSessionScope,
} from '../auth/auth-session-context';
import { useAuth } from '../auth/useAuth';
import { getPreferences, updatePreferences } from './api';
import { preferencesKeys, preferencesMutationKey } from './query-keys';
import type { UpdatePreferencesRequest, UserPreferences } from './types';

export { preferencesKeys } from './query-keys';

export function usePreferences() {
  const { runAuthorized, user } = useAuth();
  return useQuery({
    queryKey: preferencesKeys.current,
    queryFn: ({ signal }) =>
      runAuthorized((token) => getPreferences(token, signal)),
    enabled: !!user,
    retry: retryUnlessClientError,
    staleTime: 5 * 60 * 1000,
  });
}

interface UpdateVariables {
  patch: UpdatePreferencesRequest;
  scope: AuthSessionScope;
}

interface UpdateContext {
  previous: UserPreferences | undefined;
}

function patchedKeys(patch: UpdatePreferencesRequest) {
  return Object.keys(patch) as (keyof UserPreferences)[];
}

/** Writes only `keys` from `source`, so one save never clobbers another's fields. */
function mergeFields(
  queryClient: QueryClient,
  keys: (keyof UserPreferences)[],
  source: UserPreferences,
  onlyIf?: (current: UserPreferences, key: keyof UserPreferences) => boolean,
) {
  queryClient.setQueryData<UserPreferences>(
    preferencesKeys.current,
    (current) => {
      if (!current) return current;
      const next = { ...current };
      for (const key of keys) {
        if (!onlyIf || onlyIf(current, key))
          Object.assign(next, { [key]: source[key] });
      }
      return next;
    },
  );
}

/**
 * Saves changed fields and shows them immediately. A failed save puts back the
 * previous value of its own fields unless a newer edit already replaced them.
 */
export function useUpdatePreferences() {
  const { runAuthorized } = useAuth();
  const scope = useAuthSession();
  const queryClient = useQueryClient();
  // The settling mutation itself is still counted while its callbacks run.
  const isLastPending = () =>
    queryClient.isMutating({ mutationKey: preferencesMutationKey }) <= 1;

  const mutation = useMutation<
    UserPreferences,
    unknown,
    UpdateVariables,
    UpdateContext
  >({
    mutationKey: preferencesMutationKey,
    mutationFn: ({ patch, scope }) => {
      if (!scope.isCurrent())
        throw new Error('Session changed before request.');
      return runAuthorized((token) => updatePreferences(token, patch));
    },
    onMutate: async ({ patch }) => {
      await queryClient.cancelQueries({ queryKey: preferencesKeys.current });
      const previous = queryClient.getQueryData<UserPreferences>(
        preferencesKeys.current,
      );
      if (previous)
        queryClient.setQueryData(preferencesKeys.current, {
          ...previous,
          ...patch,
        });
      return { previous };
    },
    onSuccess: (saved, { patch, scope }) => {
      if (!scope.isCurrent()) return;
      if (isLastPending())
        queryClient.setQueryData(preferencesKeys.current, saved);
      else mergeFields(queryClient, patchedKeys(patch), saved);
    },
    onError: (_error, { patch, scope }, context) => {
      if (!scope.isCurrent()) return;
      if (context?.previous)
        mergeFields(
          queryClient,
          patchedKeys(patch),
          context.previous,
          (current, key) => current[key] === patch[key],
        );
      if (isLastPending())
        void queryClient.invalidateQueries({
          queryKey: preferencesKeys.current,
        });
    },
  });

  return {
    ...mutation,
    save: (
      patch: UpdatePreferencesRequest,
      options?: Parameters<typeof mutation.mutate>[1],
    ) => mutation.mutate({ patch, scope }, options),
  };
}
