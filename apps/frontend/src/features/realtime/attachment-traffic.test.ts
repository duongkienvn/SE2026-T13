import { createServer } from 'node:http';
import { once } from 'node:events';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { boardKeys } from '../boards/query-keys';
import {
  beginLocalOperation,
  clearLocalOperations,
  consumeLocalHint,
} from './local-operation';
import { createInvalidationQueue } from './invalidation-queue';
import { invalidationTargets } from './event-invalidation';

it.each([
  { correlate: false, expected: 2 },
  { correlate: true, expected: 1 },
])(
  'measures a slow attachment mutation with correlation=$correlate',
  async ({ correlate, expected }) => {
    let requests = 0;
    let starts = 0;
    let cancellations = 0;
    let commit!: () => void;
    let respond!: () => void;
    const received = new Promise<void>((resolve) => {
      commit = resolve;
    });
    const server = createServer((request, response) => {
      if (request.method === 'POST') {
        respond = () => {
          response.writeHead(204);
          response.end();
        };
        commit();
        return;
      }
      requests++;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('[]');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    const url = `http://127.0.0.1:${address.port}`;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = [...boardKeys.card('board', 'card'), 'attachments', 1];
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: async ({ signal }) => {
        starts++;
        signal.addEventListener('abort', () => cancellations++, { once: true });
        return (await fetch(url, { signal })).json();
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    const queue = createInvalidationQueue(client, 10);
    try {
      await observer.refetch();
      requests = starts = cancellations = 0;
      const operation = correlate
        ? beginLocalOperation(client, 'card:updated', 'board', 'card')
        : undefined;
      const mutation = fetch(url, { method: 'POST' });
      await received;
      const payload = {
        boardId: 'board',
        cardId: 'card',
        columnId: 'column',
        changeScope: 'attachments' as const,
        operationId: operation?.id,
      };
      const targets = invalidationTargets('card:updated', payload);
      if (
        !consumeLocalHint(client, 'card:updated', payload, targets, queue.add)
      )
        queue.add(targets);
      if (!correlate) {
        await vi.waitFor(() => expect(requests).toBe(1));
        await vi.waitFor(() => expect(client.isFetching()).toBe(0));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(requests).toBe(0);
      }
      respond();
      await mutation;
      await client.invalidateQueries(
        { queryKey: key, exact: true },
        { throwOnError: true },
      );
      operation?.success();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect({ requests, starts, cancellations }).toEqual({
        requests: expected,
        starts: expected,
        cancellations: 0,
      });
    } finally {
      queue.dispose();
      clearLocalOperations(client);
      unsubscribe();
      client.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

it('delivers a matching hint to another tab before the originating mutation completes', async () => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('[]');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  const clients = [new QueryClient(), new QueryClient()];
  const key = [...boardKeys.card('board', 'card'), 'attachments', 1];
  const queues = clients.map((client) => createInvalidationQueue(client, 10));
  const observers = clients.map((client, index) => {
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: ({ signal }) =>
        fetch(`http://127.0.0.1:${address.port}/${index}`, { signal }).then(
          (response) => response.json(),
        ),
    });
    return { observer, unsubscribe: observer.subscribe(() => undefined) };
  });
  try {
    await Promise.all(observers.map(({ observer }) => observer.refetch()));
    requests.length = 0;
    const operation = beginLocalOperation(
      clients[0],
      'card:updated',
      'board',
      'card',
    )!;
    const payload = {
      boardId: 'board',
      cardId: 'card',
      columnId: 'column',
      changeScope: 'attachments' as const,
      operationId: operation.id,
    };
    const targets = invalidationTargets('card:updated', payload);
    clients.forEach((client, index) => {
      if (
        !consumeLocalHint(
          client,
          'card:updated',
          payload,
          targets,
          queues[index].add,
        )
      )
        queues[index].add(targets);
    });
    await vi.waitFor(() => expect(requests).toEqual(['/1']));
    await clients[0].invalidateQueries(
      { queryKey: key, exact: true },
      { throwOnError: true },
    );
    operation.success();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requests).toEqual(['/1', '/0']);
  } finally {
    queues.forEach((queue) => queue.dispose());
    observers.forEach(({ unsubscribe }) => unsubscribe());
    clients.forEach((client) => {
      clearLocalOperations(client);
      client.clear();
    });
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
