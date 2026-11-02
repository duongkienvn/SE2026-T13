import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  mockApi,
  ok,
  testUser,
  type MockResponse,
} from '../../../test/mock-api';
import { AuthContext, type AuthContextValue } from '../../auth/auth-context';
import { AuthSessionContext } from '../../auth/auth-session-context';
import { BoardStar } from './BoardStar';
import { changeBoardAccessVersion } from '../access-version';

afterEach(() => vi.restoreAllMocks());

it('does not replace a successful star with an older in-flight state response', async () => {
  let finish!: (response: MockResponse) => void;
  const oldState = new Promise<MockResponse>((resolve) => {
    finish = resolve;
  });
  const calls = mockApi({
    'GET /boards/board/user-state': () => oldState,
    'PUT /boards/board/star': ok({ isStarred: true, lastViewedAt: null }),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(['board-discovery', testUser.id, 1, 'state', 'board'], {
    isStarred: false,
    lastViewedAt: null,
  });
  const auth: AuthContextValue = {
    status: 'authenticated',
    user: testUser,
    signIn: vi.fn(),
    signOut: vi.fn(),
    retry: vi.fn(),
    runAuthorized: (request) => request('token'),
  };
  render(
    <QueryClientProvider client={client}>
      <AuthSessionContext.Provider
        value={{ generation: 1, isCurrent: () => true }}
      >
        <AuthContext.Provider value={auth}>
          <BoardStar boardId="board" boardName="Board" />
        </AuthContext.Provider>
      </AuthSessionContext.Provider>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(calls.some((call) => call.method === 'GET')).toBe(true),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Add to starred: Board' }),
  );
  await screen.findByRole('button', { name: 'Remove from starred: Board' });
  await act(async () => {
    finish(ok({ isStarred: false, lastViewedAt: null }));
    await oldState;
  });
  expect(
    screen
      .getByRole('button', { name: 'Remove from starred: Board' })
      .getAttribute('aria-pressed'),
  ).toBe('true');
});

it('rejects a successful state response from an earlier access grant', async () => {
  let finish!: (response: MockResponse) => void;
  const pending = new Promise<MockResponse>((resolve) => {
    finish = resolve;
  });
  const calls = mockApi({ 'GET /boards/board/user-state': () => pending });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const auth: AuthContextValue = {
    status: 'authenticated',
    user: testUser,
    signIn: vi.fn(),
    signOut: vi.fn(),
    retry: vi.fn(),
    runAuthorized: (request) => request('token'),
  };
  render(
    <QueryClientProvider client={client}>
      <AuthSessionContext.Provider
        value={{ generation: 1, isCurrent: () => true }}
      >
        <AuthContext.Provider value={auth}>
          <BoardStar boardId="board" boardName="Board" />
        </AuthContext.Provider>
      </AuthSessionContext.Provider>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(calls.some((call) => call.method === 'GET')).toBe(true),
  );
  changeBoardAccessVersion(client, 'board');
  await act(async () => {
    finish(ok({ isStarred: true, lastViewedAt: null }));
    await pending;
  });
  await screen.findByRole('button', { name: 'Retry star status: Board' });
  expect(
    client.getQueryData(['board-discovery', testUser.id, 1, 'state', 'board']),
  ).toBeUndefined();
});
