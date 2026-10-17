import type { QueryClient } from '@tanstack/react-query';
import type { InvalidationTarget } from './event-invalidation';

export interface InvalidationQueue {
  add: (targets: InvalidationTarget[]) => void;
  dispose: () => void;
}

/**
 * Collects invalidations for `delayMs`, so a burst of events refetches each
 * query once, and holds them while any mutation is pending: a drag-and-drop
 * keeps its own preview until its request settles, and refetching after it
 * lands on the server's final order instead of racing it.
 */
export function createInvalidationQueue(
  queryClient: QueryClient,
  delayMs = 100,
): InvalidationQueue {
  const pending = new Map<string, InvalidationTarget>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopWaiting: (() => void) | undefined;
  let disposed = false;

  const flush = () => {
    timer = undefined;
    if (disposed || pending.size === 0) return;
    if (queryClient.isMutating() > 0) {
      stopWaiting ??= queryClient.getMutationCache().subscribe(() => {
        if (queryClient.isMutating() > 0) return;
        stopWaiting?.();
        stopWaiting = undefined;
        flush();
      });
      return;
    }
    const targets = [...pending.values()];
    pending.clear();
    for (const target of targets) void queryClient.invalidateQueries(target);
  };

  return {
    add(targets) {
      if (disposed) return;
      for (const target of targets) {
        pending.set(JSON.stringify([target.queryKey, target.exact]), target);
      }
      if (timer === undefined && !stopWaiting)
        timer = setTimeout(flush, delayMs);
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      stopWaiting?.();
      pending.clear();
    },
  };
}
