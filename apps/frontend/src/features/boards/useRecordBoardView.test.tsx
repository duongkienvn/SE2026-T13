import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  fail,
  mockApi,
  ok,
  testUser,
  type MockResponse,
} from '../../test/mock-api';
import { AuthContext, type AuthContextValue } from '../auth/auth-context';
import { AuthSessionContext } from '../auth/auth-session-context';
import { boardKeys } from './query-keys';
import { useRecordBoardView } from './useRecordBoardView';
import { changeBoardAccessVersion } from './access-version';
import { workspaceKeys } from '../workspaces/query-keys';
import { productivityKey } from '../productivity/cache';

afterEach(() => vi.restoreAllMocks());

it('refreshes recency representations without invalidating the Workspace directory', async () => {
  const { client, wrapper } = setup(() =>
    ok({ isStarred: false, lastViewedAt: '2026-11-01T00:00:00Z' }),
  );
  const list = workspaceKeys.list(testUser.id, 1);
  const boards = workspaceKeys.boards(testUser.id, 1, 'workspace');
  const overview = workspaceKeys.overview(testUser.id, 1, 'workspace');
  const home = [...productivityKey, 'home'];
  for (const key of [list, boards, overview, home])
    client.setQueryData(key, {});
  renderHook(() => useRecordBoardView('board', true), { wrapper });
  await waitFor(() =>
    expect(client.getQueryState(home)?.isInvalidated).toBe(true),
  );
  expect(client.getQueryState(boards)?.isInvalidated).toBe(true);
  expect(client.getQueryState(overview)?.isInvalidated).toBe(true);
  expect(client.getQueryState(list)?.isInvalidated).toBe(false);
});

function setup(response: () => MockResponse | Promise<MockResponse>) {
  const calls = mockApi({ 'POST /boards/board/views': response });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const scope = { generation: 1, isCurrent: () => true };
  const auth: AuthContextValue = {
    status: 'authenticated',
    user: testUser,
    signIn: vi.fn(),
    signOut: vi.fn(),
    retry: vi.fn(),
    runAuthorized: (request) => request('token'),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AuthSessionContext.Provider value={scope}>
        <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
      </AuthSessionContext.Provider>
    </QueryClientProvider>
  );
  return { calls, client, wrapper };
}

it('retries a failed view on reconnect without recording again on ordinary rerenders', async () => {
  let attempts = 0;
  const { calls, wrapper } = setup(() =>
    ++attempts === 1
      ? fail(503, 'UNAVAILABLE')
      : ok({ isStarred: false, lastViewedAt: '2026-11-01T00:00:00Z' }),
  );
  const hook = renderHook(() => useRecordBoardView('board', true), { wrapper });
  await waitFor(() => expect(attempts).toBe(1));
  await act(async () => {});
  hook.rerender();
  expect(calls).toHaveLength(1);
  await act(async () => {
    window.dispatchEvent(new Event('online'));
  });
  await waitFor(() => expect(attempts).toBe(2));
});

it('evicts cached Board data on a confirmed view denial', async () => {
  const { client, wrapper } = setup(() => fail(404, 'NOT_FOUND'));
  client.setQueryData(boardKeys.detail('board'), { name: 'Private board' });
  renderHook(() => useRecordBoardView('board', true), { wrapper });
  await waitFor(() =>
    expect(client.getQueryData(boardKeys.detail('board'))).toBeUndefined(),
  );
});

it('ignores a late denial after the Board access version changes', async () => {
  let finish!: (result: MockResponse) => void;
  const pending = new Promise<MockResponse>((resolve) => {
    finish = resolve;
  });
  const { calls, client, wrapper } = setup(() => pending);
  renderHook(() => useRecordBoardView('board', true), { wrapper });
  await waitFor(() => expect(calls).toHaveLength(1));
  changeBoardAccessVersion(client, 'board');
  client.setQueryData(boardKeys.detail('board'), { name: 'New grant' });
  await act(async () => {
    finish(fail(404, 'NOT_FOUND'));
    await pending;
  });
  expect(client.getQueryData(boardKeys.detail('board'))).toEqual({
    name: 'New grant',
  });
});
