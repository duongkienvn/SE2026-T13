import { useEffect, useState, useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';
import { ApiError } from '../../infrastructure/api/errors.ts';
import { MAX_AUTOMATIC_RETRY_DELAY_MS } from '../../infrastructure/api/client.ts';
import { MAX_TIMEOUT_MS } from '../../infrastructure/auth/clock.ts';

const subscribe = onlineManager.subscribe.bind(onlineManager);
const online = () => onlineManager.isOnline();
export function useWorkspaceOnline() {
  return useSyncExternalStore(subscribe, online);
}

export function workspaceErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if ([400, 409].includes(error.status)) return error.message;
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

function retryAt(error: unknown, updatedAt: number) {
  if (
    !(error instanceof ApiError) ||
    error.status !== 429 ||
    error.retryAfterMs === undefined
  )
    return 0;
  const delay = Number.isFinite(error.retryAfterMs)
    ? Math.max(0, error.retryAfterMs)
    : MAX_AUTOMATIC_RETRY_DELAY_MS;
  return updatedAt + delay;
}

export function canRetryWorkspace(error: unknown, updatedAt: number) {
  return Date.now() >= retryAt(error, updatedAt);
}

export function useWorkspaceRetryReady(error: unknown, updatedAt: number) {
  const deadline = retryAt(error, updatedAt);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(
      () => setTick((value) => value + 1),
      Math.min(remaining, MAX_TIMEOUT_MS),
    );
    return () => clearTimeout(timer);
  }, [deadline, tick]);
  return canRetryWorkspace(error, updatedAt);
}
