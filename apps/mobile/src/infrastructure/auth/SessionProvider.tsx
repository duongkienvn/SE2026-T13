import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { bindAppLifecycle } from './app-lifecycle.ts';
import { toGuardSessionState, type GuardSessionState } from './guard-state.ts';
import type { SessionManager, SessionSnapshot } from './session-manager.ts';

const SessionContext = createContext<SessionManager | null>(null);

/** Owns cold-start restore and foreground re-checks for one manager. */
export function SessionProvider({
  manager,
  children,
}: {
  manager: SessionManager;
  children: ReactNode;
}) {
  useEffect(() => {
    void manager.start();
    return bindAppLifecycle(manager, AppState);
  }, [manager]);
  return (
    <SessionContext.Provider value={manager}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionManager(): SessionManager {
  const manager = useContext(SessionContext);
  if (!manager) throw new Error('useSessionManager needs a SessionProvider');
  return manager;
}

export function useSessionSnapshot(): SessionSnapshot {
  const manager = useSessionManager();
  return useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  );
}

/** Token-free guard state for MOB-03 navigation. */
export function useGuardSession(): GuardSessionState {
  const snapshot = useSessionSnapshot();
  return useMemo(() => toGuardSessionState(snapshot), [snapshot]);
}

/**
 * Renders `children` only for a verified session; everything else shows
 * `fallback` (auth check, retry or sign-in), so no protected tree mounts —
 * and no cached private data renders — before `/users/me` succeeds.
 */
export function SessionGate({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: (state: GuardSessionState) => ReactNode;
}) {
  const state = useGuardSession();
  // Keyed by generation: a new session remounts the protected subtree, so
  // no component state from the previous account survives.
  return state.canShowProtectedContent ? (
    <SessionScope key={state.generation}>{children}</SessionScope>
  ) : (
    <>{fallback(state)}</>
  );
}

function SessionScope({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
