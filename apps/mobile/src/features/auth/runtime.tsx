import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useFocusEffect } from 'expo-router';
import { ApiError } from '../../infrastructure/api/errors';
import type { SessionManager } from '../../infrastructure/auth/session-manager';
import type { AuthApi } from './api';
import type { AuthFlow } from './flow';

interface AuthRuntime {
  api: AuthApi;
  manager: SessionManager;
  flow: AuthFlow;
}
const AuthContext = createContext<AuthRuntime | null>(null);
export function AuthProvider({
  api,
  manager,
  flow,
  children,
}: AuthRuntime & { children: ReactNode }) {
  useEffect(() => {
    const clear = () => {
      const state = manager.getSnapshot();
      if (state.status === 'authenticated') flow.clear();
    };
    const stop = manager.subscribe(clear);
    const end = manager.addLifecycleListener({
      onSessionEnd: () => flow.clear(),
    });
    // A warm public link must not leave a proof behind an authenticated guard.
    const stopFlow = flow.subscribe(() => {
      if (
        manager.getSnapshot().status === 'authenticated' &&
        flow.getSnapshot().hasProof
      )
        flow.clear();
    });
    clear();
    return () => {
      stop();
      end();
      stopFlow();
      flow.clear();
    };
  }, [manager, flow]);
  return (
    <AuthContext.Provider value={{ api, manager, flow }}>
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is required');
  return value;
}
export function useAuthFlow() {
  const { flow } = useAuth();
  return useSyncExternalStore(
    flow.subscribe,
    flow.getSnapshot,
    flow.getSnapshot,
  );
}
export function useAuthSession() {
  const { manager } = useAuth();
  return useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot,
  );
}

/** One synchronous in-flight lock per focused form; abort fences late callbacks. */
export function usePublicRequest() {
  const { manager } = useAuth();
  const current = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const cancel = useCallback(() => {
    current.current?.abort();
    current.current = null;
  }, []);
  useFocusEffect(
    useCallback(() => {
      setPending(false);
      return cancel;
    }, [cancel]),
  );
  return {
    pending,
    cancel,
    run: async (
      action: (
        signal: AbortSignal,
        currentSession: () => boolean,
      ) => Promise<void>,
      failed: (error: unknown) => void,
    ) => {
      if (current.current) return;
      const controller = new AbortController();
      current.current = controller;
      setPending(true);
      const generation = manager.getSnapshot().generation;
      try {
        await action(
          controller.signal,
          () => !controller.signal.aborted && manager.isCurrent(generation),
        );
      } catch (error) {
        if (!controller.signal.aborted && manager.isCurrent(generation))
          failed(error);
      } finally {
        if (current.current === controller) {
          current.current = null;
          setPending(false);
        }
      }
    },
  };
}
export function authError(error: unknown): string {
  if (!(error instanceof ApiError))
    return 'Something went wrong. Please try again.';
  if (error.status === 429)
    return 'Too many attempts. Please wait before trying again.';
  if (error.status === 401) return 'Email or password is incorrect.';
  if (error.status === 409)
    return 'An account already uses this email. Sign in or recover your password.';
  if (error.code === 'PASSWORD_REUSED')
    return 'Choose a password you have not used before. Request a new recovery link to try again.';
  if (error.kind === 'configuration')
    return 'The API is not configured. Contact your app administrator.';
  if (error.kind === 'offline' || error.kind === 'network')
    return 'Could not connect. Check your internet connection and try again.';
  if (error.kind === 'timeout')
    return 'The request timed out. It may have completed. Check your email or try again later.';
  if (error.status === 400) return 'Check the fields and try again.';
  return 'The service is unavailable. Please try again later.';
}
export function retryDelay(error: unknown): number {
  const delay = error instanceof ApiError ? error.retryAfterMs : undefined;
  return delay !== undefined && Number.isFinite(delay)
    ? Math.max(60_000, delay)
    : 60_000;
}
export function useCooldown(until: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (until <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}
