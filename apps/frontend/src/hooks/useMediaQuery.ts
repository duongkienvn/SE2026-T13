import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a CSS media query matches, updating when it changes. `fallback` is
 * used where `matchMedia` is unavailable (tests, server rendering).
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () =>
      typeof window.matchMedia === 'function'
        ? window.matchMedia(query).matches
        : fallback,
    () => fallback,
  );
}
