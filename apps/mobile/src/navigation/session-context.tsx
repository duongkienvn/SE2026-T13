import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  defaultSessionAdapter,
  emptyGuardMemory,
  reconcileSession,
  safeReturnTarget,
  type SessionAdapter,
  type SessionState,
} from './session';
import type { Destination } from './routes';
import { subscribeIncomingLinks } from './incoming-link';

const SessionContext = createContext<SessionAdapter>(defaultSessionAdapter);
const ReturnContext = createContext<{
  remember(path: string, overwrite?: boolean): void;
  take(): Destination | null;
}>({ remember: () => {}, take: () => null });

/** MOB-05 supplies a stable adapter; no credentials belong in navigation. */
export function SessionProvider({
  adapter,
  children,
}: {
  adapter: SessionAdapter;
  children: ReactNode;
}) {
  return (
    <SessionContext.Provider value={adapter}>
      <ReturnProvider>{children}</ReturnProvider>
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const adapter = useContext(SessionContext);
  return useSyncExternalStore(
    adapter.subscribe,
    adapter.getSnapshot,
    adapter.getSnapshot,
  );
}

function ReturnProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const adapter = useContext(SessionContext);
  const memory = useRef(emptyGuardMemory);
  memory.current = reconcileSession(memory.current, session);
  useEffect(
    () =>
      subscribeIncomingLinks((destination) => {
        const current = adapter.getSnapshot();
        if (current.status !== 'authenticated' || !current.sessionKey) {
          memory.current = {
            ...reconcileSession(memory.current, current),
            pending: destination,
          };
        }
      }),
    [adapter],
  );
  const value = useMemo(
    () => ({
      remember(path: string, overwrite = true) {
        if (!overwrite && memory.current.pending) return;
        memory.current = { ...memory.current, pending: safeReturnTarget(path) };
      },
      take() {
        const pending = memory.current.pending;
        memory.current = { ...memory.current, pending: null };
        return pending;
      },
    }),
    [],
  );
  return (
    <ReturnContext.Provider value={value}>{children}</ReturnContext.Provider>
  );
}

export function useReturnTarget() {
  return useContext(ReturnContext);
}
