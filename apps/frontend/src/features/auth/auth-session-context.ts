import { createContext, useContext } from 'react';

/** Internal session boundary; deliberately separate from the public auth API. */
export interface AuthSessionScope {
  generation: number;
  /** Check again at the point of a side effect, not only after awaiting a request. */
  isCurrent: () => boolean;
  /** Only after a confirmed server-side session-revoking success: allow the
   * initiating session to have ended, but never overwrite a replacement login. */
  canFinishRevokingRequest: () => boolean;
}

export const AuthSessionContext = createContext<AuthSessionScope | null>(null);

export function useAuthSession(): AuthSessionScope {
  const scope = useContext(AuthSessionContext);
  if (!scope) throw new Error('useAuthSession requires <AuthProvider>.');
  return scope;
}
