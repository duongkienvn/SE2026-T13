import { createHttpClient } from '../../src/infrastructure/api/client.ts';
import { createCredentialStore } from '../../src/infrastructure/auth/credential-store.ts';
import { createSessionManager } from '../../src/infrastructure/auth/session-manager.ts';
import { createMobileDataLayer } from '../../src/infrastructure/query/data-layer.ts';
import {
  FakeSessionApi,
  FakeTime,
  MemorySecureStore,
  USER_A,
  USER_B,
  loginResponse,
  user,
} from '../auth/support.ts';

export function ok(data: unknown) {
  return new Response(
    JSON.stringify({ success: true, statusCode: 200, message: 'OK', data }),
    { headers: { 'content-type': 'application/json' } },
  );
}
export async function setup(
  respond?: (init: RequestInit) => Promise<Response>,
) {
  const time = new FakeTime();
  const api = new FakeSessionApi();
  api.auto = (token) => ({
    kind: 'verified',
    user: user(token === loginResponse(USER_A).accessToken ? USER_A : USER_B),
  });
  const manager = createSessionManager({
    store: createCredentialStore(new MemorySecureStore()),
    api,
    clock: time,
    timers: time,
  });
  const requests: RequestInit[] = [];
  const transport = createHttpClient({
    baseUrl: new URL('https://example.test/api'),
    timers: time,
    clock: time,
    fetch: (async (_url, init) => {
      requests.push(init!);
      const snapshot = manager.getSnapshot();
      return respond
        ? respond(init!)
        : ok(
            user(
              snapshot.status === 'authenticated' ? snapshot.user.id : USER_A,
            ),
          );
    }) as typeof fetch,
  });
  const layer = createMobileDataLayer(manager, transport);
  layer.queryClient.setDefaultOptions({
    ...layer.queryClient.getDefaultOptions(),
    queries: {
      ...layer.queryClient.getDefaultOptions().queries,
      gcTime: Infinity,
    },
  });
  await manager.establishSession(loginResponse(USER_A));
  return {
    layer,
    manager,
    api,
    time,
    requests,
    dispose() {
      layer.dispose();
      manager.dispose();
    },
  };
}
