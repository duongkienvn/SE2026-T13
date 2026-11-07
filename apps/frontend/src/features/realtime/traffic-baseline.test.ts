import { createServer } from 'node:http';
import { once } from 'node:events';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { boardKeys } from '../boards/query-keys';
import { createInvalidationQueue } from './invalidation-queue';
import { invalidationTargets } from './event-invalidation';

it.each([
  { protectedMove: true, expected: 1 },
  { protectedMove: false, expected: 2 },
])(
  'measures a queued hint with protectedMove=$protectedMove',
  async ({ protectedMove, expected }) => {
    let requests = 0;
    let starts = 0;
    let cancellations = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('[]');
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = boardKeys.cards('board-a');
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: async ({ signal }) => {
        starts++;
        signal.addEventListener('abort', () => cancellations++, { once: true });
        return (
          await fetch(`http://127.0.0.1:${address.port}/cards`, { signal })
        ).json();
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      await observer.refetch();
      requests = starts = cancellations = 0;
      const queue = createInvalidationQueue(client, 10);
      let finish!: () => void;
      const mutation = client
        .getMutationCache()
        .build(client, {
          meta: protectedMove ? { realtimeProtectedKey: key } : undefined,
          mutationFn: () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            }),
          onSuccess: () =>
            client.invalidateQueries({ queryKey: key, exact: true }),
        })
        .execute(undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
      queue.add([{ queryKey: key, exact: true }]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (!protectedMove) {
        await vi.waitFor(() => expect(requests).toBe(1));
        await vi.waitFor(() => expect(client.isFetching()).toBe(0));
      }
      finish();
      await mutation;
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect({ starts, cancellations, requests }).toEqual({
        starts: expected,
        cancellations: 0,
        requests: expected,
      });
      queue.dispose();
    } finally {
      unsubscribe();
      client.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

it('sends an unrelated Board refresh while an optimistic move is pending', async () => {
  const requests: string[] = [];
  const starts: number[] = [];
  let cancellations = 0;
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('[]');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const keys = ['board-a', 'board-b'].map(boardKeys.cards);
  const observers = keys.map(
    (queryKey, index) =>
      new QueryObserver(client, {
        queryKey,
        queryFn: async ({ signal }) => {
          starts.push(index);
          signal.addEventListener('abort', () => cancellations++, {
            once: true,
          });
          return (
            await fetch(`http://127.0.0.1:${address.port}/${index}`, { signal })
          ).json();
        },
      }),
  );
  const unsubscribe = observers.map((observer) =>
    observer.subscribe(() => undefined),
  );
  const queue = createInvalidationQueue(client, 10);
  try {
    await Promise.all(observers.map((observer) => observer.refetch()));
    requests.length = 0;
    starts.length = 0;
    cancellations = 0;
    let finish!: () => void;
    const mutation = client
      .getMutationCache()
      .build(client, {
        meta: { realtimeProtectedKey: keys[0] },
        mutationFn: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      })
      .execute(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    queue.add(keys.map((queryKey) => ({ queryKey, exact: true })));
    await vi.waitFor(() => expect(requests).toEqual(['/1']));
    finish();
    await mutation;
    await vi.waitFor(() => expect(requests).toEqual(['/1', '/0']));
    expect(starts).toEqual([1, 0]);
    expect(cancellations).toBe(0);
  } finally {
    queue.dispose();
    unsubscribe.forEach((stop) => stop());
    client.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('refreshes only preview batches containing the changed Card', async () => {
  const requests: string[] = [];
  const starts: number[] = [];
  let cancellations = 0;
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('[]');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const prefix = [
    ...boardKeys.cards('board-a'),
    'preview-summaries',
    'user',
    1,
  ];
  const keys = [
    [...prefix, ['card-a']],
    [...prefix, ['card-a', 'card-b']],
    [...prefix, ['card-c']],
  ];
  const observers = keys.map((queryKey, index) => {
    client.setQueryData(queryKey, []);
    const observer = new QueryObserver(client, {
      queryKey,
      staleTime: Infinity,
      queryFn: async ({ signal }) => {
        starts.push(index);
        signal.addEventListener('abort', () => cancellations++, { once: true });
        return (
          await fetch(`http://127.0.0.1:${address.port}/${index}`, { signal })
        ).json();
      },
    });
    return observer.subscribe(() => undefined);
  });
  const queue = createInvalidationQueue(client, 10);
  try {
    queue.add(
      invalidationTargets('card:updated', {
        boardId: 'board-a',
        cardId: 'card-a',
        columnId: 'column',
      }),
    );
    await vi.waitFor(() => expect([...requests].sort()).toEqual(['/0', '/1']));
    await vi.waitFor(() => expect(client.isFetching()).toBe(0));
    expect([...starts].sort()).toEqual([0, 1]);
    expect(cancellations).toBe(0);
  } finally {
    queue.dispose();
    observers.forEach((unsubscribe) => unsubscribe());
    client.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
