/* global jest, test, expect */
import React from 'react';
import { URL } from 'node:url';
import { Text } from 'react-native';
import { Tabs, router } from 'expo-router';
import {
  act,
  fireEvent,
  renderRouter,
  screen,
  waitFor,
} from 'expo-router/testing-library';
import { SessionProvider as NavigationProvider } from '../src/navigation/session-context';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { createNavigationSessionAdapter } from '../src/navigation/native-session-adapter';
import { createSessionManager } from '../src/infrastructure/auth/session-manager';
import { createCredentialStore } from '../src/infrastructure/auth/credential-store';
import {
  FakeTime,
  MemorySecureStore,
  USER_A,
  user,
  makeJwt,
} from './auth/support';
import { createMobileDataLayer } from '../src/infrastructure/query/data-layer';
import { createHttpClient } from '../src/infrastructure/api/client';
import { createTransportSessionApi } from '../src/infrastructure/auth/session-api';
import { createAuthApi } from '../src/features/auth/api';
import { createAuthFlow } from '../src/features/auth/flow';
import { AuthProvider } from '../src/features/auth/runtime';
import { RootStack } from '../src/navigation/root-stack';
import Index from '../src/app/index';
import PrivateLayout from '../src/app/(private)/_layout';
import SignIn from '../src/app/sign-in';
import SignUp from '../src/app/sign-up';
import Verify from '../src/app/verify-email';
import Forgot from '../src/app/forgot-password';
import Reset from '../src/app/reset-password';
import { queryKeys } from '../src/infrastructure/query/keys';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { RealtimeProvider } from '../src/infrastructure/realtime/RealtimeProvider';
import { createNativeRealtime } from '../src/infrastructure/realtime/client';
import Home from '../src/app/(private)/(tabs)/home';
import Board from '../src/app/(private)/boards/[boardId]/index';
import Card from '../src/app/(private)/boards/[boardId]/cards/[cardId]';
import Calendar from '../src/app/(private)/boards/[boardId]/calendar';
import {
  boardId,
  cardId,
  emptyHome,
  fixture,
  workspaceId,
} from './home/fixtures';
import { boardDetail } from './workspaces/kanban-fixtures';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
jest.mock(
  'expo-glass-effect',
  () => ({ isLiquidGlassAvailable: () => false }),
  { virtual: true },
);
jest.mock(
  'expo-asset',
  () => ({ Asset: { fromModule: () => ({ downloadAsync: async () => {} }) } }),
  { virtual: true },
);
jest.spyOn(React, 'useEffectEvent').mockImplementation((callback) => {
  const latest = React.useRef(callback);
  React.useEffect(() => {
    latest.current = callback;
  });
  return React.useCallback((...args) => latest.current(...args), []);
});

test('real auth adapters and session owner resume a canonical return target, isolate logout and permit Home after fresh login', async () => {
  const clock = jest
    .spyOn(Date, 'now')
    .mockReturnValue(Date.parse('2026-11-17T00:00:00Z'));
  let boardReadable = true;
  const time = new FakeTime(),
    store = new MemorySecureStore(),
    flow = createAuthFlow(),
    calls = [];
  const http = createHttpClient({
    baseUrl: new URL('https://api.example.test/api'),
    fetch: async (input, init) => {
      expect(init.credentials).toBe('omit');
      const url = new URL(input);
      const path = url.pathname;
      calls.push(path);
      const paginated = ['cards', 'columns', 'labels', 'members'].some(
        (endpoint) => path === `/api/boards/${boardId}/${endpoint}`,
      );
      if (paginated) {
        const rows = path.endsWith('/cards')
          ? [
              {
                id: cardId,
                boardId,
                columnId: boardId,
                title: 'Calendar deadline',
                description: null,
                position: '1.0000000000',
                isArchived: false,
                startDate: null,
                dueDate: '2026-11-17T09:00:00.000Z',
                createdAt: '2026-11-15T08:00:00.000Z',
                updatedAt: '2026-11-15T08:00:00.000Z',
                assignees: [],
              },
            ]
          : [];
        return {
          ok: true,
          status: 200,
          headers: {
            get: (name) =>
              name === 'content-type' ? 'application/json' : null,
          },
          text: async () =>
            JSON.stringify({
              success: true,
              statusCode: 200,
              message: 'OK',
              data: rows,
              meta: {
                page: Number(url.searchParams.get('page')),
                limit: 100,
                total: rows.length,
                totalPages: rows.length ? 1 : 0,
              },
            }),
        };
      }
      const status = path.endsWith('logout')
        ? 204
        : path.startsWith('/api/boards/') && !boardReadable
          ? 404
          : 200;
      const data = path.endsWith('login')
        ? {
            accessToken: makeJwt(USER_A),
            tokenType: 'Bearer',
            expiresIn: 3600,
            user: user(USER_A),
          }
        : path.endsWith('/users/me/home')
          ? boardReadable
            ? fixture()
            : emptyHome()
          : path === `/api/boards/${boardId}/cards/${cardId}`
            ? {
                id: cardId,
                boardId,
                columnId: boardId,
                createdById: USER_A,
                title: 'Detail payload stays private',
                description: null,
                position: '1.0000000000',
                isArchived: false,
                archivedAt: null,
                startDate: null,
                dueDate: null,
                createdAt: '2026-11-15T08:00:00.000Z',
                updatedAt: '2026-11-15T08:00:00.000Z',
                assignees: [],
              }
            : path === `/api/boards/${boardId}`
              ? {
                  ...boardDetail,
                  id: boardId,
                  workspaceId,
                  isArchived: false,
                  capabilities: {
                    ...boardDetail.capabilities,
                    canReadBoard: true,
                    canWriteBoard: false,
                  },
                }
              : user(USER_A);
      // The real transport consumes this controlled network response.
      return {
        ok: true,
        status,
        headers: {
          get: (name) => (name === 'content-type' ? 'application/json' : null),
        },
        text: async () =>
          JSON.stringify({
            success: true,
            statusCode: status,
            message: 'OK',
            data,
          }),
      };
    },
  });
  const manager = createSessionManager({
    store: createCredentialStore(store),
    api: createTransportSessionApi(http),
    clock: time,
    timers: time,
  });
  const data = createMobileDataLayer(manager, http),
    api = createAuthApi(http),
    adapter = createNavigationSessionAdapter(manager);
  const realtime = createNativeRealtime({ manager, data, createSocket: null });
  data.queryClient.setDefaultOptions({
    ...data.queryClient.getDefaultOptions(),
    queries: {
      ...data.queryClient.getDefaultOptions().queries,
      gcTime: Infinity,
    },
  });
  const routes = {
    _layout: () => (
      <SessionProvider manager={manager}>
        <AuthProvider api={api} manager={manager} flow={flow}>
          <NavigationProvider adapter={adapter}>
            <DataProvider layer={data}>
              <RealtimeProvider client={realtime}>
                <RootStack />
              </RealtimeProvider>
            </DataProvider>
          </NavigationProvider>
        </AuthProvider>
      </SessionProvider>
    ),
    index: Index,
    'sign-in': SignIn,
    'sign-up': SignUp,
    'verify-email': Verify,
    'forgot-password': Forgot,
    'reset-password': Reset,
    '(private)/_layout': {
      default: PrivateLayout,
      unstable_settings: { anchor: '(tabs)' },
    },
    '(private)/(tabs)/_layout': () => (
      <Tabs>
        <Tabs.Screen name="home" />
      </Tabs>
    ),
    '(private)/(tabs)/home': Home,
    '(private)/boards/[boardId]/index': Board,
    '(private)/boards/[boardId]/cards/[cardId]': Card,
    '(private)/boards/[boardId]/calendar': Calendar,
    '(private)/search': () => <Text>Protected Search</Text>,
    '(private)/invitation': () => null,
  };
  const view = await renderRouter(routes, { initialUrl: '/search' });
  try {
    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy());
    expect(screen.queryByText('Protected Search')).toBeNull();
    await fireEvent.changeText(
      screen.getByLabelText('Email address'),
      'user@example.test',
    );
    await fireEvent.changeText(screen.getByLabelText('Password'), 'password');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen).toHavePathname('/search'));
    expect(calls).toEqual(['/api/auth/login', '/api/users/me']);
    expect(manager.getSnapshot().status).toBe('authenticated');
    expect(store.values.size).toBe(1);
    const key = queryKeys.me(data.getIdentity());
    data.queryClient.setQueryData(key, { private: 'only A' });
    await act(() => manager.logout());
    await waitFor(() => expect(screen).toHavePathname('/sign-in'));
    expect(screen.queryByText('Protected Search')).toBeNull();
    expect(data.queryClient.getQueryData(key)).toBeUndefined();
    expect(store.values.size).toBe(0);
    await fireEvent.changeText(
      screen.getByLabelText('Email address'),
      'user@example.test',
    );
    await fireEvent.changeText(screen.getByLabelText('Password'), 'password');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen).toHavePathname('/home'));
    await screen.findByText('Review release notes');
    const homeReads = calls.filter((path) => path.endsWith('/users/me/home'));
    expect(homeReads.length).toBeGreaterThan(0);
    expect(homeReads.length).toBeLessThanOrEqual(2);
    await fireEvent.press(
      screen.getByRole('button', { name: /Open Review release notes/ }),
    );
    await waitFor(() =>
      expect(screen).toHavePathname(`/boards/${boardId}/cards/${cardId}`),
    );
    await screen.findByText('Detail payload stays private');
    expect(screen.queryByText('Card detail is coming soon.')).toBeNull();
    await act(() => router.back());
    await waitFor(() => expect(screen).toHavePathname('/home'));
    await act(() => router.push(`/boards/${boardId}`));
    await screen.findByRole('button', { name: 'Calendar' });
    await fireEvent.press(screen.getByRole('button', { name: 'Calendar' }));
    await waitFor(() =>
      expect(screen).toHavePathname(`/boards/${boardId}/calendar`),
    );
    await screen.findByRole('button', { name: 'Open card: Calendar deadline' });
    await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    await fireEvent.changeText(
      screen.getByLabelText('Search cards'),
      'Calendar',
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Apply filters (1)' }),
    );
    await screen.findByRole('button', { name: 'Open card: Calendar deadline' });
    await fireEvent.press(
      screen.getByRole('button', { name: 'Open card: Calendar deadline' }),
    );
    await waitFor(() =>
      expect(screen).toHavePathname(`/boards/${boardId}/cards/${cardId}`),
    );
    await screen.findByText('Detail payload stays private');
    await act(() => router.back());
    await waitFor(() =>
      expect(screen).toHavePathname(`/boards/${boardId}/calendar`),
    );
    await screen.findByRole('button', { name: 'Filters (1)' });
    expect(
      screen.getByTestId('calendar-day-2026-11-17').props.accessibilityState
        .selected,
    ).toBe(true);
    await act(() => router.back());
    await waitFor(() => expect(screen).toHavePathname(`/boards/${boardId}`));
    await act(() => router.back());
    await waitFor(() => expect(screen).toHavePathname('/home'));
    boardReadable = false;
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Open board Release planning, Starred',
      }),
    );
    await waitFor(() => expect(screen).toHavePathname(`/boards/${boardId}`));
    await screen.findByText('This destination is unavailable.');
    await act(() => router.back());
    await waitFor(() => expect(screen).toHavePathname('/home'));
    expect(screen.queryByText('Release planning')).toBeNull();
    await screen.findByText('No starred boards yet.');
    await act(() => router.push('/search'));
    expect(screen.getByText('Protected Search')).toBeTruthy();
  } finally {
    await view.unmount();
    realtime.dispose();
    data.dispose();
    manager.dispose();
    flow.clear();
    clock.mockRestore();
  }
});
