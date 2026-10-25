import { useAuth } from '../auth/useAuth';

/**
 * `pending` while a stored session is being verified. The landing page never
 * waits for it; only the auth-dependent actions do. An `error` status still
 * means a stored session exists, so the user is offered Boards, whose guard
 * shows the retry screen.
 */
export type LandingSession = 'pending' | 'guest' | 'member';

export function useLandingSession(): LandingSession {
  const { status } = useAuth();
  if (status === 'loading') return 'pending';
  return status === 'anonymous' ? 'guest' : 'member';
}
