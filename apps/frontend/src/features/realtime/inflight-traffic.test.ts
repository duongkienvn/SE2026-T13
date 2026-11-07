import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { boardKeys } from '../boards/query-keys';
import { createInvalidationQueue } from './invalidation-queue';

it('measures a post-hint refresh still in flight as its mutation settles', async () => {
  let starts = 0;
  let cancellations = 0;
  let requests = 0;
  let hold = false;
  const responses: ServerResponse[] = [];
  const server = createServer((_request, response) => {
    requests++;
    if (hold) responses.push(response);
    else {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('[]');
    }
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
  const queue = createInvalidationQueue(client, 10);
  try {
    await observer.refetch();
    starts = cancellations = requests = 0;
    hold = true;
    let finish!: () => void;
    const mutation = client
      .getMutationCache()
      .build(client, {
        meta: { realtimeProtectedKey: key },
        mutationFn: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      })
      .execute(undefined);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    queue.add([{ queryKey: key, exact: true }]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const refresh = client.invalidateQueries({ queryKey: key, exact: true });
    await vi.waitFor(() => expect(requests).toBe(1));
    finish();
    await mutation;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect({ starts, cancellations, requests }).toEqual({
      starts: 1,
      cancellations: 0,
      requests: 1,
    });
    for (const response of responses) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('[]');
    }
    await refresh;
    await vi.waitFor(() => expect(client.isFetching()).toBe(0));
  } finally {
    queue.dispose();
    unsubscribe();
    client.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
