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
import { createQueryCoordinator } from './coordinator.ts';

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
  function seedVerifiedUser() {
    const snapshot = manager.getSnapshot();
    if (snapshot.status === 'authenticated') {
      queryClient.setQueryData(
        queryKeys.me({
          userId: snapshot.user.id,
          generation: snapshot.generation,
        }),
        snapshot.user,
      );
    }
  }
  const unbind = manager.addLifecycleListener({
    onSessionEnd: resetPrivateState,
    onSessionStart: seedVerifiedUser,
  });
  seedVerifiedUser();

  return {
    ...createQueryCoordinator({ queryClient, getIdentity, assertCurrent }),
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
          return network.client.json(
            '/users/me',
            (value) => {
              const user = decodeSessionUser(value);
              if (user.id !== identity.userId)
                throw new Error('Unexpected current user');
              return user;
            },
            {
              identity,
              signal,
              expectedStatus: 200,
            },
          );
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
