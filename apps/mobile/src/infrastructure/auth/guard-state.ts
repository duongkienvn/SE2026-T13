import type { SessionSnapshot, SessionStatus } from './session-manager.ts';

/**
 * Token-free view of the session for MOB-03 route guards. The six statuses
 * match the guard states MOB-03 (#244) is specified to consume.
 */
export interface GuardSessionState {
  readonly status: SessionStatus;
  readonly generation: number;
  readonly userId: string | null;
  /** Only `authenticated` may render protected routes or cached data. */
  readonly canShowProtectedContent: boolean;
  /** Still deciding: render the neutral auth-check screen, nothing private. */
  readonly isResolving: boolean;
  /** `offline-uncertain`: offer Retry instead of sending the user to Sign in. */
  readonly canRetry: boolean;
}

export function toGuardSessionState(
  snapshot: SessionSnapshot,
): GuardSessionState {
  return {
    status: snapshot.status,
    generation: snapshot.generation,
    userId: snapshot.status === 'authenticated' ? snapshot.user.id : null,
    canShowProtectedContent: snapshot.status === 'authenticated',
    isResolving:
      snapshot.status === 'restoring' || snapshot.status === 'verifying',
    canRetry: snapshot.status === 'offline-uncertain',
  };
}
