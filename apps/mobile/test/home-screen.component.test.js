/* global jest, test, expect, afterEach */
import { URL } from 'node:url';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { HomeScreen } from '../src/features/home/HomeScreen';
import { BoardArtwork } from '../src/features/home/BoardArtwork';
import { createHttpClient } from '../src/infrastructure/api/client';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { createSessionManager } from '../src/infrastructure/auth/session-manager';
import { createCredentialStore } from '../src/infrastructure/auth/credential-store';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { createMobileDataLayer } from '../src/infrastructure/query/data-layer';
import { ThemeContext, palettes } from '../src/ui';
import {
  FakeSessionApi,
  FakeTime,
  MemorySecureStore,
  USER_A,
  USER_B,
  loginResponse,
  user,
} from './auth/support';
import { boardId, cardId, emptyHome, fixture } from './home/fixtures';

let mockDimensions = { width: 375, height: 812, scale: 2, fontScale: 1 };
jest.mock('react-native', () => {
  const native = jest.requireActual('react-native');
  const descriptors = Object.getOwnPropertyDescriptors(native);
  descriptors.useWindowDimensions = {
    configurable: true,
    enumerable: true,
    value: () => mockDimensions,
  };
  descriptors.RefreshControl = {
    configurable: true,
    enumerable: true,
    value: ({ onRefresh, refreshing }) => (
      <native.View
        testID="refresh-driver"
        onTouchEnd={onRefresh}
        accessibilityState={{ busy: refreshing }}
      />
    ),
  };
  return Object.create(Object.getPrototypeOf(native), descriptors);
});

function findNodes(node, predicate) {
  if (typeof node !== 'object' || !node) return [];
  return [
    ...(predicate(node) ? [node] : []),
    ...node.children.flatMap((child) => findNodes(child, predicate)),
  ];
}
const mockNavigate = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate, push: mockPush }),
  useIsFocused: () => true,
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));

function response(data, status = 200, retryAfter = null) {
  return {
    ok: status === 200,
    status,
    headers: {
      get: (key) =>
        key === 'content-type'
          ? 'application/json'
          : key === 'retry-after'
            ? retryAfter
            : null,
    },
    text: async () =>
      JSON.stringify({
        success: status === 200,
        statusCode: status,
        message: 'OK',
        data,
      }),
  };
}

async function setup(fetch, { authenticated = true, theme = 'light' } = {}) {
  const clock = new FakeTime();
  const api = new FakeSessionApi();
  api.auto = (token) => ({
    kind: 'verified',
    user: {
      ...user(token === loginResponse(USER_A).accessToken ? USER_A : USER_B),
      displayName:
        token === loginResponse(USER_A).accessToken
          ? 'Taylor Example'
          : 'Alex Example',
    },
  });
  const manager = createSessionManager({
    store: createCredentialStore(new MemorySecureStore()),
    api,
    clock,
    timers: clock,
  });
  const transport = createHttpClient({
    baseUrl: new URL('https://home.example.test/api'),
    fetch,
  });
  const layer = createMobileDataLayer(manager, transport);
  layer.queryClient.setDefaultOptions({
    ...layer.queryClient.getDefaultOptions(),
    queries: {
      ...layer.queryClient.getDefaultOptions().queries,
      gcTime: Infinity,
    },
  });
  if (authenticated) await manager.establishSession(loginResponse(USER_A));
  const view = await render(
    <SessionProvider manager={manager}>
      <DataProvider layer={layer}>
        <ThemeContext.Provider value={theme}>
          <HomeScreen />
        </ThemeContext.Provider>
      </DataProvider>
    </SessionProvider>,
  );
  return {
    manager,
    layer,
    refresh: () => screen.getByTestId('refresh-driver'),
    async dispose() {
      await view.unmount();
      layer.dispose();
      manager.dispose();
    },
  };
}

afterEach(() => {
  onlineManager.setOnline(true);
  mockDimensions = { width: 375, height: 812, scale: 2, fontScale: 1 };
  jest.restoreAllMocks();
  mockNavigate.mockClear();
  mockPush.mockClear();
});

test('loading skeleton then server-only values, metadata, and canonical actions', async () => {
  let resolve;
  const fetch = jest.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const env = await setup(fetch);
  try {
    expect(
      screen.getByRole('progressbar', { name: 'Loading Home' }),
    ).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
    await act(() => resolve(response(fixture())));
    await screen.findByText('Review release notes');
    expect(screen.getByText(/Good .*Taylor/)).toBeTruthy();
    expect(screen.getByText('Documentation')).toBeTruthy();
    expect(screen.getByText('Release planning · Engineering')).toBeTruthy();
    expect(screen.getAllByText('Release planning')).toHaveLength(2);
    for (const [name, path] of [
      ['My tasks, 18. Open My Tasks', '/tasks'],
      ['Due soon, 4. Open My Tasks', '/tasks'],
      ['View all', '/tasks'],
      ['See all', '/boards'],
      [
        /Open Review release notes, Release planning/,
        `/boards/${boardId}/cards/${cardId}`,
      ],
      ['Open board Release planning, Starred', `/boards/${boardId}`],
    ]) {
      await fireEvent.press(screen.getByRole('button', { name }));
      expect(mockNavigate).toHaveBeenLastCalledWith(path);
    }
    await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
    expect(mockPush).toHaveBeenLastCalledWith('/search');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Account settings' }),
    );
    expect(mockPush).toHaveBeenLastCalledWith('/settings');
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    await env.dispose();
  }
});

test('pull refresh reuses an in-flight request, retains content on 503, then recovers to empty', async () => {
  let settle;
  const fetch = jest
    .fn()
    .mockResolvedValueOnce(response(fixture()))
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          settle = done;
        }),
    )
    .mockResolvedValueOnce(response(emptyHome()));
  const now = jest.spyOn(Date, 'now');
  let tick = Date.now();
  now.mockImplementation(() => tick);
  const env = await setup(fetch);
  try {
    await screen.findByText('Review release notes');
    const pull = () => fireEvent(env.refresh(), 'touchEnd');
    await pull();
    await pull();
    expect(fetch).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(env.refresh()).toBeBusy());
    expect(screen.getByText('Review release notes')).toBeTruthy();
    await act(() => settle(response(null, 503)));
    await screen.findByText(
      'Couldn’t refresh Home. Showing the last available data.',
    );
    expect(screen.getByText('Review release notes')).toBeTruthy();
    tick += 1100;
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('No assigned tasks with due dates.');
    expect(screen.getByText('No starred boards yet.')).toBeTruthy();
    expect(screen.getByText('No recently viewed boards.')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'My tasks, 0. Open My Tasks' }),
    ).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(3);
  } finally {
    await env.dispose();
  }
});

test('initial 429 honors retry-after and a malformed success never fabricates counts', async () => {
  const fetch = jest
    .fn()
    .mockResolvedValueOnce(response(null, 429, '120'))
    .mockResolvedValueOnce(response({ summary: {} }));
  const env = await setup(fetch);
  try {
    await screen.findByText('Too many requests. Try again shortly.');
    const retry = screen.getByRole('button', { name: 'Retry' });
    await waitFor(() => expect(retry).toBeDisabled());
    await fireEvent(env.refresh(), 'touchEnd');
    expect(fetch).toHaveBeenCalledTimes(1);
    const later = Date.now() + 121_000;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    await fireEvent(env.refresh(), 'touchEnd');
    await screen.findByText('Home is unavailable right now. Please retry.');
    expect(screen.queryByText('0')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    await env.dispose();
  }
});

test('verified in-memory data can be labeled offline but is cleared on account replacement and logout', async () => {
  const fetch = jest
    .fn()
    .mockResolvedValueOnce(response(fixture()))
    .mockResolvedValueOnce(response(emptyHome()));
  const env = await setup(fetch, { authenticated: false });
  try {
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByText(/Good /)).toBeNull();
    await act(() => env.manager.establishSession(loginResponse(USER_A)));
    await screen.findByText('Review release notes');
    await act(() => onlineManager.setOnline(false));
    expect(
      screen.getByText('Offline. Showing the last available Home.'),
    ).toBeTruthy();
    await fireEvent(env.refresh(), 'touchEnd');
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(() => env.manager.establishSession(loginResponse(USER_B)));
    expect(screen.queryByText('Review release notes')).toBeNull();
    await act(() => focusManager.setFocused(true));
    await act(() => onlineManager.setOnline(true));
    await screen.findByText(/Good .*Alex/);
    await screen.findByText('No starred boards yet.');
    await act(() => env.manager.logout());
    expect(screen.queryByText(/Good /)).toBeNull();
    expect(screen.queryByText('No starred boards yet.')).toBeNull();
  } finally {
    await env.dispose();
  }
});

test('dark 320 dp large text stacks tiles and exposes the full accessible board name', async () => {
  mockDimensions = { width: 320, height: 568, scale: 2, fontScale: 1.6 };
  const home = fixture();
  const longName = 'A long, distinctive board name '.repeat(5).trim();
  home.starredBoards[0].name = longName;
  const env = await setup(jest.fn().mockResolvedValue(response(home)), {
    theme: 'dark',
  });
  try {
    await screen.findByRole('button', {
      name: `Open board ${longName}, Starred`,
    });
    expect(screen.getAllByText(longName)[0].props.numberOfLines).toBe(2);
    const tile = screen.getByRole('button', {
      name: 'Due soon, 4. Open My Tasks',
    });
    expect(tile).toHaveStyle({
      backgroundColor: palettes.dark.surface,
      minHeight: 130,
    });
    expect(tile.parent).toHaveStyle({ flexDirection: 'column' });
  } finally {
    await env.dispose();
  }
});

test('photo decode failure keeps the local preset background', async () => {
  const view = await render(<BoardArtwork preset="forest" />);
  const photos = () =>
    findNodes(view.container, (node) => node.props?.resizeMode === 'cover');
  expect(photos()).toHaveLength(1);
  await fireEvent(photos()[0], 'error', {});
  expect(photos()).toHaveLength(0);
  expect(view.root).toHaveStyle({ backgroundColor: '#315C49' });
  await view.unmount();
});
