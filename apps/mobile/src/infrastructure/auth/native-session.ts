import { systemClock, systemTimers } from './clock.ts';
import { createCredentialStore } from './credential-store.ts';
import { nativeSecureStore } from './secure-store-adapter.ts';
import {
  createFetchSessionApi,
  parseApiBaseUrl,
  type SessionApi,
} from './session-api.ts';
import {
  createSessionManager,
  type SessionManager,
} from './session-manager.ts';

/**
 * Used when `EXPO_PUBLIC_API_BASE_URL` is missing or not HTTPS: no request is
 * ever sent, a stored credential stays unverified (content locked) and there
 * is no silent fallback to another server.
 */
const unconfiguredApi: SessionApi = {
  verify: async () => ({ kind: 'unavailable', reason: 'server' }),
  logout: async () => false,
};

export function createNativeSessionManager(): SessionManager {
  const baseUrl = parseApiBaseUrl(
    process.env.EXPO_PUBLIC_API_BASE_URL,
    __DEV__,
  );
  return createSessionManager({
    store: createCredentialStore(nativeSecureStore),
    api: baseUrl
      ? createFetchSessionApi({
          baseUrl,
          // Unbound call: some fetch implementations reject a foreign `this`.
          fetch: (input, init) => fetch(input, init),
          timers: systemTimers,
        })
      : unconfiguredApi,
    clock: systemClock,
    timers: systemTimers,
  });
}
