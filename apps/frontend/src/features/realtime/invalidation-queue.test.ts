import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revokeBoardAccess } from '../boards/revoke-board-access';
import { boardKeys } from '../boards/query-keys';
import { createInvalidationQueue } from './invalidation-queue';

const BOARD = 'board-a';
const cards = { queryKey: boardKeys.cards(BOARD), exact: true };
const columns = { queryKey: boardKeys.columns(BOARD) };

let queryClient: QueryClient;
let invalidateQueries: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  queryClient = new QueryClient();
  invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createInvalidationQueue', () => {
  it('cannot refetch a revoked board from invalidations queued before or after removal', async () => {
    queryClient.setQueryData(boardKeys.detail(BOARD), {
      name: 'Private board',
    });
    const queue = createInvalidationQueue(queryClient, 100);
    queue.add([cards]);
    revokeBoardAccess(queryClient, BOARD);
    queue.add([columns, { queryKey: boardKeys.detail(BOARD), exact: true }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(boardKeys.detail(BOARD))).toBeUndefined();
    queue.dispose();
  });

  it('refetches each query once for a burst of events', async () => {
    const queue = createInvalidationQueue(queryClient, 100);

    queue.add([cards]);
    queue.add([cards, columns]);
    queue.add([cards]);
    expect(invalidateQueries).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);

    expect(invalidateQueries.mock.calls).toEqual([[cards], [columns]]);
  });

  it('keeps targets that differ only in exact apart', async () => {
    const queue = createInvalidationQueue(queryClient, 100);
    const allCards = { queryKey: boardKeys.cards(BOARD) };

    queue.add([cards, allCards]);
    await vi.advanceTimersByTimeAsync(100);

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it('waits for conflicting mutations but refreshes another board', async () => {
    const queue = createInvalidationQueue(queryClient, 100);
    let finish!: () => void;
    const move = queryClient
      .getMutationCache()
      .build(queryClient, {
        meta: { realtimeProtectedKey: boardKeys.cards(BOARD) },
        mutationFn: () => new Promise<void>((resolve) => (finish = resolve)),
      })
      .execute(undefined);

    queue.add([cards]);
    await vi.advanceTimersByTimeAsync(1_000);
    const other = { queryKey: boardKeys.cards('board-b'), exact: true };
    queue.add([columns, other]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(invalidateQueries.mock.calls).toEqual([[columns], [other]]);

    finish();
    await move;
    await vi.advanceTimersByTimeAsync(0);

    expect(invalidateQueries.mock.calls).toEqual([[columns], [other], [cards]]);
  });

  it('drops everything once disposed', async () => {
    const queue = createInvalidationQueue(queryClient, 100);

    queue.add([cards]);
    queue.dispose();
    queue.add([columns]);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('flushes after a failed conflicting mutation and stops after disposal', async () => {
    const queue = createInvalidationQueue(queryClient, 10);
    let fail!: () => void;
    const mutation = queryClient
      .getMutationCache()
      .build(queryClient, {
        meta: { realtimeProtectedKey: boardKeys.cards(BOARD) },
        mutationFn: () =>
          new Promise<void>((_resolve, reject) => {
            fail = () => reject(new Error('failed'));
          }),
      })
      .execute(undefined)
      .catch(() => undefined);
    queue.add([cards]);
    await vi.advanceTimersByTimeAsync(10);
    expect(invalidateQueries).not.toHaveBeenCalled();
    fail();
    await mutation;
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    queue.dispose();
  });
});
