import {
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from 'react';
import type { BoardRealtimeStatus } from './board-realtime-client';
import { RealtimeContext } from './realtime-context';

const noSubscription = () => () => undefined;

export interface BoardRealtime {
  status: BoardRealtimeStatus;
  /** Retries now after the sync has paused. */
  retry: () => void;
}

/**
 * Keeps the board's cached data in sync with other users' changes while the
 * calling page is mounted and `enabled`, and reports how live that sync is.
 */
export function useBoardRealtime(
  boardId: string,
  { enabled = true } = {},
): BoardRealtime {
  const client = useContext(RealtimeContext);

  useEffect(
    () => (enabled ? client?.watch(boardId) : undefined),
    [client, boardId, enabled],
  );

  const status = useSyncExternalStore(
    client ? client.subscribe : noSubscription,
    () => client?.status(boardId) ?? 'connecting',
  );
  const retry = useCallback(() => client?.wake(), [client]);

  return { status, retry };
}
