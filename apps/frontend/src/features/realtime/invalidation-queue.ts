import type { QueryClient } from '@tanstack/react-query';
import { isApiError } from '../../lib/api-client';
import { BOARD_ACCESS_REVOKED } from '../boards/revoke-board-access';
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
    for (const target of targets) {
      const key = target.queryKey;
      const error =
        key?.[0] === 'boards' && key[1] === 'detail'
          ? queryClient.getQueryState(key.slice(0, 3))?.error
          : undefined;
      // A queued refresh must not undo a server-confirmed revocation.
      if (isApiError(error) && error.code === BOARD_ACCESS_REVOKED) continue;
      void queryClient.invalidateQueries(target);
    }
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
