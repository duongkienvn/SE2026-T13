import { useSyncExternalStore } from 'react';
import { focusManager, useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { ApiError } from '../../infrastructure/api/errors';
import {
  useWorkspaceOnline,
  useWorkspaceRetryReady,
  canRetryWorkspace,
} from '../workspaces/status';
import { preferencesOptions } from './api';
import { preferencesCommands } from './commands';
export function usePreferences(identity: SessionIdentity) {
  const data = useMobileData(),
    focused = useIsFocused(),
    online = useWorkspaceOnline();
  const foreground = useSyncExternalStore(
    focusManager.subscribe.bind(focusManager),
    () => focusManager.isFocused(),
  );
  const commands = preferencesCommands(data, identity),
    state = useSyncExternalStore(commands.subscribe, commands.getSnapshot);
  const writeReady = useWorkspaceRetryReady(state.error, state.errorUpdatedAt);
  const eligible = focused && foreground && online;
  const query = useQuery({
    ...preferencesOptions(data.api, identity),
    enabled: ({ state: read }) =>
      eligible &&
      !state.pending &&
      writeReady &&
      canRetryWorkspace(read.error, read.errorUpdatedAt),
  });
  const readReady = useWorkspaceRetryReady(query.error, query.errorUpdatedAt);
  const denied = [query.error, state.error].some(
    (error) =>
      error instanceof ApiError && [401, 403, 404].includes(error.status),
  );
  const canRefresh =
    eligible && !state.pending && !query.isFetching && writeReady && readReady;
  const writable =
    eligible &&
    !denied &&
    !!query.data &&
    !query.isError &&
    !query.isFetching &&
    writeReady &&
    readReady &&
    !state.uncertain;
  return {
    data,
    commands,
    state,
    query,
    online,
    denied,
    eligible,
    writable,
    canRefresh,
    refresh: async () => {
      if (canRefresh)
        try {
          await commands.refresh();
        } catch {
          /* Query owns the safe read error. */
        }
    },
  };
}
export function preferencesError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 400)
      return 'Couldn’t save. Check the time zone and selected values. The server may not support this zone.';
    if ([401, 403, 404].includes(error.status))
      return 'Preferences are unavailable. Sign in again or retry.';
    if (error.status === 429)
      return 'Too many requests. Wait before trying again.';
  }
  return 'Couldn’t save or load preferences. Check your connection and try again.';
}
