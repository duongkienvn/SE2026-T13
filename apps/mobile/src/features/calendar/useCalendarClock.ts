import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** One foreground clock for Today, labels and server due-status reconciliation. */
export function useCalendarClock(active: boolean, onBoundary?: () => void) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function sample() {
      const clock = Date.now();
      clearTimeout(timer);
      setNow(clock);
      timer = setTimeout(
        () => {
          onBoundary?.();
          sample();
        },
        60_000 - (clock % 60_000),
      );
    }
    if (AppState.currentState === 'active') sample();
    const subscription = AppState.addEventListener('change', (state) => {
      clearTimeout(timer);
      if (state === 'active') {
        onBoundary?.();
        sample();
      }
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [active, onBoundary]);
  return now;
}
