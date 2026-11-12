/* global jest, test, expect */
import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { createSessionManager } from '../src/infrastructure/auth/session-manager';
import { createCredentialStore } from '../src/infrastructure/auth/credential-store';
import {
  RealtimeProvider,
  useBoardRealtime,
} from '../src/infrastructure/realtime/RealtimeProvider';
import { EMPTY_BOARD_STATE } from '../src/infrastructure/realtime/rooms';
import {
  FakeTime,
  MemorySecureStore,
  USER_A,
  loginResponse,
  user,
} from './auth/support';

test('a focused feature owns one Board subscription; blur, logout and unmount clean it and its provider', async () => {
  const time = new FakeTime();
  const manager = createSessionManager({
    store: createCredentialStore(new MemorySecureStore()),
    clock: time,
    timers: time,
    api: {
      verify: async () => ({ kind: 'verified', user: user(USER_A) }),
      logout: async () => true,
    },
  });
  await manager.establishSession(loginResponse(USER_A));
  const release = jest.fn();
  const client = {
    start: jest.fn(),
    stop: jest.fn(),
    watchBoard: jest.fn(() => release),
    subscribeBoards: () => () => {},
    getBoardSnapshot: () => EMPTY_BOARD_STATE,
  };
  function Feature({ active }) {
    const state = useBoardRealtime(USER_A, active);
    return <Text>{state.status}</Text>;
  }
  const tree = (active) => (
    <SessionProvider manager={manager}>
      <RealtimeProvider client={client}>
        <Feature active={active} />
      </RealtimeProvider>
    </SessionProvider>
  );
  const rendered = await render(tree(true));
  expect(client.start).toHaveBeenCalledTimes(1);
  expect(client.watchBoard).toHaveBeenCalledTimes(1);
  await rendered.rerender(tree(false));
  expect(release).toHaveBeenCalledTimes(1);
  await rendered.rerender(tree(true));
  expect(client.watchBoard).toHaveBeenCalledTimes(2);
  await act(() => manager.logout());
  expect(release).toHaveBeenCalledTimes(2);
  await rendered.unmount();
  expect(client.stop).toHaveBeenCalledTimes(1);
  manager.dispose();
});
