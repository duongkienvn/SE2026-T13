/* global jest,test,expect,afterEach */
import React, { useEffect } from 'react';
import { render, act, waitFor } from '@testing-library/react-native';
import { AccountThemeProvider } from '../src/features/preferences/AccountThemeProvider';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { SessionProvider as NavigationProvider } from '../src/navigation/session-context';
import { RootStack } from '../src/navigation/root-stack';
import { createNavigationSessionAdapter } from '../src/navigation/native-session-adapter';
import { redirectSystemPath } from '../src/app/+native-intent';
import { integration, ok } from './realtime/integration-support';
import { USER_A, USER_B, loginResponse } from './auth/support';
const mockReplace = jest.fn();
jest.mock('expo-router', () => {
  const Stack = () => null;
  Stack.Screen = () => null;
  Stack.Protected = () => null;
  return {
    Stack,
    usePathname: () => '/sign-in',
    useRouter: () => ({ replace: mockReplace }),
  };
});
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
let cleanup;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  mockReplace.mockClear();
});
test('theme keeps the navigation subtree and pending protected links across sign-in, logout and another account', async () => {
  const env = await integration();
  await env.manager.logout();
  env.respond(() =>
    Promise.resolve(
      ok({
        theme: 'dark',
        timeZone: 'UTC',
        dateFormat: 'YYYY-MM-DD',
        weekStartsOn: 'monday',
      }),
    ),
  );
  const adapter = createNavigationSessionAdapter(env.manager);
  let mounts = 0,
    unmounts = 0;
  function NavigationSubtree() {
    useEffect(() => {
      mounts++;
      return () => {
        unmounts++;
      };
    }, []);
    return (
      <NavigationProvider adapter={adapter}>
        <RootStack />
      </NavigationProvider>
    );
  }
  const view = await render(
    <SessionProvider manager={env.manager}>
      <DataProvider layer={env.data}>
        <AccountThemeProvider>
          <NavigationSubtree />
        </AccountThemeProvider>
      </DataProvider>
    </SessionProvider>,
  );
  cleanup = async () => {
    await view.unmount();
    env.dispose();
  };
  const first = `/boards/${USER_A}`,
    second = `/boards/${USER_B}`;
  await act(() =>
    redirectSystemPath({
      path: `kanvexa-dev://${first.slice(1)}`,
      initial: false,
    }),
  );
  await act(() => env.manager.establishSession(loginResponse(USER_A)));
  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith(first, { withAnchor: true }),
  );
  expect(mounts).toBe(1);
  expect(unmounts).toBe(0);
  await act(() => env.manager.logout());
  await act(() =>
    redirectSystemPath({
      path: `kanvexa-dev://${second.slice(1)}`,
      initial: false,
    }),
  );
  await act(() => env.manager.establishSession(loginResponse(USER_B)));
  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith(second, { withAnchor: true }),
  );
  expect(mounts).toBe(1);
  expect(unmounts).toBe(0);
});
