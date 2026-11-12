import {
  destinationPath,
  parsePath,
  type Destination,
  type DestinationPath,
} from './routes.ts';

export type SessionState =
  | {
      status:
        | 'restoring'
        | 'verifying'
        | 'unauthenticated'
        | 'expired'
        | 'offline-uncertain';
    }
  | { status: 'authenticated'; sessionKey: string };

export interface SessionAdapter {
  getSnapshot(): SessionState;
  subscribe(listener: () => void): () => void;
}

const signedOut: SessionState = { status: 'unauthenticated' };
export const defaultSessionAdapter: SessionAdapter = {
  getSnapshot: () => signedOut,
  subscribe: () => () => {},
};

/** A pending destination is untrusted and contains no cached business data. */
export function safeReturnTarget(path: string | null): Destination | null {
  return path ? parsePath(path) : null;
}

export function resumeTarget(
  state: SessionState,
  target: Destination | null,
): DestinationPath | null {
  if (state.status !== 'authenticated' || !state.sessionKey || !target)
    return null;
  const path = destinationPath(target);
  return safeReturnTarget(path) ? path : null;
}

/** Resource access must be supplied by the future server-backed screen owner. */
export type ResourceAccess =
  | 'checking'
  | 'unavailable'
  | { status: 'allowed'; sessionKey: string; resourcePath: string };
export type GuardDecision =
  'wait' | 'sign-in' | 'offline' | 'unavailable' | 'render';

export function guardDecision(
  session: SessionState,
  access: ResourceAccess,
  resourcePath: string,
): GuardDecision {
  if (session.status === 'restoring' || session.status === 'verifying')
    return 'wait';
  if (session.status === 'offline-uncertain') return 'offline';
  if (session.status !== 'authenticated' || !session.sessionKey)
    return 'sign-in';
  const destination = parsePath(resourcePath);
  if (
    !destination ||
    (destination.kind !== 'workspace' &&
      destination.kind !== 'board' &&
      destination.kind !== 'card' &&
      destination.kind !== 'boardView')
  )
    return 'unavailable';
  if (access === 'checking') return 'wait';
  if (access === 'unavailable') return 'unavailable';
  return access.sessionKey === session.sessionKey &&
    access.resourcePath === destinationPath(destination)
    ? 'render'
    : 'wait';
}

export type GuardMemory = {
  pending: Destination | null;
  sessionKey: string | null;
};

export const emptyGuardMemory: GuardMemory = {
  pending: null,
  sessionKey: null,
};

/** Drop pending private navigation when an authenticated identity ends or changes. */
export function reconcileSession(
  memory: GuardMemory,
  state: SessionState,
): GuardMemory {
  if (state.status === 'authenticated') {
    return {
      pending:
        memory.sessionKey && memory.sessionKey !== state.sessionKey
          ? null
          : memory.pending,
      sessionKey: state.sessionKey,
    };
  }
  if (
    memory.sessionKey &&
    (state.status === 'unauthenticated' || state.status === 'expired')
  )
    return emptyGuardMemory;
  return memory;
}
