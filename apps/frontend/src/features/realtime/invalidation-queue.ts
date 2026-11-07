import type { QueryClient } from '@tanstack/react-query';
import { isApiError } from '../../lib/api-client';
import { BOARD_ACCESS_REVOKED } from '../boards/revoke-board-access';
import type { InvalidationTarget } from './event-invalidation';
import { previewSummaryContains } from '../cards/preview-summary-cache';

export interface InvalidationQueue {
  add: (targets: InvalidationTarget[]) => void;
  dispose: () => void;
}

/**
 * Collects invalidations for `delayMs`, so a burst of events refetches each
 * query once. Conflicting queries wait for optimistic changes to settle so a
 * drag or checklist preview is not overwritten by an earlier server state.
 */
export function createInvalidationQueue(
  queryClient: QueryClient,
  delayMs = 100,
): InvalidationQueue {
  const pending = new Map<
    string,
    { target: InvalidationTarget; previewCardIds?: Set<string> }
  >();
  const fetching = new Set<string>();
  const covered = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopWaiting: (() => void) | undefined;
  let disposed = false;
  const stopObserving = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' && event.type !== 'removed') return;
    let settled = false;
    for (const [id, { target }] of pending) {
      if (
        !target.exact ||
        JSON.stringify(event.query.queryKey) !== JSON.stringify(target.queryKey)
      )
        continue;
      if (event.type === 'removed') {
        const wasFetching = fetching.delete(id);
        const wasCovered = covered.delete(id);
        settled = wasFetching || wasCovered || settled;
        continue;
      }
      if (event.action.type === 'fetch') fetching.add(id);
      if (
        event.action.type === 'setState' ||
        (event.action.type === 'success' && event.action.manual)
      )
        covered.delete(id);
      if (
        event.action.type === 'success' &&
        !event.action.manual &&
        fetching.has(id)
      ) {
        covered.add(id);
        fetching.delete(id);
        settled = true;
      }
      if (
        event.action.type === 'error' ||
        (event.action.type === 'setState' &&
          event.query.state.fetchStatus === 'idle')
      )
        settled = fetching.delete(id) || settled;
    }
    if (settled && timer === undefined) void Promise.resolve().then(flush);
  });

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (disposed || pending.size === 0) return;
    for (const [id, { target, previewCardIds }] of pending) {
      const key = target.queryKey;
      const conflicts = queryClient.isMutating({
        predicate: (mutation) => {
          const protectedKey = mutation.options.meta?.realtimeProtectedKey;
          if (!Array.isArray(protectedKey) || !key) return false;
          return (
            key.length <= protectedKey.length &&
            (!target.exact || key.length === protectedKey.length) &&
            key.every((part, i) => part === protectedKey[i])
          );
        },
      });
      if (conflicts || fetching.has(id)) continue;
      pending.delete(id);
      fetching.delete(id);
      if (covered.delete(id)) continue;
      const error =
        key?.[0] === 'boards' && key[1] === 'detail'
          ? queryClient.getQueryState(key.slice(0, 3))?.error
          : undefined;
      // A queued refresh must not undo a server-confirmed revocation.
      if (isApiError(error) && error.code === BOARD_ACCESS_REVOKED) continue;
      void queryClient.invalidateQueries(
        previewCardIds
          ? {
              ...target,
              predicate: (query) =>
                previewSummaryContains(query.queryKey, previewCardIds),
            }
          : target,
      );
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
      for (const { previewCardId, ...target } of targets) {
        const id = JSON.stringify([target.queryKey, target.exact]);
        const existing = pending.get(id);
        if (!previewCardId) pending.set(id, { target });
        else if (!existing)
          pending.set(id, {
            target,
            previewCardIds: new Set([previewCardId.toLowerCase()]),
          });
        else existing.previewCardIds?.add(previewCardId.toLowerCase());
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
