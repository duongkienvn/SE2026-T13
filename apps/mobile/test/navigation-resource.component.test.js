/* global jest, test, expect */
import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { ResourceBoundary } from '../src/navigation/resource-boundary';
import { SessionProvider } from '../src/navigation/session-context';

let mockPathname = '/boards/01234567-89ab-cdef-0123-456789abcdef';
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => mockPathname,
}));

test('revocation and unresolved sessions remove already rendered private content', async () => {
  let state = { status: 'authenticated', sessionKey: 'test-only' };
  const listeners = new Set();
  const adapter = {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      state = next;
      listeners.forEach((listener) => listener());
    },
  };
  const allowed = {
    status: 'allowed',
    sessionKey: 'test-only',
    resourcePath: mockPathname,
  };
  const view = (access) => (
    <SessionProvider adapter={adapter}>
      <ResourceBoundary access={access}>
        <Text>Private title</Text>
      </ResourceBoundary>
    </SessionProvider>
  );
  const { rerender } = await render(view(allowed));
  expect(screen.getByText('Private title')).toBeTruthy();
  await rerender(view('unavailable'));
  expect(screen.queryByText('Private title')).toBeNull();
  expect(screen.getByText('Resource unavailable')).toBeTruthy();
  await rerender(view(allowed));
  await act(() =>
    adapter.set({ status: 'authenticated', sessionKey: 'another-user' }),
  );
  expect(screen.queryByText('Private title')).toBeNull();
  await act(() =>
    adapter.set({ status: 'authenticated', sessionKey: 'test-only' }),
  );
  expect(screen.getByText('Private title')).toBeTruthy();
  mockPathname = '/boards/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  await rerender(view(allowed));
  expect(screen.queryByText('Private title')).toBeNull();
  mockPathname = allowed.resourcePath;
  await rerender(view(allowed));
  await act(() => adapter.set({ status: 'verifying' }));
  expect(screen.queryByText('Private title')).toBeNull();
  await act(() => adapter.set({ status: 'unauthenticated' }));
  expect(screen.queryByText('Private title')).toBeNull();
});
