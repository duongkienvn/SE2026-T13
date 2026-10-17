import { useContext, useEffect, useSyncExternalStore } from 'react';
import type { BoardRealtimeStatus } from './board-realtime-client';
import { RealtimeContext } from './realtime-context';

const noSubscription = () => () => undefined;

/**
 * Keeps the board's cached data in sync with other users' changes while the
 * calling page is mounted, and reports how live that sync currently is.
 */
export function useBoardRealtime(boardId: string): BoardRealtimeStatus {
  const client = useContext(RealtimeContext);

  useEffect(() => client?.watch(boardId), [client, boardId]);

  return useSyncExternalStore(
    client ? client.subscribe : noSubscription,
    () => client?.status(boardId) ?? 'connecting',
  );
}
