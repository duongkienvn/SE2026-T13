import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { currentUserQueryKey } from '../auth/AuthProvider';
import { useAuth } from '../auth/useAuth';
import { BoardRealtimeClient } from './board-realtime-client';
import { createInvalidationQueue } from './invalidation-queue';
import { RealtimeContext } from './realtime-context';
import { createRealtimeSocket } from './socket-client';

/**
 * Owns the realtime client of the signed-in session. A new session (sign-in,
 * sign-out, expiry) gets a new client, so a socket never outlives the token
 * it was opened with. The socket itself opens only while a board is watched.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { status, runAuthorized } = useAuth();
  const queryClient = useQueryClient();
  const [client, setClient] = useState<BoardRealtimeClient | null>(null);
  const authenticated = status === 'authenticated';

  useEffect(() => {
    if (!authenticated) return;
    const queue = createInvalidationQueue(queryClient);
    const next = new BoardRealtimeClient({
      // `runAuthorized` belongs to this session and refuses once it has ended.
      createSocket: () =>
        createRealtimeSocket(() =>
          runAuthorized((token) => Promise.resolve(token)),
        ),
      invalidate: queue.add,
      verifySession: () =>
        void queryClient.invalidateQueries({ queryKey: currentUserQueryKey }),
    });
    const wake = () => {
      if (document.visibilityState === 'visible') next.wake();
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    setClient(next);
    return () => {
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
      next.dispose();
      queue.dispose();
      setClient((current) => (current === next ? null : current));
    };
  }, [authenticated, runAuthorized, queryClient]);

  return (
    <RealtimeContext.Provider value={client}>
      {children}
    </RealtimeContext.Provider>
  );
}
