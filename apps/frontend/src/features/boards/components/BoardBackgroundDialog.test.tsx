import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../../auth/auth-context';
import { AuthSessionContext } from '../../auth/auth-session-context';
import {
  fail,
  mockApi,
  ok,
  testUser,
  type MockResponse,
} from '../../../test/mock-api';
import { makeBoard } from '../../../test/board-fixtures';
import { BoardBackgroundDialog } from './BoardBackground';
import { boardKeys } from '../query-keys';
import { changeBoardAccessVersion } from '../access-version';

afterEach(() => vi.restoreAllMocks());

it('does not save after access changes while the permission check is pending', async () => {
  const board = makeBoard({
    id: 'board',
    backgroundPreset: 'blue',
    backgroundVersion: 0,
    capabilities: {
      canReadBoard: true,
      canWriteBoard: true,
      canManageBoard: true,
      canManageMembers: true,
      canRestoreBoard: false,
    },
  });
  let finish!: (response: MockResponse) => void;
  const pending = new Promise<MockResponse>((resolve) => {
    finish = resolve;
  });
  const calls = mockApi({
    'GET /boards/background-presets': ok([
      { id: 'blue', kind: 'color', value: '#2563EB', foreground: 'light' },
      { id: 'teal', kind: 'color', value: '#0F766E', foreground: 'light' },
    ]),
    'GET /boards/board': () => pending,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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
        value={{
          generation: 1,
          isCurrent: () => true,
          canFinishRevokingRequest: () => true,
        }}
      >
        <AuthContext.Provider value={auth}>
          <BoardBackgroundDialog board={board} canManage onClose={vi.fn()} />
        </AuthContext.Provider>
      </AuthSessionContext.Provider>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'teal' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(calls.some((call) => call.path === '/boards/board')).toBe(true),
  );
  changeBoardAccessVersion(client, board.id);
  await act(async () => {
    finish(ok(board));
    await pending;
  });
  await screen.findByRole('alert');
  expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
});

it('preserves a photo preview after a conflicting save and sends the original version', async () => {
  const board = makeBoard({
    id: 'board',
    backgroundPreset: 'blue',
    backgroundVersion: 3,
    capabilities: {
      canReadBoard: true,
      canWriteBoard: true,
      canManageBoard: true,
      canManageMembers: true,
      canRestoreBoard: false,
    },
  });
  const calls = mockApi({
    'GET /boards/background-presets': ok([
      { id: 'blue', kind: 'color', value: '#2563EB', foreground: 'light' },
      {
        id: 'forest',
        kind: 'photo',
        value: 'https://example.invalid/photo',
        foreground: 'light',
      },
    ]),
    'GET /boards/board': ok(board),
    'PATCH /boards/board/background': fail(
      409,
      'BACKGROUND_CONFLICT',
      'Background changed',
    ),
  });
  const auth: AuthContextValue = {
    status: 'authenticated',
    user: testUser,
    signIn: vi.fn(),
    signOut: vi.fn(),
    retry: vi.fn(),
    runAuthorized: (request) => request('token'),
  };
  const close = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <AuthSessionContext.Provider
        value={{
          generation: 1,
          isCurrent: () => true,
          canFinishRevokingRequest: () => true,
        }}
      >
        <AuthContext.Provider value={auth}>
          <BoardBackgroundDialog board={board} canManage onClose={close} />
        </AuthContext.Provider>
      </AuthSessionContext.Provider>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Photos' }));
  const forest = await screen.findByRole('button', { name: 'forest' });
  fireEvent.click(forest);
  expect(forest.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('alert');
  expect(forest.getAttribute('aria-pressed')).toBe('true');
  expect(close).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      preset: 'forest',
      expectedVersion: 3,
    }),
  );
});

it('rechecks rather than evicting a readable board when management is denied', async () => {
  const board = makeBoard({
    id: 'board',
    backgroundPreset: 'blue',
    backgroundVersion: 0,
    capabilities: {
      canReadBoard: true,
      canWriteBoard: true,
      canManageBoard: true,
      canManageMembers: true,
      canRestoreBoard: false,
    },
  });
  mockApi({
    'GET /boards/background-presets': ok([
      { id: 'blue', kind: 'color', value: '#2563EB', foreground: 'light' },
      { id: 'teal', kind: 'color', value: '#0F766E', foreground: 'light' },
    ]),
    'GET /boards/board': ok(board),
    'PATCH /boards/board/background': fail(403, 'FORBIDDEN'),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(boardKeys.detail(board.id), board);
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
        value={{
          generation: 1,
          isCurrent: () => true,
          canFinishRevokingRequest: () => true,
        }}
      >
        <AuthContext.Provider value={auth}>
          <BoardBackgroundDialog board={board} canManage onClose={vi.fn()} />
        </AuthContext.Provider>
      </AuthSessionContext.Provider>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'teal' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('alert');
  expect(client.getQueryData(boardKeys.detail(board.id))).toEqual(board);
});

it('does not send a background mutation after preflight detects role loss', async () => {
  const board = makeBoard({
    id: 'board',
    backgroundPreset: 'blue',
    backgroundVersion: 0,
    capabilities: {
      canReadBoard: true,
      canWriteBoard: true,
      canManageBoard: true,
      canManageMembers: true,
      canRestoreBoard: false,
    },
  });
  const calls = mockApi({
    'GET /boards/background-presets': ok([
      { id: 'blue', kind: 'color', value: '#2563EB', foreground: 'light' },
      { id: 'teal', kind: 'color', value: '#0F766E', foreground: 'light' },
    ]),
    'GET /boards/board': ok({
      ...board,
      capabilities: { ...board.capabilities, canManageBoard: false },
    }),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(boardKeys.detail(board.id), board);
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
        value={{
          generation: 1,
          isCurrent: () => true,
          canFinishRevokingRequest: () => true,
        }}
      >
        <AuthContext.Provider value={auth}>
          <BoardBackgroundDialog board={board} canManage onClose={vi.fn()} />
        </AuthContext.Provider>
      </AuthSessionContext.Provider>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'teal' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  expect(client.getQueryState(boardKeys.detail(board.id))?.isInvalidated).toBe(
    true,
  );
});

it('previews every catalog color and packaged photo and saves the selected preset', async () => {
  const board = makeBoard({
    id: 'board',
    backgroundPreset: 'blue',
    backgroundVersion: 4,
    capabilities: {
      canReadBoard: true,
      canWriteBoard: true,
      canManageBoard: true,
      canManageMembers: true,
      canRestoreBoard: false,
    },
  });
  const colors = [
    'blue',
    'indigo',
    'violet',
    'rose',
    'orange',
    'amber',
    'green',
    'teal',
  ];
  const photos = ['mountains', 'forest', 'coast', 'lake'];
  const calls = mockApi({
    'GET /boards/background-presets': ok([
      ...colors.map((id) => ({
        id,
        kind: 'color',
        value: '#2563EB',
        foreground: 'light',
      })),
      ...photos.map((id) => ({
        id,
        kind: 'photo',
        value: '',
        foreground: 'light',
      })),
    ]),
    'GET /boards/board': ok(board),
    'PATCH /boards/board/background': ok({
      ...board,
      backgroundPreset: 'lake',
      backgroundVersion: 5,
    }),
  });
  const auth: AuthContextValue = {
    status: 'authenticated',
    user: testUser,
    signIn: vi.fn(),
    signOut: vi.fn(),
    retry: vi.fn(),
    runAuthorized: (request) => request('token'),
  };
  const close = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <AuthSessionContext.Provider
        value={{
          generation: 1,
          isCurrent: () => true,
          canFinishRevokingRequest: () => true,
        }}
      >
        <AuthContext.Provider value={auth}>
          <BoardBackgroundDialog board={board} canManage onClose={close} />
        </AuthContext.Provider>
      </AuthSessionContext.Provider>
    </QueryClientProvider>,
  );
  for (const id of colors) {
    const choice = await screen.findByRole('button', {
      name: new RegExp(`^${id}`),
    });
    fireEvent.click(choice);
    expect(choice.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText(`Preview: ${id}`)).toBeTruthy();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Photos' }));
  for (const id of photos) {
    const choice = screen.getByRole('button', { name: new RegExp(`^${id}`) });
    fireEvent.click(choice);
    expect(choice.getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByLabelText(`Preview: ${id}`).getAttribute('style'),
    ).toContain(`/board-backgrounds/${id}.jpg`);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
    preset: 'lake',
    expectedVersion: 4,
  });
});
