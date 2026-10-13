import { createContext } from 'react';
import type { LoginResponse, User } from './types';

/**
 * - `loading`: a stored token is being verified with `GET /users/me`.
 * - `error`: verification failed for a reason other than 401 (network/5xx); retry is offered.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  /** Stores a fresh login and marks the session authenticated. */
  signIn: (response: LoginResponse) => void;
  /** Calls the logout API when possible, then always clears local session state. */
  signOut: () => void;
  /** Re-runs session verification after an `error` status. */
  retry: () => void;
  /**
   * Runs a protected request with the current access token. A 401 response
   * ends the session before the error is re-thrown.
   */
  runAuthorized: <T>(
    request: (accessToken: string) => Promise<T>,
  ) => Promise<T>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
