import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, isApiError } from '../../lib/api-client';
import { getCurrentUser, logout } from './api';
import {
  AuthContext,
  type AuthContextValue,
  type AuthStatus,
} from './auth-context';
import { AuthSessionContext } from './auth-session-context';
import {
  clearSession,
  readSessionSnapshot,
  readStoredSessionValue,
  saveSession,
  SESSION_STORAGE_KEY,
  type SessionSnapshot,
} from './session';
import type { LoginResponse } from './types';

export const currentUserQueryKey = ['auth', 'current-user'] as const;

/** Largest delay `setTimeout` accepts; longer delays fire immediately. */
const MAX_TIMEOUT_MS = 2_147_483_647;

function isUnauthorized(error: unknown): boolean {
  return isApiError(error) && error.status === 401;
}

function storageUnchanged(previous: string | null | undefined): boolean {
  const current = readStoredSessionValue();
  // Storage failures must not disable a same-tab in-memory login.
  return (
    current === undefined || previous === undefined || current === previous
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState(() => ({
    ...readSessionSnapshot(),
    generation: 0,
  }));
  // Updated synchronously at session boundaries, before React can render again.
  const scopeRef = useRef(scope);
  const { session, generation } = scope;
  const accessToken = session?.accessToken ?? null;

  const applySession = useCallback(
    (snapshot: SessionSnapshot, verifiedUser?: LoginResponse['user']) => {
      const next = {
        ...snapshot,
        generation: scopeRef.current.generation + 1,
      };
      scopeRef.current = next;
      // Drop all protected queries/mutations before exposing a different session.
      queryClient.clear();
      if (verifiedUser)
        queryClient.setQueryData(currentUserQueryKey, verifiedUser);
      setScope(next);
    },
    [queryClient],
  );

  const endSession = useCallback(() => {
    // An old tab's expiry/401 must not delete a newer shared login.
    if (!storageUnchanged(scopeRef.current.storedValue)) return;
    applySession(clearSession());
  }, [applySession]);

  const isCurrent = useCallback(
    () =>
      scopeRef.current === scope &&
      (!session || Date.now() < session.expiresAt) &&
      storageUnchanged(scope.storedValue),
    [scope, session],
  );

  const runAuthorized = useCallback(
    async <T,>(request: (token: string) => Promise<T>): Promise<T> => {
      // A retained callback must never use credentials from a different session.
      if (!accessToken || !isCurrent()) {
        throw new ApiError(401, 'UNAUTHORIZED', 'Your session has ended.');
      }
      try {
        const result = await request(accessToken);
        if (!isCurrent()) throw new Error('Session changed during request.');
        return result;
      } catch (error) {
        if (isUnauthorized(error) && isCurrent()) endSession();
        throw error;
      }
    },
    [accessToken, isCurrent, endSession],
  );

  const currentUser = useQuery({
    queryKey: currentUserQueryKey,
    queryFn: ({ signal }) =>
      runAuthorized((token) => getCurrentUser(token, signal)),
    enabled: accessToken !== null,
    // Failures are surfaced with an explicit "Try again" instead of silent retries.
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    const synchronize = () => {
      if (readStoredSessionValue() === undefined) return;
      // Read the latest value, not a possibly superseded event.newValue.
      const snapshot = readSessionSnapshot();
      if (snapshot.storedValue !== scopeRef.current.storedValue) {
        applySession(snapshot);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== SESSION_STORAGE_KEY) return;
      try {
        if (event.storageArea && event.storageArea !== window.localStorage)
          return;
      } catch {
        return;
      }
      synchronize();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') synchronize();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', synchronize);
    window.addEventListener('pageshow', synchronize);
    document.addEventListener('visibilitychange', onVisible);
    // Cover a change between initialization and listener installation.
    synchronize();
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', synchronize);
      window.removeEventListener('pageshow', synchronize);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [applySession]);

  // The token has a fixed lifetime and no refresh flow: end the session when it expires.
  useEffect(() => {
    if (!session) return;
    let timeout: ReturnType<typeof setTimeout>;
    const checkExpiry = () => {
      if (scopeRef.current !== scope || !storageUnchanged(scope.storedValue))
        return;
      const remaining = session.expiresAt - Date.now();
      if (remaining <= 0) endSession();
      else
        timeout = setTimeout(checkExpiry, Math.min(remaining, MAX_TIMEOUT_MS));
    };
    checkExpiry();
    return () => clearTimeout(timeout);
  }, [scope, session, endSession]);

  const signIn = useCallback(
    (response: LoginResponse) => {
      const stored = saveSession(response.accessToken, response.expiresIn);
      applySession(stored, response.user);
    },
    [applySession],
  );

  const signOut = useCallback(
    (options?: { notifyServer?: boolean }) => {
      if (scopeRef.current !== scope || !storageUnchanged(scope.storedValue))
        return;
      if (accessToken && options?.notifyServer !== false) {
        // Ordinary logout is stateless. Credential changes revoke JWTs separately
        // and can skip this now-unauthorized best-effort request.
        logout(accessToken).catch(() => undefined);
      }
      endSession();
    },
    [scope, accessToken, endSession],
  );

  const { refetch } = currentUser;
  const retry = useCallback(() => {
    if (!isCurrent()) return;
    void refetch();
  }, [refetch, isCurrent]);

  let status: AuthStatus;
  if (!accessToken) status = 'anonymous';
  else if (currentUser.data) status = 'authenticated';
  else if (currentUser.isError && !isUnauthorized(currentUser.error))
    status = 'error';
  else status = 'loading';

  const user = status === 'authenticated' ? (currentUser.data ?? null) : null;

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, signIn, signOut, retry, runAuthorized }),
    [status, user, signIn, signOut, retry, runAuthorized],
  );

  const sessionScope = useMemo(
    () => ({ generation, isCurrent }),
    [generation, isCurrent],
  );

  return (
    <AuthSessionContext.Provider value={sessionScope}>
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    </AuthSessionContext.Provider>
  );
}
