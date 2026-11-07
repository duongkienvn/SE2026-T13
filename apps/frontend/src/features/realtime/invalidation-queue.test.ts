import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revokeBoardAccess } from '../boards/revoke-board-access';
import { boardKeys } from '../boards/query-keys';
import { createInvalidationQueue } from './invalidation-queue';
import { invalidationTargets } from './event-invalidation';

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
    const detail = { queryKey: boardKeys.card(BOARD, 'card-1') };
    queue.add([columns, other, detail]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(invalidateQueries.mock.calls).toEqual([
      [columns],
      [other],
      [detail],
    ]);

    finish();
    await move;
    await vi.advanceTimersByTimeAsync(0);

    expect(invalidateQueries.mock.calls).toEqual([
      [columns],
      [other],
      [detail],
      [cards],
    ]);
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

  it('waits until all overlapping mutations have settled', async () => {
    const queue = createInvalidationQueue(queryClient, 10);
    const finish: Array<() => void> = [];
    const start = () =>
      queryClient
        .getMutationCache()
        .build(queryClient, {
          meta: { realtimeProtectedKey: boardKeys.cards(BOARD) },
          mutationFn: () =>
            new Promise<void>((resolve) => finish.push(resolve)),
        })
        .execute(undefined);
    const first = start();
    const second = start();
    await vi.advanceTimersByTimeAsync(0);
    queue.add([cards]);
    await vi.advanceTimersByTimeAsync(10);
    finish[0]();
    await first;
    expect(invalidateQueries).not.toHaveBeenCalled();
    finish[1]();
    await second;
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    queue.dispose();
  });

  it('retains a later hint received while an earlier refresh is in flight', async () => {
    let finish!: (value: string) => void;
    const queryFn = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue('latest');
    queryClient.setQueryData(cards.queryKey, 'old');
    const observer = new QueryObserver(queryClient, {
      queryKey: cards.queryKey,
      queryFn,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    const queue = createInvalidationQueue(queryClient, 100);
    queue.add([cards]);
    const first = queryClient.invalidateQueries(cards);
    queue.add([cards]);
    finish('earlier');
    await first;
    await vi.advanceTimersByTimeAsync(100);
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(cards.queryKey)).toBe('latest');
    unsubscribe();
    queue.dispose();
  });

  it('coalesces affected preview batches without refetching unrelated cards', async () => {
    const prefix = [...boardKeys.cards(BOARD), 'preview-summaries', 'user', 1];
    const keys = [
      [...prefix, ['card-a']],
      [...prefix, ['card-a', 'card-b']],
      [...prefix, ['card-b']],
      [...prefix, ['card-c']],
    ];
    const fetches = keys.map(() => vi.fn().mockResolvedValue([]));
    const observers = keys.map((queryKey, index) => {
      queryClient.setQueryData(queryKey, []);
      const observer = new QueryObserver(queryClient, {
        queryKey,
        queryFn: fetches[index],
        staleTime: Infinity,
      });
      return observer.subscribe(() => undefined);
    });
    const queue = createInvalidationQueue(queryClient, 10);
    for (const cardId of ['card-a', 'card-b'])
      queue.add(
        invalidationTargets('card:updated', {
          boardId: BOARD,
          cardId,
          columnId: 'column',
        }),
      );
    await vi.advanceTimersByTimeAsync(10);
    expect(fetches.map((fetch) => fetch.mock.calls.length)).toEqual([
      1, 1, 1, 0,
    ]);
    observers.forEach((unsubscribe) => unsubscribe());
    queue.dispose();
  });

  it('retains a generic child-change hint alongside a field-only update', async () => {
    const key = [
      ...boardKeys.cards(BOARD),
      'preview-summaries',
      'user',
      1,
      ['card-a'],
    ];
    queryClient.setQueryData(key, []);
    const queryFn = vi.fn().mockResolvedValue([]);
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    const queue = createInvalidationQueue(queryClient, 10);
    queue.add(
      invalidationTargets('card:updated', {
        boardId: BOARD,
        cardId: 'card-a',
        columnId: 'column',
        changeScope: 'card-fields',
      }),
    );
    queue.add(
      invalidationTargets('card:updated', {
        boardId: BOARD,
        cardId: 'card-a',
        columnId: 'column',
      }),
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(queryFn).toHaveBeenCalledTimes(1);
    unsubscribe();
    queue.dispose();
  });
});
