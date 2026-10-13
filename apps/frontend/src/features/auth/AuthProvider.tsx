import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
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
import { clearSession, readSession, saveSession } from './session';
import type { LoginResponse } from './types';

export const currentUserQueryKey = ['auth', 'current-user'] as const;

function isUnauthorized(error: unknown): boolean {
  return isApiError(error) && error.status === 401;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState(readSession);
  const accessToken = session?.accessToken ?? null;

  const endSession = useCallback(() => {
    clearSession();
    setSession(null);
    // Drop every cached query so no private data outlives the session.
    queryClient.clear();
  }, [queryClient]);

  const currentUser = useQuery({
    queryKey: currentUserQueryKey,
    queryFn: ({ signal }) => getCurrentUser(accessToken!, signal),
    enabled: accessToken !== null,
    // Failures are surfaced with an explicit "Try again" instead of silent retries.
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (isUnauthorized(currentUser.error)) endSession();
  }, [currentUser.error, endSession]);

  // The token has a fixed lifetime and no refresh flow: end the session when it expires.
  useEffect(() => {
    if (!session) return;
    const timeout = setTimeout(
      endSession,
      Math.max(0, session.expiresAt - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [session, endSession]);

  const signIn = useCallback(
    (response: LoginResponse) => {
      const stored = saveSession(response.accessToken, response.expiresIn);
      queryClient.setQueryData(currentUserQueryKey, response.user);
      setSession(stored);
    },
    [queryClient],
  );

  const signOut = useCallback(() => {
    if (accessToken) {
      // Best effort: the token stays valid server-side until it expires either way.
      logout(accessToken).catch(() => undefined);
    }
    endSession();
  }, [accessToken, endSession]);

  const runAuthorized = useCallback(
    async <T,>(request: (token: string) => Promise<T>): Promise<T> => {
      if (!accessToken) {
        endSession();
        throw new ApiError(401, 'UNAUTHORIZED', 'Your session has ended.');
      }
      try {
        return await request(accessToken);
      } catch (error) {
        if (isUnauthorized(error)) endSession();
        throw error;
      }
    },
    [accessToken, endSession],
  );

  const { refetch } = currentUser;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
