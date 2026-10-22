import { useCallback, useContext, useSyncExternalStore } from 'react';
import { useAuth } from '../auth/useAuth';
import {
  EMPTY_PRESENCE,
  type BoardPresenceState,
} from '../realtime/board-presence-state';
import { RealtimeContext } from '../realtime/realtime-context';

const noSubscription = () => () => undefined;

/** Observe the session's existing room. The page owns useBoardRealtime/watch. */
export function useBoardPresence(
  boardId: string,
  { enabled = true } = {},
): BoardPresenceState {
  const client = useContext(RealtimeContext);
  const { status } = useAuth();
  const active = enabled && status === 'authenticated';
  const getSnapshot = useCallback(() => {
    if (!enabled) return EMPTY_PRESENCE.unavailable;
    if (!active || !client) return EMPTY_PRESENCE.connecting;
    return client.presence(boardId);
  }, [active, boardId, client, enabled]);
  return useSyncExternalStore(
    active && client ? client.subscribe : noSubscription,
    getSnapshot,
    () => EMPTY_PRESENCE.connecting,
  );
}
