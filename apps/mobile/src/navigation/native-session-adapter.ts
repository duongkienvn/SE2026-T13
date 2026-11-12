import type {
  SessionManager,
  SessionSnapshot,
} from '../infrastructure/auth/session-manager.ts';
import type { SessionAdapter, SessionState } from './session.ts';

/** Keep native credentials out of navigation; identity includes its generation. */
export function createNavigationSessionAdapter(
  manager: Pick<SessionManager, 'getSnapshot' | 'subscribe'>,
): SessionAdapter {
  let previous: SessionSnapshot | undefined;
  let state: SessionState;
  return {
    subscribe: (listener) => manager.subscribe(listener),
    getSnapshot() {
      const snapshot = manager.getSnapshot();
      if (snapshot !== previous) {
        state =
          snapshot.status === 'authenticated'
            ? {
                status: 'authenticated',
                sessionKey: `${snapshot.generation}:${snapshot.user.id}`,
              }
            : { status: snapshot.status };
        previous = snapshot;
      }
      return state;
    },
  };
}
