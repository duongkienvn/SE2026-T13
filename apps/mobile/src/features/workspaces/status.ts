import { useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';
import { ApiError } from '../../infrastructure/api/errors.ts';

const subscribe = onlineManager.subscribe.bind(onlineManager);
const online = () => onlineManager.isOnline();
export function useWorkspaceOnline() {
  return useSyncExternalStore(subscribe, online);
}

export function workspaceErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'Too many requests. Try again shortly.';
    if (error.kind === 'timeout')
      return 'The request took too long. Try again.';
    if (error.code === 'RESOURCE_ACCESS_CHANGED')
      return 'Workspace access changed. Retry to check what’s available.';
    if (error.kind === 'offline')
      return 'You’re offline. Reconnect to try again.';
  }
  return 'Couldn’t load the latest data. Try again.';
}

export function canRetryWorkspace(error: unknown, updatedAt: number) {
  return !(
    error instanceof ApiError &&
    error.status === 429 &&
    error.retryAfterMs &&
    Date.now() < updatedAt + error.retryAfterMs
  );
}
