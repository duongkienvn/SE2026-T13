import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useSessionManager } from '../../infrastructure/auth/SessionProvider';
import { useAuth } from '../auth/runtime';

/**
 * Recovery is a public flow (`/forgot-password` is only reachable signed out).
 * Sign out on explicit request, then hand the verified email to that flow.
 * The server still answers with a generic acknowledgement; nothing is sent here.
 */
export function useRecoveryHandoff(email: string) {
  const manager = useSessionManager(),
    { flow } = useAuth(),
    router = useRouter(),
    started = useRef(false),
    [pending, setPending] = useState(false);
  return {
    pending,
    start() {
      if (started.current) return;
      started.current = true;
      setPending(true);
      // The Router object is app-wide: still valid after this screen unmounts.
      void manager.logout().then(() => {
        // A different session may have started meanwhile; never prefill for it.
        if (manager.getSnapshot().status !== 'unauthenticated') return;
        // Session end cleared the public flow; prefill only after it.
        flow?.setEmail(email);
        router.replace('/forgot-password');
      });
    },
  };
}
