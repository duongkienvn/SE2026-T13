import { createServer } from 'node:http';
import { once } from 'node:events';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { boardKeys } from '../boards/query-keys';
import { createInvalidationQueue } from './invalidation-queue';

it('measures mutation and socket hint traffic against a local HTTP server', async () => {
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
        meta: { realtimeProtectedKey: key },
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
    finish();
    await mutation;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect({ starts, cancellations, requests }).toEqual({
      starts: 2,
      cancellations: 0,
      requests: 2,
    });
    queue.dispose();
  } finally {
    unsubscribe();
    client.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
