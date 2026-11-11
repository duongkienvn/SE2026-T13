import type { SessionManager } from './session-manager.ts';

/** The part of React Native's `AppState` the session uses; fake in tests. */
export interface AppStateLike {
  readonly currentState: string | null | undefined;
  addEventListener(
    type: 'change',
    listener: (state: string) => void,
  ): { remove(): void };
}

/**
 * Re-checks absolute expiry and retries uncertain verification whenever the
 * app returns to the foreground. JS timers do not run in the background and
 * the wall clock may have changed, so the timer alone is not enough.
 */
export function bindAppLifecycle(
  manager: Pick<SessionManager, 'handleForeground'>,
  appState: AppStateLike,
): () => void {
  let previous = appState.currentState ?? 'unknown';
  const subscription = appState.addEventListener('change', (state) => {
    if (state === 'active' && previous !== 'active') manager.handleForeground();
    previous = state;
  });
  return () => subscription.remove();
}
