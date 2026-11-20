import { useEffect } from 'react';
import { useRootNavigationState, useRouter, type Href } from 'expo-router';
import { notifyIncomingLink } from '../../navigation/incoming-link';
import { nativePush, nativePushAdapter } from './native-runtime';
/** Mount after router + return-target guards; payloads never supply a path. */
export function PushBridge() {
  const router = useRouter(),
    ready = useRootNavigationState()?.key;
  useEffect(() => {
    if (!ready) return;
    nativePush.setOpenInbox(() => {
      const replacement = notifyIncomingLink({ kind: 'tab', tab: 'inbox' });
      router.navigate((replacement ?? '/inbox') as Href);
    });
    let disposed = false,
      cleanup: (() => void) | undefined;
    void nativePushAdapter
      .listen(
        nativePush.receive,
        nativePush.tap,
        () => void nativePush.reconcile(),
      )
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else cleanup = unsubscribe;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      cleanup?.();
      nativePush.setOpenInbox(() => {});
    };
  }, [ready, router]);
  return null;
}
