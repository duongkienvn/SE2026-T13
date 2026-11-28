import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { isStale } from './temporal';

export type TemporalReconciler = {
  /** Foreground, focused screen state; false cancels every timer. */
  active: boolean;
  /** When the displayed server data was fetched; 0/undefined = nothing to reconcile. */
  fetchedAt: number | undefined;
  /** Time-dependent result identity, or null when time cannot change it. */
  signature: (at: number) => string | null;
  /** Runs when the data's classification instant and now disagree. */
  onStale?: () => void;
  /** Optional earlier wake-up, e.g. the next loaded due instant. */
  wakeDelay?: (now: number) => number | undefined;
};

/**
 * One local foreground clock. It samples at each minute boundary (account
 * midnight is always on one), at optional instants and on resume. It never
 * fetches by itself: `onStale` runs only while `signature(fetchedAt)` differs
 * from `signature(now)`, which also covers device clock jumps and midnights
 * missed while backgrounded. A refresh moves `fetchedAt`, ending the cycle.
 */
export function useTemporalReconciler(options: TemporalReconciler) {
  const [now, setNow] = useState(Date.now);
  const latest = useRef(options);
  latest.current = options;
  const { active } = options;
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function sample() {
      clearTimeout(timer);
      const clock = Date.now();
      const current = latest.current;
      setNow(clock);
      if (isStale(current.fetchedAt, current.signature, clock))
        current.onStale?.();
      const delay = Math.min(
        60_000 - (clock % 60_000),
        current.wakeDelay?.(clock) ?? Infinity,
      );
      timer = setTimeout(sample, Math.max(1, delay));
    }
    if (AppState.currentState === 'active') sample();
    const subscription = AppState.addEventListener('change', (state) => {
      clearTimeout(timer);
      if (state === 'active') sample();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [active]);
  return now;
}
