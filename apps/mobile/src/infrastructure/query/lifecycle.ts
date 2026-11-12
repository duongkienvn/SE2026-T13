import { focusManager, onlineManager } from '@tanstack/react-query';
import type { SessionManager } from '../auth/session-manager.ts';

export interface NativeAppState {
  readonly currentState: string | null | undefined;
  addEventListener(
    event: 'change',
    callback: (state: string) => void,
  ): { remove(): void };
}
export interface NetworkState {
  readonly isConnected?: boolean;
  readonly isInternetReachable?: boolean;
}
export interface NativeNetwork {
  getNetworkStateAsync(): Promise<NetworkState>;
  addNetworkStateListener(callback: (state: NetworkState) => void): {
    remove(): void;
  };
}

/** Unknown reachability is not proof of offline. Subscription wins over initial read. */
export function bindQueryLifecycle(
  manager: SessionManager,
  app: NativeAppState,
  network: NativeNetwork,
): () => void {
  let disposed = false;
  let receivedEvent = false;
  function focus(state: string | null | undefined) {
    if (disposed) return;
    if (state === 'active') manager.checkExpiry();
    focusManager.setFocused(state === 'active');
  }
  function online(state: NetworkState) {
    if (disposed) return;
    const wasOnline = onlineManager.isOnline();
    const connected =
      state.isConnected !== false && state.isInternetReachable !== false;
    manager.checkExpiry();
    onlineManager.setOnline(connected);
    if (!wasOnline && connected) manager.handleNetworkRestored();
  }
  focus(app.currentState);
  const appSubscription = app.addEventListener('change', focus);
  const networkSubscription = network.addNetworkStateListener((state) => {
    receivedEvent = true;
    online(state);
  });
  void network
    .getNetworkStateAsync()
    .then((state) => {
      if (!disposed && !receivedEvent) online(state);
    })
    .catch(() => {
      /* Keep unknown status; HTTP reports actual reachability. */
    });
  return () => {
    disposed = true;
    appSubscription.remove();
    networkSubscription.remove();
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
  };
}
