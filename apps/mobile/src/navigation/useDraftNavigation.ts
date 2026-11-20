import { useEffect, useRef, useState } from 'react';
import { useIsFocused, usePreventRemove, useRouter } from 'expo-router';
import { subscribeIncomingLinks } from './incoming-link';
import { destinationPath } from './routes';

/** Screen removal covers Back, gestures, replacement and navigation back to tabs.
 * Warm app links can push instead of removing; hold them before Expo handles them.
 */
export function useDraftNavigation(
  editor: { dirty: boolean; pending: boolean; cancel(): void },
  path: string,
  enabled = true,
) {
  const router = useRouter();
  const focused = useIsFocused();
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const latest = useRef({ editor, focused, enabled });
  latest.current = { editor, focused, enabled };
  const disablePrevention = usePreventRemove(
    enabled && (editor.dirty || editor.pending),
    ({ repeat }) => {
      if (!editor.pending) setLeave(() => repeat);
    },
  );
  useEffect(
    () =>
      subscribeIncomingLinks((destination) => {
        const state = latest.current;
        const target = destinationPath(destination);
        if (
          !state.enabled ||
          !state.focused ||
          target === path ||
          (!state.editor.dirty && !state.editor.pending)
        )
          return;
        if (!state.editor.pending) setLeave(() => () => router.push(target));
        return path;
      }),
    [path, router],
  );
  return {
    prompt: enabled && !!leave,
    keepEditing: () => setLeave(null),
    discard() {
      if (editor.pending) return;
      editor.cancel();
      disablePrevention();
      const next = leave;
      setLeave(null);
      next?.();
    },
  };
}
