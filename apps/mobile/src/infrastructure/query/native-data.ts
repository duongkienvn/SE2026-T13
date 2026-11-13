import { onlineManager } from '@tanstack/react-query';
import { createHttpClient } from '../api/client.ts';
import { parseApiBaseUrl } from '../api/config.ts';
import { createNativeSessionManager } from '../auth/native-session.ts';
import { createMobileDataLayer } from './data-layer.ts';

// App-lifetime owners, not token singletons. Credentials are read per request.
export const nativeTransport = createHttpClient({
  allowInsecureLocal: __DEV__,
  baseUrl: parseApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL, __DEV__),
  fetch: (input, init) => fetch(input, init),
  isOnline: () => onlineManager.isOnline(),
});
export const nativeSession = createNativeSessionManager(nativeTransport);
export const nativeData = createMobileDataLayer(nativeSession, nativeTransport);
