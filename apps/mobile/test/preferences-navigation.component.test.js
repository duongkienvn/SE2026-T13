/* global jest, test, expect */
import React from 'react';
import { URL } from 'node:url';
import { Text } from 'react-native';
import { Stack, router } from 'expo-router';
import { focusManager } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  renderRouter,
  screen,
  waitFor,
} from 'expo-router/testing-library';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { createSessionManager } from '../src/infrastructure/auth/session-manager';
import { createCredentialStore } from '../src/infrastructure/auth/credential-store';
import { createHttpClient } from '../src/infrastructure/api/client';
import { createMobileDataLayer } from '../src/infrastructure/query/data-layer';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { notifyIncomingLink } from '../src/navigation/incoming-link';
import { Button } from '../src/ui';
import Route from '../src/app/(private)/notification-preferences';
import {
  FakeSessionApi,
  FakeTime,
  MemorySecureStore,
  USER_A,
  loginResponse,
  user,
} from './auth/support';
import { defaults } from './notifications/preferences-fixtures';
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

test('dirty native Back and warm links require Keep editing or Discard', async () => {
  const clock = new FakeTime(),
    auth = new FakeSessionApi();
  auth.auto = () => ({ kind: 'verified', user: user(USER_A) });
  const manager = createSessionManager({
    api: auth,
    store: createCredentialStore(new MemorySecureStore()),
    clock,
    timers: clock,
  });
  await manager.establishSession(loginResponse(USER_A));
  const data = createMobileDataLayer(
    manager,
    createHttpClient({
      baseUrl: new URL('https://example.test/api'),
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: {
          get: (name) => (name === 'content-type' ? 'application/json' : null),
        },
        text: async () =>
          JSON.stringify({
            success: true,
            statusCode: 200,
            message: 'OK',
            data: defaults(),
          }),
      }),
    }),
  );
  const view = await renderRouter(
    {
      _layout: () => (
        <SessionProvider manager={manager}>
          <DataProvider layer={data}>
            <Stack screenOptions={{ headerShown: false }} />
          </DataProvider>
        </SessionProvider>
      ),
      inbox: () => (
        <Button
          label="Open preferences"
          onPress={() => router.push('/notification-preferences')}
        />
      ),
      'notification-preferences': Route,
      tasks: () => <Text>Tasks destination</Text>,
    },
    { initialUrl: '/inbox' },
  );
  const press = async (name) =>
    fireEvent.press(await screen.findByRole('button', { name }));
  try {
    await press('Open preferences');
    await act(() => focusManager.setFocused(true));
    await fireEvent(
      await screen.findByRole('switch', { name: 'In-app: Card assignments' }),
      'valueChange',
      false,
    );
    await press('Back');
    await screen.findByText('Discard changes?');
    await press('Keep editing');
    expect(
      screen.getByRole('switch', {
        name: 'In-app: Card assignments',
        checked: false,
      }),
    ).toBeTruthy();
    let replacement;
    await act(() => {
      replacement = notifyIncomingLink({ kind: 'tab', tab: 'tasks' });
    });
    expect(replacement).toBe('/notification-preferences');
    await screen.findByText('Discard changes?');
    await press('Keep editing');
    await act(() => router.back());
    await screen.findByText('Discard changes?');
    await press('Discard');
    await waitFor(() => expect(screen).toHavePathname('/inbox'));
  } finally {
    await view.unmount();
    data.dispose();
    manager.dispose();
  }
});
