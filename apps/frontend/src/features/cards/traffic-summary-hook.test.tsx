import { createServer } from 'node:http';
import { once } from 'node:events';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { env } from '../../lib/env';
import { testUser } from '../../test/mock-api';
import { AuthContext, type AuthContextValue } from '../auth/auth-context';
import { AuthSessionContext } from '../auth/auth-session-context';
import { createInvalidationQueue } from '../realtime/invalidation-queue';
import { invalidationTargets } from '../realtime/event-invalidation';
import { usePreviewSummaries } from './board-filter';

it('measures the real preview hook after a Card event', async () => {
  let requests = 0;
  let cancellations = 0;
  const server = createServer((request, response) => {
    requests++;
    const ids =
      new URL(request.url ?? '/', 'http://localhost').searchParams
        .get('cardIds')
        ?.split(',') ?? [];
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        success: true,
        statusCode: 200,
        message: 'OK',
        data: {
          summaries: ids.map((cardId) => ({
            cardId,
            labelIds: [],
            checklist: { checkedItems: 0, totalItems: 0 },
            attachmentCount: 0,
            commentCount: 0,
          })),
        },
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  const previousBase = env.apiBaseUrl;
  env.apiBaseUrl = `http://127.0.0.1:${address.port}`;
  const actualFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    init?.signal?.addEventListener('abort', () => cancellations++, {
      once: true,
    });
    return actualFetch(input, init);
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const starts: number[] = [];
  const stop = client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'fetch') return;
    const key = event.query.queryKey;
    if (key[4] === 'preview-summaries' && Array.isArray(key[7]))
      starts.push(key[7].length);
  });
  const auth: AuthContextValue = {
    status: 'authenticated',
    user: testUser,
    signIn: vi.fn(),
    signOut: vi.fn(),
    retry: vi.fn(),
    runAuthorized: (request) => request('token'),
  };
  const scope = {
    generation: 1,
    isCurrent: () => true,
    canFinishRevokingRequest: () => true,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AuthSessionContext.Provider value={scope}>
        <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
      </AuthSessionContext.Provider>
    </QueryClientProvider>
  );
  const ids = Array.from(
    { length: 201 },
    (_, index) => `card-${String(index).padStart(3, '0')}`,
  );
  const queue = createInvalidationQueue(client, 10);
  const hook = renderHook(() => usePreviewSummaries('board-a', ids), {
    wrapper,
  });
  try {
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(requests).toBe(3);
    requests = cancellations = 0;
    starts.length = 0;
    await act(async () => {
      queue.add(
        invalidationTargets('card:updated', {
          boardId: 'board-a',
          cardId: ids[150],
          columnId: 'column',
        }),
      );
      await vi.waitFor(() => expect(requests).toBe(1));
      await vi.waitFor(() => expect(client.isFetching()).toBe(0));
    });
    expect(starts).toEqual([100]);
    expect(cancellations).toBe(0);
  } finally {
    hook.unmount();
    queue.dispose();
    stop();
    client.clear();
    vi.restoreAllMocks();
    env.apiBaseUrl = previousBase;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
