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
 * query once, and holds conflicting queries while an optimistic move is pending:
 * keeps its own preview until its request settles, and refetching after it
 * lands on the server's final order instead of racing it.
 */
export function createInvalidationQueue(
  queryClient: QueryClient,
  delayMs = 100,
): InvalidationQueue {
  const pending = new Map<string, InvalidationTarget>();
  const fetching = new Set<string>();
  const covered = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopWaiting: (() => void) | undefined;
  let disposed = false;
  const stopObserving = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    for (const [id, target] of pending) {
      if (
        !target.exact ||
        JSON.stringify(event.query.queryKey) !== JSON.stringify(target.queryKey)
      )
        continue;
      if (event.action.type === 'fetch') fetching.add(id);
      if (
        event.action.type === 'success' &&
        !event.action.manual &&
        fetching.has(id)
      ) {
        covered.add(id);
        fetching.delete(id);
      }
      if (event.action.type === 'error') fetching.delete(id);
    }
  });

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (disposed || pending.size === 0) return;
    for (const [id, target] of pending) {
      const key = target.queryKey;
      const conflicts = queryClient.isMutating({
        predicate: (mutation) => {
          const protectedKey = mutation.options.meta?.realtimeProtectedKey;
          if (!Array.isArray(protectedKey) || !key) return false;
          return (
            protectedKey
              .slice(0, key.length)
              .every((part, i) => part === key[i]) ||
            key
              .slice(0, protectedKey.length)
              .every((part, i) => part === protectedKey[i])
          );
        },
      });
      if (conflicts) continue;
      pending.delete(id);
      fetching.delete(id);
      if (covered.delete(id)) continue;
      const error =
        key?.[0] === 'boards' && key[1] === 'detail'
          ? queryClient.getQueryState(key.slice(0, 3))?.error
          : undefined;
      // A queued refresh must not undo a server-confirmed revocation.
      if (isApiError(error) && error.code === BOARD_ACCESS_REVOKED) continue;
      void queryClient.invalidateQueries(target);
    }
    if (pending.size) {
      stopWaiting ??= queryClient.getMutationCache().subscribe(() => flush());
    } else {
      stopWaiting?.();
      stopWaiting = undefined;
    }
  };

  return {
    add(targets) {
      if (disposed) return;
      for (const target of targets) {
        const id = JSON.stringify([target.queryKey, target.exact]);
        pending.set(id, target);
        fetching.delete(id);
        covered.delete(id);
      }
      if (timer === undefined) timer = setTimeout(flush, delayMs);
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      stopWaiting?.();
      stopObserving();
      pending.clear();
    },
  };
}
