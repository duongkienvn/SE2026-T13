import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { currentUserQueryKey } from '../auth/AuthProvider';
import { useAuth } from '../auth/useAuth';
import { useAuthSession } from '../auth/auth-session-context';
import {
  receiveBoardRevocation,
  receiveWorkspaceRevocation,
  reduceBoardToReadOnly,
  clearAccessSnapshots,
  refreshAccessSnapshots,
} from './access-revocation';
import { BoardRealtimeClient } from './board-realtime-client';
import { createInvalidationQueue } from './invalidation-queue';
import { RealtimeContext } from './realtime-context';
import { createRealtimeSocket } from './socket-client';
import { changeBoardAccessVersion } from '../boards/access-version';
import { refreshWorkspaceGuests } from '../workspaces/members/refresh-guests';

/**
 * Owns the realtime client of the signed-in session. A new session (sign-in,
 * sign-out, expiry) gets a new client, so a socket never outlives the token
 * it was opened with. The session socket also receives access changes while no Board is open.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { status, user, runAuthorized } = useAuth();
  const { isCurrent } = useAuthSession();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<{
    client: BoardRealtimeClient;
    session: typeof runAuthorized;
  } | null>(null);
  const authenticated = status === 'authenticated';

  useEffect(() => {
    if (!authenticated) return;
    const queue = createInvalidationQueue(queryClient);
    const next = new BoardRealtimeClient({
      // `runAuthorized` belongs to this session and refuses once it has ended.
      createSocket: () => {
        const socket = createRealtimeSocket(() =>
          runAuthorized((token) => Promise.resolve(token)),
        );
        // Guests may be removed without losing Board read access. Clear roster
        // snapshots immediately, before the ordinary batched invalidation queue.
        for (const event of [
          'member:added',
          'member:removed',
          'member:role-changed',
          'board:access-changed',
          'board:archived',
          'board:restored',
        ] as const) {
          socket.on(event, (payload: unknown) => {
            if (
              isCurrent() &&
              payload &&
              typeof payload === 'object' &&
              'boardId' in payload &&
              typeof payload.boardId === 'string'
            )
              refreshWorkspaceGuests(queryClient);
          });
        }
        socket.on('member:removed', (payload: unknown) => {
          if (!isCurrent() || !payload || typeof payload !== 'object') return;
          if (!('boardId' in payload) || typeof payload.boardId !== 'string')
            return;
          if (!('userId' in payload) || payload.userId !== userId) return;
          if (
            'retainsReadAccess' in payload &&
            payload.retainsReadAccess === true
          ) {
            reduceBoardToReadOnly(queryClient, payload.boardId);
            return;
          }
          receiveBoardRevocation(queryClient, payload);
        });
        socket.on('board:access-revoked', (payload: unknown) => {
          if (isCurrent()) receiveBoardRevocation(queryClient, payload);
        });
        socket.on('workspace:access-revoked', (payload: unknown) => {
          if (isCurrent()) receiveWorkspaceRevocation(queryClient, payload);
        });
        socket.on('access:changed', () => {
          if (isCurrent()) refreshAccessSnapshots(queryClient);
        });
        for (const event of ['member:added', 'member:role-changed'] as const) {
          socket.on(event, (payload: unknown) => {
            if (
              !isCurrent() ||
              !payload ||
              typeof payload !== 'object' ||
              !('userId' in payload) ||
              payload.userId !== userId ||
              !('boardId' in payload) ||
              typeof payload.boardId !== 'string'
            )
              return;
            const id = payload.boardId.toLowerCase();
            changeBoardAccessVersion(queryClient, id);
            void queryClient.cancelQueries({
              queryKey: ['boards', 'detail'],
              predicate: (query) =>
                typeof query.queryKey[2] === 'string' &&
                query.queryKey[2].toLowerCase() === id,
            });
          });
        }
        return socket;
      },
      invalidate: queue.add,
      accessRevoked: (boardId) => {
        if (isCurrent()) receiveBoardRevocation(queryClient, { boardId });
      },
      verifySession: () =>
        void queryClient.invalidateQueries({ queryKey: currentUserQueryKey }),
      keepAlive: true,
      connectionLost: () => {
        if (isCurrent()) clearAccessSnapshots(queryClient);
      },
      reconnected: () => {
        if (isCurrent()) refreshAccessSnapshots(queryClient);
      },
    });
    next.start();
    const wake = () => {
      if (document.visibilityState === 'visible') next.wake();
    };
    const guardDrafts = (event: BeforeUnloadEvent) => {
      if (
        queryClient
          .getQueryCache()
          .findAll({ queryKey: ['card-draft'] })
          .some((query) => query.state.data !== undefined)
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('online', wake);
    window.addEventListener('beforeunload', guardDrafts);
    document.addEventListener('visibilitychange', wake);
    setConnection({ client: next, session: runAuthorized });
    return () => {
      window.removeEventListener('online', wake);
      window.removeEventListener('beforeunload', guardDrafts);
      document.removeEventListener('visibilitychange', wake);
      next.dispose();
      queue.dispose();
      setConnection((current) => (current?.client === next ? null : current));
    };
  }, [authenticated, runAuthorized, queryClient, isCurrent, userId]);

  return (
    <RealtimeContext.Provider
      value={
        authenticated && connection?.session === runAuthorized
          ? connection.client
          : null
      }
    >
      {children}
    </RealtimeContext.Provider>
  );
}
