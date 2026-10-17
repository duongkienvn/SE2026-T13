import { createContext, useContext } from 'react';

/** Internal session boundary; deliberately separate from the public auth API. */
export interface AuthSessionScope {
  generation: number;
  /** Check again at the point of a side effect, not only after awaiting a request. */
  isCurrent: () => boolean;
}

export const AuthSessionContext = createContext<AuthSessionScope | null>(null);

export function useAuthSession(): AuthSessionScope {
  const scope = useContext(AuthSessionContext);
  if (!scope) throw new Error('useAuthSession requires <AuthProvider>.');
  return scope;
}
