import {
  hashKey,
  partialMatchKey,
  type QueryClient,
} from '@tanstack/react-query';
import { systemTimers, type Timers } from '../auth/clock.ts';
import { ApiError } from '../api/errors.ts';
import { sameIdentity, type SessionIdentity } from '../api/session-client.ts';
import { keyBelongsTo, queryKeys, type PrivateQueryKey } from './keys.ts';

interface CoordinatorOwner {
  readonly queryClient: QueryClient;
  getIdentity(): SessionIdentity | null;
  assertCurrent(identity: SessionIdentity): void;
}

/** One coordinator per data layer; no sockets and no server permission inference. */
export function createQueryCoordinator(
  owner: CoordinatorOwner,
  timers: Timers = systemTimers,
) {
  type Pending = {
    identity: SessionIdentity;
    key: PrivateQueryKey;
    resolve(): void;
    reject(error: unknown): void;
  };
  let pending: Pending[] = [];
  let scheduled = false;
  let hintTimer: unknown;
  const mutations = new Map<
    string,
    { keys: readonly PrivateQueryKey[]; done: Promise<void> }
  >();
  const overlaps = (a: readonly unknown[], b: readonly unknown[]) =>
    partialMatchKey(a, b) || partialMatchKey(b, a);
  function validate(
    identity: SessionIdentity,
    keys: readonly PrivateQueryKey[],
  ) {
    owner.assertCurrent(identity);
    if (keys.some((key) => !keyBelongsTo(key, identity)))
      throw new ApiError('session-changed');
  }
  function schedule() {
    if (hintTimer !== undefined) timers.clearTimeout(hintTimer);
    hintTimer = undefined;
    if (scheduled) return;
    scheduled = true;
    void Promise.resolve().then(flush);
  }
  async function flush() {
    scheduled = false;
    const ready: Pending[] = [];
    const waiting: Pending[] = [];
    for (const entry of pending) {
      try {
        validate(entry.identity, [entry.key]);
      } catch (error) {
        entry.reject(error);
        continue;
      }
      if (
        [...mutations.values()].some((mutation) =>
          mutation.keys.some((key) => overlaps(key, entry.key)),
        )
      )
        waiting.push(entry);
      else ready.push(entry);
    }
    pending = waiting;
    if (!ready.length) return;
    try {
      const identity = ready[0]!.identity;
      await owner.queryClient.invalidateQueries({
        predicate: (query) =>
          keyBelongsTo(query.queryKey, identity) &&
          ready.some((entry) => partialMatchKey(query.queryKey, entry.key)),
        refetchType: 'active',
      });
      owner.assertCurrent(identity);
      ready.forEach((entry) => entry.resolve());
    } catch (error) {
      ready.forEach((entry) => entry.reject(error));
    }
  }
  function enqueue(
    identity: SessionIdentity,
    keys: readonly PrivateQueryKey[],
    hints: boolean,
  ): Promise<void> {
    try {
      validate(identity, keys);
    } catch (error) {
      return Promise.reject(error);
    }
    const result = Promise.all(
      keys.map(
        (key) =>
          new Promise<void>((resolve, reject) => {
            pending.push({ identity, key, resolve, reject });
          }),
      ),
    ).then(() => undefined);
    if (!hints) schedule();
    else if (hintTimer === undefined)
      hintTimer = timers.setTimeout(() => {
        hintTimer = undefined;
        schedule();
      }, 50);
    return result;
  }
  function invalidate(
    identity: SessionIdentity,
    keys: readonly PrivateQueryKey[],
  ) {
    return enqueue(identity, keys, false);
  }

  function evict(identity: SessionIdentity, keys: readonly PrivateQueryKey[]) {
    validate(identity, keys);
    const filters = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        keyBelongsTo(query.queryKey, identity) &&
        keys.some((key) => partialMatchKey(query.queryKey, key)),
    };
    void owner.queryClient.cancelQueries(filters);
    owner.queryClient.removeQueries(filters);
  }

  /** Serialize conflicting optimistic edits; unrelated resource keys proceed independently. */
  async function optimistic<TCache, TResult>(options: {
    identity: SessionIdentity;
    key: PrivateQueryKey;
    update(previous: TCache | undefined): TCache;
    mutation(): Promise<TResult>;
    reconcile?(result: TResult, current: TCache | undefined): TCache;
    invalidate?: readonly PrivateQueryKey[];
  }): Promise<TResult> {
    const { identity, key } = options;
    const affected = options.invalidate ?? [key];
    validate(identity, [key, ...affected]);
    const hash = hashKey(key);
    const prior = mutations.get(hash)?.done ?? Promise.resolve();
    let release!: () => void;
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    mutations.set(hash, { keys: [key, ...affected], done: lock });
    await prior;
    let previous: TCache | undefined;
    let updateCount: number | undefined;
    let optimisticQuery: unknown;
    try {
      owner.assertCurrent(identity);
      await owner.queryClient.cancelQueries({ queryKey: key, exact: true });
      owner.assertCurrent(identity);
      previous = owner.queryClient.getQueryData<TCache>(key);
      owner.queryClient.setQueryData<TCache>(key, options.update(previous));
      updateCount = owner.queryClient.getQueryState(key)?.dataUpdateCount;
      optimisticQuery = owner.queryClient
        .getQueryCache()
        .find({ queryKey: key, exact: true });
      const result = await options.mutation();
      owner.assertCurrent(identity);
      if (
        owner.queryClient
          .getQueryCache()
          .find({ queryKey: key, exact: true }) !== optimisticQuery
      )
        throw new ApiError('session-changed');
      if (options.reconcile)
        owner.queryClient.setQueryData<TCache>(key, (current) =>
          options.reconcile!(result, current),
        );
      return result;
    } catch (error) {
      if (!sameIdentity(identity, owner.getIdentity()))
        throw new ApiError('session-changed');
      // A newer authoritative write wins over this rollback.
      if (
        updateCount !== undefined &&
        owner.queryClient
          .getQueryCache()
          .find({ queryKey: key, exact: true }) === optimisticQuery &&
        owner.queryClient.getQueryState(key)?.dataUpdateCount === updateCount
      ) {
        if (previous === undefined)
          owner.queryClient.removeQueries({ queryKey: key, exact: true });
        else owner.queryClient.setQueryData(key, previous);
      }
      throw error;
    } finally {
      if (sameIdentity(identity, owner.getIdentity())) {
        // Refetch failures live on queries. Neither the committed write nor
        // the next same-key edit waits for this read to finish.
        void invalidate(identity, affected).catch(() => undefined);
      }
      release();
      if (mutations.get(hash)?.done === lock) mutations.delete(hash);
      schedule();
    }
  }

  return {
    invalidate,
    invalidateHints(
      identity: SessionIdentity,
      keys: readonly PrivateQueryKey[],
    ) {
      return enqueue(identity, keys, true);
    },
    clearPending() {
      if (hintTimer !== undefined) timers.clearTimeout(hintTimer);
      hintTimer = undefined;
      const previous = pending;
      pending = [];
      previous.forEach((entry) =>
        entry.reject(new ApiError('session-changed')),
      );
    },
    evict,
    optimistic,
    recover(identity: SessionIdentity) {
      return invalidate(identity, [queryKeys.scope(identity)]);
    },
  };
}
