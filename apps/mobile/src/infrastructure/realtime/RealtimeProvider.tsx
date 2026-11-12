import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useSessionSnapshot } from '../auth/SessionProvider';
import type { NativeRealtime } from './client.ts';

const RealtimeContext = createContext<NativeRealtime | null>(null);
export function RealtimeProvider({
  client,
  children,
}: {
  client: NativeRealtime;
  children: ReactNode;
}) {
  useEffect(() => {
    client.start();
    return client.stop;
  }, [client]);
  return (
    <RealtimeContext.Provider value={client}>
      {children}
    </RealtimeContext.Provider>
  );
}
export function useRealtime(): NativeRealtime {
  const client = useContext(RealtimeContext);
  if (!client) throw new Error('useRealtime needs a RealtimeProvider');
  return client;
}
/** A route must pass active=false when unfocused; mounted tab stacks may be hidden. */
export function useBoardRealtime(boardId: string, active: boolean) {
  const client = useRealtime();
  const session = useSessionSnapshot();
  useEffect(() => {
    if (active && session.status === 'authenticated')
      return client.watchBoard(boardId);
  }, [client, boardId, active, session.status, session.generation]);
  return useSyncExternalStore(
    client.subscribeBoards,
    () => client.getBoardSnapshot(boardId),
    () => client.getBoardSnapshot(boardId),
  );
}
