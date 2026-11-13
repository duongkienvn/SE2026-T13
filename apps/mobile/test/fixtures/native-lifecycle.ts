import type {
  NativeAppState,
  NativeNetwork,
  NetworkState,
} from '../../src/infrastructure/query/lifecycle.ts';

export function nativeLifecycle(initial: NetworkState = { isConnected: true }) {
  let appListener: ((state: string) => void) | undefined;
  let networkListener: ((state: NetworkState) => void) | undefined;
  let networkState = initial;
  let appState = 'active';
  const app: NativeAppState = {
    get currentState() {
      return appState;
    },
    addEventListener(_event, listener) {
      appListener = listener;
      return {
        remove: () => {
          appListener = undefined;
        },
      };
    },
  };
  const network: NativeNetwork = {
    getNetworkStateAsync: async () => networkState,
    addNetworkStateListener(listener) {
      networkListener = listener;
      return {
        remove: () => {
          networkListener = undefined;
        },
      };
    },
  };
  return {
    app,
    network,
    setAppState(state: string) {
      appState = state;
      appListener?.(state);
    },
    setNetworkState(state: NetworkState) {
      networkState = state;
      networkListener?.(state);
    },
  };
}
