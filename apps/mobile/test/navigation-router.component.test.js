/* global jest, test, expect */
import React from 'react';
import process from 'node:process';
import { Text } from 'react-native';
import { router, Tabs } from 'expo-router';
import {
  act,
  getMockConfig,
  renderRouter,
  screen,
  waitFor,
} from 'expo-router/testing-library';
import { SessionProvider } from '../src/navigation/session-context';
import { RootStack } from '../src/navigation/root-stack';
import Index from '../src/app/index';
import PrivateLayout from '../src/app/(private)/_layout';
import { PublicScaffold } from '../src/navigation/public-scaffold';
import { redirectSystemPath } from '../src/app/+native-intent';
import { ResourceBoundary } from '../src/navigation/resource-boundary';

const cardPath =
  '/boards/01234567-89ab-cdef-0123-456789abcdef/cards/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('the retired preview flag cannot open the protected shell', async () => {
  const previous = process.env.EXPO_PUBLIC_NAVIGATION_PREVIEW;
  process.env.EXPO_PUBLIC_NAVIGATION_PREVIEW = '1';
  const adapter = createAdapter({ status: 'unauthenticated' });
  try {
    await renderRouter(routesFor(adapter), { initialUrl: '/' });
    await waitFor(() => expect(screen).toHavePathname('/sign-in'));
    await act(() => router.push('/search'));
    await waitFor(() => expect(screen).toHavePathname('/sign-in'));
    expect(screen.queryByText('Search content')).toBeNull();
    expect(adapter.getSnapshot()).toEqual({ status: 'unauthenticated' });
    await act(() => router.push(cardPath));
    await waitFor(() => expect(screen).toHavePathname('/sign-in'));
    expect(screen.queryByText('Resource unavailable')).toBeNull();
  } finally {
    if (previous === undefined)
      delete process.env.EXPO_PUBLIC_NAVIGATION_PREVIEW;
    else process.env.EXPO_PUBLIC_NAVIGATION_PREVIEW = previous;
  }
});

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

// The installed test renderer predates React's useEffectEvent dispatcher.
// Native React supplies the real hook; this shim is limited to the Jest harness.
jest.spyOn(React, 'useEffectEvent').mockImplementation((callback) => {
  const latest = React.useRef(callback);
  React.useEffect(() => {
    latest.current = callback;
  });
  return React.useCallback((...args) => latest.current(...args), []);
});

function createAdapter(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(value) {
      state = value;
      listeners.forEach((listener) => listener());
    },
  };
}

function routesFor(adapter) {
  return {
    _layout: () => (
      <SessionProvider adapter={adapter}>
        <RootStack />
      </SessionProvider>
    ),
    index: Index,
    'sign-in': () => <PublicScaffold title="Sign in" />,
    'sign-up': () => <Text>Sign up</Text>,
    'forgot-password': () => <Text>Forgot password</Text>,
    'reset-password': () => <Text>Reset password</Text>,
    'verify-email': () => <Text>Verify email</Text>,
    '(private)/_layout': {
      default: PrivateLayout,
      unstable_settings: { anchor: '(tabs)' },
    },
    '(private)/(tabs)/_layout': () => (
      <Tabs>
        <Tabs.Screen name="home" />
        <Tabs.Screen name="tasks" />
        <Tabs.Screen name="boards" />
        <Tabs.Screen name="inbox" />
      </Tabs>
    ),
    '(private)/(tabs)/home': () => <Text>Home content</Text>,
    '(private)/(tabs)/tasks': () => <Text>Tasks content</Text>,
    '(private)/(tabs)/boards': () => <Text>Boards content</Text>,
    '(private)/(tabs)/inbox': () => <Text>Inbox content</Text>,
    '(private)/search': () => <Text>Search content</Text>,
    '(private)/invitation': () => <Text>Invitation content</Text>,
    // This suite supplies only a navigation session, with no REST access grant.
    // The auth router integration exercises the actual Board and Card entries.
    '(private)/boards/[boardId]/cards/[cardId]': () => (
      <ResourceBoundary access="unavailable" />
    ),
  };
}

test('the production route directory can be resolved by Expo Router', () => {
  const config = getMockConfig('./src/app');
  expect(config.screens.__root.screens).toBeTruthy();
});

test('a canonical Card link remains protected and fails closed after authentication', async () => {
  const adapter = createAdapter({ status: 'unauthenticated' });
  await renderRouter(routesFor(adapter), { initialUrl: cardPath });
  await waitFor(() => expect(screen).toHavePathname('/sign-in'));
  expect(screen.queryByText('Resource unavailable')).toBeNull();
  await act(() => adapter.set({ status: 'authenticated', sessionKey: 'one' }));
  await waitFor(() => expect(screen).toHavePathname(cardPath));
  expect(screen.getByText('Resource unavailable')).toBeTruthy();
  expect(router.canGoBack()).toBe(true);
  await act(() => router.back());
  await waitFor(() => expect(screen).toHavePathname('/home'));
});

test('a malformed Card link cannot render the resource scaffold', async () => {
  const adapter = createAdapter({ status: 'authenticated', sessionKey: 'one' });
  await renderRouter(routesFor(adapter), {
    initialUrl: '/boards/not-a-uuid/cards/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  });
  await waitFor(() => expect(screen).toHavePathname('/boards'));
  expect(screen.queryByText('Resource unavailable')).toBeNull();
});

test('each supported navigation origin can push the same canonical Card route and go back', async () => {
  const adapter = createAdapter({ status: 'authenticated', sessionKey: 'one' });
  await renderRouter(routesFor(adapter), { initialUrl: '/home' });
  for (const origin of ['/home', '/tasks', '/boards', '/search', '/inbox']) {
    await act(() => router.navigate(origin));
    await waitFor(() => expect(screen).toHavePathname(origin));
    await act(() => router.push(cardPath));
    await waitFor(() => expect(screen).toHavePathname(cardPath));
    expect(screen.getByText('Resource unavailable')).toBeTruthy();
    await act(() => router.back());
    await waitFor(() => expect(screen).toHavePathname(origin));
  }
});

test('router retains a signed-out deep link until the external session authenticates', async () => {
  const adapter = createAdapter({ status: 'unauthenticated' });
  await renderRouter(routesFor(adapter), { initialUrl: '/search' });
  await waitFor(() => expect(screen).toHavePathname('/sign-in'));
  expect(screen.queryByText('Search content')).toBeNull();
  await act(() =>
    adapter.set({ status: 'authenticated', sessionKey: 'test-only' }),
  );
  await waitFor(() => expect(screen).toHavePathname('/search'));
  expect(screen.getByText('Search content')).toBeTruthy();
});

test('a restoring session never exposes the target and resumes it after verification', async () => {
  const adapter = createAdapter({ status: 'restoring' });
  await renderRouter(routesFor(adapter), { initialUrl: '/search' });
  expect(screen.queryByText('Search content')).toBeNull();
  expect(screen.getByText('Checking session')).toBeTruthy();
  await act(() => adapter.set({ status: 'authenticated', sessionKey: 'one' }));
  await waitFor(() => expect(screen).toHavePathname('/search'));
  expect(screen.getByText('Search content')).toBeTruthy();
});

test('tab navigation and a pushed detail retain a usable Back path', async () => {
  const adapter = createAdapter({ status: 'authenticated', sessionKey: 'one' });
  await renderRouter(routesFor(adapter), { initialUrl: '/home' });
  await waitFor(() => expect(screen).toHavePathname('/home'));
  await act(() => router.navigate('/tasks'));
  await waitFor(() => expect(screen).toHavePathname('/tasks'));
  await act(() => router.navigate('/boards'));
  await waitFor(() => expect(screen).toHavePathname('/boards'));
  await act(() => router.push('/search'));
  await waitFor(() => expect(screen).toHavePathname('/search'));
  expect(router.canGoBack()).toBe(true);
  await act(() => router.back());
  await waitFor(() => expect(screen).toHavePathname('/boards'));
});

test('a cold protected detail link has a safe Back destination', async () => {
  const adapter = createAdapter({ status: 'authenticated', sessionKey: 'one' });
  await renderRouter(routesFor(adapter), { initialUrl: '/search' });
  await waitFor(() => expect(screen).toHavePathname('/search'));
  expect(router.canGoBack()).toBe(true);
  await act(() => router.back());
  await waitFor(() => expect(screen).toHavePathname('/home'));
});

test('a restored protected detail has a safe Back destination after authentication', async () => {
  const adapter = createAdapter({ status: 'unauthenticated' });
  await renderRouter(routesFor(adapter), { initialUrl: '/search' });
  await waitFor(() => expect(screen).toHavePathname('/sign-in'));
  await act(() => adapter.set({ status: 'authenticated', sessionKey: 'one' }));
  await waitFor(() => expect(screen).toHavePathname('/search'));
  expect(router.canGoBack()).toBe(true);
  await act(() => router.back());
  await waitFor(() => expect(screen).toHavePathname('/home'));
});

test('logging out and changing account removes the previous private route', async () => {
  const adapter = createAdapter({ status: 'authenticated', sessionKey: 'one' });
  await renderRouter(routesFor(adapter), { initialUrl: '/search' });
  await waitFor(() => expect(screen).toHavePathname('/search'));
  await act(() => adapter.set({ status: 'unauthenticated' }));
  await waitFor(() => expect(screen).toHavePathname('/sign-in'));
  expect(screen.queryByText('Search content')).toBeNull();
  await act(() => adapter.set({ status: 'authenticated', sessionKey: 'two' }));
  await waitFor(() => expect(screen).toHavePathname('/home'));
  expect(screen.queryByText('Search content')).toBeNull();
});

test('a warm protected navigation while signed out resumes after authentication', async () => {
  const adapter = createAdapter({ status: 'unauthenticated' });
  await renderRouter(routesFor(adapter), { initialUrl: '/sign-in' });
  await waitFor(() => expect(screen).toHavePathname('/sign-in'));
  await act(() => router.push('/search'));
  await waitFor(() => expect(screen).toHavePathname('/sign-in'));
  expect(screen.queryByText('Search content')).toBeNull();
  await act(() => adapter.set({ status: 'authenticated', sessionKey: 'one' }));
  await waitFor(() => expect(screen).toHavePathname('/search'));
});

test('sequential warm native intents while signed out resume the latest validated target', async () => {
  const adapter = createAdapter({ status: 'unauthenticated' });
  await renderRouter(routesFor(adapter), { initialUrl: '/sign-in' });
  for (const url of ['kanvexa-dev://search', 'kanvexa-dev://invitation']) {
    await act(() => {
      const path = redirectSystemPath({ path: url, initial: false });
      router.push(path);
    });
    await waitFor(() => expect(screen).toHavePathname('/sign-in'));
  }
  await act(() => adapter.set({ status: 'authenticated', sessionKey: 'one' }));
  await waitFor(() => expect(screen).toHavePathname('/invitation'));
});

test('the invitation modal can be dismissed to the originating tab', async () => {
  const adapter = createAdapter({ status: 'authenticated', sessionKey: 'one' });
  await renderRouter(routesFor(adapter), { initialUrl: '/boards' });
  await waitFor(() => expect(screen).toHavePathname('/boards'));
  await act(() => router.push('/invitation'));
  await waitFor(() => expect(screen).toHavePathname('/invitation'));
  expect(router.canGoBack()).toBe(true);
  await act(() => router.back());
  await waitFor(() => expect(screen).toHavePathname('/boards'));
});

test('a direct account switch clears the current protected route', async () => {
  const adapter = createAdapter({ status: 'authenticated', sessionKey: 'one' });
  await renderRouter(routesFor(adapter), { initialUrl: '/search' });
  await waitFor(() => expect(screen).toHavePathname('/search'));
  await act(() => adapter.set({ status: 'authenticated', sessionKey: 'two' }));
  await waitFor(() => expect(screen).toHavePathname('/home'));
  expect(screen.queryByText('Search content')).toBeNull();
});

test('after expiration a new protected link can be resumed without restoring the prior route', async () => {
  const adapter = createAdapter({ status: 'authenticated', sessionKey: 'one' });
  await renderRouter(routesFor(adapter), { initialUrl: '/boards' });
  await waitFor(() => expect(screen).toHavePathname('/boards'));
  await act(() => adapter.set({ status: 'expired' }));
  await waitFor(() => expect(screen).toHavePathname('/sign-in'));
  await act(() => router.push('/search'));
  await waitFor(() => expect(screen).toHavePathname('/sign-in'));
  await act(() => adapter.set({ status: 'authenticated', sessionKey: 'two' }));
  await waitFor(() => expect(screen).toHavePathname('/search'));
});

test('offline uncertainty hides private content until the same session is verified', async () => {
  const adapter = createAdapter({ status: 'authenticated', sessionKey: 'one' });
  await renderRouter(routesFor(adapter), { initialUrl: '/search' });
  await waitFor(() => expect(screen.getByText('Search content')).toBeTruthy());
  await act(() => adapter.set({ status: 'offline-uncertain' }));
  expect(screen.queryByText('Search content')).toBeNull();
  expect(screen.getByText('Connection unavailable')).toBeTruthy();
  await act(() => adapter.set({ status: 'authenticated', sessionKey: 'one' }));
  await waitFor(() => expect(screen).toHavePathname('/search'));
  expect(screen.getByText('Search content')).toBeTruthy();
});

test('an uncertain offline session does not present the signed-out scaffold', async () => {
  const adapter = createAdapter({ status: 'offline-uncertain' });
  await renderRouter(routesFor(adapter), { initialUrl: '/sign-in' });
  expect(screen.queryByText('Sign in')).toBeNull();
  expect(screen.getByText('Connection unavailable')).toBeTruthy();
});

test('the latest validated warm link supersedes an earlier destination during restore', async () => {
  const adapter = createAdapter({ status: 'restoring' });
  await renderRouter(routesFor(adapter), { initialUrl: '/search' });
  expect(screen.queryByText('Search content')).toBeNull();
  await act(() => {
    const path = redirectSystemPath({
      path: 'kanvexa-dev://invitation',
      initial: false,
    });
    router.push(path);
  });
  await act(() => adapter.set({ status: 'authenticated', sessionKey: 'one' }));
  await waitFor(() => expect(screen).toHavePathname('/invitation'));
});

test('an invalid warm link cannot replace a validated pending destination', async () => {
  const adapter = createAdapter({ status: 'restoring' });
  await renderRouter(routesFor(adapter), { initialUrl: '/search' });
  await act(() => {
    const path = redirectSystemPath({
      path: 'https://evil.example/invitation',
      initial: false,
    });
    router.push(path);
  });
  await act(() => adapter.set({ status: 'authenticated', sessionKey: 'one' }));
  await waitFor(() => expect(screen).toHavePathname('/search'));
});

test('a warm link received while verifying an old account is not resumed into another account', async () => {
  const adapter = createAdapter({ status: 'authenticated', sessionKey: 'one' });
  await renderRouter(routesFor(adapter), { initialUrl: '/search' });
  await act(() => adapter.set({ status: 'verifying' }));
  await act(() =>
    redirectSystemPath({ path: 'kanvexa-dev://invitation', initial: false }),
  );
  await act(() => adapter.set({ status: 'authenticated', sessionKey: 'two' }));
  await waitFor(() => expect(screen).toHavePathname('/home'));
  expect(screen.queryByText('Invitation content')).toBeNull();
});
