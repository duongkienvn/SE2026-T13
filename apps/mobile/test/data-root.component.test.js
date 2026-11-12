/* global jest, test, expect */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import RootLayout from '../src/app/_layout';
import {
  nativeData,
  nativeSession,
} from '../src/infrastructure/query/native-data';
import { loginResponse, USER_A } from './auth/support';
import { queryKeys } from '../src/infrastructure/query/keys';

jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove: jest.fn() }),
}));
jest.mock('../src/infrastructure/query/native-data', () => {
  const { createSessionManager } = jest.requireActual(
    '../src/infrastructure/auth/session-manager',
  );
  const { createCredentialStore } = jest.requireActual(
    '../src/infrastructure/auth/credential-store',
  );
  const { createHttpClient } = jest.requireActual(
    '../src/infrastructure/api/client',
  );
  const { createMobileDataLayer } = jest.requireActual(
    '../src/infrastructure/query/data-layer',
  );
  const { FakeTime, MemorySecureStore, USER_A, user } =
    jest.requireActual('./auth/support');
  const time = new FakeTime();
  const nativeSession = createSessionManager({
    store: createCredentialStore(new MemorySecureStore()),
    clock: time,
    timers: time,
    api: {
      verify: async () => ({ kind: 'verified', user: user(USER_A) }),
      logout: async () => true,
    },
  });
  const transport = createHttpClient({ baseUrl: null, fetch: jest.fn() });
  return {
    nativeSession,
    nativeData: createMobileDataLayer(nativeSession, transport),
  };
});
jest.mock('../src/navigation/root-stack', () => ({
  RootStack: () => {
    const React = jest.requireActual('react');
    const { Text } = jest.requireActual('react-native');
    const { useSession } = jest.requireActual(
      '../src/navigation/session-context',
    );
    const { useSessionSnapshot } = jest.requireActual(
      '../src/infrastructure/auth/SessionProvider',
    );
    const { useMobileData } = jest.requireActual(
      '../src/infrastructure/query/DataProvider',
    );
    const { useQueryClient } = jest.requireActual('@tanstack/react-query');
    const data = useMobileData();
    const client = useQueryClient();
    return React.createElement(
      Text,
      null,
      `${useSessionSnapshot().status}/${useSession().status}/${data.queryClient === client}`,
    );
  },
}));

test('actual root preserves secure session and navigation providers while exposing one query client', async () => {
  const rendered = await render(<RootLayout />);
  await waitFor(() =>
    expect(
      screen.getByText('unauthenticated/unauthenticated/true'),
    ).toBeTruthy(),
  );
  expect(nativeData.getIdentity()).toBeNull();
  await act(() => nativeSession.establishSession(loginResponse(USER_A)));
  expect(screen.getByText('authenticated/authenticated/true')).toBeTruthy();
  const key = queryKeys.me(nativeData.getIdentity());
  nativeData.queryClient.setQueryData(key, { private: 'test fixture' });
  await act(() => nativeSession.logout());
  expect(screen.getByText('unauthenticated/unauthenticated/true')).toBeTruthy();
  expect(nativeData.queryClient.getQueryData(key)).toBeUndefined();
  await rendered.unmount();
  nativeData.dispose();
  nativeSession.dispose();
});
