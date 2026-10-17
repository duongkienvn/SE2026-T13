import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('waits for pending mutations, then refetches once', async () => {
    const queue = createInvalidationQueue(queryClient, 100);
    let finish!: () => void;
    const move = queryClient
      .getMutationCache()
      .build(queryClient, {
        mutationFn: () => new Promise<void>((resolve) => (finish = resolve)),
      })
      .execute(undefined);

    queue.add([cards]);
    await vi.advanceTimersByTimeAsync(1_000);
    queue.add([columns]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(invalidateQueries).not.toHaveBeenCalled();

    finish();
    await move;
    await vi.advanceTimersByTimeAsync(0);

    expect(invalidateQueries.mock.calls).toEqual([[cards], [columns]]);
  });

  it('drops everything once disposed', async () => {
    const queue = createInvalidationQueue(queryClient, 100);

    queue.add([cards]);
    queue.dispose();
    queue.add([columns]);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
