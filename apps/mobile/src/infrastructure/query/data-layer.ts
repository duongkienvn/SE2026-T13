import { queryOptions } from '@tanstack/react-query';
import type { HttpClient } from '../api/client.ts';
import { ApiError } from '../api/errors.ts';
import {
  createSessionHttpClient,
  currentIdentity,
  sameIdentity,
  type SessionIdentity,
} from '../api/session-client.ts';
import { decodeSessionUser } from '../auth/session-api.ts';
import type { SessionManager } from '../auth/session-manager.ts';
import { createMobileQueryClient } from './client.ts';
import { queryKeys } from './keys.ts';

/** Construct before SessionProvider starts restoring credentials. */
export function createMobileDataLayer(
  manager: SessionManager,
  transport: HttpClient,
) {
  const queryClient = createMobileQueryClient();
  const network = createSessionHttpClient(transport, manager);
  let disposed = false;
  function getIdentity() {
    return disposed ? null : currentIdentity(manager);
  }
  function assertCurrent(identity: SessionIdentity) {
    if (!sameIdentity(identity, getIdentity()))
      throw new ApiError('session-changed');
  }
  function resetPrivateState() {
    network.cancelRequests();
    // Cancellation invokes AbortSignal synchronously. Removal happens before
    // the session owner publishes another identity; promises cannot resurrect it.
    void queryClient.cancelQueries({ queryKey: queryKeys.private });
    queryClient.removeQueries({ queryKey: queryKeys.private });
    queryClient.getMutationCache().clear();
  }
  const unbind = manager.addLifecycleListener({
    onSessionEnd: resetPrivateState,
  });

  return {
    queryClient,
    api: network.client,
    getIdentity,
    assertCurrent,
    resetPrivateState,
    cancelRequests: network.cancelRequests,
    meOptions(identity: SessionIdentity) {
      return queryOptions({
        queryKey: queryKeys.me(identity),
        queryFn: ({ signal }) => {
          assertCurrent(identity);
          return network.client.json('/users/me', decodeSessionUser, {
            identity,
            signal,
            expectedStatus: 200,
          });
        },
      });
    },
    dispose() {
      disposed = true;
      resetPrivateState();
      unbind();
      network.dispose();
      queryClient.clear();
    },
  };
}

export type MobileDataLayer = ReturnType<typeof createMobileDataLayer>;
