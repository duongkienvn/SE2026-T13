/* global jest, test, expect, afterEach, structuredClone */
import { URL } from 'node:url';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppState } from 'react-native';
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

const prefs = (timeZone, dateFormat = 'YYYY-MM-DD') => ({
  theme: 'light',
  timeZone,
  dateFormat,
  weekStartsOn: 'monday',
});

async function setup(
  fetch,
  {
    authenticated = true,
    theme = 'light',
    preferences = jest.fn(async () => response(prefs('Asia/Bangkok'))),
  } = {},
) {
  // Home's own requests stay on `fetch`, so its call counts remain exact.
  const routed = (url, init) =>
    String(url).endsWith('/users/me/preferences')
      ? preferences(url, init)
      : fetch(url, init);
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
    fetch: routed,
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

function onForeground() {
  const original = AppState.addEventListener.getMockImplementation();
  const listeners = new Set();
  const state = AppState.currentState;
  const app = {
    original,
    restore() {
      AppState.addEventListener.mockImplementation(original);
      AppState.currentState = state;
    },
    // Several hooks subscribe; drive every live listener like the OS would.
    listener(next) {
      AppState.currentState = next;
      [...listeners].forEach((callback) => callback(next));
    },
  };
  AppState.addEventListener.mockImplementation((_, callback) => {
    listeners.add(callback);
    return { remove: () => listeners.delete(callback) };
  });
  return app;
}

test('F01: greeting, relative and absolute due labels use the saved account timezone and format', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  // Device (UTC or Asia/Saigon) is already on Nov 28; the account is still on Nov 27.
  jest.setSystemTime(new Date('2026-11-28T06:30:00.000Z'));
  const app = onForeground();
  const home = fixture();
  home.upNext[0].dueDate = '2026-11-28T09:00:00.000Z';
  home.recentBoards[0] = { ...home.recentBoards[0], isStarred: false };
  const env = await setup(jest.fn().mockResolvedValue(response(home)), {
    preferences: jest.fn(async () =>
      response(prefs('America/Los_Angeles', 'MM/DD/YYYY')),
    ),
  });
  try {
    await act(() => app.listener('active'));
    await screen.findByText('Good evening, Taylor');
    expect(
      screen.getByRole('button', {
        name: /Open Review release notes, .*Tomorrow/,
      }),
    ).toBeTruthy();
    expect(screen.getByText('Viewed 11/13/2026')).toBeTruthy();
  } finally {
    await env.dispose();
    app.restore();
    jest.useRealTimers();
  }
});

test('account midnight reconciles Home once (empty Overdue becomes populated), with no polling or background work', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(new Date('2026-11-27T16:59:30.000Z')); // 23:59:30 Bangkok
  const app = onForeground();
  const before = fixture();
  before.summary.overdueCount = 0;
  before.upNext[0].dueDate = '2026-11-27T12:00:00.000Z';
  const after = structuredClone(before);
  after.summary.overdueCount = 1;
  after.summary.dueNext7DaysCount = 3;
  after.upNext[0].group = 'OVERDUE';
  const fetch = jest
    .fn()
    .mockResolvedValueOnce(response(before))
    .mockResolvedValue(response(after));
  const preferences = jest.fn(async () => response(prefs('Asia/Bangkok')));
  const env = await setup(fetch, { preferences });
  try {
    await screen.findByRole('button', { name: 'Due soon, 4. Open My Tasks' });
    await act(() => app.listener('active'));
    expect(screen.getByRole('button', { name: /Today/ })).toBeTruthy();
    await act(() => jest.advanceTimersByTime(20_000));
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(() => jest.advanceTimersByTime(10_500));
    await screen.findByRole('button', { name: 'Due soon, 3. Open My Tasks' });
    expect(
      screen.getByRole('button', { name: /Overdue · 2026-11-27/ }),
    ).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(() => jest.advanceTimersByTime(3_600_000));
    expect(fetch).toHaveBeenCalledTimes(2);
    // Backgrounded across the next midnight: nothing until resume, then one read.
    await act(() => app.listener('background'));
    jest.setSystemTime(new Date('2026-11-28T18:00:00.000Z'));
    await act(() => jest.advanceTimersByTime(600_000));
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(() => app.listener('active'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    // Preferences refetch once on resume (existing focus refresh), never per tick.
    expect(preferences).toHaveBeenCalledTimes(2);
  } finally {
    await env.dispose();
    app.restore();
    jest.useRealTimers();
  }
});
