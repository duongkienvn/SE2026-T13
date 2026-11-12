/* global jest, test, expect */
import React, { createElement as mockCreateElement } from 'react';
import { Text as MockText } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { SessionProvider } from '../src/navigation/session-context';
import PrivateLayout from '../src/app/(private)/_layout';
import { RootStack } from '../src/navigation/root-stack';
import { redirectSystemPath } from '../src/app/+native-intent';

const mockReplace = jest.fn();
jest.mock('expo-router', () => {
  const Stack = () => mockCreateElement(MockText, null, 'Private content');
  Stack.Screen = () => null;
  Stack.Protected = () => null;
  return {
    Stack,
    usePathname: () => '/search',
    useRouter: () => ({ replace: mockReplace }),
  };
});

function adapter(initial) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
  };
}

test('private screens do not flash while the session is unresolved or signed out', async () => {
  mockReplace.mockClear();
  const session = adapter({ status: 'restoring' });
  await render(
    <SessionProvider adapter={session}>
      <PrivateLayout />
    </SessionProvider>,
  );
  expect(screen.queryByText('Private content')).toBeNull();
  expect(screen.getByText('Checking session')).toBeTruthy();
  await act(() => session.set({ status: 'unauthenticated' }));
  expect(screen.queryByText('Private content')).toBeNull();
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/sign-in'));
  await act(() =>
    session.set({ status: 'authenticated', sessionKey: 'test-only' }),
  );
  expect(screen.getByText('Private content')).toBeTruthy();
  await act(() => session.set({ status: 'expired' }));
  expect(screen.queryByText('Private content')).toBeNull();
});

test('a signed-out link resumes its validated path after an external session arrives', async () => {
  mockReplace.mockClear();
  const session = adapter({ status: 'unauthenticated' });
  const { rerender } = await render(
    <SessionProvider adapter={session}>
      <PrivateLayout />
    </SessionProvider>,
  );
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/sign-in'));
  await rerender(
    <SessionProvider adapter={session}>
      <RootStack />
    </SessionProvider>,
  );
  await act(() =>
    session.set({ status: 'authenticated', sessionKey: 'test-only' }),
  );
  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith('/search', { withAnchor: true }),
  );
});

test('a cold link survives session restoration before authentication', async () => {
  mockReplace.mockClear();
  const session = adapter({ status: 'restoring' });
  const { rerender } = await render(
    <SessionProvider adapter={session}>
      <PrivateLayout />
    </SessionProvider>,
  );
  expect(mockReplace).not.toHaveBeenCalled();
  await rerender(
    <SessionProvider adapter={session}>
      <RootStack />
    </SessionProvider>,
  );
  await act(() =>
    session.set({ status: 'authenticated', sessionKey: 'test-only' }),
  );
  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith('/search', { withAnchor: true }),
  );
});

test('logout does not retain the previous account’s current private path', async () => {
  mockReplace.mockClear();
  const session = adapter({
    status: 'authenticated',
    sessionKey: 'account-one',
  });
  const { rerender } = await render(
    <SessionProvider adapter={session}>
      <PrivateLayout />
    </SessionProvider>,
  );
  await act(() => session.set({ status: 'unauthenticated' }));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/sign-in'));
  await rerender(
    <SessionProvider adapter={session}>
      <RootStack />
    </SessionProvider>,
  );
  await act(() =>
    session.set({ status: 'authenticated', sessionKey: 'account-two' }),
  );
  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith('/home', { withAnchor: true }),
  );
  expect(mockReplace).not.toHaveBeenCalledWith('/search', { withAnchor: true });
});

test('a direct account switch resets the navigation destination', async () => {
  mockReplace.mockClear();
  const session = adapter({
    status: 'authenticated',
    sessionKey: 'account-one',
  });
  await render(
    <SessionProvider adapter={session}>
      <RootStack />
    </SessionProvider>,
  );
  await act(() =>
    session.set({ status: 'authenticated', sessionKey: 'account-two' }),
  );
  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith('/home', { withAnchor: true }),
  );
});

test('verification restores the current destination only for the same session', async () => {
  mockReplace.mockClear();
  const session = adapter({
    status: 'authenticated',
    sessionKey: 'account-one',
  });
  await render(
    <SessionProvider adapter={session}>
      <RootStack />
      <PrivateLayout />
    </SessionProvider>,
  );
  await act(() => session.set({ status: 'verifying' }));
  await act(() =>
    session.set({ status: 'authenticated', sessionKey: 'account-one' }),
  );
  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith('/search', { withAnchor: true }),
  );
});

test('cold and warm native intents both reject untrusted destinations', () => {
  for (const initial of [true, false]) {
    expect(redirectSystemPath({ path: 'kanvexa-dev://search', initial })).toBe(
      '/search',
    );
    expect(
      redirectSystemPath({ path: 'https://evil.example/search', initial }),
    ).toBe('/');
    expect(
      redirectSystemPath({
        path: 'https://kanvexa.tech/%2e%2e/search',
        initial,
      }),
    ).toBe('/');
  }
});
