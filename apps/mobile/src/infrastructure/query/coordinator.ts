import {
  hashKey,
  partialMatchKey,
  type QueryClient,
} from '@tanstack/react-query';
import { ApiError } from '../api/errors.ts';
import { sameIdentity, type SessionIdentity } from '../api/session-client.ts';
import { keyBelongsTo, queryKeys, type PrivateQueryKey } from './keys.ts';

interface CoordinatorOwner {
  readonly queryClient: QueryClient;
  getIdentity(): SessionIdentity | null;
  assertCurrent(identity: SessionIdentity): void;
}

/** One coordinator per data layer; no sockets and no server permission inference. */
export function createQueryCoordinator(owner: CoordinatorOwner) {
  type Batch = {
    identity: SessionIdentity;
    keys: PrivateQueryKey[];
    resolve(): void;
    reject(error: unknown): void;
  };
  let batches: Batch[] = [];
  const mutations = new Map<string, Promise<void>>();

  function validate(
    identity: SessionIdentity,
    keys: readonly PrivateQueryKey[],
  ) {
    owner.assertCurrent(identity);
    if (keys.some((key) => !keyBelongsTo(key, identity)))
      throw new ApiError('session-changed');
  }
  function invalidate(
    identity: SessionIdentity,
    keys: readonly PrivateQueryKey[],
  ): Promise<void> {
    try {
      validate(identity, keys);
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      batches.push({ identity, keys: [...keys], resolve, reject });
      if (batches.length !== 1) return;
      // Duplicate/overlapping keys in this tick match each query only once.
      void Promise.resolve().then(async () => {
        const batch = batches;
        batches = [];
        try {
          const current = batch[0]!.identity;
          validate(
            current,
            batch.flatMap((item) => item.keys),
          );
          const targets = batch.flatMap((item) => item.keys);
          await owner.queryClient.invalidateQueries({
            predicate: (query) =>
              keyBelongsTo(query.queryKey, current) &&
              targets.some((key) => partialMatchKey(query.queryKey, key)),
            refetchType: 'active',
          });
          owner.assertCurrent(current);
          batch.forEach((item) => item.resolve());
        } catch (error) {
          batch.forEach((item) => item.reject(error));
        }
      });
    });
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
    const prior = mutations.get(hash) ?? Promise.resolve();
    let release!: () => void;
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    mutations.set(hash, lock);
    await prior;
    let previous: TCache | undefined;
    let updateCount: number | undefined;
    try {
      owner.assertCurrent(identity);
      await owner.queryClient.cancelQueries({ queryKey: key, exact: true });
      owner.assertCurrent(identity);
      previous = owner.queryClient.getQueryData<TCache>(key);
      owner.queryClient.setQueryData<TCache>(key, options.update(previous));
      updateCount = owner.queryClient.getQueryState(key)?.dataUpdateCount;
      const result = await options.mutation();
      owner.assertCurrent(identity);
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
        owner.queryClient.getQueryState(key)?.dataUpdateCount === updateCount
      ) {
        if (previous === undefined)
          owner.queryClient.removeQueries({ queryKey: key, exact: true });
        else owner.queryClient.setQueryData(key, previous);
      }
      throw error;
    } finally {
      if (sameIdentity(identity, owner.getIdentity())) {
        // Refetch failures live on queries; they must not fail a committed write.
        await invalidate(identity, affected).catch(() => undefined);
      }
      release();
      if (mutations.get(hash) === lock) mutations.delete(hash);
    }
  }

  return {
    invalidate,
    evict,
    optimistic,
    recover(identity: SessionIdentity) {
      return invalidate(identity, [queryKeys.scope(identity)]);
    },
  };
}
